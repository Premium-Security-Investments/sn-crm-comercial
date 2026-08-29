import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createAgt002PreviewRuntime } from '../agt002-preview-runtime.js';

// Phase 9 (T7/D): the deterministic prompt budget must be ACTIVE for every appropriate V3 runtime
// construction — it was wired into the engine (runOnceV3) but left dormant (default-off), reachable
// only by a canary script, so no production path ever enabled it. Activation lives in the shared
// createAgt002PreviewRuntime factory, so server/index.js and api/[...path].js inherit it identically
// (backend parity by construction). Nothing here touches production, network or DB.

function baseEnv(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.example.invalid/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// V3 runtime: promptBudget is forwarded to the engine as true.
// -----------------------------------------------------------------------------
{
  let capturedOptions = null;
  createAgt002PreviewRuntime({
    environment: baseEnv({
      AGT002_CANONICAL_ONLY: 'true', AGT002_CONTEXT_V2: 'true',
      AGT002_DOCUMENT_RETRIEVAL: 'true', AGT002_INTEGRAL_CONTRACT_V3: 'true',
    }),
    countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [],
    companyEvidenceAsOf: '2026-08-29T00:00:00.000Z',
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(capturedOptions.integralContractV3, true, 'precondition: the V3 contract is active');
  assert.equal(capturedOptions.promptBudget, true, 'the V3 runtime must activate the deterministic prompt budget');
}

// -----------------------------------------------------------------------------
// Legacy (non-V3) runtime: promptBudget is NOT activated (the budget only governs the V3 path).
// -----------------------------------------------------------------------------
{
  let capturedOptions = null;
  createAgt002PreviewRuntime({
    environment: baseEnv(),
    countDailyRuns: async () => 0,
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(capturedOptions.integralContractV3, false, 'precondition: the legacy path is not V3');
  assert.notEqual(capturedOptions.promptBudget, true, 'the legacy runtime must not silently enable the V3 prompt budget');
}

// -----------------------------------------------------------------------------
// Source lock: activation lives in the shared factory (parity), keyed inside the V3 block.
// -----------------------------------------------------------------------------
{
  const runtimeSource = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
  assert.match(runtimeSource, /promptBudget:\s*true/, 'createAgt002PreviewRuntime must activate promptBudget');
}

console.log('agt002-v3-prompt-budget-runtime-activation: OK');
