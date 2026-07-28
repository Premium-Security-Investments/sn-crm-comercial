import assert from 'node:assert/strict';
import { authenticateBridgeRequest } from '../agt002-hetzner-bridge-auth.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';
import { createNonceStore } from '../agt002-hetzner-bridge-nonce-store.js';

const SECRET = 'a'.repeat(32);
const METHOD = 'POST';
const PATH = '/v1/agt002-preview/run';

function sign({ body, timestamp, nonce, secret = SECRET }) {
  const canonical = buildCanonicalString({ method: METHOD, path: PATH, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return signCanonicalString(secret, canonical);
}

function headersFor({ body, timestamp, nonce, secret = SECRET }) {
  return {
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': sign({ body, timestamp, nonce, secret }),
  };
}

function testValidSignatureAccepted() {
  const nonceStore = createNonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: true });
}

function testInvalidSignatureRejected() {
  const nonceStore = createNonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16), secret: 'b'.repeat(32) });
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testBodyTamperedAfterSigningRejected() {
  const nonceStore = createNonceStore();
  const signedBody = '{"a":1}';
  const headers = headersFor({ body: signedBody, timestamp: '1000', nonce: 'n'.repeat(16) });
  const tamperedBody = '{"a":2}';
  const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: tamperedBody, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testTimestampOutOfWindowRejected() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const tooLate = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  assert.deepEqual(
    authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooLate, secret: SECRET, nonceStore, now: () => 1031 }),
    { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' },
  );
  const tooEarly = headersFor({ body, timestamp: '1000', nonce: 'm'.repeat(16) });
  assert.deepEqual(
    authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooEarly, secret: SECRET, nonceStore, now: () => 969 }),
    { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' },
  );
}

function testRepeatedNonceRejectedEvenWithValidSignature() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const nonce = 'n'.repeat(16);
  const headers = headersFor({ body, timestamp: '1000', nonce });
  const first = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(first, { ok: true });
  const replay = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1001 });
  assert.deepEqual(replay, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' });
}

function testEachMissingHeaderRejected() {
  const nonceStore = createNonceStore();
  const body = '{}';
  const full = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  for (const missing of ['x-agt002-timestamp', 'x-agt002-nonce', 'x-agt002-signature']) {
    const headers = { ...full };
    delete headers[missing];
    const result = authenticateBridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore: createNonceStore(), now: () => 1000 });
    assert.deepEqual(result, { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' }, `header faltante: ${missing}`);
  }
}

testValidSignatureAccepted();
testInvalidSignatureRejected();
testBodyTamperedAfterSigningRejected();
testTimestampOutOfWindowRejected();
testRepeatedNonceRejectedEvenWithValidSignature();
testEachMissingHeaderRejected();
console.log('agt002-hetzner-bridge-auth.test.mjs OK');
