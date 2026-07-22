import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/022_tender_go_no_go_workflow.sql', import.meta.url), 'utf8');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  director: '22222222-2222-4222-8222-222222222222',
  commercial: '33333333-3333-4333-8333-333333333333',
  agent: '88888888-8888-4888-8888-888888888888',
  opportunity: '44444444-4444-4444-8444-444444444444',
  tender: '55555555-5555-4555-8555-555555555555',
  analysis: '66666666-6666-4666-8666-666666666666',
  legacyDecision: '77777777-7777-4777-8777-777777777777',
};
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

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
    -- A valid partial legacy audit table must survive the additive migration.
    create table public.psi_tender_go_no_go_decisions (id uuid primary key, opportunity_id uuid not null, tender_id uuid not null, decision text not null);
    insert into public.psi_sales_profiles (id, active, role, microsoft_email, identity_type) values
      ('${ids.admin}', true, 'admin', 'admin@example.test', default),
      ('${ids.director}', true, 'director', 'director@example.test', default),
      ('${ids.commercial}', true, 'comercial', 'commercial@example.test', default),
      ('${ids.agent}', true, 'admin', 'agent@example.test', 'agent');
    insert into public.psi_access_permissions values ('licitaciones', true);
    insert into public.psi_profile_permissions values ('${ids.admin}', 'licitaciones'), ('${ids.agent}', 'licitaciones');
    insert into public.psi_sales_opportunities values ('${ids.opportunity}', 'Licitación Pública', 'secop_radar:valid');
    insert into public.psi_public_tenders values ('${ids.tender}', '${ids.opportunity}');
    insert into public.psi_sales_interactions(id, opportunity_id, interaction_type, created_by, notes) values
      ('${ids.analysis}', '${ids.opportunity}', 'analisis_licitacion', '${ids.admin}', 'Análisis listo');
    insert into public.psi_tender_go_no_go_decisions(id, opportunity_id, tender_id, decision) values
      ('${ids.legacyDecision}', '${ids.opportunity}', '${ids.tender}', 'go');
  `);
  return db;
}

async function decide(db, actor, decision, justification = 'Margen y capacidad aprobados') {
  return (await one(db, `select public.psi_record_tender_go_no_go($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::text,$7::jsonb) as result`, [
    ids.opportunity, ids.tender, actor, decision, ids.analysis, justification, JSON.stringify({ owner: 'licitaciones' }),
  ])).result;
}
const count = async (db, sql, params = []) => Number((await one(db, sql, params)).count);

await (async function preservesLegacyRowsAndIsReexecutable() {
  const db = await createLegacyDatabase();
  await db.exec(migration);
  const legacy = await one(db, `select id, opportunity_id, tender_id, decision, decided_by is null as decided_by_is_null from public.psi_tender_go_no_go_decisions where id=$1`, [ids.legacyDecision]);
  assert.deepEqual(legacy, { id: ids.legacyDecision, opportunity_id: ids.opportunity, tender_id: ids.tender, decision: 'go', decided_by_is_null: true });
  await db.exec(migration);
  assert.equal(await count(db, `select count(*)::int as count from pg_indexes where schemaname='public' and indexname='psi_sales_interactions_tender_offer_preparation_unique'`), 1);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where id=$1`, [ids.legacyDecision]), 1);
  await db.close();
})();

await (async function recordsDecisionChainAndCreatesOnlyOnePreparation() {
  const db = await createLegacyDatabase(); await db.exec(migration); await db.exec(migration);
  const firstGo = await decide(db, ids.admin, 'go');
  const secondGo = await decide(db, ids.admin, 'go');
  assert.equal(firstGo.preparation_created, true);
  assert.equal(secondGo.preparation_created, false);
  assert.equal((await one(db, `select decided_by from public.psi_tender_go_no_go_decisions where id=$1`, [firstGo.decision_id])).decided_by, ids.admin);
  assert.equal(firstGo.tender_offer_status, 'en_preparacion');
  assert.equal(secondGo.supersedes_decision_id, firstGo.decision_id);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_sales_interactions where opportunity_id=$1 and interaction_type='tender_offer_preparation'`, [ids.opportunity]), 1);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where opportunity_id=$1`, [ids.opportunity]), 3);
  const noGo = await decide(db, ids.admin, 'no_go', 'Riesgo contractual no aceptable');
  assert.equal(noGo.preparation_created, false);
  assert.equal(noGo.tender_offer_status, 'cerrada_no_go');
  assert.equal(noGo.supersedes_decision_id, secondGo.decision_id);
  await db.close();
})();

await (async function rejectsBadRolesPermissionsAndNonTenderOriginsWithoutEffects() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  await assert.rejects(() => decide(db, ids.commercial, 'go'), /permisos/i);
  await assert.rejects(() => decide(db, ids.director, 'go'), /permisos/i);
  await assert.rejects(() => decide(db, ids.agent, 'go'), /permisos/i);
  await db.exec(`delete from public.psi_profile_permissions where profile_id='${ids.admin}'; insert into public.psi_profile_permissions values ('${ids.director}','licitaciones'); update public.psi_sales_opportunities set tipo_producto_original='Servicio privado', external_source='manual:one' where id='${ids.opportunity}';`);
  await assert.rejects(() => decide(db, ids.director, 'go'), /licitación/i);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where id <> $1`, [ids.legacyDecision]), 0);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_sales_interactions where interaction_type='tender_offer_preparation'`), 0);
  await db.close();
})();

await (async function serviceRoleCanOnlyAppendThroughTheSecurityDefinerRpc() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  await db.exec('set role service_role');
  await assert.rejects(
    () => db.query(`insert into public.psi_tender_go_no_go_decisions (opportunity_id, tender_id, decision, decided_by) values ('${ids.opportunity}', '${ids.tender}', 'go', '${ids.admin}')`),
    /permission denied/i,
  );
  const result = await decide(db, ids.admin, 'go');
  assert.equal(result.decision, 'go');
  assert.equal(await count(db, `select count(*)::int as count from public.psi_tender_go_no_go_decisions where id <> $1`, [ids.legacyDecision]), 1);
  await db.exec('reset role');
  await db.close();
})();

await (async function rollsBackAllEffectsWhenAuditInsertFails() {
  const db = await createLegacyDatabase(); await db.exec(migration);
  await db.exec(`create function public.fail_go_no_go_insert() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$; create trigger fail_go_no_go_insert before insert on public.psi_tender_go_no_go_decisions for each row execute function public.fail_go_no_go_insert();`);
  await assert.rejects(() => decide(db, ids.admin, 'go'), /forced audit failure/);
  assert.equal(await count(db, `select count(*)::int as count from public.psi_sales_interactions where interaction_type='tender_offer_preparation'`), 0);
  assert.equal((await one(db, `select tender_offer_status from public.psi_sales_opportunities where id=$1`, [ids.opportunity])).tender_offer_status, null);
  await db.close();
})();

console.log('PGlite tender GO/NO-GO migration integration passed');
