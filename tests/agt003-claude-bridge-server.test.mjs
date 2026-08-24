import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AGT003_BRIDGE_MAX_BODY_BYTES, AGT003_BRIDGE_PATH, createAgt003BridgeServer } from '../agt003-claude-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt003-claude-bridge-signing.js';

const SECRET = 'c'.repeat(32);
const PATH = '/v1/agt003-copilot/run';
const POLICY = 'política dedicada AGT-003';

function signedHeaders(body, { timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'n'.repeat(16), secret = SECRET, path = PATH, namespace = 'agt003' } = {}) {
  const canonical = buildCanonicalString({ method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return {
    'content-type': 'application/json',
    [`x-${namespace}-timestamp`]: timestamp,
    [`x-${namespace}-nonce`]: nonce,
    [`x-${namespace}-signature`]: signCanonicalString(secret, canonical),
  };
}

async function withServer(claudeClient, fn, options = {}) {
  const server = createServer(createAgt003BridgeServer({ hmacSecret: SECRET, claudeClient, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

// El modelo debe pertenecer a la allowlist del puente (por defecto, `sonnet`);
// el resto de los casos de esta suite no ejercen esa validación.
function validPayload(overrides = {}) {
  return { model: 'sonnet', policy: POLICY, input: { safe: true }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1', ...overrides };
}

const successClient = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null }) };

function testDedicatedPathIsExported() {
  assert.equal(AGT003_BRIDGE_PATH, PATH, 'el puente dedicado expone su propia ruta');
  assert.equal(AGT003_BRIDGE_MAX_BODY_BYTES, 1_048_576, 'el cuerpo máximo permitido es 1 MiB');
}

async function testWrongMethodRejected() {
  await withServer(successClient, async base => {
    const response = await fetch(`${base}${PATH}`, { method: 'GET' });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_METHOD_NOT_ALLOWED');
  });
}

// El puente dedicado sólo atiende su propia ruta: la ruta del transporte
// gobernado AGT-002 no se expone aquí ni siquiera con una firma válida.
async function testAgt002PathRejected() {
  await withServer(successClient, async base => {
    const body = JSON.stringify(validPayload());
    const response = await fetch(`${base}/v1/agt002-preview/run`, {
      method: 'POST',
      headers: signedHeaders(body, { path: '/v1/agt002-preview/run' }),
      body,
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_BAD_REQUEST');
  });
}

async function testAgt002HeaderNamespaceRejected() {
  await withServer(successClient, async base => {
    const body = JSON.stringify(validPayload());
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body, { namespace: 'agt002' }), body });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_AUTH_INVALID');
  });
}

async function testWrongContentTypeRejected() {
  await withServer(successClient, async base => {
    const body = JSON.stringify(validPayload());
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: { ...signedHeaders(body), 'content-type': 'text/plain' }, body });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_UNSUPPORTED_MEDIA_TYPE');
  });
}

async function testOversizedBodyRejectedWithSafeLog() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const oversized = JSON.stringify({ policy: POLICY, input: { padding: 'x'.repeat(1_100_000) } });
  try {
    await withServer(successClient, async base => {
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(oversized), body: oversized });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_PAYLOAD_TOO_LARGE');
    });
  } finally {
    console.log = originalLog;
  }
  const events = lines.map(line => JSON.parse(line)).filter(event => event.code === 'AGT003_BRIDGE_PAYLOAD_TOO_LARGE');
  assert.equal(events.length, 1, 'el rechazo 413 debe emitir exactamente un evento de log seguro');
  const [event] = events;
  assert.ok(Number.isInteger(event.received_bytes) && event.received_bytes > AGT003_BRIDGE_MAX_BODY_BYTES);
  assert.ok(typeof event.correlation_id === 'string' && event.correlation_id.length > 0);
  const serialized = JSON.stringify(event);
  for (const leak of ['padding', 'policy', SECRET, POLICY]) {
    assert.equal(serialized.includes(leak), false, `el evento nunca debe filtrar ${leak}`);
  }
}

async function testBoundedLargeBodyAccepted() {
  let calls = 0;
  const client = { run: async () => { calls += 1; return { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }; } };
  await withServer(client, async base => {
    const body = JSON.stringify(validPayload({ input: { evidence: 'x'.repeat(300_000) } }));
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200, 'un payload por debajo de 1 MiB debe llegar al proveedor');
    assert.equal(calls, 1);
  });
}

