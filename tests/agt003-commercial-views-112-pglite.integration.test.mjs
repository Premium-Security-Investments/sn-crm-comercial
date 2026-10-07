// AGT-003 — migración 112 sobre PostgreSQL aislado (PGlite) con roles anon/authenticated/service_role reales.
// Reproduce la fuga (la vista con dueño postgres y sin security_invoker se salta la RLS de la tabla base), verifica que
// 112 la cierra sin afectar al servidor (service_role), que apply y rollback son idempotentes y que el rollback
// devuelve exactamente el estado previo (y por tanto reabre la fuga).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { COMMERCIAL_VIEWS, STATE_SQL, statusOf } from '../scripts/agt003-views-security-migration.mjs';
import { stripTopLevelTransactionWrapper } from '../scripts/agt002-initial-analysis-migrations.mjs';

const migration = stripTopLevelTransactionWrapper(readFileSync(new URL('../supabase/migrations/112_agt003_commercial_views_no_public_access.sql', import.meta.url), 'utf8'));
const rollback = stripTopLevelTransactionWrapper(readFileSync(new URL('../supabase/rollbacks/112_agt003_commercial_views_no_public_access_rollback.sql', import.meta.url), 'utf8'));

// Estado de producción antes de 112: vistas de postgres, sin security_invoker, ALL a anon/authenticated/service_role;
// la tabla base con RLS y sin políticas para anon (devuelve 0 filas por la API).
async function freshDb() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.psi_sales_opportunities (id int primary key, company_name text, stage_code text, offer_value numeric, owner_id int, updated_at timestamptz default now());
    alter table public.psi_sales_opportunities enable row level security;
    grant all on public.psi_sales_opportunities to anon, authenticated, service_role;
    insert into public.psi_sales_opportunities (id, company_name, stage_code, offer_value, owner_id)
      select g, 'Cliente ' || g, case when g % 3 = 0 then 'sustentacion' else 'propuesta' end, g * 1000, g % 4 from generate_series(1, 399) g;
    create view public.v_psi_sales_opportunity_enriched as select o.* from public.psi_sales_opportunities o;
    create view public.v_psi_sales_pipeline_summary as select stage_code, count(*) as n, sum(offer_value) as total from public.v_psi_sales_opportunity_enriched group by stage_code;
    create view public.v_psi_sales_kpis_by_commercial_month as select owner_id, date_trunc('month', updated_at) as month, count(*) as n from public.psi_sales_opportunities group by 1, 2;
    create view public.v_psi_sales_stalled_sustentacion as select id, company_name from public.v_psi_sales_opportunity_enriched where stage_code = 'sustentacion';
    create view public.v_psi_sales_top3_closing as select id, company_name, offer_value from public.psi_sales_opportunities order by offer_value desc limit 3;
  `);
  for (const view of COMMERCIAL_VIEWS) await pg.exec(`grant all on public.${view} to anon, authenticated, service_role;`);
  return pg;
}

const state = async pg => statusOf((await pg.query(STATE_SQL)).rows);
const countAs = async (pg, role, relation) => {
  await pg.exec(`set role ${role};`);
  try {
    return Number((await pg.query(`select count(*)::int as n from public.${relation}`)).rows[0].n);
  } finally {
    await pg.exec('reset role;');
  }
};
const viewPrivileges = async pg => (await pg.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'v_psi_sales_%' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  order by 1, 2, 3`)).rows;
const viewOptions = async pg => (await pg.query(`select relname, reloptions from pg_class where relname like 'v_psi_sales_%' order by 1`)).rows;

test('antes de 112 la fuga se reproduce: anon lee las 399 oportunidades por la vista aunque la tabla devuelve 0', async () => {
  const pg = await freshDb();
  assert.equal(await state(pg), 'absent');
  assert.equal(await countAs(pg, 'anon', 'psi_sales_opportunities'), 0);
  assert.equal(await countAs(pg, 'anon', 'v_psi_sales_opportunity_enriched'), 399);
  assert.equal(await countAs(pg, 'authenticated', 'v_psi_sales_stalled_sustentacion'), 133);
});

