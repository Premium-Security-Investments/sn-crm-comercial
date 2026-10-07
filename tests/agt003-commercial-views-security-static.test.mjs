// AGT-003 — las cinco vistas comerciales no son legibles con la llave pública (migración 112).
// Análisis estático sobre supabase/migrations (el mismo que corre el job de CI grants_security).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT003_COMMERCIAL_VIEWS,
  checkAgt002GrantsStatic,
  checkAgt003CommercialViewsFromMigrations,
  readMigrations,
} from '../scripts/agt002-check-grants-static.mjs';
import { COMMERCIAL_VIEWS, statusOf, viewStatusOf } from '../scripts/agt003-views-security-migration.mjs';

const MIGRATION_NAME = '112_agt003_commercial_views_no_public_access.sql';
const migration = readFileSync(new URL(`../supabase/migrations/${MIGRATION_NAME}`, import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/112_agt003_commercial_views_no_public_access_rollback.sql', import.meta.url), 'utf8');
const repoMigrations = readMigrations();
const withLater = (name, sql) => [...repoMigrations, { name, sql }];

test('el aplicador y el chequeo de CI cubren exactamente las mismas cinco vistas', () => {
  assert.deepEqual([...COMMERCIAL_VIEWS], [...AGT003_COMMERCIAL_VIEWS]);
  assert.equal(AGT003_COMMERCIAL_VIEWS.length, 5);
});

test('el chequeo de CI (grants_security) pasa con las migraciones actuales, incluida 112', async () => {
  assert.deepEqual(checkAgt003CommercialViewsFromMigrations(repoMigrations), { ok: true, errors: [] });
  assert.deepEqual(await checkAgt002GrantsStatic(), { ok: true, errors: [] });
});

test('112 revoca, activa security_invoker y concede SELECT sólo a service_role en cada vista', () => {
  for (const view of AGT003_COMMERCIAL_VIEWS) {
    assert.match(migration, new RegExp(`revoke all on public\\.${view} from anon, authenticated, public;`));
    assert.match(migration, new RegExp(`alter view public\\.${view} set \\(security_invoker = true\\);`));
    assert.match(migration, new RegExp(`grant select on public\\.${view} to service_role;`));
  }
  assert.doesNotMatch(migration.replace(/--.*$/gm, ''), /alter\s+default\s+privileges/i, 'no se tocan default privileges globales');
});

test('el chequeo falla si 112 desaparece o pierde una pieza', () => {
  const without112 = repoMigrations.filter(({ name }) => name !== MIGRATION_NAME);
  assert.equal(checkAgt003CommercialViewsFromMigrations(without112).ok, false);
  const regressed = repoMigrations.map(entry => entry.name === MIGRATION_NAME
    ? { ...entry, sql: entry.sql.replace('alter view public.v_psi_sales_top3_closing set (security_invoker = true);', '') }
    : entry);
  const result = checkAgt003CommercialViewsFromMigrations(regressed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => /security_invoker = true on public\.v_psi_sales_top3_closing/.test(error)), result.errors.join('\n'));
  const reGranted = repoMigrations.map(entry => entry.name === MIGRATION_NAME
    ? { ...entry, sql: `${entry.sql}\ngrant select on public.v_psi_sales_pipeline_summary to anon;\n` }
    : entry);
  assert.ok(checkAgt003CommercialViewsFromMigrations(reGranted).errors.some(error => /must not grant public\.v_psi_sales_pipeline_summary to anon/.test(error)));
});

test('una migración posterior a 112 que vuelve a conceder las vistas a anon/authenticated hace fallar el chequeo', () => {
  for (const sql of [
    'grant select on public.v_psi_sales_opportunity_enriched to anon;',
    'grant all on table public.v_psi_sales_kpis_by_commercial_month to authenticated, service_role;',
    'GRANT SELECT ON v_psi_sales_stalled_sustentacion TO public;',
    'grant select on public.psi_x, public."v_psi_sales_top3_closing" to anon;',
    'grant select on all tables in schema public to anon;',
  ]) {
    const result = checkAgt003CommercialViewsFromMigrations(withLater('113_algo.sql', sql));
    assert.equal(result.ok, false, sql);
    assert.ok(result.errors.every(error => error.startsWith('113_algo.sql:')), result.errors.join('\n'));
  }
});

test('una migración posterior que recrea una vista debe conservar security_invoker', () => {
  const recreate = 'create or replace view public.v_psi_sales_opportunity_enriched as select o.id, o.company_name as name from public.psi_sales_opportunities o;';
  const bad = checkAgt003CommercialViewsFromMigrations(withLater('120_recrea.sql', recreate));
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /recreating public\.v_psi_sales_opportunity_enriched must keep security_invoker/);
  const withOption = recreate.replace(' as select', ' with (security_invoker = true) as select');
  assert.deepEqual(checkAgt003CommercialViewsFromMigrations(withLater('120_recrea.sql', withOption)), { ok: true, errors: [] });
  const withAlter = `${recreate}\nalter view public.v_psi_sales_opportunity_enriched set (security_invoker = true);`;
  assert.deepEqual(checkAgt003CommercialViewsFromMigrations(withLater('120_recrea.sql', withAlter)), { ok: true, errors: [] });
  for (const disable of [
    'alter view public.v_psi_sales_pipeline_summary reset (security_invoker);',
    'alter view public.v_psi_sales_pipeline_summary set (security_invoker = false);',
  ]) {
    assert.equal(checkAgt003CommercialViewsFromMigrations(withLater('121_x.sql', disable)).ok, false, disable);
  }
});

