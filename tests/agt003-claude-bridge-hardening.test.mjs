import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import {
  AGT003_BRIDGE_ALLOWED_MODELS,
  AGT003_BRIDGE_MAX_CONCURRENCY,
  AGT003_BRIDGE_MAX_TIMEOUT_MS,
  AGT003_BRIDGE_PATH,
  createAgt003BridgeServer,
} from '../agt003-claude-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt003-claude-bridge-signing.js';

/**
 * Endurecimiento del puente dedicado AGT-003 (bloqueantes de operación).
 *
 * Este archivo NO revisa el contrato de invocación del proveedor: el comando
 * `claude -p --model sonnet --output-format json --json-schema ... --tools ''
 * --no-session-persistence --safe-mode` quedó verificado con humo real en
 * Hetzner (Claude Code 2.1.237) y se da por cerrado. Lo que aquí se fija es lo
 * que rodea a esa invocación: cuántos turnos pueden existir a la vez, qué
 * timeouts y qué modelos admite el puente, y qué se registra al rechazar.
 */

const SECRET = 'c'.repeat(32);
const PATH = '/v1/agt003-copilot/run';
const POLICY = 'política dedicada AGT-003';
const CRM_SENTINEL = 'texto no confiable del CRM';
const OK_RESULT = { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null };

let nonceSeed = 0;
function freshNonce() {
  nonceSeed += 1;
  return `n${String(nonceSeed).padStart(15, '0')}`;
}

