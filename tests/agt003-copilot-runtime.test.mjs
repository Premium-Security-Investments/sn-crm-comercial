import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAgt003CopilotRuntime, getAgt003CopilotRuntimeConfig, isAgt003CopilotConfigured } from '../agt003-copilot-runtime.js';

function env(overrides = {}) {
  return {
    AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
    AGT003_COPILOT_MODEL: 'synthetic-model',
    AGT003_COPILOT_BRIDGE_URL: 'https://agents.example.test/v1/agt003-copilot/run',
    AGT003_COPILOT_HMAC_SECRET: 's'.repeat(32),
    ...overrides,
  };
}

assert.equal(isAgt003CopilotConfigured({}), false);
assert.equal(isAgt003CopilotConfigured(env()), true);
assert.equal(isAgt003CopilotConfigured(env({ AGT003_COPILOT_ENGINE: 'other' })), false);
assert.equal(isAgt003CopilotConfigured(env({ AGT003_COPILOT_MODEL: '' })), false);
assert.equal(isAgt003CopilotConfigured(env({ AGT003_COPILOT_HMAC_SECRET: '' })), false);
const sharedEnv = {
  AGT003_COPILOT_ENGINE: 'agt003_bridge_preview',
  AGT003_COPILOT_WIRE_PROTOCOL: 'agt002',
  AGT002_PREVIEW_MODEL: 'shared-model',
  AGT002_HETZNER_BRIDGE_URL: 'https://agents.example.test/v1/agt002-preview/run',
  AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'h'.repeat(32),
};
assert.equal(isAgt003CopilotConfigured(sharedEnv), true);
assert.equal(getAgt003CopilotRuntimeConfig(sharedEnv).model, 'shared-model');
assert.equal(typeof createAgt003CopilotRuntime({ environment: sharedEnv, countDailyRuns: async () => 0 }).draft, 'function');
assert.equal(isAgt003CopilotConfigured({ ...sharedEnv, AGT003_COPILOT_WIRE_PROTOCOL: 'agt003' }), false);
assert.throws(() => createAgt003CopilotRuntime({ environment: {} }), /no está configurado/i);
assert.throws(() => getAgt003CopilotRuntimeConfig(env({ AGT003_COPILOT_TIMEOUT_MS: 'bad' })), /no está configurado/i);
assert.throws(() => getAgt003CopilotRuntimeConfig(env({ AGT003_COPILOT_MAX_CONCURRENT: '0' })), /no está configurado/i);
assert.throws(() => getAgt003CopilotRuntimeConfig(env({ AGT003_COPILOT_TIMEOUT_MS: '600000' })), /no está configurado/i);
const config = getAgt003CopilotRuntimeConfig(env({ AGT003_COPILOT_TIMEOUT_MS: '5000', AGT003_COPILOT_MAX_CONCURRENT: '1', AGT003_COPILOT_DAILY_MAX_RUNS: '4' }));
assert.deepEqual(config, { model: 'synthetic-model', policyVersion: 'agt003-copilot-policy-v1', timeoutMs: 5000, maxConcurrent: 1, dailyMaxRuns: 4, leaseSeconds: 20, wireProtocol: 'agt003' });
assert.equal(getAgt003CopilotRuntimeConfig(env({ AGT003_COPILOT_WIRE_PROTOCOL: 'agt002' })).wireProtocol, 'agt002');
assert.throws(() => createAgt003CopilotRuntime({ environment: env({ AGT003_COPILOT_WIRE_PROTOCOL: 'legacy' }), countDailyRuns: async () => 0 }), /no está configurado/i);
const runtime = createAgt003CopilotRuntime({ environment: env(), countDailyRuns: async () => 0 });
assert.equal(typeof runtime.draft, 'function');

const source = readFileSync(new URL('../agt003-copilot-runtime.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /ANTHROPIC_API_KEY|OPENAI_API_KEY|Authorization|Bearer|child_process|spawn\s*\(/i);

console.log('AGT-003 copilot runtime configuration passed');
