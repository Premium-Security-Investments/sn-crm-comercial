import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgt002IncrementalConfig } from '../agt002-incremental-config.js';

test('R1 flags are hard-off unless their literal is true', () => {
  assert.deepEqual(getAgt002IncrementalConfig({}), {
    ingressEnabled: false, dispatchEnabled: false, workerDispatchUrl: '', workerDispatchHmacSecret: '',
  });
  assert.equal(getAgt002IncrementalConfig({ AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED: 'TRUE' }).ingressEnabled, false);
});

test('dispatch can only turn on behind incremental ingress', () => {
  assert.throws(() => getAgt002IncrementalConfig({ AGT002_INCREMENTAL_DISPATCH_ENABLED: 'true' }), /ingreso incremental apagado/);
  assert.throws(() => getAgt002IncrementalConfig({
    AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED: 'true',
    AGT002_INCREMENTAL_DISPATCH_ENABLED: 'true',
  }), /URL y secreto HMAC/);
  const config = getAgt002IncrementalConfig({
    AGT002_INCREMENTAL_SIGNAL_INGRESS_ENABLED: 'true',
    AGT002_INCREMENTAL_DISPATCH_ENABLED: 'true',
    AGT002_INCREMENTAL_WORKER_DISPATCH_URL: 'https://agt002.example/v1/agt002/reanalysis/dispatch',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(32),
  });
  assert.equal(config.ingressEnabled, true);
  assert.equal(config.dispatchEnabled, true);
});
