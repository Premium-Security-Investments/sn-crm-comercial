import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgt002BridgeServer, AGT002_BRIDGE_MAX_BODY_BYTES } from '../agt002-hetzner-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';

const SECRET = 'a'.repeat(32);
const PATH = '/v1/agt002-preview/run';

function signedHeaders(body, { timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'n'.repeat(16), secret = SECRET } = {}) {
  const canonical = buildCanonicalString({ method: 'POST', path: PATH, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return {
    'content-type': 'application/json',
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': signCanonicalString(secret, canonical),
  };
}

async function withServer(codexClient, fn) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const fakeSuccessClient = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }) };

async function testWrongMethodRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const response = await fetch(`${base}${PATH}`, { method: 'GET' });
    assert.equal(response.status, 405);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AGT002_BRIDGE_METHOD_NOT_ALLOWED');
  });
}

async function testUnknownPathRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const body = '{}';
    const response = await fetch(`${base}/v1/other`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 404);
  });
}

async function testWrongContentTypeRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const body = '{}';
    const headers = { ...signedHeaders(body), 'content-type': 'text/plain' };
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers, body });
    assert.equal(response.status, 415);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AGT002_BRIDGE_UNSUPPORTED_MEDIA_TYPE');
  });
}

async function testOversizedBodyRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(1_100_000) });
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(oversized), body: oversized });
    assert.equal(response.status, 413);
  });
}

async function testOversizedBodyEmitsSafeLogEvent() {
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => { lines.push(line); };
  const oversized = JSON.stringify({ padding: 'x'.repeat(1_100_000) });
  try {
    await withServer(fakeSuccessClient, async (base) => {
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(oversized), body: oversized });
      assert.equal(response.status, 413);
    });
  } finally {
    console.log = originalLog;
  }

  const events = lines.map(line => JSON.parse(line)).filter(event => event.code === 'AGT002_BRIDGE_PAYLOAD_TOO_LARGE');
  assert.equal(events.length, 1, 'el rechazo 413 debe emitir exactamente un evento de log seguro');
  const [event] = events;
  assert.ok(Number.isInteger(event.received_bytes) && event.received_bytes > AGT002_BRIDGE_MAX_BODY_BYTES, 'el evento debe incluir received_bytes numérico por encima del límite');
  assert.ok(typeof event.correlation_id === 'string' && event.correlation_id.length > 0, 'el evento debe incluir correlation_id');

  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes('padding'), false, 'el evento nunca debe filtrar el cuerpo de la solicitud');
  assert.equal(serialized.includes(SECRET), false, 'el evento nunca debe filtrar el secreto HMAC');
  assert.equal(serialized.includes('policy'), false, 'el evento nunca debe filtrar campos de prompt/policy');
}

async function testIntegralV3SizedBodyAccepted() {
  let calls = 0;
  const client = {
    run: async () => {
      calls += 1;
      return { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null };
    },
  };
  await withServer(client, async (base) => {
    const payload = {
      model: 'gpt-x', policy: 'policy text', input: { evidence: 'x'.repeat(300_000) },
      outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-v3-sized',
    };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200, 'un payload V3 acotado por debajo de 1 MiB debe llegar al proveedor');
    assert.equal(calls, 1);
  });
}

function neverResolvingClient() {
  return { run: () => new Promise(() => {}) };
}

async function testSuccessResponseShape() {
  await withServer(fakeSuccessClient, async (base) => {
    const payload = { model: 'gpt-x', policy: 'policy text', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null });
  });
}

async function testEffortForwardedToCodexClient() {
  let captured = null;
  const client = { run: async (options) => { captured = options; return { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }; } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-1', effort: 'low' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200);
  });
  assert.equal(captured.effort, 'low');
}

async function testEffortAckFromCodexClientIsForwardedVerbatim() {
  const client = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null, effort_ack: 'low' }) };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-ack-1', effort: 'low' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.effort_ack, 'low', 'the bridge server must never strip the codex client\'s effort acknowledgement');
  });
}

async function testEffortIsRecordedOnSuccessSafeLog() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null, effort_ack: 'low' }) };
  try {
    await withServer(client, async (base) => {
      const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-log-1', effort: 'low' };
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 200);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'OK');
  assert.equal(event.effort, 'low');
  assert.equal(JSON.stringify(event).includes('policy'), false);
}

