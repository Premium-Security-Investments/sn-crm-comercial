import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAgt003CopilotConfigured, resolveAgt003BridgeConnection } from '../agt003-copilot-runtime.js';
import {
  AGT003_PREFLIGHT_DEFAULT_POLICY_VERSION,
  createAgt003PreflightRuntime,
  getAgt003PreflightRuntimeConfig,
  isAgt003PreflightConfigured,
} from '../agt003-preflight-runtime.js';

function env(overrides = {}) {
  return {
    AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
    AGT003_COPILOT_MODEL: 'synthetic-model',
    AGT003_COPILOT_BRIDGE_URL: 'https://agents.example.test/v1/agt003-copilot/run',
    AGT003_COPILOT_HMAC_SECRET: 's'.repeat(32),
    ...overrides,
  };
}

assert.equal(AGT003_PREFLIGHT_DEFAULT_POLICY_VERSION, 'agt003-preflight-policy-v1');
for (const environment of [
  {},
  env(),
  env({ AGT003_COPILOT_ENGINE: 'other' }),
  env({ AGT003_COPILOT_MODEL: '' }),
  env({ AGT003_COPILOT_HMAC_SECRET: '' }),
]) {
  assert.equal(isAgt003PreflightConfigured(environment), isAgt003CopilotConfigured(environment));
}
assert.equal(isAgt003PreflightConfigured, isAgt003CopilotConfigured, 'preflight uses the exact existing configuration gate');

const directConfig = getAgt003PreflightRuntimeConfig(env());
assert.deepEqual(directConfig, {
  model: 'synthetic-model',
  policyVersion: 'agt003-preflight-policy-v1',
  timeoutMs: 20000,
  maxConcurrent: 1,
  dailyMaxRuns: 40,
  wireProtocol: 'agt003',
});
assert.deepEqual(resolveAgt003BridgeConnection(env()), {
  wireProtocol: 'agt003',
  model: directConfig.model,
  bridgeUrl: 'https://agents.example.test/v1/agt003-copilot/run',
  hmacSecret: 's'.repeat(32),
});

const customConfig = getAgt003PreflightRuntimeConfig(env({
  AGT003_PREFLIGHT_POLICY_VERSION: 'policy-custom',
  AGT003_PREFLIGHT_TIMEOUT_MS: '5000',
  AGT003_PREFLIGHT_MAX_CONCURRENT: '2',
  AGT003_PREFLIGHT_DAILY_MAX_RUNS: '7',
}));
assert.deepEqual(customConfig, {
  model: 'synthetic-model',
  policyVersion: 'policy-custom',
  timeoutMs: 5000,
  maxConcurrent: 2,
  dailyMaxRuns: 7,
  wireProtocol: 'agt003',
});

const sharedEnv = {
  AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
  AGT003_COPILOT_WIRE_PROTOCOL: 'agt002',
  AGT002_PREVIEW_MODEL: 'shared-model',
  AGT002_HETZNER_BRIDGE_URL: 'https://agents.example.test/v1/agt002-preview/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'h'.repeat(32),
};
assert.equal(isAgt003PreflightConfigured(sharedEnv), true);
assert.deepEqual(getAgt003PreflightRuntimeConfig(sharedEnv), {
  model: 'shared-model',
  policyVersion: 'agt003-preflight-policy-v1',
  timeoutMs: 20000,
  maxConcurrent: 1,
  dailyMaxRuns: 40,
  wireProtocol: 'agt002',
});

for (const overrides of [
  { AGT003_PREFLIGHT_TIMEOUT_MS: 'bad' },
  { AGT003_PREFLIGHT_TIMEOUT_MS: '0' },
  { AGT003_PREFLIGHT_MAX_CONCURRENT: '-1' },
  { AGT003_PREFLIGHT_DAILY_MAX_RUNS: '1.5' },
]) {
  assert.throws(() => getAgt003PreflightRuntimeConfig(env(overrides)), /no está configurado/i);
}
assert.throws(() => createAgt003PreflightRuntime({ environment: {} }), /no está configurado/i);
const runtime = createAgt003PreflightRuntime({ environment: env() });
assert.equal(typeof runtime.preflight, 'function');

const source = readFileSync(new URL('../agt003-preflight-runtime.js', import.meta.url), 'utf8');
assert.match(source, /createAgt003CopilotBridgeClient/);
assert.match(source, /resolveAgt003BridgeConnection/);
assert.doesNotMatch(source, /ANTHROPIC_API_KEY|OPENAI_API_KEY|Authorization|Bearer|child_process|spawn\s*\(/i);

console.log('AGT-003 preflight runtime configuration passed');
