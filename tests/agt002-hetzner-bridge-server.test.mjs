import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
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
    const oversized = JSON.stringify({ padding: 'x'.repeat(300_000) });
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(oversized), body: oversized });
    assert.equal(response.status, 413);
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

async function testConcurrencyOneRejectsSecondRequest() {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient: neverResolvingClient() }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-3' };
    const firstBody = JSON.stringify(payload);
    const firstRequest = fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(firstBody), body: firstBody });
    await new Promise(resolve => setTimeout(resolve, 50));
    const secondPayload = { ...payload, idempotencyKey: 'idem-4' };
    const secondBody = JSON.stringify(secondPayload);
    const secondResponse = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(secondBody, { nonce: 'm'.repeat(16) }), body: secondBody });
    assert.equal(secondResponse.status, 409);
    const secondResult = await secondResponse.json();
    assert.equal(secondResult.error.code, 'AGT002_BRIDGE_BUSY');
    firstRequest.catch(() => {});
  } finally {
    // The first request's codexClient never resolves, so its connection is never idle;
    // force-close it here or server.close() would hang waiting for a response that never comes.
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

async function testProviderErrorMappedTo502() {
  const client = { run: async () => { const error = new Error('boom'); error.code = 'AGT002_CODEX_PROVIDER_ERROR'; throw error; } };
  await withServer(client, async (base) => {
    const payload = { model: 'gpt-x', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-5' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PATH}`, { method: 'POST', headers: signedHeaders(body), body });
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.error.code, 'AGT002_CODEX_PROVIDER_ERROR');
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
console.log('agt002-hetzner-bridge-server.test.mjs Step 1 OK');

await testSuccessResponseShape();
await testCwdInBodyRejected();
await testConcurrencyOneRejectsSecondRequest();
await testProviderErrorMappedTo502();
await testLoginRequiredMappedTo503();
console.log('agt002-hetzner-bridge-server.test.mjs Step 5 OK');
