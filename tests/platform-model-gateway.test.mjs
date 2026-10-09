// Puerta única de modelos (Paso 1: registro central). Pruebas unitarias con dobles: la puerta registra
// completed/failed/rejected con los campos correctos, nunca envía contenido y no rompe ni demora la respuesta si el
// registro falla o tarda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT003_COPILOT_CAPABILITY,
  AGT003_LEAD_ANALYSIS_CAPABILITY,
  MODEL_GATEWAY_RECORD_TIMEOUT_MS,
  RECORD_MODEL_USAGE_SQL,
  buildModelUsageEvent,
  createModelGatewayClient,
  gatewayEnvironment,
  modelUsageParams,
  normalizeFailureCode,
  recordModelRejection,
  recordModelUsage,
  safeCorrelationId,
} from '../platform-model-gateway.js';
import { estimateLeadAnalysisCostUsd } from '../src/vigia/lead-analysis.js';
import { runLeadAnalysis } from '../agt003-lead-analysis.js';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';

const SECRET_INPUT = 'Cliente Secreto S.A.S. decisor@cliente.test +57 300 000 0000';
const SECRET_OUTPUT = '{"mensaje":"Texto privado generado por el modelo"}';
const SECRET_POLICY = 'Eres Vig-IA — política privada';
const KEY = 'a'.repeat(64);
const EVENT_KEYS = ['agent_id', 'capability', 'environment', 'provider', 'model', 'status', 'failure_code', 'latency_ms', 'input_tokens', 'output_tokens', 'cost_usd_equivalent', 'correlation_id', 'occurred_at'];

function clock(...values) {
  const queue = [...values];
  return () => queue.shift();
}

function runOptions(overrides = {}) {
  return {
    model: 'claude-sonnet-test',
    policy: SECRET_POLICY,
    input: { cliente: SECRET_INPUT },
    outputSchema: { type: 'object' },
    timeoutMs: 30_000,
    idempotencyKey: KEY,
    ...overrides,
  };
}

function assertNoContent(event) {
  const serialized = JSON.stringify(event);
  for (const secret of [SECRET_INPUT, SECRET_OUTPUT, SECRET_POLICY, 'Cliente Secreto', 'decisor@cliente.test', 'Texto privado']) {
    assert.ok(!serialized.includes(secret), `el evento no contiene: ${secret}`);
  }
  assert.deepEqual(Object.keys(event).sort(), [...EVENT_KEYS].sort(), 'sólo los 13 campos del libro');
}

test('completed: tokens, costo equivalente con la tarifa del análisis profundo, latencia y correlación', async () => {
  const events = [];
  const usage = { input_tokens: 1200, output_tokens: 800 };
  const gateway = createModelGatewayClient({
    client: { async run() { return { content: SECRET_OUTPUT, usage, rate_limit: { remaining: 3 } }; } },
    capability: AGT003_COPILOT_CAPABILITY,
    env: { VERCEL_ENV: 'production' },
    recordUsage: async event => { events.push(event); },
    now: clock(1_000, 1_850),
  });
  const result = await gateway.run(runOptions());
  assert.deepEqual(result, { content: SECRET_OUTPUT, usage, rate_limit: { remaining: 3 } }, 'el resultado del puente pasa intacto');
  assert.equal(events.length, 1);
  const [event] = events;
  assertNoContent(event);
  assert.deepEqual({ ...event, occurred_at: 'x' }, {
    agent_id: 'AGT-003',
    capability: 'agt003.opportunity-copilot.preview',
    environment: 'production',
    provider: 'claude_subscription',
    model: 'claude-sonnet-test',
    status: 'completed',
    failure_code: null,
    latency_ms: 850,
    input_tokens: 1200,
    output_tokens: 800,
    cost_usd_equivalent: estimateLeadAnalysisCostUsd(usage),
    correlation_id: KEY,
    occurred_at: 'x',
  });
  assert.ok(!Number.isNaN(Date.parse(event.occurred_at)));
});

