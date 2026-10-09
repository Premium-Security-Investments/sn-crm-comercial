// Migraciones 117, 118 y 119 sobre PostgreSQL aislado (PGlite): reservas v2 con cupo del equipo y por persona en hora
// de Bogotá (periodo que entrega el servidor), misma semántica de uso que las originales, compatibilidad con la reserva
// original, perfil de uso de IA de cada persona con auditoría, permisos sólo para service_role y reversas limpias.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';

const read = path => stripTopLevelTransactionWrapper(readFileSync(new URL(path, import.meta.url), 'utf8'));
const m043 = read('../supabase/migrations/043_agt003_copilot_runs.sql');
const m114 = read('../supabase/migrations/114_agt003_lead_deep_analysis.sql');
const m117 = read('../supabase/migrations/117_agt003_copilot_quota_by_actor.sql');
const m118 = read('../supabase/migrations/118_agt003_lead_analysis_quota_by_actor.sql');
const m119 = read('../supabase/migrations/119_crm_profile_ai_usage_profile.sql');
const r117 = read('../supabase/rollbacks/117_agt003_copilot_quota_by_actor_rollback.sql');
const r118 = read('../supabase/rollbacks/118_agt003_lead_analysis_quota_by_actor_rollback.sql');
const r119 = read('../supabase/rollbacks/119_crm_profile_ai_usage_profile_rollback.sql');

