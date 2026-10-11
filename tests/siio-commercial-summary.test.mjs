import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { buildCommercialSummary, loadCommercialSummary } from '../siio-commercial-summary.js';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
process.env.VERCEL = '1';

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const now = new Date('2026-10-11T15:00:00Z');
const stages = [
  { code: 'prospecto', name: 'Prospecto', stage_order: 1, close_probability: 0.1, is_terminal: false },
  { code: 'envio_oferta', name: 'Envío de Oferta', stage_order: 2, close_probability: 0.25, is_terminal: false },
  { code: 'negociacion', name: 'Negociación', stage_order: 4, close_probability: 0.7, is_terminal: false },
  { code: 'aprobado', name: 'Aprobado', stage_order: 5, close_probability: 1, is_terminal: true },
  { code: 'descartado', name: 'Descartado', stage_order: 6, close_probability: 0, is_terminal: true },
];
const opp = (id, fields) => ({ id, owner_id: 'u1', company_name: `Cliente ${id}`, service_type_code: 'seguridad_fisica', created_at: '2026-01-05T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', last_interaction_at: '2026-10-05T00:00:00Z', approved_at: null, deleted_at: null, tender_offer_status: null, ...fields });
const fixture = {
  stages,
  profiles: [{ id: 'u1', full_name: 'Comercial Uno' }],
  goals: Array.from({ length: 12 }, (_, index) => ({ period_month: `2026-${String(index + 1).padStart(2, '0')}-01`, sales_budget: 100, service_type_code: 'seguridad_fisica' })),
  opportunities: [
    opp('w1', { stage_code: 'aprobado', offer_value: 300, quote_date: '2026-02-10' }),
    opp('w2', { stage_code: 'aprobado', offer_value: 540, quote_date: '2026-06-01' }),
    opp('w3', { stage_code: 'aprobado', offer_value: 50, quote_date: '2026-10-02' }),
    opp('d1', { stage_code: 'aprobado', offer_value: 999, quote_date: '2026-03-01', deleted_at: '2026-04-01' }),
    opp('o1', { stage_code: 'envio_oferta', offer_value: 400, last_interaction_at: '2026-08-01T00:00:00Z' }),
    opp('o2', { stage_code: 'negociacion', offer_value: 100 }),
    opp('o3', { stage_code: 'prospecto', offer_value: 0, last_interaction_at: null, updated_at: '2026-05-01T00:00:00Z' }),
    opp('t1', { service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 5000 }),
    opp('t2', { service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 9000, tender_offer_status: 'en_preparacion' }),
    opp('t3', { service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 7000, tender_offer_status: 'cerrada_no_go' }),
    opp('t4', { service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 8000 }),
    opp('t5', { service_type_code: 'licitacion_publica', stage_code: 'descartado', offer_value: 1 }),
    opp('t6', { service_type_code: 'licitacion_publica', stage_code: 'prospecto', offer_value: 2000 }),
  ],
  tenders: [
    { converted_opportunity_id: 't1', entity: 'Gobernación A', value: 5000, deadline_at: '2026-10-13T22:00:00Z' },
    { converted_opportunity_id: 't2', entity: 'Instituto B', value: 9000, deadline_at: '2026-10-07T22:00:00Z' },
    { converted_opportunity_id: 't3', entity: 'Alcaldía C', value: 7000, deadline_at: '2026-10-20T22:00:00Z' },
    { converted_opportunity_id: 't4', entity: 'Fiscalía D', value: 8000, deadline_at: '2026-12-20T22:00:00Z' },
    { converted_opportunity_id: 't6', entity: 'Rama E', value: 2000, deadline_at: '2026-10-25T22:00:00Z' },
  ],
  decisions: [
    { opportunity_id: 't2', decision: 'go', decided_at: '2026-09-01' },
    { opportunity_id: 't6', decision: 'go', decided_at: '2026-09-01' },
    { opportunity_id: 't6', decision: 'no_go', decided_at: '2026-09-20' },
  ],
};

test('ventas por mes de cotización frente a la meta de los meses cerrados', () => {
  const summary = buildCommercialSummary(fixture, { now });
  assert.equal(summary.sales.closed_months, 9);
  assert.equal(summary.sales.ytd_monthly_value, 840, 'excluye octubre (abierto) y oportunidades borradas');
  assert.equal(summary.sales.ytd_goal, 900);
  assert.ok(Math.abs(summary.sales.ytd_attainment - 840 / 900) < 1e-9);
  assert.equal(summary.sales.year_monthly_value, 890);
});