// AGT-002 review blocker: the success log's `effort` field must come from the caller's own
// already-validated request, never from the codex client's `effort_ack`. `effort_ack` exists only
// so the bridge *client* (agt002-hetzner-bridge-client.js) can validate the response; it must never
// double as a logging source. A stale/misbehaving codex client that omits (or gets wrong)
// `effort_ack` must not make the server silently under-report (or leak an unvalidated value for)
// what was actually requested.
async function testSuccessLogUsesRequestedEffortNotEffortAck() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }) };
  try {
    await withServer(client, async (base) => {
      const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-log-3', effort: 'medium' };
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 200);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'OK');
  assert.equal(event.effort, 'medium', 'a stale codex client that never emits effort_ack must not make the server drop the requested effort from its own log');
}

async function testSuccessLogNeverLeaksAMismatchedEffortAck() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null, effort_ack: 'high' }) };
  try {
    await withServer(client, async (base) => {
      const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-log-4', effort: 'low' };
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 200);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'OK');
  assert.equal(event.effort, 'low', 'the safe log must reflect the validated request effort, never a codex client-supplied effort_ack');
}

async function testEffortIsRecordedOnErrorSafeLog() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = { run: async () => { const error = new Error('provider secret detail'); error.code = 'AGT002_CODEX_PROVIDER_ERROR'; throw error; } };
  try {
    await withServer(client, async (base) => {
      const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-log-2', effort: 'medium' };
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 502);
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'AGT002_CODEX_PROVIDER_ERROR');
  assert.equal(event.effort, 'medium');
}

async function testUnsupportedEffortRejectedWithBadRequest() {
  await withServer(fakeSuccessClient, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-2', effort: 'high' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_BRIDGE_BAD_REQUEST');
  });
}

async function testCwdInBodyRejected() {
  await withServer(fakeSuccessClient, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-2', cwd: '/etc' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 400);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_BRIDGE_BAD_REQUEST');
  });
}

async function testConcurrentRequestsAreAccepted() {
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
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-3' };
    const firstBody = JSON.stringify(payload);
    const secondBody = JSON.stringify({ ...payload, idempotencyKey: 'idem-4' });
    const [first, second] = await Promise.all([
      fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(firstBody), body: firstBody }),
      fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(secondBody, { nonce: 'm'.repeat(16) }), body: secondBody }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(maxActive, 2, 'el bridge no debe serializar artificialmente solicitudes independientes');
  });
}

async function testProviderErrorMappedTo502() {
  const originalLog = console.log;
  const lines = [];
  console.log = line => { lines.push(line); };
  const client = { run: async () => { const error = new Error('provider secret detail'); error.code = 'AGT002_CODEX_PROVIDER_ERROR'; error.providerStatus = 'failed'; error.providerErrorCode = 'rate_limited'; throw error; } };
  try {
    await withServer(client, async (base) => {
      const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-5' };
      const body = JSON.stringify(payload);
      const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
      assert.equal(response.status, 502);
      const result = await response.json();
      assert.equal(result.error.code, 'AGT002_CODEX_PROVIDER_ERROR');
    });
  } finally {
    console.log = originalLog;
  }
  const event = lines.map(line => JSON.parse(line)).find(item => item.code === 'AGT002_CODEX_PROVIDER_ERROR');
  assert.equal(event.provider_status, 'failed');
  assert.equal(event.provider_error_code, 'rate_limited');
  assert.equal(JSON.stringify(event).includes('provider secret detail'), false);
}

async function testSynchronousThrowInCodexClientReleasesBusyAndFailsClosed() {
  const client = { run: () => { throw new Error('sync boom, must never leak to the caller'); } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-sync-1' };
    const firstBody = JSON.stringify(payload);
    const first = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(firstBody, { nonce: 'q'.repeat(16) }), body: firstBody });
    assert.equal(first.status, 500, 'Un throw síncrono debe responder fail-closed, no dejar la petición colgada.');
    const firstResult = await first.json();
    assert.equal(firstResult.error.code, 'AGT002_BRIDGE_INTERNAL');
    assert.equal(JSON.stringify(firstResult).includes('sync boom'), false, 'El detalle del throw síncrono no debe filtrarse al caller.');

    const secondPayload = { ...payload, idempotencyKey: 'idem-sync-2' };
    const secondBody = JSON.stringify(secondPayload);
    const second = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(secondBody, { nonce: 'r'.repeat(16) }), body: secondBody });
    assert.notEqual(second.status, 409, 'busy no debe quedar atascado tras un throw síncrono del cliente Codex.');
  });
}

