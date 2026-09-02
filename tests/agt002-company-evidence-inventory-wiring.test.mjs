// AGT-002 — production wiring for the governed SharePoint company-evidence catalog snapshot.
//
// RED reason: no production file loads, freezes, forwards or requires an inventory snapshot
// yet, so every source-text assertion below fails against server/index.js, the reanalysis
// executor, the preview runtime and the preview engine, and the behavioral assertions fail
// against the current runtime/frozen-input builders.
//
// The contract this pins, end to end:
//   governance load (registry + inventory snapshot, ONCE, before the idempotency reservation)
//     -> evidence identity binds the snapshot
//     -> every preview path and the frozen durable job carry the SAME snapshot
//     -> the executor forwards it verbatim
//     -> the runtime REQUIRES it for V3 and injects it into the engine
//     -> a direct non-V3 construction is completely unchanged.
//
// As with the existing governed-data wiring tests, no unit test can observe server/index.js's
// inline route handlers directly, so the server layer is a source-text contract; everything
// below the server (runtime, frozen input, executor) is driven for real.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { createAgt002PreviewRuntime } from '../agt002-preview-runtime.js';
import { buildAgt002FrozenEngineInput } from '../agt002-reanalysis-input.js';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../agt002-preview-runtime.js', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
const executorSource = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('../agt002-reanalysis-input.js', import.meta.url), 'utf8');

function count(source, token) {
  return source.split(token).length - 1;
}

function slice(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  assert.ok(start !== -1, `${label}: start anchor not found`);
  const end = source.indexOf(endToken, start);
  assert.ok(end !== -1 && end > start, `${label}: end anchor not found after start`);
  return source.slice(start, end);
}

function assertOrder(source, tokens, label) {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor);
    assert.ok(index !== -1, `${label}: missing "${token}" at/after position ${cursor}`);
    cursor = index + token.length;
  }
}

// ---------------------------------------------------------------------------
// Shared synthetic snapshot: the exact safe contract shape, 17 closed classes.
// ---------------------------------------------------------------------------
const INVENTORY_SNAPSHOT = Object.freeze({
  inventory_version: 'agt002-company-evidence-sharepoint-catalog-v1',
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
    last_reconciled_at: '2026-09-01T00:00:00.000Z',
  })),
});

// ===========================================================================
// 1. Backend parity, unchanged.
// ===========================================================================
assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');

// ===========================================================================
// 2. The V3 governance loader fetches the snapshot ONCE, alongside the registry, and
//    before anything binds an identity or reserves an idempotency key.
// ===========================================================================
assert.match(
  server,
  /import \{[^}]*loadAgt002CompanyEvidenceInventorySnapshot[^}]*\} from '\.\.\/agt002-company-evidence-sharepoint-catalog\.js';/,
  'the server must load the inventory snapshot through the governed catalog module',
);
assert.equal(
  count(server, 'loadAgt002CompanyEvidenceInventorySnapshot(database)'), 1,
  'exactly one snapshot load call site — shared by all three flows through the single governance loader',
);

{
  const loader = slice(
    server,
    'async function loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId) {',
    'function agt002EvidenceIdentityKeyParams(evidenceIdentity)',
    'governance loader',
  );
  assertOrder(loader, [
    'Promise.all([',
    'loadAgt002CompanyEvidenceRegistryEntries(database)',
    'loadAgt002CompanyEvidenceInventorySnapshot(database)',
    'buildAgt002CompanyEvidenceIdentity(',
  ], 'governance loader (registry + snapshot fetched together, before the identity binds them)');
  assert.match(
    loader,
    /inventorySnapshot: companyEvidenceInventorySnapshot/,
    'the evidence identity must bind the SAME snapshot this load returned',
  );
  assert.match(
    loader,
    /return \{[\s\S]*companyEvidenceInventorySnapshot,[\s\S]*\};/,
    'the governance object must expose the loaded snapshot to every downstream flow',
  );
  // A catalog that cannot be read must fail closed on the SAME safe boundary code the
  // registry already uses — never a silently degraded rules_fallback.
  assert.match(loader, /AGT002_RUNTIME_COMPANY_EVIDENCE_INVALID/);
}

// Every flow still loads governance exactly once, before the idempotency reservation, so the
// snapshot is necessarily bound before any run identity is computed or claimed.
assert.equal(count(server, 'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)'), 3);
for (const [label, startToken, endToken] of [
  ['flow1 (enqueueAgt002CanonicalReanalysis)', 'async function enqueueAgt002CanonicalReanalysis(database, {', 'function sendError(res, error, status = 500) {'],
  ['flow2 (requestAgt002)', 'requestAgt002: async ({ jobId, tenderId, opportunityId, snapshotId }) => {', 'export async function buildTenderOpportunitySummary('],
  ['flow3 (legacy preview)', "app.post('/api/tender-documents-analyze-agent-preview', async (req, res) => {", "app.get('/api/agt002-reanalysis-status'"],
]) {
  const flow = slice(server, startToken, endToken, label);
  assertOrder(flow, [
    'await loadAgt002IntegralV3GovernanceIfEnabled(database, opportunityId)',
    'computeAgt002PreviewIdempotencyKey({',
  ], `${label}: governance (and its snapshot) must be loaded before the idempotency key`);
}