function signedHeaders(body, { timestamp = String(Math.floor(Date.now() / 1000)), nonce = freshNonce(), secret = SECRET, path = PATH } = {}) {
  const canonical = buildCanonicalString({ method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return {
    'content-type': 'application/json',
    'x-agt003-timestamp': timestamp,
    'x-agt003-nonce': nonce,
    'x-agt003-signature': signCanonicalString(secret, canonical),
  };
}

function validPayload(overrides = {}) {
  return {
    model: 'sonnet',
    policy: POLICY,
    input: { notes: CRM_SENTINEL },
    outputSchema: { type: 'object' },
    timeoutMs: 5000,
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

async function withServer(options, fn) {
  const server = createServer(createAgt003BridgeServer({ hmacSecret: SECRET, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`, port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function post(base, payload, headerOverrides = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body, headerOverrides), body });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error(message);
}

async function captureLog(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return lines.map(line => { try { return JSON.parse(line); } catch { return { raw: String(line) }; } });
}

/** Cliente que retiene cada turno hasta que la prueba lo libera a mano. */
function gatedClient() {
  const state = { calls: 0, active: 0, maxActive: 0, aborted: 0, pending: [] };
  const client = {
    run: ({ signal } = {}) => new Promise((resolve, reject) => {
      state.calls += 1;
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      let settled = false;
      const finish = fn => value => {
        if (settled) return;
        settled = true;
        state.active -= 1;
        fn(value);
      };
      const settleResolve = finish(resolve);
      const settleReject = finish(reject);
      state.pending.push({ resolve: settleResolve });
      signal?.addEventListener('abort', () => {
        state.aborted += 1;
        const error = new Error('cancelado');
        error.code = 'AGT003_CLAUDE_CANCELLED';
        settleReject(error);
      }, { once: true });
    }),
  };
  state.releaseAll = () => { while (state.pending.length) state.pending.shift().resolve(OK_RESULT); };
  return { client, state };
}

// ---------------------------------------------------------------------------
// 1. Concurrencia global del puente: configurable, por defecto 1.
// ---------------------------------------------------------------------------

function testConcurrencyDefaultIsDeclared() {
  assert.equal(AGT003_BRIDGE_PATH, PATH, 'esta suite ejerce la ruta dedicada del puente');
  assert.equal(AGT003_BRIDGE_MAX_CONCURRENCY, 1, 'el puente admite un solo turno simultáneo por defecto');
}

// Un solo servidor de 2 vCPU no puede sostener dos subprocesos `claude` a la
// vez: la segunda petición se rechaza de inmediato y NO lanza otro proceso.
async function testSecondSimultaneousRequestIsRejectedWithoutSpawning() {
  const { client, state } = gatedClient();
  await withServer({ claudeClient: client }, async base => {
    const first = post(base, validPayload({ idempotencyKey: 'idem-busy-1' }));
    first.catch(() => {});
    await waitFor(() => state.calls === 1, 'el primer turno nunca llegó al proveedor');

    const second = await post(base, validPayload({ idempotencyKey: 'idem-busy-2' }));
    assert.equal(second.status, 429, 'la segunda petición simultánea debe rechazarse con 429');
    const payload = await second.json();
    assert.equal(payload.error.code, 'AGT003_BRIDGE_BUSY');
    assert.ok(typeof payload.correlation_id === 'string' && payload.correlation_id.length > 0, 'el 429 debe traer correlation_id');
    assert.equal(state.calls, 1, 'una petición rechazada por saturación nunca debe invocar otro proceso del proveedor');
    assert.equal(state.maxActive, 1, 'el puente nunca debe sostener dos turnos del proveedor a la vez');

    state.releaseAll();
    assert.equal((await first).status, 200);
  });
}

async function testSlotIsReleasedAfterSuccess() {
  let calls = 0;
  const client = { run: async () => { calls += 1; return OK_RESULT; } };
  await withServer({ claudeClient: client }, async base => {
    for (let index = 0; index < 3; index += 1) {
      const response = await post(base, validPayload({ idempotencyKey: `idem-seq-${index}` }));
      assert.equal(response.status, 200, `la petición secuencial ${index} debe atenderse: el slot se libera tras el éxito`);
    }
  });
  assert.equal(calls, 3, 'tres turnos secuenciales deben llegar los tres al proveedor');
}

async function testSlotIsReleasedAfterProviderError() {
  let calls = 0;
  const client = {
    run: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('detalle privado');
        error.code = 'AGT003_CLAUDE_PROVIDER_ERROR';
        throw error;
      }
      return OK_RESULT;
    },
  };
  await withServer({ claudeClient: client }, async base => {
    const failed = await post(base, validPayload({ idempotencyKey: 'idem-err-1' }));
    assert.equal(failed.status, 502);
    const next = await post(base, validPayload({ idempotencyKey: 'idem-err-2' }));
    assert.equal(next.status, 200, 'un fallo del proveedor debe liberar el slot global');
  });
  assert.equal(calls, 2);
}

// El slot sigue al turno del proveedor, no al socket: se libera cuando la
// promesa del cliente termina (y ante un abort esa promesa se rechaza), de modo
// que una desconexión nunca deja el puente bloqueado ni con un proceso huérfano.
async function testSlotIsReleasedAfterAbort() {
  const { client, state } = gatedClient();
  await withServer({ claudeClient: client }, async base => {
    const controller = new AbortController();
    const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-abort-1' }));
    const pending = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body, signal: controller.signal });
    pending.catch(() => {});
    await waitFor(() => state.calls === 1, 'el turno abortado nunca llegó al proveedor');
    controller.abort();
    await waitFor(() => state.aborted === 1, 'el puente no propagó la desconexión al proveedor');
    await waitFor(() => state.active === 0, 'el turno abortado nunca terminó');

    // El segundo turno también queda retenido por el gate: hay que lanzarlo,
    // esperar a que llegue al proveedor y sólo entonces liberarlo.
    const next = post(base, validPayload({ idempotencyKey: 'idem-abort-2' }));
    next.catch(() => {});
    await waitFor(() => state.calls === 2, 'el segundo turno nunca llegó al proveedor');
    state.releaseAll();
    assert.equal((await next).status, 200, 'un abort debe liberar el slot global');
    assert.equal(state.maxActive, 1);
  });
}

async function testConcurrencyIsConfigurable() {
  const { client, state } = gatedClient();
  await withServer({ claudeClient: client, maxConcurrency: 2 }, async base => {
    const first = post(base, validPayload({ idempotencyKey: 'idem-cc-1' }));
    const second = post(base, validPayload({ idempotencyKey: 'idem-cc-2' }));
    first.catch(() => {});
    second.catch(() => {});
    await waitFor(() => state.calls === 2, 'con maxConcurrency=2 ambos turnos deben llegar al proveedor');

    const third = await post(base, validPayload({ idempotencyKey: 'idem-cc-3' }));
    assert.equal(third.status, 429, 'el tercer turno excede el techo configurado');
    assert.equal((await third.json()).error.code, 'AGT003_BRIDGE_BUSY');
    assert.equal(state.calls, 2, 'el rechazo por saturación nunca invoca al proveedor');

    state.releaseAll();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal(state.maxActive, 2);
  });
}

// El slot es un recurso escaso: sólo lo consume quien ya demostró credenciales.
// Si el gate estuviera antes de la firma, cualquiera podría negar el servicio.
async function testUnauthenticatedRequestNeverConsumesTheSlot() {
  const { client, state } = gatedClient();
  await withServer({ claudeClient: client }, async base => {
    const first = post(base, validPayload({ idempotencyKey: 'idem-gate-1' }));
    first.catch(() => {});
    await waitFor(() => state.calls === 1, 'el primer turno nunca llegó al proveedor');

    const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-gate-2' }));
    const forged = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body, { secret: 'd'.repeat(32) }), body });
    assert.equal(forged.status, 401, 'una petición sin firma válida se rechaza por auth, no por saturación');
    assert.equal((await forged.json()).error.code, 'AGT003_BRIDGE_AUTH_INVALID');

    state.releaseAll();
    assert.equal((await first).status, 200);
  });
}

async function testConcurrencyConfigFailsClosed() {
  const client = { run: async () => OK_RESULT };
  for (const maxConcurrency of [0, -1, 1.5, '2', null]) {
    assert.throws(
      () => createAgt003BridgeServer({ hmacSecret: SECRET, claudeClient: client, maxConcurrency }),
      /concurrencia/i,
      `maxConcurrency inválido: ${String(maxConcurrency)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Techo del timeout de la petición.
// ---------------------------------------------------------------------------

function testTimeoutCeilingDefaultIsDeclared() {
  assert.equal(AGT003_BRIDGE_MAX_TIMEOUT_MS, 120_000, 'el techo por defecto del timeout es 120 s');
}

// El llamador no puede pedir un turno indefinido: un timeout por encima del
// techo se rechaza antes de tocar al proveedor, no se recorta en silencio.
async function testTimeoutAboveCeilingIsRejectedBeforeProvider() {
  let calls = 0;
  const client = { run: async () => { calls += 1; return OK_RESULT; } };
  await withServer({ claudeClient: client }, async base => {
    const rejected = await post(base, validPayload({ timeoutMs: AGT003_BRIDGE_MAX_TIMEOUT_MS + 1, idempotencyKey: 'idem-t-1' }));
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'AGT003_BRIDGE_BAD_REQUEST');
    assert.equal(calls, 0, 'un timeout fuera de techo nunca debe llegar al proveedor');

    const accepted = await post(base, validPayload({ timeoutMs: AGT003_BRIDGE_MAX_TIMEOUT_MS, idempotencyKey: 'idem-t-2' }));
    assert.equal(accepted.status, 200, 'el techo exacto sigue siendo válido');
    assert.equal(calls, 1);
  });
}

async function testTimeoutCeilingIsConfigurable() {
  let received;
  const client = { run: async args => { received = args; return OK_RESULT; } };
  await withServer({ claudeClient: client, maxTimeoutMs: 5_000 }, async base => {
    const rejected = await post(base, validPayload({ timeoutMs: 5_001, idempotencyKey: 'idem-t-3' }));
    assert.equal(rejected.status, 400, 'el techo configurado manda sobre el valor por defecto');
    assert.equal(received, undefined, 'el proveedor nunca debe invocarse con un timeout fuera de techo');

    const accepted = await post(base, validPayload({ timeoutMs: 5_000, idempotencyKey: 'idem-t-4' }));
    assert.equal(accepted.status, 200);
    assert.equal(received.timeoutMs, 5_000, 'el timeout aceptado se propaga tal cual al proveedor');
  });
}

async function testTimeoutCeilingConfigFailsClosed() {
  const client = { run: async () => OK_RESULT };
  for (const maxTimeoutMs of [0, -1, 1.5, '1000', null]) {
    assert.throws(
      () => createAgt003BridgeServer({ hmacSecret: SECRET, claudeClient: client, maxTimeoutMs }),
      /timeout/i,
      `maxTimeoutMs inválido: ${String(maxTimeoutMs)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Allowlist de modelos del puente.
// ---------------------------------------------------------------------------

function testAllowedModelsDefaultIsDeclared() {
  assert.deepEqual([...AGT003_BRIDGE_ALLOWED_MODELS], ['sonnet'], 'por defecto el puente sólo admite el alias sonnet');
  assert.throws(() => { AGT003_BRIDGE_ALLOWED_MODELS.push('opus'); }, 'la allowlist por defecto debe ser inmutable');
}

// El modelo llega en el cuerpo firmado por Vercel, pero el puente decide qué
// modelos existen: nada fuera de la lista puede llegar al argv del proveedor.
async function testModelOutsideAllowlistIsRejectedBeforeProvider() {
  let calls = 0;
  const client = { run: async () => { calls += 1; return OK_RESULT; } };
  const forbidden = ['opus', 'haiku', 'claude-sonnet-4-6', 'sonnet-experimental', 'SONNET', ' sonnet', '--dangerously-skip-permissions'];
  await withServer({ claudeClient: client }, async base => {
    for (const model of forbidden) {
      const response = await post(base, validPayload({ model, idempotencyKey: `idem-m-${model}` }));
      assert.equal(response.status, 400, `modelo fuera de allowlist: ${model}`);
      assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_BAD_REQUEST');
    }
    assert.equal(calls, 0, 'ningún modelo fuera de la allowlist puede llegar al proveedor');

    const allowed = await post(base, validPayload({ idempotencyKey: 'idem-m-ok' }));
    assert.equal(allowed.status, 200, 'el modelo de la allowlist sí se atiende');
    assert.equal(calls, 1);
  });
}

async function testAllowlistIsConfigurable() {
  const seen = [];
  const client = { run: async ({ model }) => { seen.push(model); return OK_RESULT; } };
  await withServer({ claudeClient: client, allowedModels: ['sonnet', 'haiku'] }, async base => {
    assert.equal((await post(base, validPayload({ idempotencyKey: 'idem-al-1' }))).status, 200);
    assert.equal((await post(base, validPayload({ model: 'haiku', idempotencyKey: 'idem-al-2' }))).status, 200);
    const rejected = await post(base, validPayload({ model: 'opus', idempotencyKey: 'idem-al-3' }));
    assert.equal(rejected.status, 400, 'la allowlist configurada sigue siendo cerrada');
  });
  assert.deepEqual(seen, ['sonnet', 'haiku']);
}

async function testAllowlistConfigFailsClosed() {
  const client = { run: async () => OK_RESULT };
  for (const allowedModels of [[], '', 'sonnet', [''], ['sonnet', 42], null]) {
    assert.throws(
      () => createAgt003BridgeServer({ hmacSecret: SECRET, claudeClient: client, allowedModels }),
      /modelo/i,
      `allowedModels inválido: ${JSON.stringify(allowedModels)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Techo del outputSchema: el código del cliente debe tener status propio.
// ---------------------------------------------------------------------------

// El techo se aplica en el cliente, antes del spawn (ver
// agt003-claude-client.test.mjs). Aquí sólo se fija que el puente traduzca ese
// código a una respuesta acotada y no a un 500 genérico.
async function testSchemaTooLargeMapsToItsOwnStatus() {
  const client = {
    run: async () => {
      const error = new Error('outputSchema de 900000 bytes que jamás debe filtrarse');
      error.code = 'AGT003_CLAUDE_SCHEMA_TOO_LARGE';
      throw error;
    },
  };
  const events = await captureLog(async () => {
    await withServer({ claudeClient: client }, async base => {
      const response = await post(base, validPayload({ idempotencyKey: 'idem-schema' }));
      assert.equal(response.status, 413, 'un esquema fuera de techo es un payload demasiado grande, no un error interno');
      const payload = await response.json();
      assert.equal(payload.error.code, 'AGT003_CLAUDE_SCHEMA_TOO_LARGE');
      assert.equal(JSON.stringify(payload).includes('900000'), false, 'el detalle del proveedor nunca llega al caller');
    });
  });
  const event = events.find(item => item.code === 'AGT003_CLAUDE_SCHEMA_TOO_LARGE');
  assert.ok(event, 'el rechazo por esquema desbordado debe registrarse');
  const serialized = JSON.stringify(event);
  for (const leak of [POLICY, SECRET, CRM_SENTINEL, '900000']) {
    assert.equal(serialized.includes(leak), false, `el evento nunca debe filtrar ${leak}`);
  }
}

// ---------------------------------------------------------------------------
// 5. Registro de los rechazos: sólo event, code y correlation_id.
// ---------------------------------------------------------------------------

const SAFE_REJECTION_KEYS = ['code', 'correlation_id', 'event'];

function leakNeedles({ nonce, signature }) {
  return [SECRET, signature, nonce, POLICY, CRM_SENTINEL, 'x-agt003', 'authorization', 'sonnet'];
}

async function assertRejectionIsLoggedSafely({ label, expectedStatus, expectedCode, request, serverOptions = {} }) {
  let responsePayload;
  let usedHeaders;
  const events = await captureLog(async () => {
    await withServer({ claudeClient: { run: async () => OK_RESULT }, ...serverOptions }, async base => {
      const { response, headers } = await request(base);
      usedHeaders = headers ?? {};
      assert.equal(response.status, expectedStatus, `${label}: status`);
      responsePayload = await response.json();
      assert.equal(responsePayload.error.code, expectedCode, `${label}: code`);
    });
  });

  const errors = events.filter(item => item.event === 'agt003_bridge_error' && item.code === expectedCode);
  assert.equal(errors.length, 1, `${label}: el rechazo debe emitir exactamente un evento de error`);
  const [event] = errors;
  assert.deepEqual(Object.keys(event).sort(), SAFE_REJECTION_KEYS, `${label}: el evento sólo puede llevar event, code y correlation_id`);
  assert.ok(typeof event.correlation_id === 'string' && event.correlation_id.length > 0, `${label}: correlation_id presente`);
  assert.equal(event.correlation_id, responsePayload.correlation_id, `${label}: el correlation_id del log y el de la respuesta deben coincidir`);

  const serialized = JSON.stringify(event);
  for (const leak of leakNeedles({ nonce: usedHeaders['x-agt003-nonce'] ?? '', signature: usedHeaders['x-agt003-signature'] ?? '' })) {
    if (!leak) continue;
    assert.equal(serialized.includes(leak), false, `${label}: el evento nunca debe filtrar ${leak}`);
  }
}

async function testRejectionLogsCarryOnlySafeFields() {
  const bodyWith = payload => JSON.stringify(payload);

  await assertRejectionIsLoggedSafely({
    label: 'método no permitido',
    expectedStatus: 405,
    expectedCode: 'AGT003_BRIDGE_METHOD_NOT_ALLOWED',
    request: async base => ({ response: await fetch(`${base}${PATH}`, { method: 'GET' }) }),
  });

  await assertRejectionIsLoggedSafely({
    label: 'ruta desconocida',
    expectedStatus: 404,
    expectedCode: 'AGT003_BRIDGE_BAD_REQUEST',
    request: async base => {
      const body = bodyWith(validPayload());
      const headers = signedHeaders(body, { path: '/v1/agt002-preview/run' });
      return { response: await fetch(`${base}/v1/agt002-preview/run`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'content-type no soportado',
    expectedStatus: 415,
    expectedCode: 'AGT003_BRIDGE_UNSUPPORTED_MEDIA_TYPE',
    request: async base => {
      const body = bodyWith(validPayload());
      const headers = { ...signedHeaders(body), 'content-type': 'text/plain' };
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'firma inválida',
    expectedStatus: 401,
    expectedCode: 'AGT003_BRIDGE_AUTH_INVALID',
    request: async base => {
      const body = bodyWith(validPayload());
      const headers = signedHeaders(body, { secret: 'd'.repeat(32) });
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'timestamp fuera de ventana',
    expectedStatus: 401,
    expectedCode: 'AGT003_BRIDGE_AUTH_INVALID',
    request: async base => {
      const body = bodyWith(validPayload());
      const headers = signedHeaders(body, { timestamp: String(Math.floor(Date.now() / 1000) - 600) });
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  // Replay: el nonce ya consumido se rechaza y el rechazo se registra igual de
  // parco. El primer turno emite su propio evento de éxito, que no se cuenta.
  await assertRejectionIsLoggedSafely({
    label: 'replay de nonce',
    expectedStatus: 401,
    expectedCode: 'AGT003_BRIDGE_AUTH_INVALID',
    request: async base => {
      const body = bodyWith(validPayload({ idempotencyKey: 'idem-replay' }));
      const headers = signedHeaders(body);
      const first = await fetch(`${base}${PATH}`, { method: 'POST', headers, body });
      assert.equal(first.status, 200, 'el primer envío con nonce fresco debe atenderse');
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'cuerpo malformado',
    expectedStatus: 400,
    expectedCode: 'AGT003_BRIDGE_BAD_REQUEST',
    request: async base => {
      const body = `no es json: ${CRM_SENTINEL}`;
      const headers = signedHeaders(body);
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'cwd en el cuerpo',
    expectedStatus: 400,
    expectedCode: 'AGT003_BRIDGE_BAD_REQUEST',
    request: async base => {
      const body = bodyWith(validPayload({ cwd: '/etc' }));
      const headers = signedHeaders(body);
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'timeout fuera de techo',
    expectedStatus: 400,
    expectedCode: 'AGT003_BRIDGE_BAD_REQUEST',
    request: async base => {
      const body = bodyWith(validPayload({ timeoutMs: AGT003_BRIDGE_MAX_TIMEOUT_MS + 1 }));
      const headers = signedHeaders(body);
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });

  await assertRejectionIsLoggedSafely({
    label: 'modelo fuera de allowlist',
    expectedStatus: 400,
    expectedCode: 'AGT003_BRIDGE_BAD_REQUEST',
    request: async base => {
      const body = bodyWith(validPayload({ model: 'opus' }));
      const headers = signedHeaders(body);
      return { response: await fetch(`${base}${PATH}`, { method: 'POST', headers, body }), headers };
    },
  });
}

// El rechazo por saturación se registra con la misma parquedad: nunca revela
// quién ocupa el slot ni con qué cuerpo se pidió.
async function testBusyRejectionIsLoggedSafely() {
  const { client, state } = gatedClient();
  let busyPayload;
  const events = await captureLog(async () => {
    await withServer({ claudeClient: client }, async base => {
      const first = post(base, validPayload({ idempotencyKey: 'idem-busylog-1' }));
      first.catch(() => {});
      await waitFor(() => state.calls === 1, 'el primer turno nunca llegó al proveedor');
      const second = await post(base, validPayload({ idempotencyKey: 'idem-busylog-2' }));
      assert.equal(second.status, 429);
      busyPayload = await second.json();
      state.releaseAll();
      await first;
    });
  });
  const busyEvents = events.filter(item => item.code === 'AGT003_BRIDGE_BUSY');
  assert.equal(busyEvents.length, 1, 'la saturación debe emitir exactamente un evento');
  const [event] = busyEvents;
  assert.equal(event.event, 'agt003_bridge_error');
  assert.deepEqual(Object.keys(event).sort(), SAFE_REJECTION_KEYS, 'el evento de saturación sólo lleva event, code y correlation_id');
  assert.equal(event.correlation_id, busyPayload.correlation_id);
  const serialized = JSON.stringify(event);
  for (const leak of [SECRET, POLICY, CRM_SENTINEL, 'idem-busylog', 'sonnet']) {
    assert.equal(serialized.includes(leak), false, `el evento nunca debe filtrar ${leak}`);
  }
}

// ---------------------------------------------------------------------------
// 6. Un error en `req` no derriba el proceso ni deja turnos huérfanos.
// ---------------------------------------------------------------------------

function rawTruncatedPost(port, { contentLength = 4096, partial = '{"model":"son' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => {
      socket.write([
        `POST ${PATH} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Content-Type: application/json',
        `Content-Length: ${contentLength}`,
        '',
        '',
      ].join('\r\n'));
      socket.write(partial);
      // Cortar a mitad del cuerpo: el servidor ve un error en `req`, nunca 'end'.
      setTimeout(() => { socket.destroy(); resolve(); }, 30);
    });
    socket.on('error', () => { /* el corte también rompe este lado */ });
    socket.on('close', () => resolve());
    setTimeout(() => reject(new Error('el socket crudo nunca se conectó')), 2000).unref?.();
  });
}

async function testTruncatedRequestNeitherThrowsNorHoldsTheSlot() {
  const uncaught = [];
  const onUncaught = error => { uncaught.push(error); };
  process.on('uncaughtException', onUncaught);
  let calls = 0;
  const client = { run: async () => { calls += 1; return OK_RESULT; } };
  try {
    await withServer({ claudeClient: client }, async (base, port) => {
      await rawTruncatedPost(port);
      await delay(100);
      assert.equal(calls, 0, 'un cuerpo truncado nunca debe llegar a lanzar el proveedor');

      const response = await post(base, validPayload({ idempotencyKey: 'idem-raw' }));
      assert.equal(response.status, 200, 'un `req` errado no puede dejar el slot global retenido');
      assert.equal(calls, 1);
    });
  } finally {
    process.off('uncaughtException', onUncaught);
  }
  assert.deepEqual(uncaught.map(error => error.message), [], 'un error de `req` nunca debe escalar a excepción no capturada');
}

// Mismo corte, pero con el turno ya en vuelo: además de no lanzar, el puente
// debe cancelar el turno (sin proceso huérfano) y devolver el slot.
async function testDisconnectMidRunReleasesEverything() {
  const uncaught = [];
  const onUncaught = error => { uncaught.push(error); };
  process.on('uncaughtException', onUncaught);
  const { client, state } = gatedClient();
  try {
    await withServer({ claudeClient: client }, async base => {
      const controller = new AbortController();
      const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-mid' }));
      const pending = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body, signal: controller.signal });
      pending.catch(() => {});
      await waitFor(() => state.calls === 1, 'el turno nunca llegó al proveedor');
      controller.abort();
      await waitFor(() => state.aborted === 1, 'el turno del proveedor quedó huérfano tras la desconexión');
      await waitFor(() => state.active === 0, 'el turno abortado nunca terminó');

      const next = post(base, validPayload({ idempotencyKey: 'idem-mid-2' }));
      next.catch(() => {});
      await waitFor(() => state.calls === 2, 'el segundo turno nunca llegó al proveedor');
      state.releaseAll();
      assert.equal((await next).status, 200, 'tras la desconexión el slot global debe estar libre');
    });
  } finally {
    process.off('uncaughtException', onUncaught);
  }
  assert.deepEqual(uncaught.map(error => error.message), [], 'una desconexión a mitad de turno nunca debe escalar a excepción no capturada');
}

testConcurrencyDefaultIsDeclared();
testTimeoutCeilingDefaultIsDeclared();
testAllowedModelsDefaultIsDeclared();
await testConcurrencyConfigFailsClosed();
await testTimeoutCeilingConfigFailsClosed();
await testAllowlistConfigFailsClosed();
console.log('agt003-claude-bridge-hardening.test.mjs Paso 1 OK');

await testSecondSimultaneousRequestIsRejectedWithoutSpawning();
await testSlotIsReleasedAfterSuccess();
await testSlotIsReleasedAfterProviderError();
await testSlotIsReleasedAfterAbort();
await testConcurrencyIsConfigurable();
await testUnauthenticatedRequestNeverConsumesTheSlot();
console.log('agt003-claude-bridge-hardening.test.mjs Paso 2 OK');

await testTimeoutAboveCeilingIsRejectedBeforeProvider();
await testTimeoutCeilingIsConfigurable();
await testModelOutsideAllowlistIsRejectedBeforeProvider();
await testAllowlistIsConfigurable();
await testSchemaTooLargeMapsToItsOwnStatus();
console.log('agt003-claude-bridge-hardening.test.mjs Paso 3 OK');

await testRejectionLogsCarryOnlySafeFields();
await testBusyRejectionIsLoggedSafely();
await testTruncatedRequestNeitherThrowsNorHoldsTheSlot();
await testDisconnectMidRunReleasesEverything();
console.log('agt003-claude-bridge-hardening.test.mjs Paso 4 OK');
