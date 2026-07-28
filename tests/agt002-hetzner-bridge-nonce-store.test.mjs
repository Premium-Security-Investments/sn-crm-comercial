import assert from 'node:assert/strict';
import { isTimestampWithinWindow, createNonceStore } from '../agt002-hetzner-bridge-nonce-store.js';

function testTimestampWindowBoundaries() {
  assert.equal(isTimestampWithinWindow('1000', 1000, 30), true);
  assert.equal(isTimestampWithinWindow('1000', 1030, 30), true);
  assert.equal(isTimestampWithinWindow('1000', 1031, 30), false);
  assert.equal(isTimestampWithinWindow('1000', 969, 30), false);
  assert.equal(isTimestampWithinWindow('not-a-number', 1000, 30), false);
}

function testNonceConsumedOnceThenRejected() {
  const store = createNonceStore({ ttlMs: 90_000 });
  const nonce = 'n'.repeat(16);
  assert.equal(store.consume(nonce, 1_000), true);
  assert.equal(store.consume(nonce, 1_000), false);
}

function testNonceRejectsShortEntropy() {
  const store = createNonceStore({ ttlMs: 90_000 });
  assert.equal(store.consume('short', 1_000), false);
}

function testNonceExpiresAfterTtl() {
  const store = createNonceStore({ ttlMs: 90_000 });
  const nonce = 'n'.repeat(16);
  assert.equal(store.consume(nonce, 1_000), true);
  assert.equal(store.consume('other-nonce-value', 1_000 + 90_001), true);
  assert.equal(store.size(), 1);
}

testTimestampWindowBoundaries();
testNonceConsumedOnceThenRejected();
testNonceRejectsShortEntropy();
testNonceExpiresAfterTtl();
console.log('agt002-hetzner-bridge-nonce-store.test.mjs OK');
