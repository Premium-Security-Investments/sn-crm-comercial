import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { readStatus, verify, rollback, apply, classify, STATE_SQL } from '../scripts/tender-document-state-migrations.mjs';

const decisionMigration = readFileSync(new URL('../supabase/migrations/022_tender_go_no_go_workflow.sql', import.meta.url), 'utf8');
const analysisMigration = readFileSync(new URL('../supabase/migrations/025_tender_analysis_foundation.sql', import.meta.url), 'utf8');

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
};
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const hash = character => character.repeat(64);

function pgliteExecSql(db) {
  return async sql => {
    const results = await db.exec(sql);
    const last = results[results.length - 1];
    return Array.isArray(last?.rows) ? last.rows : [];
  };
}

async function createPreMigrationDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
    create function public.psi_sales_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null default 'admin', microsoft_email text not null default 'test@example.test', identity_type text default 'human');
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null references public.psi_sales_profiles(id), permission_code text not null references public.psi_access_permissions(code), primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key, tipo_producto_original text, external_source text, tender_offer_status text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid references public.psi_sales_opportunities(id));
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null default now(), notes text);
    insert into public.psi_sales_profiles (id, active, identity_type) values ('${ids.actor}', true, 'human');
    insert into public.psi_access_permissions values ('licitaciones', true);
    insert into public.psi_profile_permissions values ('${ids.actor}', 'licitaciones');
    insert into public.psi_sales_opportunities (id, tipo_producto_original, external_source) values ('${ids.opportunity}', 'Licitación Pública', 'secop_radar:current');
    insert into public.psi_public_tenders (id, converted_opportunity_id) values ('${ids.tender}', '${ids.opportunity}');
  `);
  await db.exec(decisionMigration);
  await db.exec(analysisMigration);
  return db;
}

async function recordTenderDocument(db, overrides = {}) {
  const input = {
    opportunityId: ids.opportunity, tenderId: ids.tender, source: 'secop', sourceDocumentId: 'official-42',
    name: 'Pliego oficial.pdf', contentHash: hash('a'), storagePath: `tender-documents/${ids.opportunity}/official-42/a.pdf`,
    mimeType: 'application/pdf', sizeBytes: 1024, documentType: 'pliego', extractedText: 'Texto oficial',
    sourceUrl: null, actorId: ids.actor, ...overrides,
  };
  return (await one(db, `select public.psi_record_tender_document_version(
    $1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid
  ) as result`, [
    input.opportunityId, input.tenderId, input.source, input.sourceDocumentId, input.name, input.contentHash,
    input.storagePath, input.mimeType, input.sizeBytes, input.documentType, input.extractedText, input.sourceUrl, input.actorId,
  ])).result;
}

await (async function applyVerifyRollbackReapplyPreservesDataAndBehavior() {
  const db = await createPreMigrationDatabase();
  const execSql = pgliteExecSql(db);

  // 1. PENDING: nothing from 026/027 exists yet.
  const initial = await readStatus(execSql);
  assert.equal(initial.status, 'pending');
  await assert.rejects(() => verify(execSql), /pending/);

  // 2. APPLY: applies 026 then 027 and verifies structurally.
  const applied = await apply(execSql);
  assert.equal(applied.status, 'applied');
  await verify(execSql); // read-only, must not throw

  // 2b. Re-running apply must be a no-op (026/027 are not blindly re-runnable — see rollback safety test).
  const [row] = await execSql(STATE_SQL);
  assert.equal(classify(row).status, 'applied');
  const secondApply = await apply(execSql);
  assert.equal(secondApply.status, 'applied');

  // 3. Real data flowing through the 026/027 surface, to prove rollback never destroys it.
  const firstVersion = await recordTenderDocument(db);
  assert.equal(firstVersion.status, 'created');
  const refreshToken = (await one(db, `select public.psi_begin_tender_document_refresh($1::uuid,$2::uuid) as token`, [ids.opportunity, ids.tender])).token;
  const snapshot = (await one(db, `select public.psi_record_tender_document_snapshot($1::uuid,$2::uuid,$3::text,$4::text,$5::jsonb,$6::jsonb,$7::uuid,$8::uuid) as result`, [
    ids.opportunity, ids.tender, hash('b'), hash('c'), JSON.stringify({ documents: [] }), JSON.stringify({}), ids.actor, refreshToken,
  ])).result;
  const decision = (await one(db, `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb,$8::text) as result`, [
    ids.opportunity, ids.tender, ids.actor, 'go', null, 'Justificación de prueba', JSON.stringify({ kind: 'tender_offer_preparation' }), hash('b'),
  ])).result;
  assert.equal(decision.decision, 'go');

  // 4. ROLLBACK: reverse (LIFO) order, must return to pending and must not delete the data recorded above.
  const rolledBack = await rollback(execSql);
  assert.equal(rolledBack.status, 'pending');
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_document_versions where id = '${firstVersion.id}'`)).count), 1, 'rollback must not delete tender document versions');
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where id = '${decision.decision_id}'`)).count), 1, 'rollback must not delete GO/NO GO decisions');
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_document_state where opportunity_id = '${ids.opportunity}'`)).count), 1, 'rollback must not drop or empty the document-state pointer table');

  // 4b. The 8-argument (026/027-era) RPC surface must now be unreachable for service_role.
  // PGlite's current_user is a superuser that bypasses ACL checks, so the
  // revoked grant is only observable by actually assuming service_role.
  await db.exec('set role service_role');
  await assert.rejects(
    () => db.query(`select public.psi_record_tender_document_version($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::bigint,$10::text,$11::text,$12::text,$13::uuid) as result`, [
      ids.opportunity, ids.tender, 'secop', 'official-99', 'x', hash('d'), `tender-documents/${ids.opportunity}/official-99/x.pdf`, 'application/pdf', 1, 'pliego', 'Texto', null, ids.actor,
    ]),
    /permission denied/i,
  );
  // The 027-era 8-argument overload is dropped outright (not merely revoked)
  // by the rollback, since it is replaced by the restored 7-argument 025
  // signature — so this now fails as an unresolvable function call.
  await assert.rejects(
    () => db.query(`select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb,$8::text) as result`, [
      ids.opportunity, ids.tender, ids.actor, 'go', null, null, JSON.stringify({ kind: 'tender_offer_preparation' }), hash('b'),
    ]),
    /does not exist/i,
  );

  // 4c. The pre-026/027 (025-era) 7-argument GO/NO GO signature is restored and callable.
  const restoredDecision = (await one(db, `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb) as result`, [
    ids.opportunity, ids.tender, ids.actor, 'no_go', null, 'Reversión operativa', null,
  ])).result;
  assert.equal(restoredDecision.decision, 'no_go');
  await db.exec('reset role');

  // 5. REAPPLY: must succeed idempotently and must not disturb data retained through rollback.
  const reapplied = await apply(execSql);
  assert.equal(reapplied.status, 'applied');
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_document_versions where id = '${firstVersion.id}'`)).count), 1, 'reapply must not delete data retained through rollback');
  assert.equal(Number((await one(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions`)).count), 2, 'both the pre-rollback and post-rollback decisions must survive reapply');

  // 5b. New capability works again after reapply.
  const secondVersion = await recordTenderDocument(db, { sourceDocumentId: 'official-100', contentHash: hash('e'), storagePath: `tender-documents/${ids.opportunity}/official-100/e.pdf` });
  assert.equal(secondVersion.status, 'created');

  await db.close();
})();

console.log('PGlite 026/027 apply->verify->rollback->reapply lifecycle passed');
