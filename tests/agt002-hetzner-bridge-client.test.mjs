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
await testNonOkResponseRejectsWithProvidedCode();
await testTransportFailureRejectsWithSafeTransportCode();
console.log('agt002-hetzner-bridge-client.test.mjs OK');