async function testSuccessResponseShape() {
  let received;
  const client = { run: async args => { received = args; return { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null }; } };
  await withServer(client, async base => {
    const body = JSON.stringify(validPayload());
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null });
  });
  assert.equal(received.model, 'sonnet');
  assert.equal(received.policy, POLICY);
  assert.deepEqual(received.input, { safe: true });
  assert.equal(received.cwd, undefined, 'el servidor nunca propaga un cwd al proveedor');
}

async function testCwdInBodyRejected() {
  await withServer(successClient, async base => {
    const body = JSON.stringify(validPayload({ cwd: '/etc' }));
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_BAD_REQUEST');
  });
}

async function testMalformedBodyRejected() {
  await withServer(successClient, async base => {
    const body = 'not json at all';
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'AGT003_BRIDGE_BAD_REQUEST');
  });
}

async function testMissingFieldsRejected() {
  const cases = [
    [validPayload({ model: '' }), 400],
    [validPayload({ policy: '' }), 400],
    [validPayload({ timeoutMs: 0 }), 400],
    [validPayload({ input: 'texto libre' }), 422],
    [validPayload({ outputSchema: [] }), 422],
  ];
  await withServer(successClient, async base => {
    let index = 0;
    for (const [payload, expected] of cases) {
      index += 1;
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body, { nonce: `${index}`.repeat(16) }), body });
      assert.equal(response.status, expected, `caso ${index}: ${JSON.stringify(payload).slice(0, 60)}`);
      assert.match((await response.json()).error.code, /^AGT003_/);
    }
  });
}

async function testProviderCodesMapToStatuses() {
  const cases = [
    ['AGT003_CLAUDE_TIMEOUT', 504],
    ['AGT003_CLAUDE_LOGIN_REQUIRED', 503],
    ['AGT003_CLAUDE_PROVIDER_ERROR', 502],
    ['AGT003_CLAUDE_TRANSPORT_ERROR', 502],
    ['AGT003_CLAUDE_OUTPUT_TOO_LARGE', 502],
    ['AGT003_CLAUDE_INVALID_RESPONSE', 422],
  ];
  let index = 0;
  for (const [code, status] of cases) {
    index += 1;
    const client = { run: async () => { const error = new Error('detalle privado del proveedor'); error.code = code; throw error; } };
    await withServer(client, async base => {
      const body = JSON.stringify(validPayload({ idempotencyKey: `idem-${index}` }));
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, status, `código ${code}`);
      const result = await response.json();
      assert.equal(result.error.code, code);
      assert.equal(JSON.stringify(result).includes('detalle privado'), false, 'el detalle del proveedor nunca llega al caller');
    });
  }
}

async function testProviderErrorLogIsSanitized() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = {
    run: async () => {
      const error = new Error('stderr crudo del proveedor');
      error.code = 'AGT003_CLAUDE_PROVIDER_ERROR';
      error.providerErrorCode = 'overloaded_error';
      error.stderr = 'nunca registrar esto';
      throw error;
    },
  };
  try {
    await withServer(client, async base => {
      const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-log' }));
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 502);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'AGT003_CLAUDE_PROVIDER_ERROR');
  assert.ok(event, 'un fallo del proveedor debe emitir un evento de log');
  assert.equal(event.provider_error_code, 'overloaded_error');
  const serialized = JSON.stringify(event);
  for (const leak of ['stderr crudo', 'nunca registrar esto', POLICY, SECRET, 'safe']) {
    assert.equal(serialized.includes(leak), false, `el evento nunca debe filtrar ${leak}`);
  }
}

async function testSuccessLogIsSanitized() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  try {
    await withServer(successClient, async base => {
      const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-ok' }));
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 200);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'OK');
  assert.ok(event, 'un run exitoso debe emitir un evento de log');
  assert.equal(event.input_tokens, 3);
  assert.equal(event.output_tokens, 4);
  const serialized = JSON.stringify(event);
  for (const leak of [POLICY, SECRET, 'idem-ok', 'sonnet', '{"ok":true}']) {
    assert.equal(serialized.includes(leak), false, `el evento nunca debe filtrar ${leak}`);
  }
  assert.equal(serialized.includes('agt002'), false, 'los eventos AGT-003 nunca usan el espacio de nombres AGT-002');
}

