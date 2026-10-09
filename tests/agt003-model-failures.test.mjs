// Puerta única de modelos — Paso 3 (Vig-IA Comercial, AGT-003): clasificación de fallas del puente o del modelo,
// registro en el libro central (sólo metadatos, idempotente, sin romper la petición), mensajes al usuario por categoría
// (plan B "pausar y avisar") y avisos de IT → Agentes. Todo con dobles: sin red ni base reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT003_MODEL_FAILURE,
  AGT003_MODEL_FAILURE_CODES,
  AGT003_MODEL_FAILURE_IT_TEXT,
  AGT003_MODEL_FAILURE_MESSAGES,
  agt003ModelFailureMessage,
  classifyAgt003ModelFailure,
  isAgt003ModelFailureMessage,
} from '../src/vigia/model-failures.js';
import {
  AGT003_COPILOT_CAPABILITY,
  AGT003_LEAD_ANALYSIS_CAPABILITY,
  __resetModelGatewayFailureDedupForTests,
  createModelGatewayClient,
  isDuplicateFailureEvent,
  recordModelUsage,
} from '../platform-model-gateway.js';
import { createAgt003CopilotBridgeClient } from '../agt003-copilot-bridge-client.js';
import { createAgt003CopilotEngine } from '../agt003-copilot-engine.js';
import { createAgt003CopilotApi } from '../agt003-copilot-api.js';
import { runLeadAnalysis } from '../agt003-lead-analysis.js';
import { presentModelAlerts, presentModelUsage } from '../platform-model-usage.js';
import { AI_FALLBACK_OPTIONS } from '../platform-agent-configuration.js';

const { LOGIN_REQUIRED, BRIDGE_UNAVAILABLE, SESSION_LIMIT, MODEL_ERROR } = AGT003_MODEL_FAILURE;
const SECRET = 'Cliente Secreto S.A.S. decisor@cliente.test';
const LEAD_ENV = {
  AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
  AGT003_COPILOT_MODEL: 'sonnet',
  AGT003_COPILOT_BRIDGE_URL: 'https://agents.example.test/v1/agt003-copilot/run',
  AGT003_COPILOT_HMAC_SECRET: 's'.repeat(32),
};

