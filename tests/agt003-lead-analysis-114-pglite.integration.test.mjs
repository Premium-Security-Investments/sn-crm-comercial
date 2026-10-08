// AGT-003 — migración 114 (premio análisis profundo) sobre PostgreSQL aislado (PGlite): reserva atómica, un análisis
// por perfil, uno en curso a la vez, tope mensual (los fallidos no cuentan), registro inmutable y sin acceso público.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { STATE_SQL, statusOf } from '../scripts/agt003-lead-analysis-migration.mjs';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';

const migration = stripTopLevelTransactionWrapper(readFileSync(new URL('../supabase/migrations/114_agt003_lead_deep_analysis.sql', import.meta.url), 'utf8'));
const rollback = stripTopLevelTransactionWrapper(readFileSync(new URL('../supabase/rollbacks/114_agt003_lead_deep_analysis_rollback.sql', import.meta.url), 'utf8'));
const OPP = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const ACTOR = '00000000-0000-4000-8000-0000000000aa';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_sales_profiles (id uuid primary key);
    insert into public.psi_sales_opportunities values ('${OPP[0]}'), ('${OPP[1]}'), ('${OPP[2]}');
    insert into public.psi_sales_profiles values ('${ACTOR}');
  `);
  await pg.exec(migration);
  return pg;
}
const claim = async (pg, opp, hash, max = 2) => (await pg.query(
  `select public.psi_claim_agt003_lead_analysis($1, $2, $3, '1.0', $4, date_trunc('month', now())) as r`, [opp, ACTOR, hash, max])).rows[0].r;
const finish = (pg, id, status) => pg.query(
  `select public.psi_finish_agt003_lead_analysis($1, $2, 'sonnet', null, 'leida', $3::jsonb, null, $4)`,
  [id, status, status === 'completed' ? JSON.stringify({ ok: true }) : null, status === 'failed' ? 'X' : null]);

test('114 aplica, reserva y respeta el cupo mensual', async () => {
  const pg = await freshDb();
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'applied');

  const first = await claim(pg, OPP[0], H1);
  assert.equal(first.status, 'claimed');
  assert.equal((await claim(pg, OPP[0], H1)).status, 'in_progress', 'uno en curso a la vez por oportunidad');
  await finish(pg, first.id, 'completed');
  assert.deepEqual(await claim(pg, OPP[0], H1), { status: 'existing', id: first.id }, 'mismo perfil: devuelve el existente');

  const failed = await claim(pg, OPP[1], H1);
  await finish(pg, failed.id, 'failed');
  const second = await claim(pg, OPP[1], H1);
  assert.equal(second.status, 'claimed', 'un fallido no consume cupo y se puede reintentar');
  await finish(pg, second.id, 'completed');

  const quota = await claim(pg, OPP[2], H1);
  assert.equal(quota.status, 'quota', 'tope mensual de 2 alcanzado');
  assert.equal(quota.used, 2);
  assert.equal((await claim(pg, OPP[0], H2, 3)).status, 'claimed', 'perfil cambiado: análisis nuevo si hay cupo');
});

test('registro inmutable y sin acceso público', async () => {
  const pg = await freshDb();
  const run = await claim(pg, OPP[0], H1);
  await finish(pg, run.id, 'completed');
  await assert.rejects(() => finish(pg, run.id, 'failed'), /ya finalizado/);
  await assert.rejects(() => pg.query(`delete from public.psi_agt003_lead_analyses`), /solo inserción/);
  await assert.rejects(() => pg.query(`update public.psi_agt003_lead_analyses set profile_hash = '${H2}'`), /no permitida/);
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role};`);
    await assert.rejects(() => pg.query(`select * from public.psi_agt003_lead_analyses`), /permission denied/);
    await assert.rejects(() => pg.query(`select public.psi_claim_agt003_lead_analysis('${OPP[1]}', '${ACTOR}', '${H1}', '1.0', 5, now())`), /permission denied/);
    await pg.exec('reset role;');
  }
  await pg.exec('set role service_role;');
  assert.equal((await pg.query(`select count(*)::int as n from public.psi_agt003_lead_analyses`)).rows[0].n, 1);
  await pg.exec('reset role;');
});

test('rollback deja el estado ausente y es idempotente con apply', async () => {
  const pg = await freshDb();
  await pg.exec(rollback);
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'absent');
  await pg.exec(migration);
  await pg.exec(migration);
  assert.equal(statusOf((await pg.query(STATE_SQL)).rows[0]), 'applied');
});
