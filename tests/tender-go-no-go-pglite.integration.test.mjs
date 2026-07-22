import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/022_tender_go_no_go_workflow.sql', import.meta.url), 'utf8');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111', director: '22222222-2222-4222-8222-222222222222', commercial: '33333333-3333-4333-8333-333333333333', agent: '88888888-8888-4888-8888-888888888888',
  opportunity: '44444444-4444-4444-8444-444444444444', tender: '55555555-5555-4555-8555-555555555555', analysis: '66666666-6666-4666-8666-666666666666', legacyDecision: '77777777-7777-4777-8777-777777777777',
  oldPreparation: '99999999-9999-4999-8999-999999999991', newPreparation: '99999999-9999-4999-8999-999999999992', invalid: '99999999-9999-4999-8999-999999999993',
};
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const count = async (db, sql, params = []) => Number((await one(db, sql, params)).count);
const preparationCount = db => count(db, `select count(*)::int as count from public.psi_sales_interactions where opportunity_id=$1 and interaction_type='documento' and public.psi_safe_jsonb(notes)->>'kind'='tender_offer_preparation'`, [ids.opportunity]);

async function createLegacyDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role service_role; alter role service_role bypassrls; grant service_role to current_user;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, role text not null, microsoft_email text not null, identity_type text default 'human');
    create table public.psi_access_permissions (code text primary key, active boolean not null default true);
    create table public.psi_profile_permissions (profile_id uuid not null references public.psi_sales_profiles(id), permission_code text not null references public.psi_access_permissions(code), primary key(profile_id, permission_code));
    create table public.psi_sales_opportunities (id uuid primary key, tipo_producto_original text, external_source text);
    create table public.psi_public_tenders (id uuid primary key, converted_opportunity_id uuid);
    create table public.psi_sales_interactions (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null, interaction_type text not null, created_by uuid not null, occurred_at timestamptz not null default now(), notes text);
    create table public.psi_tender_go_no_go_decisions (id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, decision text not null);
    grant insert, update, delete on public.psi_tender_go_no_go_decisions to service_role;
    insert into public.psi_sales_profiles (id, active, role, microsoft_email, identity_type) values
      ('${ids.admin}', true, 'admin', 'admin@example.test', default), ('${ids.director}', true, 'director', 'director@example.test', default),
      ('${ids.commercial}', true, 'comercial', 'commercial@example.test', default), ('${ids.agent}', true, 'admin', 'agent@example.test', 'agent');
    insert into public.psi_access_permissions values ('licitaciones', true);
    insert into public.psi_profile_permissions values ('${ids.admin}', 'licitaciones'), ('${ids.agent}', 'licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}', 'Licitación Pública', 'secop_radar:valid');
    insert into public.psi_public_tenders values ('${ids.tender}', '${ids.opportunity}');
    insert into public.psi_sales_interactions(id, opportunity_id, interaction_type, created_by, notes) values
      ('${ids.analysis}', '${ids.opportunity}', 'documento', '${ids.admin}', '{"kind":"tender_document_analysis","status":"analisis_generado"}'),
      ('${ids.invalid}', '${ids.opportunity}', 'documento', '${ids.admin}', 'not-json');
    insert into public.psi_tender_go_no_go_decisions(id, opportunity_id, tender_id, decision) values ('${ids.legacyDecision}', '${ids.opportunity}', '${ids.tender}', 'go');
  `);
  return db;
}
async function decide(db, actor, decision, preparation = { kind: 'tender_offer_preparation', owner: 'licitaciones' }, analysisId = ids.analysis) {
  return (await one(db, `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb) as result`, [ids.opportunity, ids.tender, actor, decision, analysisId, 'Margen y capacidad aprobados', preparation === null ? null : JSON.stringify(preparation)])).result;
}

await (async function preservesLegacyRowsAndIsReexecutable() {
  const db = await createLegacyDatabase(); await db.exec(migration); await db.exec(migration);
  const legacy = await one(db, `select id, decided_by is null as decided_by_is_null from public.psi_tender_go_no_go_decisions where id=$1`, [ids.legacyDecision]);
  assert.deepEqual(legacy, { id: ids.legacyDecision, decided_by_is_null: true });
  assert.equal(await count(db, `select count(*)::int as count from pg_indexes where schemaname='public' and indexname='psi_sales_interactions_tender_offer_preparation_unique'`), 0);
  assert.equal((await one(db, `select column_default from information_schema.columns where table_schema='public' and table_name='psi_sales_profiles' and column_name='identity_type'`)).column_default.includes('human'), true);
  await db.close();
})();

await (async function noGoNeverCreatesPreparationAndNullAnalysisIsAllowed() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  const noGo = await decide(db, ids.admin, 'no_go', null, null);
  assert.equal(noGo.preparation_created, false); assert.equal(noGo.preparation_id, null); assert.equal(await preparationCount(db), 0);
  const go = await decide(db, ids.admin, 'go', { kind: 'tender_offer_preparation' }, null);
  assert.equal(go.preparation_created, true); assert.equal(await preparationCount(db), 1);
  await db.close();
})();

await (async function repeatedGoCreatesOneCompatiblePreparation() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  const firstGo = await decide(db, ids.admin, 'go'); const secondGo = await decide(db, ids.admin, 'go');
  assert.equal(firstGo.preparation_created, true); assert.equal(secondGo.preparation_created, false); assert.equal(await preparationCount(db), 1);
  assert.equal((await one(db, `select interaction_type, notes::jsonb->>'kind' as kind from public.psi_sales_interactions where id=$1`, [firstGo.preparation_id])).interaction_type, 'documento');
  assert.equal(secondGo.supersedes_decision_id, firstGo.decision_id);
  const noGo = await decide(db, ids.admin, 'no_go'); assert.equal(noGo.preparation_created, false); assert.equal(noGo.tender_offer_status, 'cerrada_no_go');
  await db.close();
})();

await (async function preservesTwoHistoricalPreparationsAndReusesNewest() {
  const db = await createLegacyDatabase();
  await db.exec(`insert into public.psi_sales_interactions(id, opportunity_id, interaction_type, created_by, occurred_at, notes) values
    ('${ids.oldPreparation}', '${ids.opportunity}', 'documento', '${ids.admin}', '2026-01-01T00:00:00Z', '{"kind":"tender_offer_preparation","version":"old"}'),
    ('${ids.newPreparation}', '${ids.opportunity}', 'documento', '${ids.admin}', '2026-02-01T00:00:00Z', '{"kind":"tender_offer_preparation","version":"new"}');`);
  await db.exec(migration); await db.exec(migration);
  const result = await decide(db, ids.admin, 'go');
  assert.equal(await preparationCount(db), 2); assert.equal(result.preparation_created, false); assert.equal(result.preparation_id, ids.newPreparation);
  await db.close();
})();

await (async function rejectsInvalidPreparationAndAnalysisWithoutEffects() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  await assert.rejects(() => decide(db, ids.admin, 'go', { owner: 'wrong' }), /preparación/i);
  await assert.rejects(() => decide(db, ids.admin, 'go', { kind: 'tender_offer_preparation' }, ids.invalid), /análisis/i);
  await assert.rejects(() => decide(db, ids.admin, 'go', null), /preparación/i);
  assert.equal(await preparationCount(db), 0);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where id <> $1`, [ids.legacyDecision]), 0);
  await db.close();
})();