const ANA = '00000000-0000-4000-8000-0000000000aa';
const LUIS = '00000000-0000-4000-8000-0000000000bb';
const AGENT = '00000000-0000-4000-8000-0000000000cc';
const OPP = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'];
const key = char => char.repeat(64);

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_profiles (id uuid primary key, identity_type text default 'human', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_access_audit_log (
      id uuid primary key default gen_random_uuid(), actor_profile_id uuid, target_profile_id uuid, action text not null,
      before_state jsonb, after_state jsonb, created_at timestamptz not null default now());
    insert into public.psi_sales_profiles(id, identity_type, full_name) values ('${ANA}', 'human', 'Ana'), ('${LUIS}', 'human', 'Luis'), ('${AGENT}', 'agent', 'Vig-IA');
    insert into public.psi_sales_opportunities values ${OPP.map(id => `('${id}')`).join(', ')};
  `);
  await pg.exec(m043);
  await pg.exec(m114);
  await pg.exec(m117);
  await pg.exec(m118);
  await pg.exec(m119);
  return pg;
}

// Inicio del día de hoy en Bogotá calculado igual que el servidor (medianoche de Bogotá = 05:00 UTC).
const BOGOTA_DAY_START = `(date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota')`;

async function claimCopilot(pg, idempotencyKey, actor, teamMax, actorMax = null, concurrent = 5) {
  const result = await pg.query(`select public.psi_claim_agt003_copilot_run_v2($1, $2, $3, ${BOGOTA_DAY_START}, $4, case when $4::int is null then null else ${BOGOTA_DAY_START} end, $5, 30) as r`,
    [idempotencyKey, actor, teamMax, actorMax, concurrent]);
  return result.rows[0].r;
}

async function insertRun(pg, idempotencyKey, actor, createdAtSql, status = 'completed') {
  await pg.query(`insert into public.psi_agt003_copilot_runs(idempotency_key, opportunity_id, snapshot_id, actor_id, contract_version, capability_id, policy_version, model, status, output, usage, input_hash, output_hash, failure_code, created_at)
    values ($1, $2, 's', $3, '2', 'agt003.opportunity-copilot.preview', 'p', 'sonnet', $4,
            case when $4 = 'completed' then '{"ok":true}'::jsonb end, '{}'::jsonb, $5,
            case when $4 = 'completed' then $5 end, case when $4 = 'failed' then 'X' end, ${createdAtSql})`,
  [idempotencyKey, OPP[0], actor, status, key('f')]);
}

test('117: cupo del equipo y por persona en el día de Bogotá; cuentan completados, fallidos y reservas vivas', async () => {
  const pg = await freshDb();
  // Ayer (antes de la medianoche de Bogotá) no cuenta.
  await insertRun(pg, key('1'), ANA, `${BOGOTA_DAY_START} - interval '1 second'`);
  // Hoy: un completado de Ana y un fallido de Luis.
  await insertRun(pg, key('2'), ANA, `${BOGOTA_DAY_START} + interval '1 second'`);
  await insertRun(pg, key('3'), LUIS, `${BOGOTA_DAY_START} + interval '2 seconds'`, 'failed');

  // Ana con cupo personal 2: lleva 1 (el de ayer no cuenta) → reserva; con la reserva viva ya lleva 2.
  const first = await claimCopilot(pg, key('a'), ANA, 10, 2);
  assert.equal(first.status, 'claimed');
  assert.deepEqual(await claimCopilot(pg, key('b'), ANA, 10, 2), { status: 'quota', scope: 'actor', used: 2, max: 2 }, 'la reserva viva cuenta para la persona');
  // Luis no tiene cupo personal (null): sólo el equipo (3 usos hoy: 2 ejecuciones + 1 reserva viva).
  assert.equal((await claimCopilot(pg, key('c'), LUIS, 10)).status, 'claimed');
  assert.deepEqual(await claimCopilot(pg, key('d'), LUIS, 4), { status: 'quota', scope: 'team', used: 4, max: 4 }, 'equipo: 2 ejecuciones + 2 reservas vivas');
  // El equipo se revisa antes que la persona.
  assert.equal((await claimCopilot(pg, key('e'), ANA, 4, 1)).scope, 'team');
  // Cupo 0 del equipo: todo rechazado.
  assert.equal((await claimCopilot(pg, key('f'), LUIS, 0)).status, 'quota');
  // La reserva guarda quién pidió; la idempotencia y "en curso" no cambian.
  assert.equal((await pg.query('select actor_id from public.psi_agt003_copilot_claims where idempotency_key = $1', [key('a')])).rows[0].actor_id, ANA);
  assert.equal((await claimCopilot(pg, key('a'), ANA, 10, 5)).status, 'in_progress');
  assert.equal((await claimCopilot(pg, key('2'), ANA, 10, 5)).status, 'existing');
});

test('117: saturación, validación de parámetros y convivencia con la reserva original (mismo lock)', async () => {
  const pg = await freshDb();
  assert.equal((await claimCopilot(pg, key('a'), ANA, 10, null, 1)).status, 'claimed');
  assert.equal((await claimCopilot(pg, key('b'), ANA, 10, null, 1)).status, 'saturated');
  const legacy = (await pg.query('select public.psi_claim_agt003_copilot_run($1, 20, 5, 30) as r', [key('c')])).rows[0].r;
  assert.equal(legacy.status, 'claimed', 'la reserva original sigue funcionando');
  for (const [sql, params] of [
    ['select public.psi_claim_agt003_copilot_run_v2($1, $2, -1, now(), null, null, 1, 30)', [key('d'), ANA]],
    ['select public.psi_claim_agt003_copilot_run_v2($1, $2, 5, now() + interval \'1 day\', null, null, 1, 30)', [key('d'), ANA]],
    ['select public.psi_claim_agt003_copilot_run_v2($1, $2, 5, now() - interval \'40 days\', null, null, 1, 30)', [key('d'), ANA]],
    ['select public.psi_claim_agt003_copilot_run_v2($1, $2, 5, now(), 2, null, 1, 30)', [key('d'), ANA]],
    ['select public.psi_claim_agt003_copilot_run_v2($1, null, 5, now(), null, null, 1, 30)', [key('d')]],
  ]) {
    await assert.rejects(pg.query(sql, params), /no (es|son) válid/);
  }
});

async function claimLead(pg, opp, actor, hash, teamMax, actorMax = null, start = `date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota'`) {
  return (await pg.query(`select public.psi_claim_agt003_lead_analysis_v2($1, $2, $3, '1.0', $4, ${start}, $5, case when $5::int is null then null else ${start} end) as r`,
    [opp, actor, hash, teamMax, actorMax])).rows[0].r;
}
const finishLead = (pg, id, status) => pg.query(`select public.psi_finish_agt003_lead_analysis($1, $2, 'sonnet', null, 'leida', $3::jsonb, null, $4)`,
  [id, status, status === 'completed' ? '{"ok":true}' : null, status === 'failed' ? 'X' : null]);

test('118: cupo del equipo y por persona del análisis profundo; los fallidos no cuentan; "existe" antes del cupo', async () => {
  const pg = await freshDb();
  const first = await claimLead(pg, OPP[0], ANA, key('a'), 3, 1);
  assert.equal(first.status, 'claimed');
  await finishLead(pg, first.id, 'completed');
  assert.deepEqual(await claimLead(pg, OPP[1], ANA, key('a'), 3, 1), { status: 'quota', scope: 'actor', used: 1, max: 1 });
  assert.equal((await claimLead(pg, OPP[0], ANA, key('a'), 3, 1)).status, 'existing', 'ya analizado: se devuelve aunque no haya cupo');
  const failed = await claimLead(pg, OPP[1], LUIS, key('a'), 3);
  await finishLead(pg, failed.id, 'failed');
  const luis = await claimLead(pg, OPP[1], LUIS, key('a'), 3);
  assert.equal(luis.status, 'claimed', 'un fallido no consume cupo');
  assert.equal((await claimLead(pg, OPP[1], LUIS, key('a'), 3)).status, 'in_progress');
  await finishLead(pg, luis.id, 'completed');
  assert.deepEqual(await claimLead(pg, OPP[2], LUIS, key('a'), 2), { status: 'quota', scope: 'team', used: 2, max: 2 });
  // La reserva original (114) sigue disponible y comparte el lock.
  assert.equal((await pg.query(`select public.psi_claim_agt003_lead_analysis($1, $2, $3, '1.0', 10, date_trunc('month', now())) as r`, [OPP[3], LUIS, key('a')])).rows[0].r.status, 'claimed');
  await assert.rejects(claimLead(pg, OPP[2], LUIS, key('b'), 2, 1, 'null::timestamptz'), /cupo/);
});

test('119: perfil de uso de IA con formato, auditoría sólo si cambia y sin identidades de agentes', async () => {
  const pg = await freshDb();
  const set = (profile, value) => pg.query('select public.psi_admin_set_profile_ai_usage_profile($1, $2, $3) as r', [profile, value, LUIS]);
  assert.deepEqual((await set(ANA, 'comercial')).rows[0].r, { id: ANA, ai_usage_profile: 'comercial' });
  await set(ANA, 'comercial');
  await set(ANA, null);
  const audit = (await pg.query(`select action, before_state, after_state from public.psi_access_audit_log order by created_at, id`)).rows;
  assert.equal(audit.length, 2, 'sin cambio no hay registro');
  assert.ok(audit.every(row => row.action === 'profile.ai_usage_profile.set'));
  assert.deepEqual(audit.map(row => row.after_state.ai_usage_profile).sort(), [null, 'comercial'].sort());
  await assert.rejects(set(ANA, 'Mal Valor'), /inválido/);
  await assert.rejects(set(AGENT, 'comercial'), /agentes/);
  await assert.rejects(pg.query(`update public.psi_sales_profiles set ai_usage_profile = 'X' where id = $1`, [ANA]), /ai_usage_profile_format/);
});

test('permisos: sólo service_role ejecuta las funciones nuevas', async () => {
  const pg = await freshDb();
  const rows = (await pg.query(`select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
     where p.proname in ('psi_claim_agt003_copilot_run_v2', 'psi_claim_agt003_lead_analysis_v2', 'psi_admin_set_profile_ai_usage_profile')`)).rows;
  assert.equal(rows.length, 9);
  for (const row of rows) assert.equal(row.can, row.rolname === 'service_role', `${row.proname} / ${row.rolname}`);
});

test('reversas: dejan las reservas originales funcionando', async () => {
  const pg = await freshDb();
  await pg.exec(r119);
  await pg.exec(r118);
  await pg.exec(r117);
  const remaining = (await pg.query(`select proname from pg_proc where proname in ('psi_claim_agt003_copilot_run_v2', 'psi_claim_agt003_lead_analysis_v2', 'psi_admin_set_profile_ai_usage_profile')`)).rows;
  assert.equal(remaining.length, 0);
  assert.equal((await pg.query(`select count(*)::int as n from information_schema.columns where table_name in ('psi_sales_profiles', 'psi_agt003_copilot_claims') and column_name in ('ai_usage_profile', 'actor_id')`)).rows[0].n, 0);
  assert.equal((await pg.query('select public.psi_claim_agt003_copilot_run($1, 20, 5, 30) as r', [key('9')])).rows[0].r.status, 'claimed');
  // Reaplicar es idempotente.
  await pg.exec(m117); await pg.exec(m117); await pg.exec(m118); await pg.exec(m119); await pg.exec(m119);
});