test('112 cierra las cinco vistas a anon/authenticated y el servidor (service_role) sigue leyendo todo', async () => {
  const pg = await freshDb();
  await pg.exec(migration);
  assert.equal(await state(pg), 'applied');
  for (const view of COMMERCIAL_VIEWS) {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(countAs(pg, role, view), /permission denied/, `${role} no debe leer ${view}`);
    }
  }
  assert.equal(await countAs(pg, 'service_role', 'v_psi_sales_opportunity_enriched'), 399);
  assert.equal(await countAs(pg, 'service_role', 'v_psi_sales_pipeline_summary'), 2);
  assert.equal(await countAs(pg, 'service_role', 'v_psi_sales_stalled_sustentacion'), 133);
  assert.equal(await countAs(pg, 'service_role', 'v_psi_sales_top3_closing'), 3);
  assert.ok(await countAs(pg, 'service_role', 'v_psi_sales_kpis_by_commercial_month') > 0);
  const grants = await viewPrivileges(pg);
  assert.deepEqual(grants.filter(row => row.grantee !== 'service_role'), [], 'ningún privilegio para anon/authenticated/PUBLIC');
});

test('con security_invoker, si alguien vuelve a conceder SELECT por error, la vista respeta la RLS (0 filas)', async () => {
  const pg = await freshDb();
  await pg.exec(migration);
  await pg.exec('grant select on public.v_psi_sales_opportunity_enriched to anon;');
  assert.equal(await countAs(pg, 'anon', 'v_psi_sales_opportunity_enriched'), 0);
});

test('apply es idempotente', async () => {
  const pg = await freshDb();
  await pg.exec(migration);
  const grants = await viewPrivileges(pg);
  const options = await viewOptions(pg);
  await pg.exec(migration);
  assert.equal(await state(pg), 'applied');
  assert.deepEqual(await viewPrivileges(pg), grants);
  assert.deepEqual(await viewOptions(pg), options);
});

test('rollback devuelve exactamente el estado previo (reabre la fuga), es idempotente y 112 se puede volver a aplicar', async () => {
  const pg = await freshDb();
  const grantsBefore = await viewPrivileges(pg);
  const optionsBefore = await viewOptions(pg);
  await pg.exec(migration);
  await pg.exec(rollback);
  assert.equal(await state(pg), 'absent');
  assert.deepEqual(await viewPrivileges(pg), grantsBefore);
  assert.deepEqual(await viewOptions(pg), optionsBefore);
  assert.equal(await countAs(pg, 'anon', 'v_psi_sales_opportunity_enriched'), 399, 'el rollback reabre la fuga (documentado)');
  await pg.exec(rollback);
  assert.deepEqual(await viewPrivileges(pg), grantsBefore);
  assert.deepEqual(await viewOptions(pg), optionsBefore);
  await pg.exec(migration);
  assert.equal(await state(pg), 'applied');
});

test('el estado reporta partial si sólo una vista quedó cerrada y missing si falta una vista', async () => {
  const pg = await freshDb();
  await pg.exec('revoke all on public.v_psi_sales_top3_closing from anon, authenticated, public; alter view public.v_psi_sales_top3_closing set (security_invoker = true);');
  assert.equal(await state(pg), 'partial');
  await pg.exec('drop view public.v_psi_sales_top3_closing;');
  assert.equal(await state(pg), 'missing');
  await assert.rejects(pg.exec(migration), /does not exist/);
});

test('create or replace view sin WITH borra security_invoker (por eso el chequeo de CI lo exige en migraciones futuras)', async () => {
  const pg = await freshDb();
  await pg.exec(migration);
  await pg.exec('create or replace view public.v_psi_sales_top3_closing as select id, company_name, offer_value from public.psi_sales_opportunities order by offer_value desc limit 3;');
  assert.equal(await state(pg), 'partial');
  const grants = (await viewPrivileges(pg)).filter(row => row.table_name === 'v_psi_sales_top3_closing' && row.grantee !== 'service_role');
  assert.deepEqual(grants, [], 'los grants sí se conservan al recrear');
  await pg.exec('create or replace view public.v_psi_sales_top3_closing with (security_invoker = true) as select id, company_name, offer_value from public.psi_sales_opportunities order by offer_value desc limit 3;');
  assert.equal(await state(pg), 'applied');
});