await (async function serviceRoleCanOnlyAppendThroughSecurityDefinerRpc() {
  const db = await createLegacyDatabase(); await db.exec(migration); await db.exec('set role service_role');
  await assert.rejects(() => db.query(`insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, decided_by) values ('${ids.opportunity}', '${ids.tender}', 'go', '${ids.admin}')`), /permission denied/i);
  await assert.rejects(() => db.query(`update public.psi_tender_go_no_go_decisions set decision='no_go' where id='${ids.legacyDecision}'`), /permission denied/i);
  await assert.rejects(() => db.query(`delete from public.psi_tender_go_no_go_decisions where id='${ids.legacyDecision}'`), /permission denied/i);
  assert.equal((await decide(db, ids.admin, 'go')).decision, 'go'); await db.exec('reset role'); await db.close();
})();

await (async function rejectsBadRolesAndRollsBackAuditFailure() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  await assert.rejects(() => decide(db, ids.commercial, 'go'), /permisos/i); await assert.rejects(() => decide(db, ids.agent, 'go'), /permisos/i);
  await db.exec(`create function public.fail_go_no_go_insert() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$; create trigger fail_go_no_go_insert before insert on public.psi_tender_go_no_go_decisions for each row execute function public.fail_go_no_go_insert();`);
  await assert.rejects(() => decide(db, ids.admin, 'go'), /forced audit failure/);
  assert.equal(await preparationCount(db), 0); assert.equal((await one(db, `select tender_offer_status from public.psi_sales_opportunities where id=$1`, [ids.opportunity])).tender_offer_status, null);
  await db.close();
})();

console.log('PGlite tender GO/NO-GO migration integration passed');