test('pipeline ponderado, cobertura y oportunidades quietas', () => {
  const { pipeline } = buildCommercialSummary(fixture, { now });
  assert.equal(pipeline.open_count, 3, 'las licitaciones no cuentan en el pipeline comercial');
  assert.equal(pipeline.weighted_monthly_value, 400 * 0.25 + 100 * 0.7);
  assert.equal(pipeline.remaining_goal, 1200 - 890);
  assert.ok(Math.abs(pipeline.coverage_of_remaining_goal - 170 / 310) < 1e-9);
  assert.equal(pipeline.stale_count, 2);
  assert.equal(pipeline.without_value_count, 1);
  assert.deepEqual(pipeline.stale_large.map(item => [item.company_name, item.days_without_activity, item.owner_name]), [['Cliente o1', 71, 'Comercial Uno']]);
});

test('licitaciones: sólo procesos vivos, con decisión pendiente o cierre vencido', () => {
  const { tenders } = buildCommercialSummary(fixture, { now });
  assert.deepEqual(tenders.calendar.map(item => item.entity), ['Instituto B', 'Gobernación A', 'Fiscalía D'], 'excluye cerradas, descartadas y las que terminaron en no_go');
  const byEntity = Object.fromEntries(tenders.calendar.map(item => [item.entity, item]));
  assert.equal(byEntity['Gobernación A'].attention, 'requiere_decision');
  assert.equal(byEntity['Gobernación A'].days_to_deadline, 3);
  assert.equal(byEntity['Instituto B'].attention, 'cierre_vencido_sin_actualizar');
  assert.equal(byEntity['Fiscalía D'].attention, null, 'fuera de la ventana de 21 días');
  assert.equal(tenders.total_value, 22000);
  assert.equal(tenders.award_rate, null);
});

test('la lectura comercial cita sus cifras', async () => {
  const { commercialReadings } = await loadModule('../src/siio/commercialSummary.ts');
  const readings = commercialReadings(buildCommercialSummary(fixture, { now }));
  assert.ok(readings.some(text => /enero a septiembre/.test(text) && /93%/.test(text)), readings.join('\n'));
  assert.ok(readings.some(text => /1 licitación cierra en los próximos 21 días/.test(text) && /Gobernación A/.test(text)), readings.join('\n'));
  assert.ok(readings.some(text => /Instituto B: la fecha de cierre ya pasó/.test(text)), readings.join('\n'));
});

test('el cargador consulta sólo lectura y arma el resumen', async () => {
  const tables = [];
  const database = {
    from: table => {
      tables.push(table);
      const rows = { psi_sales_opportunities: fixture.opportunities.filter(item => !item.deleted_at), psi_sales_pipeline_stages: stages, psi_sales_goals: fixture.goals, psi_public_tenders: fixture.tenders, psi_tender_go_no_go_decisions: fixture.decisions, psi_sales_profiles: fixture.profiles }[table];
      const chain = { select: () => chain, is: () => chain, limit: () => chain, gte: () => chain, lte: () => chain, not: () => chain, then: resolve => resolve({ data: rows, error: null }) };
      return chain;
    },
  };
  const summary = await loadCommercialSummary(database, { now });
  assert.equal(summary.tenders.open_count, 3);
  assert.deepEqual([...new Set(tables)].sort(), ['psi_public_tenders', 'psi_sales_goals', 'psi_sales_opportunities', 'psi_sales_pipeline_stages', 'psi_sales_profiles', 'psi_tender_go_no_go_decisions']);
});

test('mismos permisos de lectura que el resto de la Torre gerencial', async () => {
  const { requireSiioEndpointAccess } = await import('../server/index.js');
  const profile = role => ({ id: `${role}-profile`, role, active: true, identity_type: 'human', areas: [], permissions: ['modulo_siio_gerencial'] });
  for (const role of ['admin', 'gerencia', 'consulta']) assert.equal(requireSiioEndpointAccess(profile(role), 'GET /api/siio/commercial-summary'), true);
  assert.throws(() => requireSiioEndpointAccess(profile('junta'), 'GET /api/siio/commercial-summary'), error => error?.status === 403);
  assert.throws(() => requireSiioEndpointAccess(profile('comercial'), 'GET /api/siio/commercial-summary'), error => error?.status === 403);
});
