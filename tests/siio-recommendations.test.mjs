import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  RECOMMENDATIONS_DAILY_BUTTON_LIMIT, RECOMMENDATIONS_OUTPUT_SCHEMA, bogotaDate, buildRecommendationsInput, generateRecommendations,
  loadRecommendations, resolveAgt001BridgeConfig, spellSheetMonths, setRecommendationFeedback, validateRecommendationsOutput,
} from '../siio-recommendations.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const item = (overrides = {}) => ({
  area: 'finanzas', prioridad: 'alta', titulo: 'Revisar gastos financieros',
  recomendacion: 'Revisar con Tesorería el costo del factoring y renegociar tasas este mes.',
  por_que: 'Los gastos financieros suman 1.584,5 millones, 66 % más que en 2025.',
  fuentes: ['finanzas'], responsable_sugerido: 'Gerencia financiera', plazo_dias: 14, ...overrides,
});
const output = (overrides = {}) => ({
  resumen: 'Los ingresos crecen 58 % pero los gastos financieros crecen más rápido que la utilidad.',
  recomendaciones: [item(), item({ area: 'comercial', prioridad: 'media', fuentes: ['comercial'] }), item({ area: 'licitaciones', prioridad: 'baja', fuentes: ['licitaciones'] })],
  datos_faltantes: ['Presupuesto mensual por rubro'],
  ...overrides,
});

test('valida la salida cerrada de Vig-IA y rechaza campos o valores fuera del contrato', () => {
  const clean = validateRecommendationsOutput(JSON.stringify(output()));
  assert.equal(clean.recomendaciones.length, 3);
  assert.throws(() => validateRecommendationsOutput(output({ extra: 1 })), error => error.code === 'AGT001_RECOMMENDATIONS_INVALID_SHAPE');
  assert.throws(() => validateRecommendationsOutput(output({ recomendaciones: [item(), item(), item({ area: 'nomina' })] })), error => error.status === 502);
  assert.throws(() => validateRecommendationsOutput(output({ recomendaciones: [item(), item()] })));
  assert.throws(() => validateRecommendationsOutput(output({ recomendaciones: [item(), item(), item({ plazo_dias: 0 })] })));
  assert.throws(() => validateRecommendationsOutput('no es json'));
  assert.deepEqual(RECOMMENDATIONS_OUTPUT_SCHEMA.properties.recomendaciones.items.properties.area.enum, ['finanzas', 'comercial', 'licitaciones', 'operaciones', 'transversal']);
});

test('la entrada usa agregados en millones, separa privados de licitaciones y no lleva ids ni nombres de personas', () => {
  const input = buildRecommendationsInput({
    financialMetrics: [
      { period_month: '2026-04-01', concept: 'INGRESOS', value_current: 51_845_041_733, value_comparison: 33_046_110_285, variation_pct: 0.57 },
      { period_month: '2026-08-01', concept: 'INGRESOS', value_current: 106_593_449_127.5, value_comparison: 67_602_800_052.7, variation_pct: 0.5768 },
      { period_month: '2026-08-01', concept: 'MARGEN NETO', value_current: 0.02822815, value_comparison: 0.0135, variation_pct: null },
    ],
    financialWarnings: ['7 26: suma de clases 1 a 7. Mes anterior al corte con diferencia'],
    pulse: { months: [{ year: 2026, month: 7, values: { ingresos: 13_699_000_000 }, provision_declared: true, balance_difference: -1_032_138, totals: { ingresos: 13_699_000_000, costos: 1, gastos_operacionales: 1, utilidad_operacional: 791_000_000, margen_operacional: 0.0577, resultado_no_operacional: 0 } }] },
    commercial: {
      as_of: '2026-10-15',
      sales: { year: 2026, ytd_monthly_value: 120_000_000, ytd_goal: 200_000_000, ytd_attainment: 0.6, year_goal: 300_000_000, by_month: [] },
      pipeline: { open_count: 4, monthly_value: 90_000_000, weighted_monthly_value: 30_000_000, stale_count: 1, stale_days: 15, without_value_count: 0, by_stage: [], stale_large: [{ id: 'opp-1', company_name: 'Cliente X', stage: 'Propuesta', monthly_value: 50_000_000, days_without_activity: 20, owner_name: 'Ana Pérez' }] },
      tenders: { open_count: 1, total_value: 3_249_000_000, requires_decision: 1, overdue_status: 0, award_rate: null, calendar: [{ id: 'opp-2', entity: 'Gobernación de Risaralda', total_value: 3_249_000_000, deadline_at: '2026-10-19T17:00:00Z', days_to_deadline: 4, decision: null, offer_status: null, attention: 'requiere_decision' }] },
    },
    followups: [{ title: 'Decidir Risaralda', origin_type: 'licitacion', due_date: '2026-10-10', status: 'abierto', owner_label: 'Juan Botero' }],
    now: new Date('2026-10-15T15:00:00Z'),
  });
  assert.equal(input.finanzas.periodo_acumulado_hasta, '2026-08-01');
  assert.deepEqual(input.finanzas.indicadores[0], { concepto: 'INGRESOS', actual: 106593.4, anio_anterior: 67602.8, variacion_pct: 0.577 });
  assert.equal(input.finanzas.indicadores[1].actual, 0.028);
  assert.match(input.pulso_mensual.meses[0].advertencia_balance, /no cuadra por -1 millones/);
  assert.equal(input.comercial.embudo.grandes_sin_actividad[0].cliente, 'Cliente X');
  assert.equal(input.licitaciones.procesos[0].entidad, 'Gobernación de Risaralda');
  assert.equal(input.seguimientos_abiertos[0].vencido, true);
  const serialized = JSON.stringify(input);
  assert.doesNotMatch(serialized, /Ana Pérez|Juan Botero|opp-1|opp-2/);
});

