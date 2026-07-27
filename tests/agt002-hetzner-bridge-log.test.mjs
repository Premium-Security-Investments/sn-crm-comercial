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
      input: { evidence_id: 'should-never-appear' },
      content: 'model output should never appear',
      secret: 'hmac-secret-should-never-appear',
    });
  } finally {
    console.log = originalLog;
  }
  assert.ok(emitted, 'logBridgeEvent debe emitir una línea');
  const parsed = JSON.parse(emitted);
  assert.deepEqual(parsed, { event: 'agt002_bridge_success', correlation_id: 'corr-1', code: 'OK', latency_ms: 42, input_tokens: 10, output_tokens: 5 });
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

testOnlySafeKeysAreEmitted();
testMissingOptionalFieldsAreOmittedNotNull();
console.log('agt002-hetzner-bridge-log.test.mjs OK');