// ===========================================================================
// 3. Every preview path carries the SAME snapshot into runtime construction.
// ===========================================================================
assert.equal(
  count(server, 'companyEvidenceInventorySnapshot: integralV3Governance.companyEvidenceInventorySnapshot,'), 2,
  'both direct createAgt002PreviewRuntime call sites must forward the loaded snapshot',
);
assert.doesNotMatch(
  server,
  /companyEvidenceInventorySnapshot: await loadAgt002CompanyEvidenceInventorySnapshot/,
  'no call site may re-load the snapshot: a run must bind exactly the catalog its identity was computed from',
);

// The frozen durable job carries it too, and the executor forwards it verbatim.
assert.match(
  inputSource,
  /validateAgt002CompanyEvidenceInventorySnapshot\(integralV3Governance\.companyEvidenceInventorySnapshot\)/,
  'a NEW durable job must re-validate the snapshot it freezes, never accept it verbatim',
);
assert.match(
  executorSource,
  /companyEvidenceInventorySnapshot: governance\.companyEvidenceInventorySnapshot,/,
  'the durable executor must forward the frozen snapshot into runtime construction, never re-load it',
);
assert.doesNotMatch(
  executorSource,
  /loadAgt002CompanyEvidenceInventorySnapshot/,
  'the durable worker must never re-read the catalog: the frozen job is the run\'s own governed truth',
);

// ===========================================================================
// 4. The runtime requires it for V3 and injects it into the engine.
// ===========================================================================
assert.match(runtimeSource, /companyEvidenceInventorySnapshot/, 'the shared runtime factory owns the V3 snapshot requirement (backend parity by construction)');
assert.match(
  engineSource,
  /inventorySnapshot: companyEvidenceInventorySnapshot/,
  'the engine must project the snapshot through the real buildAgt002CompanyEvidenceClasses builder',
);

function v3Env(overrides = {}) {
  return {
    TENDER_ANALYSIS_ENGINE: 'agt002_codex_preview',
    AGT002_PREVIEW_MODEL: 'synthetic-codex-model',
    AGT002_HETZNER_BRIDGE_URL: 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run',
    AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'a'.repeat(32),
    AGT002_CANONICAL_ONLY: 'true', AGT002_CONTEXT_V2: 'true', AGT002_DOCUMENT_RETRIEVAL: 'true',
    AGT002_INTEGRAL_CONTRACT_V3: 'true',
    ...overrides,
  };
}
const AS_OF = '2026-08-29T00:00:00.000Z';

// A V3 run with no catalog snapshot must fail closed at construction — exactly like a missing
// registry or a missing asOf does. Silently analysing with no company-evidence inventory would
// read as "no historical evidence exists", which is the opposite of the truth.
assert.throws(
  () => createAgt002PreviewRuntime({
    environment: v3Env(), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], companyEvidenceAsOf: AS_OF,
  }),
  (error) => {
    assert.match(String(error?.message), /no está configurado/i);
    assert.equal(error?.runtime_boundary_code, 'AGT002_RUNTIME_GOVERNANCE_INVALID', 'the failure must surface only the stable governance boundary code');
    return true;
  },
  'AGT002_INTEGRAL_CONTRACT_V3 must fail closed without an injected company-evidence inventory snapshot',
);

// A malformed snapshot is not a snapshot: it must fail closed at the same boundary, never be
// forwarded to the engine for the class builder to choke on mid-run.
for (const badSnapshot of [
  {},
  'not-an-object',
  { ...INVENTORY_SNAPSHOT, classes: INVENTORY_SNAPSHOT.classes.slice(1) },
  { ...INVENTORY_SNAPSHOT, source_file_count: 99 },
]) {
  assert.throws(
    () => createAgt002PreviewRuntime({
      environment: v3Env(), countDailyRuns: async () => 0,
      companyEvidenceRegistryEntries: [], companyEvidenceAsOf: AS_OF, companyEvidenceInventorySnapshot: badSnapshot,
    }),
    error => error?.runtime_boundary_code === 'AGT002_RUNTIME_GOVERNANCE_INVALID',
    `a malformed inventory snapshot (${JSON.stringify(badSnapshot).slice(0, 40)}) must fail closed`,
  );
}

