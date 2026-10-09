// IT → Agentes → "Uso de IA": endpoint de sólo lectura del libro de uso de modelos y su sección en la vista.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PLATFORM_MODEL_USAGE_DAILY_SQL,
  PLATFORM_MODEL_USAGE_SUMMARY_SQL,
  bogotaSeriesDays,
  knownModelLimits,
  limitsFromEffectiveConfiguration,
  listPlatformModelUsage,
  presentModelUsage,
  PLATFORM_MODEL_ALERTS_SQL,
} from '../platform-model-usage.js';
import { PLATFORM_AGENTS_UNAVAILABLE_MESSAGE, isPlatformAgentsUnavailable } from '../platform-agents.js';
import { defaultAgentConfiguration } from '../platform-agent-configuration.js';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const serverSource = read('../server/index.js');
const apiSource = read('../api/[...path].js');
const view = read('../src/platform/AgentsView.tsx');
const section = read('../src/platform/ModelUsageSection.tsx');
const presentation = read('../src/platform/agentsPresentation.ts');
const loader = read('../src/platform/usePlatformData.ts');

test('GET /api/platform/model-usage tiene la misma protección que /api/platform/agents y espejo idéntico', () => {
  assert.equal(serverSource, apiSource);
  assert.match(serverSource, /'GET \/api\/platform\/model-usage': \['users', ACTIONS\.USERS_MANAGE\]/);
  assert.match(serverSource, /app\.get\('\/api\/platform\/model-usage', async \(req, res\) => \{\n  try \{\n    const \{ profile: currentProfile \} = await getAuthContext\(req\);\n    requireModuleAction\(currentProfile, 'users'\);\n    requireAction\(currentProfile, ACTIONS\.USERS_MANAGE, \{\}\);\n    res\.set\('Cache-Control', 'no-store'\);\n    \/\/ "Tope actual": [^\n]+\n    res\.json\(await listPlatformModelUsage\(\{ limits: limitsFromEffectiveConfiguration\(await getEffectiveAgentConfiguration\(AGT003_AGENT_ID\)\) \}\)\);/);
  const route = serverSource.slice(serverSource.indexOf("app.get('/api/platform/model-usage'"), serverSource.indexOf("app.all('/api/platform/model-usage'"));
  assert.match(route, /if \(isPlatformAgentsUnavailable\(error\)\) return res\.status\(503\)\.json\(\{ error: PLATFORM_AGENTS_UNAVAILABLE_MESSAGE \}\);/);
  assert.match(serverSource, /app\.all\('\/api\/platform\/model-usage', \(_req, res\) => res\.status\(405\)/);
});

test('consultas: sólo select sobre platform.model_usage_event, en hora de Bogotá', () => {
  for (const sql of [PLATFORM_MODEL_USAGE_SUMMARY_SQL, PLATFORM_MODEL_USAGE_DAILY_SQL]) {
    assert.match(sql, /^with bounds as \(/);
    assert.ok(sql.includes('from platform.model_usage_event e'));
    assert.ok(sql.includes("at time zone 'America/Bogota'"));
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop|grant|record_model_usage)\b/i);
  }
  assert.ok(PLATFORM_MODEL_USAGE_SUMMARY_SQL.includes("e.failure_code like '%SESSION_LIMIT'"), 'límite de la suscripción = códigos *_SESSION_LIMIT');
  for (const column of ['uses_today', 'uses_month', 'completed_7d', 'failed_7d', 'rejected_7d', 'quota_rejected_7d', 'session_limit_7d', 'avg_latency_ms_7d', 'last_used_at', 'input_tokens_month', 'output_tokens_month', 'cost_usd_month']) {
    assert.ok(PLATFORM_MODEL_USAGE_SUMMARY_SQL.includes(`as ${column}`), column);
  }
  assert.ok(PLATFORM_MODEL_USAGE_DAILY_SQL.includes("interval '13 days'"), 'serie de 14 días');
});

test('topes conocidos: copiloto 20/día y análisis profundo 30/mes, configurables por entorno', () => {
  assert.deepEqual(knownModelLimits({}), {
    'agt003.opportunity-copilot.preview': { period: 'day', max: 20 },
    'agt003.lead-deep-analysis': { period: 'month', max: 30 },
  });
  const custom = knownModelLimits({ AGT003_COPILOT_DAILY_MAX_RUNS: '35', AGT003_LEAD_ANALYSIS_MONTHLY_MAX: '12' });
  assert.equal(custom['agt003.opportunity-copilot.preview'].max, 35);
  assert.equal(custom['agt003.lead-deep-analysis'].max, 12);
  assert.equal(knownModelLimits({ AGT003_COPILOT_DAILY_MAX_RUNS: 'x' })['agt003.opportunity-copilot.preview'].max, 20);
});

test('serie de 14 días termina hoy en Bogotá', () => {
  // 2026-10-10 03:00 UTC = 2026-10-09 22:00 en Bogotá.
  const days = bogotaSeriesDays(new Date('2026-10-10T03:00:00Z'));
  assert.equal(days.length, 14);
  assert.equal(days.at(-1), '2026-10-09');
  assert.equal(days[0], '2026-09-26');
});

test('presentación: sin datos devuelve las dos capacidades en cero y has_data=false', () => {
  const payload = presentModelUsage({ now: new Date('2026-10-09T15:00:00Z'), env: {} });
  assert.equal(payload.has_data, false);
  assert.deepEqual(payload.capabilities.map(item => item.label), ['Siguiente paso (copiloto)', 'Análisis profundo']);
  assert.equal(payload.capabilities[0].daily.length, 14);
  assert.ok(payload.cost_note.includes('equivalente'));
});

function fakePool({ connectError, failOn } = {}) {
  const queries = [];
  const released = [];
  return {
    queries,
    released,
    async connect() {
      if (connectError) throw connectError;
      return {
        async query(sql, params) {
          queries.push({ sql, params });
          if (failOn && sql.includes(failOn)) throw Object.assign(new Error('permission denied for table model_usage_event at db.internal'), { code: '42501' });
          if (sql === PLATFORM_MODEL_USAGE_SUMMARY_SQL) {
            return { rows: [{
              agent_id: 'AGT-003', capability: 'agt003.opportunity-copilot.preview', uses_today: 3, uses_month: '41',
              completed_7d: 10, failed_7d: 1, rejected_7d: 2, quota_rejected_7d: 1, session_limit_7d: 3, avg_latency_ms_7d: 18250, last_used_at: new Date('2026-10-09T14:00:00Z'),
              input_tokens_month: '120000', output_tokens_month: '30000', cost_usd_month: '0.540000',
            }] };
          }
          if (sql === PLATFORM_MODEL_USAGE_DAILY_SQL) {
            return { rows: [{ agent_id: 'AGT-003', capability: 'agt003.opportunity-copilot.preview', day: '2026-10-09', uses: 3, rejected: 1 }] };
          }
          return { rows: [] };
        },
        release(error) { released.push(error); },
      };
    },
  };
}

test('lee en transacción read only y arma uso por agente+capacidad', async () => {
  const pool = fakePool();
  const now = new Date('2026-10-09T15:00:00Z');
  const payload = await listPlatformModelUsage({ pool, now, env: {} });
  assert.deepEqual(pool.queries.map(query => query.sql), ['begin read only', 'set local statement_timeout = 5000', PLATFORM_MODEL_USAGE_SUMMARY_SQL, PLATFORM_MODEL_USAGE_DAILY_SQL, PLATFORM_MODEL_ALERTS_SQL, 'commit']);
  assert.deepEqual(pool.queries[2].params, [now.toISOString()]);
  assert.deepEqual(pool.released, [undefined]);
  assert.equal(payload.has_data, true);
  const copilot = payload.capabilities.find(item => item.capability === 'agt003.opportunity-copilot.preview');
  assert.equal(copilot.today, 3);
  assert.equal(copilot.month, 41);
  assert.deepEqual(copilot.last_7_days, { completed: 10, failed: 1, rejected: 2, quota_rejected: 1, session_limit: 3 });
  assert.equal(payload.session_limit_7d, 3, 'veces que se tocó el límite de la suscripción en 7 días');
  assert.equal(copilot.avg_latency_ms, 18250);
  assert.equal(copilot.last_used_at, '2026-10-09T14:00:00.000Z');
  assert.deepEqual(copilot.month_tokens, { input: 120000, output: 30000 });
  assert.equal(copilot.month_cost_usd_equivalent, 0.54);
  assert.deepEqual(copilot.limit, { period: 'day', max: 20, source: 'code', version_number: null });
  assert.equal(payload.today, '2026-10-09', 'día de referencia en hora de Bogotá');
  assert.deepEqual(copilot.daily.at(-1), { day: '2026-10-09', uses: 3, rejected: 1 });
  const lead = payload.capabilities.find(item => item.capability === 'agt003.lead-deep-analysis');
  assert.equal(lead.month, 0);
  assert.deepEqual(lead.limit, { period: 'month', max: 30, source: 'code', version_number: null });
});

test('"Tope actual": topes de la configuración vigente aprobada o valores del código', async () => {
  const configuration = defaultAgentConfiguration('AGT-003');
  configuration.capabilities['agt003.opportunity-copilot.preview'].team_cap = { per: 'month', max: 300 };
  configuration.capabilities['agt003.lead-deep-analysis'].enabled = false;
  const limits = limitsFromEffectiveConfiguration({ source: 'platform', version_number: 4, configuration }, {});
  assert.deepEqual(limits['agt003.opportunity-copilot.preview'], { period: 'month', max: 300, source: 'configuration', version_number: 4, enabled: true });
  assert.deepEqual(limits['agt003.lead-deep-analysis'], { period: 'month', max: 30, source: 'configuration', version_number: 4, enabled: false });
  assert.deepEqual(limitsFromEffectiveConfiguration(null, {})['agt003.opportunity-copilot.preview'], { period: 'day', max: 20, source: 'code', version_number: null, enabled: true });
  const payload = await listPlatformModelUsage({ pool: fakePool(), now: new Date('2026-10-10T04:30:00Z'), env: {}, limits });
  assert.equal(payload.today, '2026-10-09', '23:30 en Bogotá sigue siendo el 9');
  assert.equal(payload.capabilities.find(item => item.capability === 'agt003.opportunity-copilot.preview').limit.max, 300);
});

test('sin PLATFORM_DATABASE_URL o con error → 503 neutro, rollback y cliente descartado', async () => {
  await assert.rejects(listPlatformModelUsage({ env: {} }), error => isPlatformAgentsUnavailable(error) && error.status === 503 && error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(listPlatformModelUsage({ pool: fakePool({ connectError: new Error('password authentication failed') }) }), error => error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE);
    const pool = fakePool({ failOn: 'from platform.model_usage_event' });
    await assert.rejects(listPlatformModelUsage({ pool }), error => error.message === PLATFORM_AGENTS_UNAVAILABLE_MESSAGE && !/db\.internal|permission/.test(error.message));
    assert.equal(pool.queries.at(-1).sql, 'rollback');
    assert.deepEqual(pool.released, [true]);
  } finally { console.warn = warn; }
});

test('"Uso de IA" tiene su pestaña: destaca usos, fallas y límite de la suscripción; costo equivalente secundario', () => {
  assert.ok(view.includes("import { ModelUsageSection } from './ModelUsageSection';"));
  assert.ok(view.includes("{tab === 'usage' && <ModelUsageSection usage={usage} agentNames={agentNames} />}"), 'la sección vive en la pestaña Uso de IA');
  assert.ok(loader.includes("api<ModelUsagePayload>('/api/platform/model-usage')"));
  for (const text of ['<Panel title="Uso de IA">', 'role="meter"', 'Usos hoy', 'Usos este mes', 'Fallidos (7 días)', 'Límite de la suscripción (7 días)', 'Completados (7 días)', 'Rechazados (7 días)', 'Tiempo medio de respuesta', 'Costo equivalente del mes', 'Último uso', 'MODEL_USAGE_COST_NOTE', 'MODEL_USAGE_EMPTY_TEXT']) {
    assert.ok(section.includes(text), text);
  }
  const highlights = section.slice(section.indexOf('platform-usage-highlights'), section.indexOf('</dl>'));
  assert.ok(!highlights.includes('Costo equivalente'), 'el costo no está entre los datos destacados');
  assert.ok(section.indexOf('Costo equivalente del mes') > section.indexOf('platform-usage-secondary'), 'el costo va en la línea secundaria');
  assert.doesNotMatch(section, /\{item\.capability\}<\/small>|item\.agent_id\} · \{item\.capability/, 'no muestra IDs técnicos de capacidades');
  assert.match(section, /usage\.status === 'error' && <div className="error" role="alert">\{usage\.message\}<\/div>/, 'el 503 "no está conectada" se muestra tal cual');
  assert.match(section, /!usage\.data\.has_data && <EmptyState/, 'mensaje claro sin datos');
  assert.ok(presentation.includes("'agt003.opportunity-copilot.preview': 'Siguiente paso (copiloto)'"));
  assert.ok(presentation.includes("'agt003.lead-deep-analysis': 'Análisis profundo'"));
  assert.ok(presentation.includes('suscripción'), 'aclara que el costo es equivalente por la suscripción');
});
