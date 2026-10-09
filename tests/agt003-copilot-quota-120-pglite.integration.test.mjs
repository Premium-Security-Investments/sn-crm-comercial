// Migración 120 (escrita, NO aplicada) sobre PostgreSQL aislado (PGlite): una falla del proveedor no consume cupo del
// "Próximo seguimiento". La reserva v2 cuenta sólo ejecuciones completadas + reservas vivas; todo lo demás
// (idempotencia, "en curso", saturación, permisos) queda igual. La reversa vuelve a contar las fallidas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';

const raw = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const read = path => stripTopLevelTransactionWrapper(raw(path));
const M120 = '../supabase/migrations/120_agt003_copilot_quota_skip_provider_failures.sql';
const R120 = '../supabase/rollbacks/120_agt003_copilot_quota_skip_provider_failures_rollback.sql';

const ANA = '00000000-0000-4000-8000-0000000000aa';
const LUIS = '00000000-0000-4000-8000-0000000000bb';
const OPP = '00000000-0000-4000-8000-000000000001';
const key = char => char.repeat(64);
const DAY_START = `(date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota')`;

async function freshDb({ with120 = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_profiles (id uuid primary key, identity_type text default 'human', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    insert into public.psi_sales_profiles(id) values ('${ANA}'), ('${LUIS}');
    insert into public.psi_sales_opportunities values ('${OPP}');
  `);
  await pg.exec(read('../supabase/migrations/043_agt003_copilot_runs.sql'));
  await pg.exec(read('../supabase/migrations/117_agt003_copilot_quota_by_actor.sql'));
  if (with120) await pg.exec(read(M120));
  return pg;
}

async function insertRun(pg, idempotencyKey, actor, status) {
  await pg.query(`insert into public.psi_agt003_copilot_runs(idempotency_key, opportunity_id, snapshot_id, actor_id, contract_version, capability_id, policy_version, model, status, output, usage, input_hash, output_hash, failure_code, created_at)
    values ($1, $2, 's', $3, '2', 'agt003.opportunity-copilot.preview', 'p', 'sonnet', $4,
            case when $4 = 'completed' then '{"ok":true}'::jsonb end, '{}'::jsonb, $5,
            case when $4 = 'completed' then $5 end, case when $4 = 'failed' then 'AGT003_CLAUDE_LOGIN_REQUIRED' end, ${DAY_START} + interval '1 second')`,
  [idempotencyKey, OPP, actor, status, key('f')]);
}

const claim = async (pg, idempotencyKey, actor, teamMax, actorMax = null) => (await pg.query(
  `select public.psi_claim_agt003_copilot_run_v2($1, $2, $3, ${DAY_START}, $4, case when $4::int is null then null else ${DAY_START} end, 5, 30) as r`,
  [idempotencyKey, actor, teamMax, actorMax])).rows[0].r;

test('120 es el siguiente número libre, con transacción, reversa y sin sentencias destructivas', () => {
  const numbers = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map(name => name.slice(0, 3));
  assert.equal(numbers.filter(value => value === '120').length, 1);
  assert.equal(Math.max(...numbers.map(Number).filter(Number.isFinite)), 120);
  const sql = raw(M120);
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /commit;\s*$/);
  // Fuera del cuerpo de la función ($$…$$, que conserva la limpieza de reservas vencidas de 117) no hay DDL ni DML.
  const outside = text => text.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.doesNotMatch(outside(sql), /drop |delete from|truncate|alter table|insert into|update /i);
  assert.ok(sql.includes("run.status = 'completed' and run.created_at >= p_team_period_start"));
  assert.ok(sql.includes("run.status = 'completed' and run.actor_id = p_actor_id"));
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtextextended('psi_agt003_copilot_claims:v1', 0))"), 'mismo lock');
  assert.doesNotMatch(sql, /function public\.psi_claim_agt003_copilot_run\(/, 'la reserva original no se toca');
  assert.doesNotMatch(outside(raw(R120)), /drop |delete from|truncate|alter table|insert into|update /i);
});

test('120: las ejecuciones fallidas ya no consumen cupo (equipo ni persona); las completadas sí', async () => {
  const pg = await freshDb();
  await insertRun(pg, key('1'), ANA, 'failed');
  await insertRun(pg, key('2'), ANA, 'failed');
  await insertRun(pg, key('3'), ANA, 'completed');
  // Equipo con cupo 2: sólo 1 completada cuenta → reserva (y esa reserva viva ya cuenta).
  assert.equal((await claim(pg, key('a'), ANA, 2)).status, 'claimed');
  assert.deepEqual(await claim(pg, key('b'), LUIS, 2), { status: 'quota', scope: 'team', used: 2, max: 2 });
  // Persona con cupo 2: 1 completada + 1 reserva viva = 2 → agotado; las 2 fallidas no cuentan.
  assert.deepEqual(await claim(pg, key('c'), ANA, 10, 2), { status: 'quota', scope: 'actor', used: 2, max: 2 });
  // "existing" sigue viendo la fallida: el CRM pasa a la clave de reintento.
  assert.equal((await claim(pg, key('1'), ANA, 10)).status, 'existing');
});

test('sin 120 (comportamiento 117) las fallidas contaban; la reversa de 120 lo restaura', async () => {
  const before = await freshDb({ with120: false });
  await insertRun(before, key('1'), ANA, 'failed');
  assert.deepEqual(await claim(before, key('a'), ANA, 1), { status: 'quota', scope: 'team', used: 1, max: 1 });

  const pg = await freshDb();
  await insertRun(pg, key('1'), ANA, 'failed');
  assert.equal((await claim(pg, key('a'), ANA, 1)).status, 'claimed');
  await pg.exec(read(R120));
  await pg.query('delete from public.psi_agt003_copilot_claims');
  assert.deepEqual(await claim(pg, key('b'), ANA, 1), { status: 'quota', scope: 'team', used: 1, max: 1 });
});

test('120: sólo service_role ejecuta la reserva v2', async () => {
  const pg = await freshDb();
  const rows = (await pg.query(`select r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
      from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
     where p.proname = 'psi_claim_agt003_copilot_run_v2'`)).rows;
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.rolname, row.can])), { anon: false, authenticated: false, service_role: true });
});
