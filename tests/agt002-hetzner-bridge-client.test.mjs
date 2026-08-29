import assert from 'node:assert/strict';
import { createAgt002HetznerBridgeClient } from '../agt002-hetzner-bridge-client.js';
import { sha256Hex, buildCanonicalString, verifySignatureConstantTime, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';

const URL_ = 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run';
const SECRET = 'a'.repeat(32);

function fakeFetch({ status = 200, jsonBody, capture }) {
  return async (url, init) => {
    if (capture) capture({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
    };
  };
}

function fakeStreamBody(chunkSizes) {
  let index = 0;
  const state = { cancelled: false };
  state.getReader = () => ({
    async read() {
      if (index >= chunkSizes.length) return { done: true, value: undefined };
      const value = new Uint8Array(chunkSizes[index]).fill(97);
      index += 1;
      return { done: false, value };
    },
    async cancel() { state.cancelled = true; },
    releaseLock() { /* no-op */ },
  });
  return state;
}

function fakeFetchWithBody({ status = 200, headers = {}, body }) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body,
  });
}

async function testExposesSameRunSignatureAndResolvesSameShape() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  const result = await client.run({ model: 'gpt-x', policy: 'policy', input: { a: 1 }, outputSchema: { type: 'object' }, timeoutMs: 5000, idempotencyKey: 'idem-1' });
  assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 3, output_tokens: 4 }, rate_limit: null });
}

async function testCwdIsNeverSentOverNetwork() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-2', cwd: '/should/never/appear' });
  assert.equal(captured.init.body.includes('/should/never/appear'), false);
  assert.equal(JSON.parse(captured.init.body).cwd, undefined);
}

async function testSignalIsNeverSerializedInBody() {
  let captured = null;
  const controller = new AbortController();
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-3', signal: controller.signal });
  const bodyParsed = JSON.parse(captured.init.body);
  assert.equal(bodyParsed.signal, undefined);
}

async function testRequestIsCorrectlySignedForServerCanonical() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-4' });
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex(captured.init.body), timestamp: '1000', nonce: 'n'.repeat(16) });
  const expected = signCanonicalString(SECRET, canonical);
  assert.equal(verifySignatureConstantTime(expected, captured.init.headers['X-AGT002-Signature']), true);
}

async function testNonOkResponseRejectsWithProvidedCode() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ status: 504, jsonBody: { error: { code: 'AGT002_CODEX_TIMEOUT', message: 'fixed' }, correlation_id: 'c-1' } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-5' }),
    (error) => { assert.equal(error.code, 'AGT002_CODEX_TIMEOUT'); return true; },
  );
}

function fakeStreamBodyFromText(text, chunkLength = 8) {
  const bytes = Buffer.from(text, 'utf8');
  const state = { cancelled: false };
  let offset = 0;
  state.getReader = () => ({
    async read() {
      if (offset >= bytes.length) return { done: true, value: undefined };
      const value = bytes.subarray(offset, Math.min(offset + chunkLength, bytes.length));
      offset += value.length;
      return { done: false, value };
    },
    async cancel() { state.cancelled = true; },
    releaseLock() { /* no-op */ },
  });
  return state;
}

async function testStreamedResponseUnderCapParsesCorrectly() {
  const jsonBody = JSON.stringify({ content: '{"ok":true}', usage: { input_tokens: 5, output_tokens: 6 }, rate_limit: null });
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetchWithBody({ body: fakeStreamBodyFromText(jsonBody) }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  const result = await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-stream-ok' });
  assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 5, output_tokens: 6 }, rate_limit: null });
}

async function testExcessiveContentLengthRejectedWithoutReadingBody() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetchWithBody({ headers: { 'content-length': '400000' }, body: fakeStreamBody([400_000]) }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-7' }),
    (error) => {
      assert.equal(error.code, 'AGT002_CODEX_INVALID_RESPONSE');
      assert.equal(error.message.includes('400000'), false, 'El error no debe filtrar el tamaño declarado.');
      return true;
    },
  );
}