function codedError(code, message = 'detalle interno del puente que no debe salir') {
  return Object.assign(new Error(message), { code });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Clasificación

test('clasificación: los códigos que hoy devuelven el puente y los clientes caen en cuatro categorías estables', () => {
  const cases = {
    AGT003_CLAUDE_LOGIN_REQUIRED: LOGIN_REQUIRED,
    AGT003_CLAUDE_SESSION_LIMIT: SESSION_LIMIT,
    AGT003_CLAUDE_TIMEOUT: BRIDGE_UNAVAILABLE,
    AGT003_CLAUDE_TRANSPORT_ERROR: BRIDGE_UNAVAILABLE,
    AGT003_COPILOT_TRANSPORT_ERROR: BRIDGE_UNAVAILABLE,
    AGT003_BRIDGE_AUTH_INVALID: BRIDGE_UNAVAILABLE,
    AGT003_BRIDGE_INTERNAL: BRIDGE_UNAVAILABLE,
    AGT003_CLAUDE_PROVIDER_ERROR: MODEL_ERROR,
    AGT003_CLAUDE_INVALID_RESPONSE: MODEL_ERROR,
    AGT003_CLAUDE_OUTPUT_TOO_LARGE: MODEL_ERROR,
    AGT003_CLAUDE_SCHEMA_TOO_LARGE: MODEL_ERROR,
    AGT003_COPILOT_INVALID_RESPONSE: MODEL_ERROR,
    AGT003_COPILOT_INTERNAL: MODEL_ERROR,
    AGT003_BRIDGE_BAD_REQUEST: MODEL_ERROR,
    COPILOT_UNAVAILABLE: MODEL_ERROR,
    MODEL_GATEWAY_UNKNOWN_ERROR: MODEL_ERROR,
    // Modo compartido: el puente de Licitaciones responde los mismos sufijos con prefijo AGT002_.
    AGT002_CLAUDE_LOGIN_REQUIRED: LOGIN_REQUIRED,
    AGT002_CLAUDE_TIMEOUT: BRIDGE_UNAVAILABLE,
  };
  for (const [code, expected] of Object.entries(cases)) assert.equal(classifyAgt003ModelFailure(code), expected, code);
  for (const category of AGT003_MODEL_FAILURE_CODES) assert.equal(classifyAgt003ModelFailure(category), category, 'una categoría se clasifica a sí misma');
  assert.equal(classifyAgt003ModelFailure(codedError('agt003_claude_login_required')), LOGIN_REQUIRED, 'acepta un error con .code, sin importar mayúsculas');
  assert.equal(classifyAgt003ModelFailure(undefined), MODEL_ERROR, 'sin código: otro error del modelo (nunca se pierde una falla)');
  assert.equal(classifyAgt003ModelFailure(new Error('x')), MODEL_ERROR);
});

test('clasificación: cancelación, puente ocupado, cupos y función apagada NO son fallas del proveedor', () => {
  for (const code of ['AGT003_CLAUDE_CANCELLED', 'AGT003_COPILOT_CANCELLED', 'AGT003_BRIDGE_BUSY', 'VIGIA_COPILOT_QUOTA',
    'VIGIA_COPILOT_PERSONAL_QUOTA', 'AGT003_LEAD_ANALYSIS_QUOTA', 'AGT003_CAPABILITY_DISABLED', 'VIGIA_COPILOT_SATURATED',
    'VIGIA_COPILOT_IN_PROGRESS', 'VIGIA_COPILOT_RETRY_LIMIT']) {
    assert.equal(classifyAgt003ModelFailure(code), null, code);
  }
});

test('las categorías reutilizan los códigos existentes de sesión vencida y límite (Uso de IA cuenta %SESSION_LIMIT)', () => {
  assert.equal(LOGIN_REQUIRED, 'AGT003_CLAUDE_LOGIN_REQUIRED');
  assert.equal(SESSION_LIMIT, 'AGT003_CLAUDE_SESSION_LIMIT');
  assert.match(SESSION_LIMIT, /SESSION_LIMIT$/);
  for (const code of AGT003_MODEL_FAILURE_CODES) assert.match(code, /^AGT003_[A-Z0-9_]+$/);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Mensajes al usuario (plan B "avisar")

test('mensajes: distintos por categoría, en lenguaje común, sin códigos ni nombres técnicos, en las dos funciones', () => {
  for (const feature of ['copilot', 'lead_analysis']) {
    const messages = AGT003_MODEL_FAILURE_CODES.map(category => agt003ModelFailureMessage(category, feature));
    assert.equal(new Set(messages).size, 4, `${feature}: un mensaje distinto por categoría`);
    for (const message of messages) {
      assert.match(message, /^Vig-IA /);
      assert.match(message, /IT/, 'dice que IT tiene el registro');
      assert.doesNotMatch(message, /AGT00|[A-Z]{3,}_[A-Z]|puente|bridge|token|HTTP|\b5\d\d\b|Claude|OAuth|stderr|timeout/i, message);
      assert.ok(isAgt003ModelFailureMessage(message));
    }
  }
  assert.match(agt003ModelFailureMessage(LOGIN_REQUIRED), /no está disponible por ahora/);
  assert.match(agt003ModelFailureMessage(BRIDGE_UNAVAILABLE), /no está disponible por ahora/);
  assert.match(agt003ModelFailureMessage(MODEL_ERROR, 'lead_analysis'), /el análisis/);
  assert.match(agt003ModelFailureMessage(MODEL_ERROR, 'copilot'), /el seguimiento/);
  assert.equal(agt003ModelFailureMessage('LO_QUE_SEA'), agt003ModelFailureMessage(MODEL_ERROR), 'categoría desconocida: mensaje genérico');
  assert.equal(AGT003_MODEL_FAILURE_MESSAGES.length, 8);
  assert.equal(isAgt003ModelFailureMessage('Error 500: connection refused'), false);
});

test('textos de IT sin nombres técnicos ni códigos', () => {
  for (const category of AGT003_MODEL_FAILURE_CODES) {
    const text = AGT003_MODEL_FAILURE_IT_TEXT[category];
    assert.ok(text.title && text.help, category);
    assert.doesNotMatch(`${text.title} ${text.help}`, /AGT00|[A-Z]{3,}_[A-Z]|bridge|HTTP|OAuth|timeout|token/i);
  }
});

test('plan B: "avisar" es el único valor activo; no existe cambio a otro modelo ni a otro proveedor', () => {
  assert.deepEqual(AI_FALLBACK_OPTIONS.map(option => option.id), ['notify']);
  const source = readFileSync(new URL('../src/vigia/model-failures.js', import.meta.url), 'utf8');
  assert.match(source, /No se cambia a otro modelo ni a otro proveedor/);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Registro en el libro central

test('puerta: cada falla queda con su categoría, la función, el modelo y la correlación; sin contenido', async () => {
  __resetModelGatewayFailureDedupForTests();
  const events = [];
  const cases = [
    ['AGT003_CLAUDE_LOGIN_REQUIRED', LOGIN_REQUIRED],
    ['AGT003_COPILOT_TRANSPORT_ERROR', BRIDGE_UNAVAILABLE],
    ['AGT003_CLAUDE_SESSION_LIMIT', SESSION_LIMIT],
    ['AGT003_CLAUDE_PROVIDER_ERROR', MODEL_ERROR],
  ];
  for (const [index, [raw, category]] of cases.entries()) {
    const failure = codedError(raw, SECRET);
    const gateway = createModelGatewayClient({
      client: { async run() { throw failure; } },
      capability: AGT003_COPILOT_CAPABILITY,
      env: {},
      classifyFailure: classifyAgt003ModelFailure,
      recordUsage: async event => { events.push(event); },
    });
    await assert.rejects(gateway.run({ model: 'sonnet', policy: SECRET, input: { secret: SECRET }, idempotencyKey: `corr-${index}` }),
      error => error === failure, 'el error del puente sigue intacto para el llamador');
    const event = events.at(-1);
    assert.equal(event.status, 'failed');
    assert.equal(event.failure_code, category, raw);
    assert.equal(event.capability, AGT003_COPILOT_CAPABILITY);
    assert.equal(event.model, 'sonnet');
    assert.equal(event.correlation_id, `corr-${index}`);
    assert.equal(event.input_tokens, null);
    assert.ok(!JSON.stringify(event).includes('Secreto'), 'nunca el contenido');
  }
  assert.equal(events.length, 4);
});

test('puerta: el puente ocupado sigue siendo un rechazo y la cancelación conserva su código (no son avisos)', async () => {
  __resetModelGatewayFailureDedupForTests();
  const events = [];
  for (const code of ['AGT003_BRIDGE_BUSY', 'AGT003_COPILOT_CANCELLED']) {
    const gateway = createModelGatewayClient({
      client: { async run() { throw codedError(code); } }, capability: AGT003_COPILOT_CAPABILITY, env: {},
      classifyFailure: classifyAgt003ModelFailure, recordUsage: async event => { events.push(event); },
    });
    await assert.rejects(gateway.run({ model: 'sonnet', idempotencyKey: `k-${code}` }));
  }
  assert.deepEqual(events.map(event => [event.status, event.failure_code]), [['rejected', 'AGT003_BRIDGE_BUSY'], ['failed', 'AGT003_COPILOT_CANCELLED']]);
});

test('puerta: idempotente — la misma falla reportada dos veces se registra una sola vez; otra correlación sí cuenta', async () => {
  __resetModelGatewayFailureDedupForTests();
  const events = [];
  const gateway = createModelGatewayClient({
    client: { async run() { throw codedError('AGT003_CLAUDE_TIMEOUT'); } }, capability: AGT003_LEAD_ANALYSIS_CAPABILITY, env: {},
    classifyFailure: classifyAgt003ModelFailure, recordUsage: async event => { events.push(event); },
  });
  await assert.rejects(gateway.run({ model: 'sonnet', idempotencyKey: 'claim-1' }));
  await assert.rejects(gateway.run({ model: 'sonnet', idempotencyKey: 'claim-1' }));
  await assert.rejects(gateway.run({ model: 'sonnet', idempotencyKey: 'claim-2' }));
  assert.deepEqual(events.map(event => event.correlation_id), ['claim-1', 'claim-2']);
  // La ventana es corta y se libera: pasado el minuto, la misma correlación vuelve a contar.
  const event = { status: 'failed', agent_id: 'AGT-003', capability: AGT003_LEAD_ANALYSIS_CAPABILITY, failure_code: BRIDGE_UNAVAILABLE, correlation_id: 'claim-9' };
  assert.equal(isDuplicateFailureEvent(event, 1_000), false);
  assert.equal(isDuplicateFailureEvent(event, 30_000), true);
  assert.equal(isDuplicateFailureEvent(event, 1_000 + 61_000 + 30_000), false);
  assert.equal(isDuplicateFailureEvent({ ...event, status: 'rejected' }, 1), false, 'los rechazos no se deduplican');
  assert.equal(isDuplicateFailureEvent({ ...event, correlation_id: null }, 1), false, 'sin correlación no se deduplica');
});

test('puerta: si el libro no responde (falla o se cuelga) la petición del usuario no se rompe', async () => {
  __resetModelGatewayFailureDedupForTests();
  const failure = codedError('AGT003_CLAUDE_LOGIN_REQUIRED');
  const broken = createModelGatewayClient({
    client: { async run() { throw failure; } }, capability: AGT003_COPILOT_CAPABILITY, env: {},
    classifyFailure: classifyAgt003ModelFailure, recordUsage: async () => { throw new Error('libro caído'); },
  });
  await assert.rejects(broken.run({ model: 'sonnet', idempotencyKey: 'x-1' }), error => error === failure);
  const hanging = { query: () => new Promise(() => {}) };
  const started = Date.now();
  assert.equal(await recordModelUsage({ capability: AGT003_COPILOT_CAPABILITY, status: 'failed' }, { pool: hanging, timeoutMs: 50 }), 'timeout');
  assert.ok(Date.now() - started < 1000, 'no demora la respuesta');
  assert.equal(await recordModelUsage({ capability: AGT003_COPILOT_CAPABILITY, status: 'failed' }, { env: {} }), 'skipped', 'sin conexión configurada no registra');
});

test('análisis profundo: la falla del puente queda en el libro con su categoría', async () => {
  __resetModelGatewayFailureDedupForTests();
  const events = [];
  await assert.rejects(runLeadAnalysis({
    input: { cliente: { nombre: SECRET } },
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
    environment: LEAD_ENV,
    client: { async run() { throw codedError('AGT003_CLAUDE_TIMEOUT'); } },
    recordUsage: async event => { events.push(event); },
  }), error => error.code === 'AGT003_CLAUDE_TIMEOUT');
  assert.equal(events.length, 1);
  assert.equal(events[0].capability, AGT003_LEAD_ANALYSIS_CAPABILITY);
  assert.equal(events[0].failure_code, BRIDGE_UNAVAILABLE);
  assert.equal(events[0].correlation_id, '33333333-3333-4333-8333-333333333333');
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Cliente del puente: lo que devuelve hoy se traduce sin inventar formatos

function fakeResponse(status, body, { json = true } = {}) {
  const text = json ? JSON.stringify(body) : body;
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, body: null, json: async () => JSON.parse(text) };
}

function bridgeClient(fetchImpl) {
  return createAgt003CopilotBridgeClient({ url: LEAD_ENV.AGT003_COPILOT_BRIDGE_URL, hmacSecret: 's'.repeat(32), fetchImpl });
}

const RUN = { model: 'sonnet', policy: 'p', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 1000 };

test('cliente del puente: código del puente se conserva; 5xx sin cuerpo del puente = puente no disponible', async () => {
  await assert.rejects(bridgeClient(async () => fakeResponse(503, { error: { code: 'AGT003_CLAUDE_LOGIN_REQUIRED' } })).run(RUN),
    error => error.code === 'AGT003_CLAUDE_LOGIN_REQUIRED');
  await assert.rejects(bridgeClient(async () => fakeResponse(502, '<html>Bad Gateway</html>', { json: false })).run(RUN),
    error => error.code === 'AGT003_COPILOT_TRANSPORT_ERROR' && classifyAgt003ModelFailure(error) === BRIDGE_UNAVAILABLE);
  await assert.rejects(bridgeClient(async () => fakeResponse(503, {})).run(RUN), error => error.code === 'AGT003_COPILOT_TRANSPORT_ERROR');
  await assert.rejects(bridgeClient(async () => { throw new TypeError('fetch failed'); }).run(RUN), error => error.code === 'AGT003_COPILOT_TRANSPORT_ERROR');
  await assert.rejects(bridgeClient(async () => fakeResponse(400, {})).run(RUN), error => error.code === 'AGT003_COPILOT_INTERNAL');
  await assert.rejects(bridgeClient(async () => fakeResponse(200, 'no-json', { json: false })).run(RUN), error => error.code === 'AGT003_COPILOT_INVALID_RESPONSE');
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Mensaje en las dos funciones

function copilotApi(throwCode, recorded) {
  const profile = {
    id: 'user-comercial', active: true, identity_type: 'human', role: 'comercial',
    permissions: ['modulo_vig_ia', 'modulo_oportunidades', 'vigia_copilot_pilot'], areas: [],
  };
  const opportunityId = '11111111-1111-4111-8111-111111111111';
  const engine = createAgt003CopilotEngine({ client: { async run() { throw codedError(throwCode, SECRET); } }, model: 'sonnet', policyVersion: 'v1' });
  const api = createAgt003CopilotApi({
    isConfigured: () => true,
    getConfig: () => ({ model: 'sonnet', policyVersion: 'v1', dailyMaxRuns: 20, maxConcurrent: 1, leaseSeconds: 45 }),
    resolveOpportunityResource: async () => ({ area_code: 'comercial', subarea_code: 'norte', owner_id: profile.id }),
    loadOpportunityContext: async () => ({
      snapshotId: 'snapshot-001',
      opportunity: { id: opportunityId, owner_id: profile.id, title: 'Renovación sintética', company_name: 'Cliente Sintético', stage: 'Sustentación', service: 'Seguridad electrónica', owner_name: 'Comercial Sintético' },
      interactions: [{ id: 'interaction-1', interaction_type: 'nota', occurred_at: '2030-01-01T00:00:00.000Z', notes: 'Necesidad sintética.' }],
    }),
    loadApprovedAssets: async () => [],
    claimRun: async () => ({ status: 'claimed', claim_id: '55555555-5555-4555-8555-555555555555' }),
    findRunByKey: async () => null,
    findRunById: async () => null,
    createRuntime: () => ({ draft: (request, options) => engine.draft(request, options) }),
    recordRun: async () => { throw new Error('no debe llegar'); },
    recordFailure: async input => { recorded.push(input); },
    releaseClaim: async () => true,
    recordFeedback: async () => null,
  });
  return () => api.generate({ profile, body: { opportunity_id: opportunityId, contact_channel: 'email' } });
}

test('copiloto: mensaje por categoría, sin detalle técnico; el fallido se registra con su código', async () => {
  const cases = [
    ['AGT003_CLAUDE_LOGIN_REQUIRED', LOGIN_REQUIRED, 'VIGIA_COPILOT_UNAVAILABLE'],
    ['AGT003_CLAUDE_TIMEOUT', BRIDGE_UNAVAILABLE, 'VIGIA_COPILOT_UNAVAILABLE'],
    ['AGT003_BRIDGE_INTERNAL', BRIDGE_UNAVAILABLE, 'VIGIA_COPILOT_UNAVAILABLE'],
    ['AGT003_CLAUDE_SESSION_LIMIT', SESSION_LIMIT, 'VIGIA_COPILOT_SESSION_LIMIT'],
    ['AGT003_CLAUDE_PROVIDER_ERROR', MODEL_ERROR, 'VIGIA_COPILOT_UNAVAILABLE'],
  ];
  for (const [raw, category, publicCode] of cases) {
    const recorded = [];
    await assert.rejects(copilotApi(raw, recorded)(), error => {
      assert.equal(error.message, agt003ModelFailureMessage(category, 'copilot'), raw);
      assert.equal(error.code, publicCode);
      assert.ok(!error.message.includes('detalle') && !error.message.includes('Secreto') && !error.message.includes(raw));
      return true;
    });
    assert.equal(recorded.length, 1, `${raw}: el fallido queda en el CRM (y, desde la migración 120, no consume cupo)`);
  }
});

test('análisis profundo (servidor): mensaje por categoría, "no se descontó" y error interno nunca técnico', () => {
  for (const path of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes("const category = classifyAgt003ModelFailure(runError) || AGT003_MODEL_FAILURE.MODEL_ERROR;"), path);
    assert.ok(source.includes("agt003ModelFailureMessage(category, 'lead_analysis')} No se descontó de tu cupo."), path);
    assert.ok(source.includes("'Vig-IA no pudo preparar el análisis por ahora. Intenta de nuevo en unos minutos.'"), path);
    assert.ok(!source.includes('No se pudo preparar el análisis. No se descontó del cupo; intente de nuevo en unos minutos.'), path);
  }
});

test('copiloto (interfaz): muestra el mensaje de la categoría sólo si es uno de los mensajes en lenguaje común', () => {
  const source = readFileSync(new URL('../src/vigia/VigiaOpportunityCopilot.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('isAgt003ModelFailureMessage(state.message) && <span className="vigia-copilot-error-reason">{state.message}</span>'));
  assert.ok(source.includes('No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.'));
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Avisos de IT → Agentes

const AT = iso => new Date(iso);
const failed = (capability, code, lastAt, count24h = 1, count7d = count24h) => ({ agent_id: 'AGT-003', capability, status: 'failed', failure_code: code, count_24h: count24h, count_7d: count7d, last_at: AT(lastAt) });
const completed = (capability, lastAt) => ({ agent_id: 'AGT-003', capability, status: 'completed', failure_code: null, count_24h: 1, count_7d: 1, last_at: AT(lastAt) });

test('avisos: agrupados por categoría (también códigos crudos del Paso 1), última vez y veces en 24 h', () => {
  const alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, 'AGT003_CLAUDE_LOGIN_REQUIRED', '2026-10-09T14:00:00Z', 2, 3),
    failed(AGT003_LEAD_ANALYSIS_CAPABILITY, 'AGT003_CLAUDE_LOGIN_REQUIRED', '2026-10-09T14:30:00Z', 1, 1),
    failed(AGT003_COPILOT_CAPABILITY, 'AGT003_CLAUDE_TIMEOUT', '2026-10-09T10:00:00Z', 1, 1), // crudo (Paso 1)
    failed(AGT003_COPILOT_CAPABILITY, BRIDGE_UNAVAILABLE, '2026-10-09T11:00:00Z', 2, 2),
    failed(AGT003_COPILOT_CAPABILITY, 'AGT003_COPILOT_CANCELLED', '2026-10-09T12:00:00Z', 5, 5), // no es aviso
  ]);
  assert.deepEqual(alerts.map(alert => alert.category), [LOGIN_REQUIRED, BRIDGE_UNAVAILABLE]);
  const [login, bridge] = alerts;
  assert.equal(login.count_24h, 3);
  assert.equal(login.count_7d, 4);
  assert.equal(login.last_at, '2026-10-09T14:30:00.000Z');
  assert.deepEqual(login.functions, ['Análisis profundo', 'Próximo seguimiento']);
  assert.equal(login.title, AGT003_MODEL_FAILURE_IT_TEXT[LOGIN_REQUIRED].title);
  assert.equal(login.active, true);
  assert.equal(login.last_success_at, null);
  assert.equal(bridge.count_24h, 3, 'código crudo + categoría se suman');
  assert.equal(bridge.last_at, '2026-10-09T11:00:00.000Z');
  for (const alert of alerts) assert.doesNotMatch(JSON.stringify([alert.title, alert.help, alert.functions]), /AGT00|agt003\.|_[A-Z]/);
});

test('avisos: activo mientras no haya un uso exitoso posterior; conexión compartida vs. error de una función', () => {
  // Sesión vencida a las 10:00; un uso exitoso del análisis profundo a las 11:00 la resuelve para todo el agente.
  let alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, LOGIN_REQUIRED, '2026-10-09T10:00:00Z'),
    completed(AGT003_LEAD_ANALYSIS_CAPABILITY, '2026-10-09T11:00:00Z'),
  ]);
  assert.equal(alerts[0].active, false);
  assert.equal(alerts[0].last_success_at, '2026-10-09T11:00:00.000Z');
  // Un éxito ANTERIOR a la falla no la resuelve.
  alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, SESSION_LIMIT, '2026-10-09T12:00:00Z'),
    completed(AGT003_COPILOT_CAPABILITY, '2026-10-09T11:00:00Z'),
  ]);
  assert.equal(alerts[0].active, true);
  // "Otro error" del copiloto no se resuelve con un éxito del análisis profundo; sí con uno del copiloto.
  alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, MODEL_ERROR, '2026-10-09T10:00:00Z'),
    completed(AGT003_LEAD_ANALYSIS_CAPABILITY, '2026-10-09T11:00:00Z'),
  ]);
  assert.equal(alerts[0].active, true);
  alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, MODEL_ERROR, '2026-10-09T10:00:00Z'),
    completed(AGT003_COPILOT_CAPABILITY, '2026-10-09T11:00:00Z'),
  ]);
  assert.equal(alerts[0].active, false);
  // Resuelto y sin fallas en 24 h: ya no se lista. Activo aunque sea viejo (dentro de 7 días): sí.
  alerts = presentModelAlerts([
    failed(AGT003_COPILOT_CAPABILITY, BRIDGE_UNAVAILABLE, '2026-10-05T10:00:00Z', 0, 1),
    completed(AGT003_COPILOT_CAPABILITY, '2026-10-06T11:00:00Z'),
    failed(AGT003_LEAD_ANALYSIS_CAPABILITY, MODEL_ERROR, '2026-10-05T10:00:00Z', 0, 1),
  ]);
  assert.deepEqual(alerts.map(alert => [alert.category, alert.active]), [[MODEL_ERROR, true]]);
});

