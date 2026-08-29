import assert from 'node:assert/strict';
import { logBridgeEvent } from '../agt002-hetzner-bridge-log.js';

function testOnlySafeKeysAreEmitted() {
  const originalLog = console.log;
  let emitted = null;
  console.log = (line) => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_success', {
      correlation_id: 'corr-1',
      code: 'OK',
      latency_ms: 42,
      input_tokens: 10,
      output_tokens: 5,
      provider_status: 'failed',
      provider_error_code: 'rate_limited',
      input: { evidence_id: 'should-never-appear' },
      content: 'model output should never appear',
      secret: 'hmac-secret-should-never-appear',
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(emitted, 'logBridgeEvent debe emitir una línea');
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_success', correlation_id: 'corr-1', code: 'OK', latency_ms: 42, input_tokens: 10, output_tokens: 5, provider_status: 'failed', provider_error_code: 'rate_limited' });
  assert.equal(emitted.includes('should-never-appear'), false);
}

function testMissingOptionalFieldsAreOmittedNotNull() {
  const originalLog = console.log;
  let emitted = null;
  console.log = (line) => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_error', { correlation_id: 'corr-2', code: 'AGT002_BRIDGE_AUTH_INVALID', latency_ms: 3 });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_error', correlation_id: 'corr-2', code: 'AGT002_BRIDGE_AUTH_INVALID', latency_ms: 3 });
}

function testUnsafeProviderAtomsAreDroppedAtTheLoggingBoundary() {
  const originalLog = console.log;
  let emitted = null;
  console.log = line => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_error', {
      correlation_id: 'corr-3',
      code: 'AGT002_CODEX_PROVIDER_ERROR',
      provider_status: 'failed with raw provider secret detail',
      provider_error_code: { message: 'nested secret detail' },
    });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_error', correlation_id: 'corr-3', code: 'AGT002_CODEX_PROVIDER_ERROR' });
  assert.equal(emitted.includes('secret detail'), false);
}

function testAllowlistedEffortIsEmitted() {
  const originalLog = console.log;
  let emitted = null;
  console.log = line => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_success', { correlation_id: 'corr-4', code: 'OK', effort: 'low' });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_success', correlation_id: 'corr-4', code: 'OK', effort: 'low' });
}

function testUnsafeEffortIsDroppedAtTheLoggingBoundary() {
  const originalLog = console.log;
  let emitted = null;
  console.log = line => { emitted = line; };
  try {
    logBridgeEvent('agt002_bridge_error', { correlation_id: 'corr-5', code: 'AGT002_BRIDGE_BAD_REQUEST', effort: 'high' });
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_error', correlation_id: 'corr-5', code: 'AGT002_BRIDGE_BAD_REQUEST' });
  assert.equal(emitted.includes('high'), false);
}

testOnlySafeKeysAreEmitted();
testMissingOptionalFieldsAreOmittedNotNull();
testUnsafeProviderAtomsAreDroppedAtTheLoggingBoundary();
testAllowlistedEffortIsEmitted();
testUnsafeEffortIsDroppedAtTheLoggingBoundary();
console.log('agt002-hetzner-bridge-log.test.mjs OK');