function fakeDatabase({ runs = [], failInsert = null } = {}) {
  const tables = { siio_ai_recommendation_runs: runs, siio_ai_recommendations: [], siio_financial_metrics_current: [], siio_operations_metrics_current: [], siio_followups: [], siio_financial_validations: [] };
  const builder = table => {
    const state = { table, filters: [], op: 'select', payload: null, order: null };
    const rows = () => (tables[table] || []).filter(row => state.filters.every(([kind, column, value]) => {
      if (kind === 'eq') return row[column] === value;
      if (kind === 'lt') return String(row[column]) < String(value);
      return true;
    }));
    const chain = {
      order: (column, { ascending = true } = {}) => { state.order = [column, ascending]; return chain; },
      select: () => chain, limit: () => chain, in: () => chain, not: () => chain, is: () => chain, gte: () => chain, lte: () => chain, or: () => chain,
      eq: (column, value) => { state.filters.push(['eq', column, value]); return chain; },
      lt: (column, value) => { state.filters.push(['lt', column, value]); return chain; },
      insert: payload => {
        if (table === 'siio_ai_recommendation_runs' && failInsert) return Promise.resolve({ error: failInsert });
        if (table === 'siio_ai_recommendation_runs' && tables[table].some(row => row.status === 'en_curso')) return Promise.resolve({ error: { code: '23505' } });
        tables[table].push(...(Array.isArray(payload) ? payload : [payload]).map(row => ({ id: row.id || `item-${tables[table].length + 1}`, ...row })));
        return Promise.resolve({ error: null });
      },
      update: patch => { state.op = 'update'; state.payload = patch; return chain; },
      single: () => {
        if (state.op === 'update') { const [row] = rows(); Object.assign(row, state.payload); return Promise.resolve({ data: row, error: null }); }
        return Promise.resolve({ data: rows()[0] || null, error: null });
      },
      then: (resolve, reject) => {
        if (state.op === 'update') { for (const row of rows()) Object.assign(row, state.payload); return Promise.resolve({ error: null }).then(resolve, reject); }
        const data = rows();
        if (state.order) { const [column, ascending] = state.order; data.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1)); }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from: builder, tables };
}

const now = new Date('2026-10-15T15:00:00Z');
const okClient = { run: async () => ({ content: JSON.stringify(output()), usage: { input_tokens: 9000, output_tokens: 1500 } }) };
const profile = { id: 'profile-1', role: 'gerencia' };

