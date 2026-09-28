import assert from 'node:assert/strict';
import { createAgt002RadarPreanalysisRuntime } from '../agt002-radar-preanalysis-runtime.js';
import { AGT002_PREVIEW_SONNET_MODEL } from '../agt002-preview-allowed-models.js';

// ---------------------------------------------------------------------------
// Issue #136's bridge-measured-usage authority is now dead code: AGT002_RADAR_GATE no longer
// exists in ANALYSIS_FLAG_NAMES (agt002-analysis-config.js), so the runtime fails closed on its
// own config before it can ever reach the bridge client, the model, or a usage measurement --
// for every previously-valid environment shape. This test asserts that unreachability directly,
// rather than exercising usage semantics that can no longer run.
// ---------------------------------------------------------------------------

const previouslyValidEnv = {
  AGT002_RADAR_GATE: 'true',
  AGT002_RADAR_PREANALYSIS_MODEL: AGT002_PREVIEW_SONNET_MODEL,
  AGT002_HETZNER_BRIDGE_URL: 'https://bridge.example.test/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
};

for (const environment of [previouslyValidEnv, { ...previouslyValidEnv, AGT002_RADAR_GATE: '1' }]) {
  let bridgeCalls = 0;
  const hostileCreateClient = () => {
    bridgeCalls += 1;
    return { run: async () => { throw new Error('the bridge must never run once the AI preanalysis runtime is retired'); } };
  };

  assert.throws(
    () => createAgt002RadarPreanalysisRuntime({ environment, createClient: hostileCreateClient }),
    error => error.runtime_boundary_code === 'AGT002_RADAR_RUNTIME_CONFIG_INVALID',
  );
  assert.equal(bridgeCalls, 0, 'the runtime must fail on its own config before ever constructing the bridge client');
}

console.log('AGT-002 Radar bridge-measured usage authority (issue #136) is unreachable now that AI preanalysis is retired');
