import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgt002IncrementalConfig } from '../agt002-incremental-config.js';

test('R1 flags are hard-off unless their literal is true', () => {
  assert.deepEqual(getAgt002IncrementalConfig({}), { ingressEnabled: false, dispatchEnabled: false });
  assert.deepEqual(getAgt002IncrementalConfig({ AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED: 'TRUE' }), { ingressEnabled: false, dispatchEnabled: false });
});

test('dispatch can only turn on behind incremental ingress', () => {
  assert.throws(() => getAgt002IncrementalConfig({ AGT002_INCREMENTAL_DISPATCH_ENABLED: 'true' }), /ingreso incremental apagado/);
  assert.deepEqual(getAgt002IncrementalConfig({
    AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED: 'true',
    AGT002_INCREMENTAL_DISPATCH_ENABLED: 'true',
  }), { ingressEnabled: true, dispatchEnabled: true });
});