test('genera, guarda las recomendaciones y registra el uso con la identidad AGT-001', async () => {
  const database = fakeDatabase();
  const events = [];
  const result = await generateRecommendations(database, { trigger: 'boton', profile, now, environment: {}, client: okClient, recordUsage: event => { events.push(event); } });
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.run.summary.startsWith('Los ingresos'), true);
  assert.deepEqual(result.button, { used_today: 1, limit: RECOMMENDATIONS_DAILY_BUTTON_LIMIT, remaining_today: 2 });
  const [run] = database.tables.siio_ai_recommendation_runs;
  assert.equal(run.status, 'completado');
  assert.equal(run.bogota_date, '2026-10-15');
  assert.equal(run.input_tokens, 9000);
  assert.equal(events[0].agent_id, 'AGT-001');
  assert.equal(events[0].capability, 'agt001.executive-recommendations');
});

test('el botón tiene tope de 3 corridas al día (Bogotá); las fallidas no cuentan y la del lunes no consume cupo', async () => {
  const runs = [1, 2, 3].map(index => ({ id: `r${index}`, trigger: 'boton', status: index === 3 ? 'fallido' : 'completado', bogota_date: '2026-10-15', requested_at: '2026-10-15T12:00:00Z' }));
  const database = fakeDatabase({ runs });
  await generateRecommendations(database, { trigger: 'boton', profile, now, environment: {}, client: okClient, recordUsage: () => {} });
  await assert.rejects(() => generateRecommendations(database, { trigger: 'boton', profile, now, environment: {}, client: okClient, recordUsage: () => {} }), error => error.status === 429 && /3 veces hoy/.test(error.message));
  await generateRecommendations(database, { trigger: 'semanal', now, environment: {}, client: okClient, recordUsage: () => {} });
  assert.equal(database.tables.siio_ai_recommendation_runs.filter(run => run.trigger === 'semanal' && run.status === 'completado').length, 1);
  assert.equal(bogotaDate(new Date('2026-10-16T03:00:00Z')), '2026-10-15', 'el día cambia a medianoche de Bogotá, no UTC');
});

test('una sola corrida a la vez y una corrida abandonada se cierra como fallida', async () => {
  const busy = fakeDatabase({ runs: [{ id: 'live', trigger: 'boton', status: 'en_curso', bogota_date: '2026-10-15', requested_at: '2026-10-15T14:59:00Z' }] });
  await assert.rejects(() => generateRecommendations(busy, { trigger: 'boton', profile, now, environment: {}, client: okClient, recordUsage: () => {} }), error => error.status === 409);
  const stale = fakeDatabase({ runs: [{ id: 'old', trigger: 'boton', status: 'en_curso', bogota_date: '2026-10-15', requested_at: '2026-10-15T14:00:00Z' }] });
  await generateRecommendations(stale, { trigger: 'boton', profile, now, environment: {}, client: okClient, recordUsage: () => {} });
  assert.equal(stale.tables.siio_ai_recommendation_runs.find(run => run.id === 'old').status, 'fallido');
});

test('si el modelo falla la corrida queda fallida y el usuario recibe un mensaje claro', async () => {
  const database = fakeDatabase();
  const loginExpired = { run: async () => { const error = new Error('login'); error.code = 'AGT003_CLAUDE_LOGIN_REQUIRED'; throw error; } };
  await assert.rejects(() => generateRecommendations(database, { trigger: 'boton', profile, now, environment: {}, client: loginExpired, recordUsage: () => {} }), error => error.status === 502 && /sesión de Claude de Vig-IA Gerencia/.test(error.message));
  assert.equal(database.tables.siio_ai_recommendation_runs[0].status, 'fallido');
  const badShape = { run: async () => ({ content: '{"resumen":"x"}', usage: {} }) };
  const later = new Date(now.getTime() + 60_000);
  await assert.rejects(() => generateRecommendations(database, { trigger: 'boton', profile, now: later, environment: {}, client: badShape, recordUsage: () => {} }), error => error.status === 502);
  const state = await loadRecommendations(database, { now: later });
  assert.equal(state.run, null);
  assert.equal(state.button.used_today, 0, 'las fallidas no consumen el cupo del día');
  assert.equal(state.last_failure.code, 'AGT001_RECOMMENDATIONS_INVALID_SHAPE');
});