test('las migraciones anteriores a 112 (p. ej. 110 recrea la vista) y otras vistas no se marcan', () => {
  assert.deepEqual(checkAgt003CommercialViewsFromMigrations(withLater('113_otra.sql',
    'grant select on public.v_psi_sales_opportunity_enriched_v2 to authenticated; grant select on public.otra_vista to anon;')), { ok: true, errors: [] });
  assert.deepEqual(checkAgt003CommercialViewsFromMigrations(withLater('113_comentario.sql',
    '-- grant select on public.v_psi_sales_opportunity_enriched to anon;')), { ok: true, errors: [] });
});

test('el rollback restaura el estado previo exacto y advierte en voz alta que reabre la fuga', () => {
  assert.match(rollback, /REABRE LA FUGA/);
  for (const view of AGT003_COMMERCIAL_VIEWS) {
    assert.match(rollback, new RegExp(`grant all on public\\.${view} to anon, authenticated;`));
    assert.match(rollback, new RegExp(`alter view public\\.${view} reset \\(security_invoker\\);`));
  }
});

test('el aplicador clasifica el estado por vista y en conjunto', () => {
  const applied = { present: true, anon_select: false, authenticated_select: false, service_role_select: true, security_invoker: true };
  const before = { present: true, anon_select: true, authenticated_select: true, service_role_select: true, security_invoker: false };
  assert.equal(viewStatusOf(applied), 'applied');
  assert.equal(viewStatusOf(before), 'absent');
  assert.equal(viewStatusOf({ ...applied, security_invoker: false }), 'partial');
  assert.equal(viewStatusOf({ present: false }), 'missing');
  assert.equal(statusOf(Array(5).fill(applied)), 'applied');
  assert.equal(statusOf(Array(5).fill(before)), 'absent');
  assert.equal(statusOf([...Array(4).fill(applied), before]), 'partial');
  assert.equal(statusOf([...Array(4).fill(applied), { present: false }]), 'missing');
  assert.equal(statusOf(Array(4).fill(applied)), 'missing');
});

test('el navegador no lee estas vistas (sólo el servidor con service_role)', async () => {
  const { execFileSync } = await import('node:child_process');
  let hits = '';
  try {
    hits = execFileSync('grep', ['-rlE', 'v_psi_sales_(opportunity_enriched|pipeline_summary|kpis_by_commercial_month|stalled_sustentacion|top3_closing)', 'src'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  assert.equal(hits.trim(), '', `src/ no debe consultar las vistas comerciales: ${hits}`);
});
