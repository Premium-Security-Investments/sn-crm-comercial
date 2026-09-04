import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createAgt002PreviewRuntime } from '../agt002-preview-runtime.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION } from '../agt002-company-evidence-sharepoint-catalog.js';
import { AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS } from '../agt002-v3-prompt-budget.js';

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

// Synthetic, privacy-safe valid 17-class inventory snapshot matching the real validator shape
// (agt002-company-evidence-sharepoint-catalog.js) — no real names, paths, URLs or raw ids.
const SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT = Object.freeze({
  inventory_version: AGT002_COMPANY_EVIDENCE_INVENTORY_VERSION,
  catalog_snapshot_hash: 'c'.repeat(64),
  source_file_count: 18,
  excluded_non_evidence_count: 1,
  state_counts: {
    current_valid: 0, historical_update_required: 0, reported_unverified: 17, absent_unknown: 0, process_specific_template: 0,
  },
  classes: AGT002_COMPANY_EVIDENCE_CLASS_IDS.map(entryId => ({
    entry_id: entryId,
    source_file_count: 1,
    state_counts: {
      current_valid: 0, historical_update_required: 0, reported_unverified: 1, absent_unknown: 0, process_specific_template: 0,
    },
    effective_state: 'reported_unverified',
    last_reconciled_at: '2026-08-29T00:00:00.000Z',
  })),
});

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
    companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT,
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
  assert.equal(capturedOptions.promptMaxInputTokens, undefined, 'the legacy runtime must never forward promptMaxInputTokens (constructor-only, V3-scoped)');
}

// -----------------------------------------------------------------------------
// V3 runtime: promptMaxInputTokens is forwarded to the engine alongside promptBudget:true,
// defaulting to the safe-floor constant and honoring the server-owned env override
// (AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS — never a caller/browser value).
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
    companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT,
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(
    capturedOptions.promptMaxInputTokens,
    AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'the default V3 runtime must forward the safe-floor constant unchanged',
  );
}

{
  let capturedOptions = null;
  createAgt002PreviewRuntime({
    environment: baseEnv({
      AGT002_CANONICAL_ONLY: 'true', AGT002_CONTEXT_V2: 'true',
      AGT002_DOCUMENT_RETRIEVAL: 'true', AGT002_INTEGRAL_CONTRACT_V3: 'true',
      AGT002_PREVIEW_PROMPT_MAX_INPUT_TOKENS: '180000',
    }),
    countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [],
    companyEvidenceAsOf: '2026-08-29T00:00:00.000Z',
    companyEvidenceInventorySnapshot: SYNTHETIC_COMPANY_EVIDENCE_INVENTORY_SNAPSHOT,
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(
    capturedOptions.promptMaxInputTokens,
    180000,
    'a valid server-owned override must reach the engine verbatim',
  );
}

// -----------------------------------------------------------------------------
// Source lock: activation lives in the shared factory (parity), keyed inside the V3 block.
// -----------------------------------------------------------------------------
{
  const runtimeSource = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
  assert.match(runtimeSource, /promptBudget:\s*true/, 'createAgt002PreviewRuntime must activate promptBudget');
}

console.log('agt002-v3-prompt-budget-runtime-activation: OK');