test('failed: el error del puente se relanza idéntico y queda con su código', async () => {
  const events = [];
  const failure = Object.assign(new Error('El servicio de Vig-IA devolvió un error.'), { code: 'AGT003_CLAUDE_TIMEOUT' });
  const gateway = createModelGatewayClient({
    client: { async run() { throw failure; } },
    capability: AGT003_LEAD_ANALYSIS_CAPABILITY,
    env: {},
    recordUsage: async event => { events.push(event); },
    now: clock(0, 42),
  });
  await assert.rejects(gateway.run(runOptions({ idempotencyKey: '11111111-1111-4111-8111-111111111111' })), error => error === failure);
  assert.equal(events.length, 1);
  assertNoContent(events[0]);
  assert.equal(events[0].capability, 'agt003.lead-deep-analysis');
  assert.equal(events[0].environment, 'production', 'sin VERCEL_ENV el ambiente es production');
  assert.equal(events[0].status, 'failed');
  assert.equal(events[0].failure_code, 'AGT003_CLAUDE_TIMEOUT');
  assert.equal(events[0].latency_ms, 42);
  assert.equal(events[0].input_tokens, null);
  assert.equal(events[0].output_tokens, null);
  assert.equal(events[0].cost_usd_equivalent, null);
  assert.equal(events[0].correlation_id, '11111111-1111-4111-8111-111111111111');
});

test('rejected: puente ocupado (AGT003_BRIDGE_BUSY) se registra como rechazo y el error no cambia', async () => {
  const events = [];
  const busy = Object.assign(new Error('El servicio de Vig-IA devolvió un error.'), { code: 'AGT003_BRIDGE_BUSY' });
  const gateway = createModelGatewayClient({
    client: { async run() { throw busy; } },
    capability: AGT003_COPILOT_CAPABILITY,
    recordUsage: async event => { events.push(event); },
  });
  await assert.rejects(gateway.run(runOptions()), error => error === busy && error.code === 'AGT003_BRIDGE_BUSY');
  assert.equal(events[0].status, 'rejected');
  assert.equal(events[0].failure_code, 'AGT003_BRIDGE_BUSY');
});

test('códigos y correlación se normalizan al formato del libro', () => {
  assert.equal(normalizeFailureCode('agt003-claude.timeout'), 'AGT003_CLAUDE_TIMEOUT');
  assert.equal(normalizeFailureCode(undefined), 'MODEL_GATEWAY_UNKNOWN_ERROR');
  assert.equal(normalizeFailureCode('***'), 'MODEL_GATEWAY_UNKNOWN_ERROR');
  assert.match(normalizeFailureCode('X'.repeat(300)), /^[A-Z0-9_]{1,96}$/);
  assert.equal(safeCorrelationId(KEY), KEY);
  assert.equal(safeCorrelationId('con espacios y @correo'), null);
  assert.equal(safeCorrelationId('x'.repeat(129)), null);
  assert.equal(gatewayEnvironment({ VERCEL_ENV: 'Preview' }), 'preview');
  assert.equal(gatewayEnvironment({}), 'production');
  const event = buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'failed', failureCode: 'bad code!', correlationId: 'no válido', model: '  m  ', extra: SECRET_INPUT });
  assert.equal(event.failure_code, 'BAD_CODE');
  assert.equal(event.correlation_id, null);
  assert.equal(event.model, 'm');
  assertNoContent(event);
  assert.throws(() => buildModelUsageEvent({ capability: 'otra.cosa', status: 'completed' }));
});

test('si el registro falla o lanza, la respuesta al usuario no cambia', async () => {
  const gateway = createModelGatewayClient({
    client: { async run() { return { content: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }; } },
    capability: AGT003_COPILOT_CAPABILITY,
    recordUsage: async () => { throw new Error('platform down at db.internal'); },
  });
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal((await gateway.run(runOptions())).content, 'ok');
  } finally { console.warn = warn; }
  assert.ok(!JSON.stringify(warnings).includes('db.internal'), 'la advertencia no repite detalles del error');
});

test('recordModelUsage: sin PLATFORM_GATEWAY_DATABASE_URL no registra y sigue normal', async () => {
  assert.equal(await recordModelUsage(buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'completed' }), { env: {} }), 'skipped');
  assert.equal(await recordModelUsage(buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'completed' }), { env: { PLATFORM_GATEWAY_DATABASE_URL: 'https://no-es-postgres' } }), 'skipped');
});