test('sin puente configurado no crea corridas', async () => {
  const database = fakeDatabase();
  await assert.rejects(() => generateRecommendations(database, { trigger: 'boton', profile, now, environment: {} }), error => error.status === 503);
  assert.equal(database.tables.siio_ai_recommendation_runs.length, 0);
  assert.equal(resolveAgt001BridgeConfig({ AGT001_BRIDGE_URL: 'https://agt001.example/v1/agt003-copilot/run', AGT001_BRIDGE_HMAC_SECRET: 'x'.repeat(32) }).configured, true);
  assert.equal(resolveAgt001BridgeConfig({ AGT001_BRIDGE_URL: 'http://agt001.example', AGT001_BRIDGE_HMAC_SECRET: 'x'.repeat(32) }).configured, false);
});

test('útil / no útil acepta sólo esos valores', async () => {
  const database = fakeDatabase();
  database.tables.siio_ai_recommendations.push({ id: 'rec-1', feedback: null });
  assert.equal((await setRecommendationFeedback(database, 'rec-1', { feedback: 'util' }, profile, now)).feedback, 'util');
  await assert.rejects(() => setRecommendationFeedback(database, 'rec-1', { feedback: 'excelente' }, profile, now), error => error.status === 400);
});

test('rutas, permisos y corrida semanal protegida en el CRM', () => {
  const server = read('server/index.js');
  for (const route of ['GET /api/siio/recommendations', 'POST /api/siio/recommendations/generate', 'POST /api/siio/recommendations/:id/feedback']) {
    assert.equal(server.split(`'${route}'`).length - 1 >= 3, true, `${route} debe estar en los dos mapas de acceso y en su handler`);
  }
  assert.match(server, /app\.post\('\/api\/siio\/recommendations\/weekly'[\s\S]{0,400}secretMatches\(process\.env\.AGT001_WEEKLY_SECRET/);
  assert.equal(server, read('api/[...path].js'));
});

test('migración 131: una corrida a la vez, RLS y sólo service_role', () => {
  const sql = read('supabase/migrations/131_siio_ai_recommendations.sql');
  assert.match(sql, /create unique index if not exists siio_ai_recommendation_runs_one_in_progress[\s\S]*where status = 'en_curso'/);
  assert.match(sql, /alter table public\.siio_ai_recommendations enable row level security/);
  assert.match(sql, /revoke all on table public\.siio_ai_recommendation_runs from public, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/);
});

test('puente propio de AGT-001 y timer semanal sin secretos en la línea de comandos', () => {
  const unit = read('ops/agt001-claude-bridge/agt001-bridge.service');
  assert.match(unit, /User=agt001-bridge/);
  assert.match(unit, /CLAUDE_CONFIG_DIR=\/opt\/agt001-bridge\/\.claude/);
  assert.match(read('ops/agt001-claude-bridge/env.example'), /AGT003_BRIDGE_LISTEN_PORT=8789/);
  assert.match(read('ops/agt001-claude-bridge/Caddyfile'), /reverse_proxy 127\.0\.0\.1:8789/);
  const weekly = read('ops/agt001-recommendations-weekly/agt001-recommendations-weekly.service');
  assert.match(weekly, /"\$\$AGT001_WEEKLY_SECRET" \| \/usr\/bin\/curl [^']*-H @-/);
  assert.match(read('ops/agt001-recommendations-weekly/agt001-recommendations-weekly.timer'), /OnCalendar=Mon \*-\*-\* 11:30:00 UTC/);
  for (const path of ['ops/agt001-claude-bridge/env.example', 'ops/agt001-recommendations-weekly/env.example']) assert.match(read(path), /SECRET=\n/);
});

test('las advertencias contables nombran el mes completo para que Vig-IA no confunda el año', () => {
  assert.equal(spellSheetMonths('7 26: suma de clases 1 a 7.'), 'julio de 2026: suma de clases 1 a 7.');
  assert.equal(spellSheetMonths('8 25: no cuadra'), 'agosto de 2025: no cuadra');
  assert.equal(spellSheetMonths('Hay meses sin provisión'), 'Hay meses sin provisión');
});