test('Uso de IA: la respuesta trae los avisos (vacía sin fallas)', () => {
  const now = new Date('2026-10-09T15:00:00Z');
  assert.deepEqual(presentModelUsage({ now, env: {} }).alerts, []);
  const payload = presentModelUsage({ now, env: {}, alertRows: [failed(AGT003_COPILOT_CAPABILITY, LOGIN_REQUIRED, '2026-10-09T14:00:00Z')] });
  assert.equal(payload.alerts.length, 1);
  assert.equal(payload.alerts[0].active, true);
});

test('IT → Agentes (interfaz): el indicador "Avisos" y el detalle del agente muestran las fallas', () => {
  const view = readFileSync(new URL('../src/platform/AgentsView.tsx', import.meta.url), 'utf8');
  assert.ok(view.includes('for (const alert of agentModelAlerts(usage).filter(item => item.active))'), 'cada falla activa es un aviso del Resumen');
  assert.ok(view.includes('<ModelAlertsPanel alerts={agentModelAlerts(usageData)}'));
  const detail = readFileSync(new URL('../src/platform/AgentDetail.tsx', import.meta.url), 'utf8');
  assert.ok(detail.includes("<ModelAlertsPanel alerts={agentModelAlerts(usage.status === 'ready' ? usage.data : null, agent.id)}"));
  const panel = readFileSync(new URL('../src/platform/ModelAlerts.tsx', import.meta.url), 'utf8');
  assert.match(panel, /Última vez:/);
  assert.match(panel, /No se cambia a otro modelo ni a otro proveedor/);
  assert.doesNotMatch(panel, /AGT003_|failure_code|bridge/i);
});

test('sin imports cruzados AGT-003 ↔ AGT-002 en las piezas nuevas', () => {
  for (const path of ['../src/vigia/model-failures.js', '../src/platform/ModelAlerts.tsx']) {
    assert.doesNotMatch(readFileSync(new URL(path, import.meta.url), 'utf8'), /from ['"][^'"]*agt002/i, path);
  }
});