test('recordModelUsage: llama a platform.record_model_usage con 13 parámetros y sin contenido', async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ record_model_usage: 'id' }] }; } };
  const event = buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'completed', model: 'm', usage: { input_tokens: 3, output_tokens: 4 }, latencyMs: 10, correlationId: KEY });
  assert.equal(await recordModelUsage(event, { pool }), 'recorded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, RECORD_MODEL_USAGE_SQL);
  assert.equal(RECORD_MODEL_USAGE_SQL, 'select platform.record_model_usage($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)');
  assert.deepEqual(calls[0].params, modelUsageParams(event));
  assert.equal(calls[0].params.length, 13);
  assert.deepEqual(calls[0].params.slice(0, 7), ['AGT-003', AGT003_COPILOT_CAPABILITY, 'production', 'claude_subscription', 'm', 'completed', null]);
});

test('recordModelUsage: un registro lento se corta en el timeout y no demora la respuesta', async () => {
  assert.ok(MODEL_GATEWAY_RECORD_TIMEOUT_MS <= 2000, 'timeout corto (≤ 2 s)');
  const pool = { query: () => new Promise(() => {}) };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const started = Date.now();
    const outcome = await recordModelUsage(buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'completed' }), { pool, timeoutMs: 50 });
    assert.equal(outcome, 'timeout');
    assert.ok(Date.now() - started < 1000);
    const failing = { query: async () => { throw Object.assign(new Error('permission denied for host db.secret'), { code: '42501' }); } };
    assert.equal(await recordModelUsage(buildModelUsageEvent({ capability: AGT003_COPILOT_CAPABILITY, status: 'completed' }), { pool: failing }), 'failed');
  } finally { console.warn = warn; }

  // Extremo a extremo: la puerta devuelve el resultado aunque el registro se quede colgado.
  const gateway = createModelGatewayClient({
    client: { async run() { return { content: 'ok', usage: { input_tokens: 1, output_tokens: 1 } }; } },
    capability: AGT003_COPILOT_CAPABILITY,
    recordUsage: event => recordModelUsage(event, { pool, timeoutMs: 50 }),
  });
  console.warn = () => {};
  try {
    assert.equal((await gateway.run(runOptions())).content, 'ok');
  } finally { console.warn = warn; }
});

test('recordModelRejection: tope agotado sin llamar al modelo y nunca lanza', async () => {
  const events = [];
  await recordModelRejection({ capability: AGT003_LEAD_ANALYSIS_CAPABILITY, model: 'm', failureCode: 'AGT003_LEAD_ANALYSIS_QUOTA', correlationId: KEY, env: {}, recordUsage: async event => { events.push(event); } });
  assert.equal(events[0].status, 'rejected');
  assert.equal(events[0].failure_code, 'AGT003_LEAD_ANALYSIS_QUOTA');
  assert.equal(events[0].latency_ms, null);
  assert.equal(events[0].input_tokens, null);
  assertNoContent(events[0]);
  await recordModelRejection({ capability: AGT003_LEAD_ANALYSIS_CAPABILITY, failureCode: 'X', recordUsage: async () => { throw new Error('boom'); } });
  await recordModelRejection({ capability: 'no-valida', failureCode: 'X', recordUsage: async () => {} });
});

test('análisis profundo: runLeadAnalysis pasa por la puerta (completed con tokens, sin contenido)', async () => {
  const env = {
    AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
    AGT003_COPILOT_MODEL: 'synthetic-model',
    AGT003_COPILOT_BRIDGE_URL: 'https://agents.example.test/v1/agt003-copilot/run',
    AGT003_COPILOT_HMAC_SECRET: 's'.repeat(32),
  };
  const output = {
    empresa: { que_hace: 'Hace cosas.', sedes: 'No aparece.', tamano: 'No aparece.' },
    riesgos_sector: ['Riesgo uno.', 'Riesgo dos.'],
    servicio_recomendado: { servicio: 'Vigilancia', por_que: 'Encaja.' },
    mensaje_sugerido: { canal: 'correo', texto: 'Hola.' },
    pendientes_por_confirmar: [],
  };
  const events = [];
  const result = await runLeadAnalysis({
    input: { cliente: { nombre: SECRET_INPUT } },
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    environment: env,
    client: { async run() { return { content: JSON.stringify(output), usage: { input_tokens: 5000, output_tokens: 1000 } }; } },
    recordUsage: async event => { events.push(event); },
  });
  assert.equal(result.model, 'synthetic-model');
  assert.equal(events.length, 1);
  assert.equal(events[0].capability, AGT003_LEAD_ANALYSIS_CAPABILITY);
  assert.equal(events[0].status, 'completed');
  assert.equal(events[0].cost_usd_equivalent, result.costUsd, 'mismo costo equivalente que guarda el análisis profundo');
  assert.equal(events[0].correlation_id, '22222222-2222-4222-8222-222222222222');
  assertNoContent(events[0]);
  assert.ok(!JSON.stringify(events[0]).includes('Hace cosas'));
});