// Supplied: the exact snapshot reaches the engine, verbatim.
{
  let capturedOptions = null;
  createAgt002PreviewRuntime({
    environment: v3Env(), countDailyRuns: async () => 0,
    companyEvidenceRegistryEntries: [], companyEvidenceAsOf: AS_OF, companyEvidenceInventorySnapshot: INVENTORY_SNAPSHOT,
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(capturedOptions.integralContractV3, true, 'precondition: this is a V3 construction');
  assert.deepEqual(
    capturedOptions.companyEvidenceInventorySnapshot, INVENTORY_SNAPSHOT,
    'the runtime must forward the loaded catalog snapshot to the engine verbatim',
  );
}

// A direct non-V3 construction is completely unchanged: no snapshot is required, none is
// invented, and the engine never even receives the option.
{
  let capturedOptions = null;
  const runtime = createAgt002PreviewRuntime({
    environment: v3Env({ AGT002_INTEGRAL_CONTRACT_V3: undefined, AGT002_CANONICAL_ONLY: undefined }),
    countDailyRuns: async () => 0,
    createEngine: (options) => { capturedOptions = options; return { analyze: async () => ({}) }; },
  });
  assert.equal(typeof runtime.analyze, 'function');
  assert.notEqual(capturedOptions.integralContractV3, true, 'precondition: this is a legacy, non-V3 construction');
  assert.ok(
    !Object.hasOwn(capturedOptions, 'companyEvidenceInventorySnapshot'),
    'a non-V3 engine must never receive a company-evidence inventory snapshot option at all',
  );
}

// ===========================================================================
// 5. The frozen durable job freezes the snapshot with the rest of its governed truth.
// ===========================================================================
function frozenSource(governanceOverrides = {}) {
  return {
    runtimeConfig: { model: 'm', policyVersion: 'p', timeoutMs: 165000, dailyMaxRuns: 20, maxConcurrent: 2 },
    analysisConfig: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
    analysisContext: { opportunity: { id: 'opp' }, documents: [{ id: 'doc' }], snapshotId: 'snap', canonicalOnly: true },
    legalCorpusContext: null,
    integralV3Governance: {
      companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {},
      evidenceIdentity: {
        source_snapshot_hash: 'a'.repeat(64), preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829',
      },
      evidenceAsOf: AS_OF,
      companyEvidenceInventorySnapshot: JSON.parse(JSON.stringify(INVENTORY_SNAPSHOT)),
      ...governanceOverrides,
    },
    manizalesManifestSource: null,
    idempotencyKey: 'key',
  };
}

{
  const input = buildAgt002FrozenEngineInput(frozenSource());
  assert.deepEqual(
    input.integral_v3_governance.companyEvidenceInventorySnapshot, INVENTORY_SNAPSHOT,
    'the frozen job must carry the exact catalog snapshot the run identity was computed from',
  );
  assert.doesNotThrow(() => structuredClone(input), 'the frozen input must stay JSON-safe');
}

// A V3 job with no snapshot can never be queued: it would execute against a catalog nobody
// pinned, and the durable run would silently disagree with its own reserved identity.
assert.throws(
  () => buildAgt002FrozenEngineInput(frozenSource({ companyEvidenceInventorySnapshot: undefined })),
  /inventar|snapshot|governance|frozen/i,
  'a V3 job must never freeze without the governed catalog snapshot',
);
assert.throws(
  () => buildAgt002FrozenEngineInput(frozenSource({ companyEvidenceInventorySnapshot: { corrupted: true } })),
  /inventar|snapshot|inventory_version/i,
  'a malformed snapshot must be rejected at freeze time, not discovered by the worker hours later',
);

// ===========================================================================
// 6. The durable executor forwards the frozen snapshot into runtime construction.
// ===========================================================================
{
  const calls = { runtime: [] };
  const executor = createAgt002ReanalysisExecutor({
    environment: { AGT002_HETZNER_BRIDGE_URL: 'https://bridge.invalid', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'not-observed' },
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'preview-lease-1' }),
    findPreviewRun: async () => ({ run_id: 'existing-run-1' }),
    releasePreviewClaim: async () => {},
    countDailyRuns: async () => 0,
    createRuntime: (options) => { calls.runtime.push(options); return { analyze() {}, manifestScope: null }; },
    runPostBridgeAnalysis: async () => ({ status: 'completed', analysis_run_id: 'run-1', error_code: null }),
    createCorrelationId: () => 'correlation-1',
    observability: { record() {} },
  });

  const frozenInput = buildAgt002FrozenEngineInput(frozenSource());
  await executor({ kind: 'db' }, {
    jobId: 'job-1', leaseId: 'lease-1', opportunityId: 'opp', tenderId: 'tender-1',
    snapshotId: 'snap', contextVersionId: 'context-1', idempotencyKey: 'key', requestedBy: 'actor-1',
    frozenEngineInput: frozenInput,
  });

  assert.equal(calls.runtime.length, 1, 'precondition: the executor reconstructed exactly one runtime');
  assert.equal(
    calls.runtime[0].companyEvidenceInventorySnapshot,
    frozenInput.integral_v3_governance.companyEvidenceInventorySnapshot,
    'the executor must forward the SAME frozen snapshot object — never a re-derived or re-loaded one',
  );
}

console.log('AGT-002 company evidence inventory snapshot production wiring contract passed');
