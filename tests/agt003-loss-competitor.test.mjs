// AGT-003 — motivo de pérdida y competidor (F5; Juan, 2026-10-22).
// Cubre el resumen puro, la migración 147, el servidor y la pantalla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const load = async (relative, named) => {
  const entry = new URL(relative, import.meta.url).pathname;
  const bundle = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return (await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`))[named];
};
const lossBreakdown = await load('../src/vigia/loss-report.ts', 'lossBreakdown');

test('resumen de pérdidas: agrupa por motivo y por competidor, y dice lo que no se sabe', () => {
  const rows = [
    { id: '1', stage_code: 'perdido', offer_value: 10_000_000, loss_reason_name: 'Precio', competitor_name: 'Atlas' },
    { id: '2', stage_code: 'perdido', offer_value: 5_000_000, loss_reason_name: 'Precio', competitor_name: null },
    { id: '3', stage_code: 'perdido', offer_value: 1_000_000, loss_reason_name: null, competitor_name: 'Atlas' },
    { id: '4', stage_code: 'aprobado', offer_value: 90_000_000, loss_reason_name: 'Precio', competitor_name: 'Atlas' },
    { id: '5', stage_code: 'prospecto', offer_value: 3_000_000 },
  ];
  const report = lossBreakdown(rows);

  assert.equal(report.total, 3, 'sólo cuentan las perdidas');
  assert.equal(report.value, 16_000_000);
  assert.deepEqual(report.byReason, [
    { label: 'Precio', count: 2, value: 15_000_000 },
    { label: 'Sin registrar', count: 1, value: 1_000_000 },
  ], 'la pérdida sin motivo se nombra, no se esconde');
  assert.deepEqual(report.byCompetitor, [
    { label: 'Atlas', count: 2, value: 11_000_000 },
    { label: 'No se sabe', count: 1, value: 5_000_000 },
  ]);
  assert.deepEqual(lossBreakdown(), { total: 0, value: 0, byReason: [], byCompetitor: [] }, 'sin datos no inventa filas');
});

test('migración 147: catálogo cerrado al servidor, nombre único sin importar mayúsculas, y vista ampliada', () => {
  const sql = readFileSync(new URL('../supabase/migrations/147_crm_competidor_en_perdida.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.psi_sales_competitors/);
  assert.match(sql, /create unique index if not exists psi_sales_competitors_name_unique\s+on public\.psi_sales_competitors \(lower\(btrim\(name\)\)\)/);
  assert.match(sql, /alter table public\.psi_sales_competitors enable row level security/);
  assert.match(sql, /revoke all on table public\.psi_sales_competitors from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update on table public\.psi_sales_competitors to service_role/);
  assert.doesNotMatch(sql, /grant[^;]*to (anon|authenticated)/i, 'el catálogo no se abre a la llave pública');
  assert.match(sql, /add column if not exists competitor_id uuid references public\.psi_sales_competitors\(id\) on delete set null/);
  assert.match(sql, /o\.competitor_id,\s+comp\.name AS competitor_name/, 'la vista expone el competidor y su nombre');
  assert.match(sql, /LEFT JOIN psi_sales_competitors comp ON comp\.id = o\.competitor_id/);
  assert.match(sql, /o\.stage_entered_at,\s+o\.stage_entered_at_measured,\s+st\.staleness_days,/, 'conserva lo que agregó la 145');
  assert.match(sql, /alter view public\.v_psi_sales_opportunity_enriched set \(security_invoker = true\)/);
  const ejecutable = sql.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(ejecutable, /drop view|delete from|truncate|drop table/i, 'la migración no borra nada');
  assert.doesNotMatch(ejecutable, /insert into public\.psi_sales_competitors/i, 'el catálogo arranca vacío: no se inventan competidores');

  const rollback = readFileSync(new URL('../supabase/rollbacks/147_crm_competidor_en_perdida_rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /drop table if exists public\.psi_sales_competitors/);
  assert.match(rollback, /drop column if exists competitor_id/);
});

test('servidor: el competidor se resuelve o se crea una vez, y nunca tumba la pérdida ya registrada', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'el espejo de Vercel queda igual');

  const helper = server.slice(server.indexOf('async function resolveCompetitorId('), server.indexOf("app.post('/api/opportunity-decision'"));
  assert.match(helper, /trim\(\)\.replace\(\/\\s\+\/g, ' '\)\.slice\(0, 120\)/, 'el nombre se normaliza como el índice único');
  assert.match(helper, /String\(row\.name \|\| ''\)\.trim\(\)\.toLowerCase\(\) === key/, 'la comparación ignora mayúsculas y espacios');
  assert.match(helper, /const afterRace = await match\(\);/, 'dos registros a la vez reutilizan el que quedó');

  assert.match(server, /if \(params\.p_decision === 'lose' && \(req\.body\?\.competitor_id \|\| req\.body\?\.competitor_name\)\)/);
  assert.match(server, /catch \(competitorError\) \{\s+console\.warn\('psi_sales_competitors no se pudo registrar'/,
    'si falla el competidor, la decisión ya guardada no se cae');
  assert.match(server, /competitor_id: body\.stage_code === 'perdido' \? \(body\.competitor_id \|\| null\) : null,/,
    'el competidor sólo vive en una oportunidad perdida, igual que el motivo');
  assert.match(server, /must\(database\.from\('psi_sales_competitors'\)\.select\('id,name'\)\.eq\('active', true\)\.order\('name'\)\)/,
    'el catálogo viaja en el arranque');
  // El motivo ya era obligatorio antes de F5: la prueba lo fija para que no se pierda.
  assert.match(server, /if \(payload\.stage_code === 'perdido' && !payload\.loss_reason_code\) throw new Error\('Si la oportunidad está perdida, debe registrar motivo de pérdida\.'\)/);
});

test('pantalla: el competidor se escoge o se escribe, y el reporte sale del mismo filtro del listado', () => {
  const decision = readFileSync(new URL('../src/vigia/OpportunityDecision.tsx', import.meta.url), 'utf8');
  assert.match(decision, /\{decision === 'lose' && <label>¿Frente a quién\? \(opcional\)/);
  assert.match(decision, /<option value=\{OTHER_COMPETITOR\}>Otro \(escribirlo\)<\/option>/);
  assert.match(decision, /body\.competitor_name = competitorName\.trim\(\)/);
  assert.match(decision, /if \(decision === 'lose'\) \{/, 'el competidor sólo se manda cuando la decisión es perder');

  const ui = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(ui, /<LossReportPanel rows=\{filtered\} \/>/, 'el reporte respeta los filtros ya aplicados');
  assert.match(ui, /const report = lossBreakdown\(rows\);\s+if \(!report\.total\) return null;/, 'sin pérdidas no se muestra una tabla vacía');
  assert.match(ui, /competitors=\{data\.competitors \|\| \[\]\}/);
});