test('copiloto: tope diario → recordRejection(VIGIA_COPILOT_QUOTA) sin crear runtime', async () => {
  const opportunityId = '11111111-1111-4111-8111-111111111111';
  const rejections = [];
  let runtimeCreated = false;
  const api = createAgt003CopilotApi({
    isConfigured: () => true,
    getConfig: () => ({ model: 'synthetic-model', policyVersion: 'p1', dailyMaxRuns: 20, maxConcurrent: 1, leaseSeconds: 45 }),
    resolveOpportunityResource: async () => ({ area_code: 'comercial', subarea_code: null, owner_id: 'human-1' }),
    loadOpportunityContext: async () => ({
      opportunity: { id: opportunityId, title: 'Oportunidad', company_name: 'Empresa', stage: 'Contacto', service: 'Seguridad', owner_name: 'Humano', preparation_date: '2030-02-01' },
      interactions: [],
      snapshotId: 'snapshot-1',
    }),
    loadApprovedAssets: async () => [],
    claimRun: async () => ({ status: 'quota' }),
    findRunByKey: async () => null,
    findRunById: async () => null,
    createRuntime: () => { runtimeCreated = true; throw new Error('no debe crearse'); },
    recordRun: async () => { throw new Error('no'); },
    recordFailure: async () => { throw new Error('no'); },
    releaseClaim: async () => {},
    recordFeedback: async () => {},
    recordRejection: async payload => { rejections.push(payload); },
  });
  const profile = { id: 'human-1', active: true, identity_type: 'human', role: 'comercial', permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [] };
  await assert.rejects(api.generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'email' } }), error => error.status === 429 && error.code === 'VIGIA_COPILOT_QUOTA');
  assert.equal(runtimeCreated, false, 'no se llama al modelo');
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].failureCode, 'VIGIA_COPILOT_QUOTA');
  assert.equal(rejections[0].model, 'synthetic-model');
  assert.match(rejections[0].correlationId, /^[0-9a-f]{64}$/, 'la correlación es la clave de idempotencia (hash), no datos del cliente');
});

test('cableado: copiloto y análisis profundo envuelven el cliente del puente con la puerta', () => {
  const runtime = readFileSync(new URL('../agt003-copilot-runtime.js', import.meta.url), 'utf8');
  assert.match(runtime, /createModelGatewayClient\(\{\n    client: createAgt003CopilotBridgeClient\(/);
  assert.ok(runtime.includes('capability: AGT003_COPILOT_CAPABILITY'));
  const lead = readFileSync(new URL('../agt003-lead-analysis.js', import.meta.url), 'utf8');
  assert.ok(lead.includes('client: bridge, capability: AGT003_LEAD_ANALYSIS_CAPABILITY'));
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.ok(server.includes("recordRejection: ({ failureCode, model, correlationId }) => recordModelRejection({ capability: AGT003_COPILOT_CAPABILITY, model, failureCode, correlationId })"));
  const quota = server.slice(server.indexOf("if (claim?.status === 'quota') {"), server.indexOf("error.code = 'AGT003_LEAD_ANALYSIS_QUOTA'"));
  assert.ok(quota.includes("await recordModelRejection({ capability: AGT003_LEAD_ANALYSIS_CAPABILITY"), 'el tope mensual se registra como rechazo');
  const gateway = readFileSync(new URL('../platform-model-gateway.js', import.meta.url), 'utf8');
  assert.ok(gateway.includes('env.PLATFORM_GATEWAY_DATABASE_URL'));
  assert.ok(gateway.includes('ssl: platformSslConfig(env)'), 'SSL obligatorio');
  assert.doesNotMatch(gateway, /options\.input|options\.policy|outputSchema|result\.content/, 'la puerta no lee entrada, política ni salida');
});