// Regression for the production smoke bug: a completed request body makes the
// server IncomingMessage emit 'close' immediately after 'end', while the codex
// run is still in flight. If disconnect cancellation keys off req 'close', it
// aborts every real request and the injected client fails with
// AGT002_CODEX_CANCELLED (mapped to 500) before any model output.
function abortAwareClient() {
  return {
    run: ({ signal } = {}) => new Promise((resolve, reject) => {
      const cancel = () => {
        const error = new Error('La ejecución de AGT-002 Preview fue cancelada.');
        error.code = 'AGT002_CODEX_CANCELLED';
        reject(error);
      };
      if (signal?.aborted) return cancel();
      // Model latency: give req 'close' a chance to (wrongly) abort us first.
      const timer = setTimeout(() => resolve({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }), 60);
      signal?.addEventListener('abort', () => { clearTimeout(timer); cancel(); }, { once: true });
    }),
  };
}

async function testCompletedRequestBodyDoesNotCancelRun() {
  await withServer(abortAwareClient(), async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-close-1' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    const result = await response.json();
    assert.equal(response.status, 200, `Una petición HTTP normal no debe cancelarse; recibido ${response.status} ${JSON.stringify(result)}`);
    assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null });
  });
}

async function testClientDisconnectStillCancelsRun() {
  let observeAbort;
  const abortObserved = new Promise(resolve => { observeAbort = resolve; });
  const client = {
    run: ({ signal } = {}) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        observeAbort(true);
        const error = new Error('La ejecución de AGT-002 Preview fue cancelada.');
        error.code = 'AGT002_CODEX_CANCELLED';
        reject(error);
      }, { once: true });
    }),
  };
  await withServer(client, async (base) => {
    const controller = new AbortController();
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-disc-1' };
    const body = JSON.stringify(payload);
    const pending = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body, signal: controller.signal });
    pending.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    controller.abort();
    const result = await Promise.race([
      abortObserved,
      new Promise((_, reject) => setTimeout(() => reject(new Error('El servidor no propagó la desconexión del cliente al run de Codex.')), 2000)),
    ]);
    assert.equal(result, true, 'La desconexión real del cliente debe seguir cancelando el run de Codex.');
  });
}

async function testLoginRequiredMappedTo503() {
  const client = { run: async () => { const error = new Error('login'); error.code = 'AGT002_CODEX_LOGIN_REQUIRED'; throw error; } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-6' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 503);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_CODEX_LOGIN_REQUIRED');
  });
}

await testWrongMethodRejected();
await testUnknownPathRejected();
await testWrongContentTypeRejected();
await testOversizedBodyRejected();
await testOversizedBodyEmitsSafeLogEvent();
await testIntegralV3SizedBodyAccepted();
console.log('agt002-hetzner-bridge-server.test.mjs Step 1 OK');

await testSuccessResponseShape();
await testEffortForwardedToCodexClient();
await testEffortAckFromCodexClientIsForwardedVerbatim();
await testEffortIsRecordedOnSuccessSafeLog();
await testSuccessLogUsesRequestedEffortNotEffortAck();
await testSuccessLogNeverLeaksAMismatchedEffortAck();
await testEffortIsRecordedOnErrorSafeLog();
await testUnsupportedEffortRejectedWithBadRequest();
await testCwdInBodyRejected();
await testConcurrentRequestsAreAccepted();
await testProviderErrorMappedTo502();
await testLoginRequiredMappedTo503();
await testSynchronousThrowInCodexClientReleasesBusyAndFailsClosed();
await testCompletedRequestBodyDoesNotCancelRun();
await testClientDisconnectStillCancelsRun();
console.log('agt002-hetzner-bridge-server.test.mjs Step 5 OK');
