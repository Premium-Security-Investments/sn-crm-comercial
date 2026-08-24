import assert from 'node:assert/strict';
import { authenticateAgt003BridgeRequest } from '../agt003-claude-bridge-auth.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt003-claude-bridge-signing.js';
import { createAgt003NonceStore } from '../agt003-claude-bridge-nonce-store.js';

const SECRET = 'c'.repeat(32);
const METHOD = 'POST';
const PATH = '/v1/agt003-copilot/run';
const AUTH_INVALID = { ok: false, status: 401, code: 'AGT003_BRIDGE_AUTH_INVALID' };

function sign({ body, timestamp, nonce, secret = SECRET, path = PATH }) {
  const canonical = buildCanonicalString({ method: METHOD, path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return signCanonicalString(secret, canonical);
}

function headersFor({ body, timestamp, nonce, secret = SECRET, path = PATH }) {
  return {
    'x-agt003-timestamp': timestamp,
    'x-agt003-nonce': nonce,
    'x-agt003-signature': sign({ body, timestamp, nonce, secret, path }),
  };
}

function testValidSignatureAccepted() {
  const nonceStore = createAgt003NonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  const result = authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, { ok: true });
}

function testInvalidSignatureRejected() {
  const nonceStore = createAgt003NonceStore();
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16), secret: 'd'.repeat(32) });
  const result = authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, AUTH_INVALID);
}

function testBodyTamperedAfterSigningRejected() {
  const nonceStore = createAgt003NonceStore();
  const headers = headersFor({ body: '{"a":1}', timestamp: '1000', nonce: 'n'.repeat(16) });
  const result = authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: '{"a":2}', headers, secret: SECRET, nonceStore, now: () => 1000 });
  assert.deepEqual(result, AUTH_INVALID);
}

function testTimestampOutOfWindowRejected() {
  const body = '{}';
  const tooLate = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  assert.deepEqual(
    authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooLate, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 1031 }),
    AUTH_INVALID,
  );
  const tooEarly = headersFor({ body, timestamp: '1000', nonce: 'm'.repeat(16) });
  assert.deepEqual(
    authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: tooEarly, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 969 }),
    AUTH_INVALID,
  );
}

function testRepeatedNonceRejectedEvenWithValidSignature() {
  const nonceStore = createAgt003NonceStore();
  const body = '{}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  assert.deepEqual(authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1000 }), { ok: true });
  assert.deepEqual(authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore, now: () => 1001 }), AUTH_INVALID);
}

function testEachMissingHeaderRejected() {
  const body = '{}';
  const full = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16) });
  for (const missing of ['x-agt003-timestamp', 'x-agt003-nonce', 'x-agt003-signature']) {
    const headers = { ...full };
    delete headers[missing];
    assert.deepEqual(
      authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 1000 }),
      AUTH_INVALID,
      `header faltante: ${missing}`,
    );
  }
}

// El puente dedicado tiene su propio espacio de nombres: una petición firmada con
// las cabeceras del transporte gobernado AGT-002 nunca debe autenticarse aquí,
// aunque su firma sea criptográficamente válida sobre el mismo string canónico.
function testForeignHeaderNamespaceRejected() {
  const body = '{"a":1}';
  const timestamp = '1000';
  const nonce = 'n'.repeat(16);
  const foreign = {
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': sign({ body, timestamp, nonce }),
  };
  assert.deepEqual(
    authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers: foreign, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 1000 }),
    AUTH_INVALID,
  );
}

// La ruta forma parte del string canónico: una firma emitida para la ruta del
// puente AGT-002 no puede reutilizarse contra la ruta dedicada AGT-003.
function testSignatureBoundToDedicatedPath() {
  const body = '{"a":1}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'n'.repeat(16), path: '/v1/agt002-preview/run' });
  assert.deepEqual(
    authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 1000 }),
    AUTH_INVALID,
  );
}

function testShortNonceRejected() {
  const body = '{}';
  const headers = headersFor({ body, timestamp: '1000', nonce: 'short' });
  assert.deepEqual(
    authenticateAgt003BridgeRequest({ method: METHOD, path: PATH, rawBody: body, headers, secret: SECRET, nonceStore: createAgt003NonceStore(), now: () => 1000 }),
    AUTH_INVALID,
  );
}

testValidSignatureAccepted();
testInvalidSignatureRejected();
testBodyTamperedAfterSigningRejected();
testTimestampOutOfWindowRejected();
testRepeatedNonceRejectedEvenWithValidSignature();
testEachMissingHeaderRejected();
testForeignHeaderNamespaceRejected();
testSignatureBoundToDedicatedPath();
testShortNonceRejected();
console.log('agt003-claude-bridge-auth.test.mjs OK');
