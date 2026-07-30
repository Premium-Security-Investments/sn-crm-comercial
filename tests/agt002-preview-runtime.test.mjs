import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createAgt002PreviewRuntime, isAgt002PreviewConfigured } from '../agt002-preview-runtime.js';

function baseEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

assert.equal(isAgt002PreviewConfigured({}), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ TENDER_ANALYSIS_ENGINE: undefined })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ TENDER_ANALYSIS_ENGINE: 'agt002_openai_preview' })), false, 'only the Codex App Server engine id is accepted; the legacy OpenAI-key plan id must not silently enable this runtime');
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_PREVIEW_MODEL: '' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_HETZNER_BRIDGE_URL: '   ' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv({ AGT002_HETZNER_BRIDGE_HMAC_SECRET: '   ' })), false);
assert.equal(isAgt002PreviewConfigured(baseEnv()), true);

// Fails closed when unconfigured; never constructs a client/spawns anything.
assert.throws(() => createAgt002PreviewRuntime({ environment: {} }), /no está configurado/i);
assert.throws(() => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_MODEL: undefined }) }), /no está configurado/i);

// When configured, returns a usable engine without eagerly spawning (construction is cheap/safe).
{
  const runtime = createAgt002PreviewRuntime({ environment: baseEnv(), countDailyRuns: async () => 0 });
  assert.equal(typeof runtime.analyze, 'function');
}

// Malformed numeric overrides must fail closed rather than silently coerce to an unsafe default.
assert.throws(
  () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: 'not-a-number' }), countDailyRuns: async () => 0 }),
  /no está configurado/i,
);

// Negative/zero operator overrides must also fail closed.
assert.throws(
  () => createAgt002PreviewRuntime({ environment: baseEnv({ AGT002_PREVIEW_MAX_CONCURRENT: '0' }), countDailyRuns: async () => 0 }),
  /no está configurado/i,
);

// Explicit numeric overrides are honored when valid.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_PREVIEW_TIMEOUT_MS: '5000', AGT002_PREVIEW_MAX_CONCURRENT: '1', AGT002_PREVIEW_DAILY_MAX_RUNS: '4', AGT002_PREVIEW_POLICY_VERSION: 'agt002-preview-policy-v2' }),
    countDailyRuns: async () => 4,
  });
  await assert.rejects(
    () => runtime.analyze({ opportunity: {}, documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }], companyProfile: {}, deepAnalysis: {}, snapshotId: 'snapshot-1' }),
    /cuota/i,
  );
}

// AGT002_CONTEXT_V2 must be propagated by the server-side runtime factory. With the
// flag enabled, incomplete v1-only input fails closed before quota/provider work.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_PREVIEW_DAILY_MAX_RUNS: '1' }),
    countDailyRuns: async () => 1,
  });
  assert.throws(
    () => runtime.analyze({
      opportunity: {},
      documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }],
      companyProfile: {},
      deepAnalysis: {},
      snapshotId: 'snapshot-1',
    }),
    /context.*v2|contexto.*v2/i,
    'runtime must enable context v2 from AGT002_CONTEXT_V2 rather than silently using v1',
  );
}

// AGT002_LEGAL_CORPUS must reach the engine together with a deterministic, versioned corpus
// provider. Engine construction itself fails closed if runtime forgets either dependency.
{
  const runtime = createAgt002PreviewRuntime({
    environment: baseEnv({ AGT002_CONTEXT_V2: 'true', AGT002_LEGAL_CORPUS: 'true', AGT002_LEGAL_AS_OF: '2026-07-30' }),
    countDailyRuns: async () => 0,
  });
  assert.equal(typeof runtime.analyze, 'function');
}

const source = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /OPENAI_API_KEY|HERMES_INTERIM_API_KEY|Authorization|Bearer/i, 'the runtime must never manage an API key or bearer token');

function testConfiguredRequiresHetznerBridgeUrlAndSecret() {
  const baseEnv = { TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview', AGT002_PREVIEW_MODEL: 'gpt-x' };
  assert.equal(isAgt002PreviewConfigured(baseEnv), false, 'sin URL de puente, debe fallar cerrado (kill switch apagado por defecto)');
  assert.equal(isAgt002PreviewConfigured({ ...baseEnv, AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run' }), false, 'sin secreto HMAC, debe fallar cerrado');
  assert.equal(isAgt002PreviewConfigured({
    ...baseEnv,
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  }), true);
}

function testRuntimeBuildsHetznerBridgeClientNotLocalSpawn() {
  const environment = {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'gpt-x',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
  };
  const engine = createAgt002PreviewRuntime({ environment, countDailyRuns: async () => 0 });
  assert.equal(typeof engine.analyze, 'function');
}

testConfiguredRequiresHetznerBridgeUrlAndSecret();
testRuntimeBuildsHetznerBridgeClientNotLocalSpawn();

console.log('AGT-002 Preview runtime factory (fail-closed environment wiring) passed');