async function testSynchronousThrowFailsClosed() {
  const client = { run: () => { throw new Error('boom síncrono que no debe filtrarse'); } };
  await withServer(client, async base => {
    const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-sync' }));
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT003_BRIDGE_INTERNAL');
    assert.equal(JSON.stringify(result).includes('boom síncrono'), false);
  });
}

async function testCompletedRequestBodyDoesNotCancelRun() {
  const client = {
    run: ({ signal } = {}) => new Promise((resolve, reject) => {
      const cancel = () => { const error = new Error('cancelado'); error.code = 'AGT003_CLAUDE_CANCELLED'; reject(error); };
      if (signal?.aborted) return cancel();
      const timer = setTimeout(() => resolve({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }), 60);
      signal?.addEventListener('abort', () => { clearTimeout(timer); cancel(); }, { once: true });
    }),
  };
  await withServer(client, async base => {
    const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-close' }));
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    const result = await response.json();
    assert.equal(response.status, 200, `una petición normal no debe cancelarse; recibido ${response.status} ${JSON.stringify(result)}`);
  });
}

async function testClientDisconnectCancelsRun() {
  let observeAbort;
  const abortObserved = new Promise(resolve => { observeAbort = resolve; });
  const client = {
    run: ({ signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        observeAbort(true);
        const error = new Error('cancelado');
        error.code = 'AGT003_CLAUDE_CANCELLED';
        reject(error);
      }, { once: true });
    }),
  };
  await withServer(client, async base => {
    const controller = new AbortController();
    const body = JSON.stringify(validPayload({ idempotencyKey: 'idem-disc' }));
    const pending = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body, signal: controller.signal });
    pending.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    const result = await Promise.race([
      abortObserved,
      new Promise((_, reject) => setTimeout(() => reject(new Error('el servidor no propagó la desconexión al proveedor')), 2000)),
    ]);
    assert.equal(result, true);
  });
}

// La concurrencia del puente es un techo global explícito: sólo con
// maxConcurrency configurado por encima de 1 pueden convivir dos turnos. El
// rechazo 429 del caso por defecto se cubre en
// agt003-claude-bridge-hardening.test.mjs.
async function testConcurrentRequestsOnlyRunInParallelWhenConfigured() {
  let active = 0;
  let maxActive = 0;
  const client = {
    run: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 75));
      active -= 1;
      return { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null };
    },
  };
  await withServer(client, async base => {
    const first = JSON.stringify(validPayload({ idempotencyKey: 'idem-c1' }));
    const second = JSON.stringify(validPayload({ idempotencyKey: 'idem-c2' }));
    const [a, b] = await Promise.all([
      fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(first, { nonce: 'a'.repeat(16) }), body: first }),
      fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(second, { nonce: 'b'.repeat(16) }), body: second }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(maxActive, 2, 'con el techo configurado en 2 el puente no debe serializar');
  }, { maxConcurrency: 2 });
}

function testConstructorFailsClosed() {
  assert.throws(() => createAgt003BridgeServer({ hmacSecret: 'corto', claudeClient: successClient }), /secreto HMAC/i);
  assert.throws(() => createAgt003BridgeServer({ hmacSecret: SECRET }), /cliente/i);
}

testDedicatedPathIsExported();
testConstructorFailsClosed();
await testWrongMethodRejected();
await testAgt002PathRejected();
await testAgt002HeaderNamespaceRejected();
await testWrongContentTypeRejected();
await testOversizedBodyRejectedWithSafeLog();
await testBoundedLargeBodyAccepted();
console.log('agt003-claude-bridge-server.test.mjs Paso 1 OK');

await testSuccessResponseShape();
await testCwdInBodyRejected();
await testMalformedBodyRejected();
await testMissingFieldsRejected();
await testProviderCodesMapToStatuses();
await testProviderErrorLogIsSanitized();
await testSuccessLogIsSanitized();
await testSynchronousThrowFailsClosed();
await testCompletedRequestBodyDoesNotCancelRun();
await testClientDisconnectCancelsRun();
await testConcurrentRequestsOnlyRunInParallelWhenConfigured();
console.log('agt003-claude-bridge-server.test.mjs Paso 2 OK');
