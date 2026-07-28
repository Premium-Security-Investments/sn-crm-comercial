import assert from 'node:assert/strict';
import { sha256Hex, buildCanonicalString, signCanonicalString, verifySignatureConstantTime } from '../agt002-hetzner-bridge-signing.js';

function testCanonicalStringOrderAndSeparators() {
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: 'abc123', timestamp: '1700000000', nonce: 'nonce-value' });
  assert.equal(canonical, 'POST\n/v1/agt002-preview/run\nabc123\n1700000000\nnonce-value');
}

function testSha256HexIsDeterministicAndLowercase() {
  const digest = sha256Hex('{"a":1}');
  assert.equal(digest, sha256Hex('{"a":1}'));
  assert.match(digest, /^[a-f0-9]{64}$/);
}

function testSignAndVerifyRoundTrip() {
  const secret = 'a'.repeat(32);
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonical);
  assert.equal(verifySignatureConstantTime(signature, signature), true);
}

function testVerifyRejectsOneByteDifference() {
  const secret = 'a'.repeat(32);
  const canonical = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonical);
  const tampered = signature.slice(0, -1) + (signature.at(-1) === '0' ? '1' : '0');
  assert.equal(verifySignatureConstantTime(signature, tampered), false);
}

function testVerifyRejectsBodyTamperedAfterSigning() {
  const secret = 'a'.repeat(32);
  const canonicalOriginal = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{"n":1}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const signature = signCanonicalString(secret, canonicalOriginal);
  const canonicalTamperedBody = buildCanonicalString({ method: 'POST', path: '/v1/agt002-preview/run', bodySha256Hex: sha256Hex('{"n":2}'), timestamp: '1700000000', nonce: 'n'.repeat(16) });
  const expectedForTamperedBody = signCanonicalString(secret, canonicalTamperedBody);
  assert.equal(verifySignatureConstantTime(expectedForTamperedBody, signature), false);
}

testCanonicalStringOrderAndSeparators();
testSha256HexIsDeterministicAndLowercase();
testSignAndVerifyRoundTrip();
testVerifyRejectsOneByteDifference();
testVerifyRejectsBodyTamperedAfterSigning();
console.log('agt002-hetzner-bridge-signing.test.mjs OK');