async function testExcessiveStreamBodyRejectedEvenWithoutContentLength() {
  const body = fakeStreamBody([100_000, 100_000, 100_000]);
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetchWithBody({ body }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-8' }),
    (error) => { assert.equal(error.code, 'AGT002_CODEX_INVALID_RESPONSE'); return true; },
  );
  assert.equal(body.cancelled, true, 'El lector del stream debe cancelarse al exceder el límite, no seguir drenando datos.');
}

async function testEffortIsForwardedInTheSignedBody() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null, effort_ack: 'low' }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-1', effort: 'low' });
  assert.equal(JSON.parse(captured.init.body).effort, 'low');
}

// Root cause of the review blocker: a Vercel/app deploy can request `effort` while the Hetzner
// bridge is still running stale code that never learned about the field (drops it silently before
// ever reaching Codex, or reaches a codex client that never echoes it back). Requiring an exact
// `effort_ack` on every response that named an effort turns that silent revert-to-default-medium
// into a fail-closed rejection instead of an unnoticed correctness regression.
async function testExactAckAcceptsTheRequestedEffort() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null, effort_ack: 'low' } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  const result = await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-ack-1', effort: 'low' });
  assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null });
}

async function testMissingAckFailsClosedForAStaleBridge() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    // A stale bridge that never learned about `effort` returns the pre-hotfix response shape.
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-ack-2', effort: 'low' }),
    (error) => { assert.equal(error.code, 'AGT002_BRIDGE_STALE_EFFORT_ACK'); return true; },
  );
}

async function testMismatchedAckFailsClosed() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null, effort_ack: 'medium' } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-ack-3', effort: 'low' }),
    (error) => { assert.equal(error.code, 'AGT002_BRIDGE_STALE_EFFORT_ACK'); return true; },
  );
}

async function testAbsentAckIsFineWhenNoEffortWasRequested() {
  // A legacy/direct caller that never sets `effort` at all must be unaffected by the ack
  // requirement: there is nothing to acknowledge.
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  const result = await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-ack-4' });
  assert.deepEqual(result, { content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 1 }, rate_limit: null });
}

async function testAbsentEffortOmitsTheKeyForBackwardCompatibility() {
  let captured = null;
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: fakeFetch({ jsonBody: { content: '{}', usage: { input_tokens: 0, output_tokens: 0 }, rate_limit: null }, capture: (c) => { captured = c; } }),
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-2' });
  assert.equal(Object.hasOwn(JSON.parse(captured.init.body), 'effort'), false);
}

async function testUnsupportedEffortIsRejectedBeforeAnyRequestIsSent() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: async () => { throw new Error('must never be called for a malformed effort'); },
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-effort-3', effort: 'high' }),
    /esfuerzo de razonamiento/i,
  );
}

async function testTransportFailureRejectsWithSafeTransportCode() {
  const client = createAgt002HetznerBridgeClient({
    url: URL_, hmacSecret: SECRET,
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    randomNonce: () => 'n'.repeat(16), now: () => 1_000,
  });
  await assert.rejects(
    () => client.run({ model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-6' }),
    (error) => { assert.equal(error.code, 'AGT002_CODEX_TRANSPORT_ERROR'); assert.equal(error.message.includes('ECONNREFUSED'), false); return true; },
  );
}

await testExposesSameRunSignatureAndResolvesSameShape();
await testCwdIsNeverSentOverNetwork();
await testSignalIsNeverSerializedInBody();
await testRequestIsCorrectlySignedForServerCanonical();
await testEffortIsForwardedInTheSignedBody();
await testAbsentEffortOmitsTheKeyForBackwardCompatibility();
await testUnsupportedEffortIsRejectedBeforeAnyRequestIsSent();
await testExactAckAcceptsTheRequestedEffort();
await testMissingAckFailsClosedForAStaleBridge();
await testMismatchedAckFailsClosed();
await testAbsentAckIsFineWhenNoEffortWasRequested();
await testNonOkResponseRejectsWithProvidedCode();
await testStreamedResponseUnderCapParsesCorrectly();
await testExcessiveContentLengthRejectedWithoutReadingBody();
await testExcessiveStreamBodyRejectedEvenWithoutContentLength();
await testTransportFailureRejectsWithSafeTransportCode();
console.log('agt002-hetzner-bridge-client.test.mjs OK');
