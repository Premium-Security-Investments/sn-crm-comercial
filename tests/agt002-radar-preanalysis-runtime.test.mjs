import assert from 'node:assert/strict';
import { createAgt002RadarPreanalysisRuntime, getAgt002RadarPreanalysisRuntimeConfig, isAgt002RadarPreanalysisConfigured } from '../agt002-radar-preanalysis-runtime.js';
import { AGT002_PREVIEW_SONNET_MODEL } from '../agt002-preview-allowed-models.js';

// AGT002_RADAR_GATE no longer exists in ANALYSIS_FLAG_NAMES (agt002-analysis-config.js): an
// environment shape that used to fully configure the AI preanalysis runtime no longer does, for
// any previously-valid variant of that flag. get/create fail closed with
// AGT002_RADAR_RUNTIME_CONFIG_INVALID and the bridge client is never constructed.
const previouslyValidEnv = {
  AGT002_RADAR_GATE: 'true',
  AGT002_RADAR_PREANALYSIS_MODEL: AGT002_PREVIEW_SONNET_MODEL,
  AGT002_HETZNER_BRIDGE_URL: 'https://bridge.example.test/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'x'.repeat(48),
};

for (const environment of [
  previouslyValidEnv,
  { ...previouslyValidEnv, AGT002_RADAR_GATE: '1' },
  { ...previouslyValidEnv, AGT002_RADAR_GATE: 'TRUE' },
  {},
]) {
  assert.equal(Boolean(isAgt002RadarPreanalysisConfigured(environment)), false);
  assert.throws(
    () => getAgt002RadarPreanalysisRuntimeConfig(environment),
    error => error.code === 'AGT002_RADAR_RUNTIME_CONFIG_INVALID',
  );

  let clientCreated = false;
  assert.throws(
    () => createAgt002RadarPreanalysisRuntime({
      environment,
      createClient: () => { clientCreated = true; return { run: async () => ({}) }; },
    }),
    error => error.runtime_boundary_code === 'AGT002_RADAR_RUNTIME_CONFIG_INVALID' && error.code === 'AGT002_RADAR_RUNTIME_CONFIG_INVALID',
  );
  assert.equal(clientCreated, false, 'the bridge client must never be constructed once the runtime is retired');
}

console.log('AGT-002 Radar preanalysis runtime is unconditionally unconfigured (AI preanalysis retired) passed');
