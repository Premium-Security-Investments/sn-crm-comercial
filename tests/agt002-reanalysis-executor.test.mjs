import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';
import { AGT002_POST_BRIDGE_ERROR_CODES } from '../agt002-post-bridge-observability.js';
import { AGT002_PREVIEW_ALLOWED_MODELS } from '../agt002-preview-allowed-models.js';
import { computeAgt002GovernedWorksetIdempotencyKey } from '../agt002-governed-document-workset-api.js';
import { computeAgt002WorksetSelectionHash, freezeAgt002WorksetEvidence } from '../agt002-governed-document-worksets.js';

const JOB = Object.freeze({
  jobId: 'job-1', leaseId: 'lease-1', opportunityId: 'opp-1', tenderId: 'tender-1',
  snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-1', requestedBy: 'actor-1',
  frozenEngineInput: {
    schema_version: 1,
    engine_identity: { model: 'sonnet', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2 },
    analysis_flags: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
    analysis_context: { opportunity: { id: 'opp-1' }, documents: [], snapshotId: 'snapshot-1', canonicalOnly: true },
    legal_corpus_context: null,
    integral_v3_governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
    manizales_manifest_source: null,
  },
});

function harness({
  previewClaim = { status: 'claimed', claim_id: 'preview-lease-1' },
  postOutcome = { status: 'completed', analysis_run_id: 'run-1', error_code: null },
  runtimeError = null,
  createCheckpointAdapter = undefined,
  // HIGH remediation 1+2 (RED — docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "stable
  // workset identity" + persistence-boundary sections): dependency seams the durable_batched_v1
  // executor path is expected to accept alongside createCheckpointAdapter. Left undefined by
  // default so every pre-existing call to harness() stays byte-identical.
  deriveWorksetIdentity = undefined,
  getOrCreateWorkset = undefined,
  computeFrozenInputHash = undefined,
  finalizeDurableAnalysis = undefined,
  registerPreviewAnalysis = undefined,
  runPostBridgeAnalysis: runPostBridgeAnalysisOverride = undefined,
} = {}) {
  const calls = { claim: [], find: [], release: [], runtime: [], post: [], count: [] };
  const executor = createAgt002ReanalysisExecutor({
    environment: { AGT002_HETZNER_BRIDGE_URL: 'https://bridge.invalid', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'not-observed' },
    claimPreviewRun: async (...args) => { calls.claim.push(args); return previewClaim; },
    findPreviewRun: async (...args) => { calls.find.push(args); return { run_id: 'existing-run-1' }; },
    releasePreviewClaim: async (...args) => { calls.release.push(args); },
    countDailyRuns: async (...args) => { calls.count.push(args); return 0; },
    createRuntime: options => { calls.runtime.push(options); if (runtimeError) throw runtimeError; return { analyze() {}, manifestScope: { scope: 'fixed' } }; },
    runPostBridgeAnalysis: runPostBridgeAnalysisOverride ?? (async (...args) => { calls.post.push(args); return postOutcome; }),
    createCorrelationId: () => 'correlation-1',
    observability: { record() {} },
    ...(createCheckpointAdapter ? { createCheckpointAdapter } : {}),
    ...(deriveWorksetIdentity ? { deriveWorksetIdentity } : {}),
    ...(getOrCreateWorkset ? { getOrCreateWorkset } : {}),
    ...(computeFrozenInputHash ? { computeFrozenInputHash } : {}),
    ...(finalizeDurableAnalysis ? { finalizeDurableAnalysis } : {}),
    ...(registerPreviewAnalysis ? { registerPreviewAnalysis } : {}),
  });
  return { executor, calls };
}

test('reuses an existing canonical preview run without constructing or invoking the model', async () => {
  const { executor, calls } = harness({ previewClaim: { status: 'existing' } });
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'existing-run-1', reused: true });
  assert.equal(calls.find.length, 1);
  assert.equal(calls.runtime.length, 0);
  assert.equal(calls.post.length, 0);
});

test('reconstructs runtime from frozen non-secret input and invokes the real orchestrator once', async () => {
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false });
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.runtime.length, 1);
  assert.equal(calls.post.length, 1, 'zero retry/fallback: one orchestrator call');
  const runtimeOptions = calls.runtime[0];
  assert.equal(runtimeOptions.environment.AGT002_PREVIEW_MODEL, 'sonnet');
  assert.equal(runtimeOptions.environment.AGT002_PREVIEW_POLICY_VERSION, 'policy-1');
  assert.equal(runtimeOptions.environment.AGT002_INTEGRAL_CONTRACT_V3, 'true');
  // AGT-002 root-cause fix: a legacy frozen job (no `engine_identity.effort` — created before
  // this field existed) must still reconstruct with the current safe default, never crash and
  // never inherit whatever the worker host's own ambient env happens to have set.
  assert.equal(runtimeOptions.environment.AGT002_PREVIEW_REASONING_EFFORT, 'low');
  assert.equal(runtimeOptions.contextVersionId, 'context-1');
  assert.equal(runtimeOptions.companyEvidenceRegistryEntries, JOB.frozenEngineInput.integral_v3_governance.companyEvidenceRegistryEntries);
  assert.equal(runtimeOptions.onBridgeInvocationStarted instanceof Function, true);
  const [, context, deps] = calls.post[0];
  assert.equal(context.claimId, 'preview-lease-1');
  assert.equal(context.idempotencyKey, 'key-1');
  assert.equal(context.expectedIdempotencyKey, 'key-1', 'the durable claim identity must reach persistence unchanged');
  assert.equal(context.requireTenderRequirementInventory, true, 'retrieval on must keep the fail-closed inventory requirement');
  assert.equal(deps.analysisContext, JOB.frozenEngineInput.analysis_context);
  assert.equal(deps.integralContractV3, true);
  assert.equal(calls.release.length, 0, 'post-bridge orchestrator owns the claimed preview lease');
});

// F4/A5: the durable executor forwards the SAME deterministic asOf the frozen governance
// already carries into runtime construction — never the wall clock, never re-derived.
test('forwards the frozen governance evidenceAsOf verbatim into runtime construction', async () => {
  const evidenceIdentity = { source_snapshot_hash: 'a'.repeat(64), preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829' };
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      integral_v3_governance: { ...JOB.frozenEngineInput.integral_v3_governance, evidenceIdentity, evidenceAsOf: '2026-08-29T00:00:00.000Z' },
    },
  };
  const { executor, calls } = harness();
  await executor({ kind: 'db' }, job);
  assert.equal(calls.runtime[0].companyEvidenceAsOf, '2026-08-29T00:00:00.000Z');
});

// C: a NEW job's frozen governance carries evidenceIdentity/evidenceAsOf together; an isolated
// evidenceAsOf (no evidenceIdentity) can never come from any real builder and must be rejected
// before any provider claim, exactly like every other malformed frozen input.
test('rejects a frozen governance carrying evidenceAsOf without evidenceIdentity', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      integral_v3_governance: { ...JOB.frozenEngineInput.integral_v3_governance, evidenceAsOf: '2026-08-29T00:00:00.000Z' },
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, job);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.runtime.length, 0);
});

// C: symmetrically, an isolated evidenceIdentity (no evidenceAsOf) can never come from any real
// builder either — a pre-F3 legacy job carries NEITHER field, never identity alone — and must be
// rejected before any provider claim, exactly like the evidenceAsOf-only case above.
test('rejects a frozen governance carrying evidenceIdentity without evidenceAsOf', async () => {
  const evidenceIdentity = { source_snapshot_hash: 'a'.repeat(64), preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829' };
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      integral_v3_governance: { ...JOB.frozenEngineInput.integral_v3_governance, evidenceIdentity },
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, job);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.runtime.length, 0);
});

// C: a malformed evidenceIdentity (invalid hash) must fail closed even though the frozen input
// is otherwise well-formed — the executor never trusts a durable value verbatim.
test('rejects a frozen governance carrying a malformed evidenceIdentity', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      integral_v3_governance: {
        ...JOB.frozenEngineInput.integral_v3_governance,
        evidenceIdentity: { source_snapshot_hash: 'not-a-hash', preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829' },
        evidenceAsOf: '2026-08-29T00:00:00.000Z',
      },
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, job);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0);
});

// Focal: a frozen evidenceAsOf must be exactly the canonical start-of-day UTC form — never
// merely Date-parseable — so an offset, a non-midnight time or a calendar-impossible date is
// rejected before any provider claim, exactly like a malformed evidenceIdentity above.
test('rejects a frozen governance carrying a non-canonical evidenceAsOf', async () => {
  const evidenceIdentity = { source_snapshot_hash: 'a'.repeat(64), preview_artifact_hash: 'b'.repeat(64), source_manifest_version: 'v0.3.1-approved-20260829' };
  for (const badAsOf of ['2026-08-29T00:00:00.000+00:00', '2026-08-29T08:30:00.000Z', '2026-02-30T00:00:00.000Z', 'not-a-date']) {
    const job = {
      ...JOB,
      frozenEngineInput: {
        ...JOB.frozenEngineInput,
        integral_v3_governance: { ...JOB.frozenEngineInput.integral_v3_governance, evidenceIdentity, evidenceAsOf: badAsOf },
      },
    };
    const { executor, calls } = harness();
    const result = await executor({ kind: 'db' }, job);
    assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false }, `${badAsOf} must be rejected`);
    assert.equal(calls.claim.length, 0);
  }
});

// Blocker: the frozen job's own AGT002_DOCUMENT_RETRIEVAL flag — never a hardcoded true —
// must gate the persistence-side inventory requirement, or a retrieval-off run (whose
// envelope legitimately carries no evidence_coverage) pays the provider then fails to persist.
test('retrieval-off jobs never require the tender inventory at persistence', async () => {
  const retrievalOffJob = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      analysis_flags: { ...JOB.frozenEngineInput.analysis_flags, AGT002_DOCUMENT_RETRIEVAL: false },
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, retrievalOffJob);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false });
  const [, context] = calls.post[0];
  assert.equal(context.requireTenderRequirementInventory, false);
});

// Release blocker: the semantic V3 path spends TWO sequential provider timeouts (discovery
// then analysis) under a single durable claim, so the claim lease must fund both turns plus
// the executor's 30s buffer — 2 * ceil(timeout_ms / 1000) + 30. A one-timeout lease expires
// while the second turn is in flight and the run is reclaimed underneath itself.
test('claims a preview lease covering both sequential provider turns plus buffer', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, timeout_ms: 30_000 },
    },
  };
  const { executor, calls } = harness();
  await executor({ kind: 'db' }, job);
  assert.equal(calls.claim.length, 1);
  assert.equal(
    calls.claim[0][1].leaseSeconds,
    90,
    'a 30s identity timeout funds two turns, so the claim lease must be 2*30+30=90s, not 60s',
  );
});

// Clamping a two-turn lease to the 600s ceiling would be worse than useless: it hands back a
// lease that silently underfunds both turns (2*480+30=990s of work under a 600s lease), so the
// run is reclaimed mid-flight after the provider has already been paid. A timeout the ceiling
// cannot fund is a frozen-config error, and the only safe close is to reject it as unclaimable
// config — before any provider claim, exactly like the other pre-claim validation failures.
const SAFE_CONFIG_REJECTION = { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false };

test('rejects a timeout the 600s ceiling cannot fund for two turns before claiming', async () => {
  for (const timeout_ms of [285_001, 300_000, 480_000]) {
    const job = {
      ...JOB,
      frozenEngineInput: {
        ...JOB.frozenEngineInput,
        engine_identity: { ...JOB.frozenEngineInput.engine_identity, timeout_ms },
      },
    };
    const { executor, calls } = harness();
    const result = await executor({ kind: 'db' }, job);
    const required = 2 * Math.ceil(timeout_ms / 1000) + 30;
    assert.ok(required > 600, `${timeout_ms}ms must be an unfundable timeout for this case`);
    assert.deepEqual(result, SAFE_CONFIG_REJECTION, `${timeout_ms}ms needs ${required}s > 600s and must close safely`);
    assert.equal(calls.claim.length, 0, 'an unfundable lease must never reach claimPreviewRun');
    assert.equal(calls.runtime.length, 0);
    assert.equal(calls.post.length, 0);
    assert.equal(calls.release.length, 0, 'nothing was claimed, so there is nothing to release');
  }
});

test('the largest two-turn-fundable timeout still claims at exactly the 600s ceiling', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, timeout_ms: 285_000 },
    },
  };
  const { executor, calls } = harness();
  await executor({ kind: 'db' }, job);
  assert.equal(calls.claim.length, 1, '2*285+30=600 fits the ceiling exactly and stays claimable');
  assert.equal(calls.claim[0][1].leaseSeconds, 600);
});

test('closes capacity states without constructing the model or retrying', async () => {
  const { executor, calls } = harness({ previewClaim: { status: 'saturated' } });
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'capacity_unavailable', reused: false });
  assert.equal(calls.runtime.length, 0);
  assert.equal(calls.post.length, 0);
  assert.equal(calls.claim.length, 1);
});

test('releases the preview lease exactly once if runtime construction fails before orchestration', async () => {
  const { executor, calls } = harness({ runtimeError: new Error('do not leak') });
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'provider_error');
  assert.equal(calls.post.length, 0);
  assert.equal(calls.release.length, 1);
  assert.deepEqual(calls.release[0][1], { idempotencyKey: 'key-1', claimId: 'preview-lease-1' });
});

test('rejects malformed, over-budget, or identity-mismatched frozen input before any provider claim', async () => {
  const { executor, calls } = harness();
  const mismatch = await executor({ kind: 'db' }, { ...JOB, frozenEngineInput: { ...JOB.frozenEngineInput, analysis_context: { ...JOB.frozenEngineInput.analysis_context, snapshotId: 'other' } } });
  const overBudget = await executor({ kind: 'db' }, { ...JOB, frozenEngineInput: { ...JOB.frozenEngineInput, engine_identity: { ...JOB.frozenEngineInput.engine_identity, timeout_ms: 480_001 } } });
  assert.deepEqual(mismatch, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.deepEqual(overBudget, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.runtime.length, 0);
});

// Contract: validFrozenInput accepts a frozen model only if it is an EXACT, case-sensitive
// member of AGT002_PREVIEW_ALLOWED_MODELS — a tampered/corrupted durable governed job carrying
// any other value (including one that was once valid, or a mis-cased/padded variant) must be
// rejected before any claim or runtime construction, never merely logged and executed anyway.
test('rejects a tampered durable governed job whose frozen model is not an exact allowlisted value, before any claim or runtime construction', async () => {
  assert.equal(AGT002_PREVIEW_ALLOWED_MODELS.includes('gpt-agt002-preview'), false);
  for (const model of ['gpt-agt002-preview', 'Sonnet', ' sonnet', '']) {
    const tamperedJob = {
      ...JOB,
      executionMode: 'durable_batched_v1',
      frozenEngineInput: { ...JOB.frozenEngineInput, engine_identity: { ...JOB.frozenEngineInput.engine_identity, model } },
    };
    const { executor, calls } = harness();
    const result = await executor({ kind: 'db' }, tamperedJob);
    assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false }, `model ${JSON.stringify(model)} must be rejected`);
    assert.equal(calls.claim.length, 0);
    assert.equal(calls.runtime.length, 0);
  }
});

// AGT-002 root-cause fix: an explicit, valid frozen effort reconstructs the worker's runtime
// environment exactly, and an unsupported/corrupted frozen effort is refused fail-closed before
// any provider claim — exactly like every other malformed engine_identity field above.
test('forwards an explicit frozen reasoning effort to the reconstructed runtime environment', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, effort: 'medium' },
    },
  };
  const { executor, calls } = harness();
  await executor({ kind: 'db' }, job);
  assert.equal(calls.runtime[0].environment.AGT002_PREVIEW_REASONING_EFFORT, 'medium');
});

test('rejects an unsupported frozen reasoning effort before any provider claim', async () => {
  const job = {
    ...JOB,
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, effort: 'high' },
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, job);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0);
  assert.equal(calls.runtime.length, 0);
});

test('a persisted canonical run wins even if presentation later reports unavailable', async () => {
  const { executor } = harness({ postOutcome: { status: 'unavailable', analysis_run_id: 'run-persisted', error_code: 'response_serialization_failed' } });
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-persisted', error_code: null, reused: false });
});

// ---------------------------------------------------------------------------------------------
// AGT-002 durable batched analysis, Task 2 (RED — docs/plans/2026-09-03-agt002-durable-batched-
// analysis.md): checkpoint hooks (agt002-analysis-checkpoints.js's
// createAgt002AnalysisCheckpointAdapter, see tests/agt002-analysis-checkpoints.test.mjs) are
// injected into runtime construction ONLY for a claimed job whose executionMode is exactly
// 'durable_batched_v1'. Every legacy shape — no executionMode at all (every job fixture above),
// or an explicit 'single_turn_v1' — must construct zero checkpoint adapters and reach
// createRuntime with no checkpointHooks key at all, so direct/Manizales/legacy paths stay
// byte-equivalent to today.
// ---------------------------------------------------------------------------------------------

// HIGH remediation 1+2 (RED — docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "1.
// Stable workset identity"): the checkpoint adapter can no longer be fenced by the job's raw
// idempotencyKey. It must be fenced by a CONCRETE, get-or-created workset id: the executor
// hashes the frozen engine input, derives the workset identity (bound to that hash plus the
// job's own canonical idempotency key), gets-or-creates the workset, and only THEN constructs
// the checkpoint adapter from `{jobId, leaseId, worksetId}` — never `idempotencyKey`.
test('a durable_batched_v1 job derives its workset identity from the frozen-input hash and the job\'s own canonical idempotency key, gets-or-creates the workset, and only then constructs the checkpoint adapter from the concrete workset id', async () => {
  const callOrder = [];
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const frozenInputHash = 'f'.repeat(64);
  const derivedIdentity = Object.freeze({ opportunityId: 'opp-1', idempotencyKey: 'key-1' });

  const hashCalls = [];
  const computeFrozenInputHash = frozenEngineInput => { callOrder.push('hash'); hashCalls.push(frozenEngineInput); return frozenInputHash; };
  const deriveCalls = [];
  const deriveWorksetIdentity = input => { callOrder.push('derive'); deriveCalls.push(input); return derivedIdentity; };
  const getOrCreateCalls = [];
  const getOrCreateWorkset = async (db, identity) => { callOrder.push('getOrCreate'); getOrCreateCalls.push({ db, identity }); return { status: 'created', worksetId: 'workset-1', published: false }; };
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const adapterCalls = [];
  const createCheckpointAdapter = (...args) => { callOrder.push('adapter'); adapterCalls.push(args); return checkpointHooks; };

  const database = { kind: 'db' };
  const { executor, calls } = harness({ computeFrozenInputHash, deriveWorksetIdentity, getOrCreateWorkset, createCheckpointAdapter });
  await executor(database, durableJob);

  assert.deepEqual(
    callOrder,
    ['hash', 'derive', 'getOrCreate', 'adapter'],
    'durable execution must hash the frozen input, derive the workset identity, get-or-create the workset, and only then build the checkpoint adapter — before createRuntime',
  );
  assert.equal(hashCalls[0], durableJob.frozenEngineInput);
  assert.equal(deriveCalls.length, 1);
  assert.equal(deriveCalls[0].idempotencyKey, durableJob.idempotencyKey, 'the SAME canonical job idempotency key must reach identity derivation, never a rehashed one');
  assert.equal(deriveCalls[0].frozenEngineInputHash, frozenInputHash, 'identity derivation must use the freshly computed frozen-input hash');
  assert.equal(getOrCreateCalls.length, 1, 'a durable_batched_v1 job must get-or-create exactly one workset');
  assert.equal(getOrCreateCalls[0].db, database, 'get-or-create must run against the same database handle the executor was given');
  assert.equal(getOrCreateCalls[0].identity, derivedIdentity, 'get-or-create must receive exactly what identity derivation returned, unmodified');
  assert.equal(adapterCalls.length, 1, 'a durable_batched_v1 job must construct exactly one checkpoint adapter');
  assert.equal(adapterCalls[0][0], database, 'the adapter must be built against the same database handle the executor was given');
  assert.equal(adapterCalls[0][1].jobId, 'job-1');
  assert.equal(adapterCalls[0][1].leaseId, 'lease-1');
  assert.equal(adapterCalls[0][1].worksetId, 'workset-1', 'the adapter must be fenced by the CONCRETE workset id get-or-create returned');
  assert.equal(Object.hasOwn(adapterCalls[0][1], 'idempotencyKey'), false, 'the adapter must never be identified by idempotencyKey once a concrete workset exists');
  assert.equal(calls.runtime[0].checkpointHooks, checkpointHooks, 'the adapter hooks must reach runtime construction verbatim');
});

test('a job with no executionMode (every legacy/direct/Manizales shape today) never constructs a checkpoint adapter or touches the workset seams, and runtime construction never carries a checkpointHooks key', async () => {
  const adapterCalls = [];
  const createCheckpointAdapter = (...args) => { adapterCalls.push(args); return {}; };
  const deriveCalls = [];
  const deriveWorksetIdentity = (...args) => { deriveCalls.push(args); return {}; };
  const getOrCreateCalls = [];
  const getOrCreateWorkset = async (...args) => { getOrCreateCalls.push(args); return { status: 'created', worksetId: 'unexpected', published: false }; };
  const finalizeCalls = [];
  const finalizeDurableAnalysis = async (...args) => { finalizeCalls.push(args); return { analysisRunId: 'unexpected' }; };
  const { executor, calls } = harness({ createCheckpointAdapter, deriveWorksetIdentity, getOrCreateWorkset, finalizeDurableAnalysis });
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(adapterCalls.length, 0, 'a job with no executionMode must never construct a checkpoint adapter');
  assert.equal(deriveCalls.length, 0, 'a legacy job must never derive a workset identity');
  assert.equal(getOrCreateCalls.length, 0, 'a legacy job must never get-or-create a workset');
  assert.equal(finalizeCalls.length, 0, 'a legacy job must never call the durable finalizer');
  assert.equal(Object.hasOwn(calls.runtime[0], 'checkpointHooks'), false, 'runtime options must never carry a checkpointHooks key when no adapter was built, so byte-identical construction is preserved');
  assert.equal(Object.hasOwn(result, 'queue_finalized'), false, 'a legacy job must never carry the durable-only queue_finalized signal');
});

test('an explicit single_turn_v1 job never constructs a checkpoint adapter or touches the workset seams either', async () => {
  const adapterCalls = [];
  const createCheckpointAdapter = (...args) => { adapterCalls.push(args); return {}; };
  const deriveCalls = [];
  const deriveWorksetIdentity = (...args) => { deriveCalls.push(args); return {}; };
  const getOrCreateCalls = [];
  const getOrCreateWorkset = async (...args) => { getOrCreateCalls.push(args); return { status: 'created', worksetId: 'unexpected', published: false }; };
  const finalizeCalls = [];
  const finalizeDurableAnalysis = async (...args) => { finalizeCalls.push(args); return { analysisRunId: 'unexpected' }; };
  const singleTurnJob = { ...JOB, executionMode: 'single_turn_v1' };
  const { executor, calls } = harness({ createCheckpointAdapter, deriveWorksetIdentity, getOrCreateWorkset, finalizeDurableAnalysis });
  const result = await executor({ kind: 'db' }, singleTurnJob);
  assert.equal(adapterCalls.length, 0, 'an explicit single_turn_v1 job must never construct a checkpoint adapter');
  assert.equal(deriveCalls.length, 0);
  assert.equal(getOrCreateCalls.length, 0);
  assert.equal(finalizeCalls.length, 0);
  assert.equal(Object.hasOwn(calls.runtime[0], 'checkpointHooks'), false);
  assert.equal(Object.hasOwn(result, 'queue_finalized'), false);
});

// ---------------------------------------------------------------------------------------------
// Task 2 remediation, updated for HIGH remediation 1+2 (RED —
// docs/plans/2026-09-03-agt002-durable-batched-analysis.md): every test above injects a mocked
// `createCheckpointAdapter`, so it never exercises the real default from
// agt002-analysis-checkpoints.js. This executor is expected to call that real default with
// `{ jobId, leaseId, worksetId }` — a CONCRETE workset id resolved by an (injected, here faked)
// get-or-create step, never `idempotencyKey` directly. Per the real adapter's own contract, a
// concrete `worksetId` resolves synchronously with zero RPCs (unlike the lazy idempotencyKey
// path), so the database must stay untouched (zero RPC calls) for the whole run: nothing in
// this harness's mocked runtime/post-bridge orchestrator ever invokes a load/store checkpoint
// hook, and get-or-create itself is faked, not real, in this test.
// ---------------------------------------------------------------------------------------------

test('a durable_batched_v1 job constructs the REAL default checkpoint adapter (worksetId-based) without throwing during construction, and the database stays untouched until a hook is invoked', async () => {
  const rpcCalls = [];
  const database = {
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      throw new Error(`must never be called: no checkpoint hook is invoked in this run (got RPC ${name})`);
    },
  };
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const getOrCreateWorkset = async () => ({ status: 'created', worksetId: 'workset-1', published: false });
  // No createCheckpointAdapter override: the executor's own real default
  // (createAgt002AnalysisCheckpointAdapter from agt002-analysis-checkpoints.js) is exercised,
  // given a concrete worksetId from the (faked) get-or-create step above.
  const { executor, calls } = harness({ getOrCreateWorkset });

  const result = await executor(database, durableJob);

  assert.deepEqual(
    result,
    { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false, queue_finalized: true },
    'the real default adapter must not make this durable_batched_v1 job fail merely during construction, and a completed durable outcome must signal queue_finalized',
  );
  assert.equal(rpcCalls.length, 0, 'the real default checkpoint adapter must make zero database calls when no load/store hook is ever invoked');
  assert.equal(calls.runtime.length, 1);
  assert.equal(typeof calls.runtime[0].checkpointHooks?.loadCheckpoint, 'function', 'runtime construction must still receive real, callable checkpoint hooks');
  assert.equal(typeof calls.runtime[0].checkpointHooks?.storeCheckpoint, 'function');
});

// ---------------------------------------------------------------------------------------------
// Task 7B (RED): schema_version 2 is a new, backward-compatible frozen input shape. It must be
// accepted exactly like schema_version 1 today, and — for a durable_batched_v1 job reclaimed
// under a new leaseId/resumeCount — every identity the checkpoint adapter and the post-bridge
// call are fenced by must remain the job's own original idempotencyKey, never recomputed or
// rehashed from the reclaimed lease. Every other schema_version value must still fail closed
// before any preview claim, runtime construction, or post-bridge call, exactly like the existing
// SAFE_CONFIG_REJECTION cases above.
// ---------------------------------------------------------------------------------------------

test('a valid schema_version 2 job is accepted and reaches claim/runtime/post exactly once', async () => {
  const job = { ...JOB, frozenEngineInput: { ...JOB.frozenEngineInput, schema_version: 2 } };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, job);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false });
  assert.equal(calls.claim.length, 1);
  assert.equal(calls.runtime.length, 1);
  assert.equal(calls.post.length, 1, 'zero retry/fallback: one orchestrator call');
});

test('a reclaimed schema_version 2 durable_batched_v1 job (new leaseId, resumeCount:1) fences its workset identity derivation and post-bridge identity by the original idempotencyKey alone, while the checkpoint adapter itself carries the CURRENT leaseId', async () => {
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const adapterCalls = [];
  const createCheckpointAdapter = (...args) => { adapterCalls.push(args); return checkpointHooks; };
  const deriveCalls = [];
  const deriveWorksetIdentity = input => { deriveCalls.push(input); return { opportunityId: input.opportunityId, idempotencyKey: input.idempotencyKey }; };
  const getOrCreateWorkset = async () => ({ status: 'created', worksetId: 'workset-1', published: false });
  const reclaimedJob = {
    ...JOB,
    frozenEngineInput: { ...JOB.frozenEngineInput, schema_version: 2 },
    executionMode: 'durable_batched_v1',
    leaseId: 'lease-reclaimed-2',
    resumeCount: 1,
  };
  const { executor, calls } = harness({ createCheckpointAdapter, deriveWorksetIdentity, getOrCreateWorkset });
  const result = await executor({ kind: 'db' }, reclaimedJob);

  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false, queue_finalized: true });
  assert.equal(deriveCalls.length, 1, 'a durable_batched_v1 job must derive exactly one workset identity');
  assert.equal(deriveCalls[0].idempotencyKey, JOB.idempotencyKey, 'workset identity derivation must use the job\'s own ORIGINAL idempotency key, never recomputed for the reclaimed lease/resume');
  assert.equal(adapterCalls.length, 1, 'a durable_batched_v1 job must construct exactly one checkpoint adapter');
  assert.equal(adapterCalls[0][1].worksetId, 'workset-1', 'the adapter must be fenced by the CONCRETE workset id, resolved (via the original idempotencyKey) from the reclaimed lease');
  assert.equal(adapterCalls[0][1].leaseId, 'lease-reclaimed-2', 'checkpoint mutations must still be fenced by the CURRENT (reclaimed) lease, never the original one');

  const [, context] = calls.post[0];
  assert.equal(context.idempotencyKey, JOB.idempotencyKey);
  assert.equal(context.expectedIdempotencyKey, JOB.idempotencyKey);
  assert.equal(context.attemptKey, JOB.idempotencyKey);

  const seenIdentityKeys = new Set([deriveCalls[0].idempotencyKey, context.idempotencyKey, context.expectedIdempotencyKey, context.attemptKey]);
  assert.deepEqual([...seenIdentityKeys], [JOB.idempotencyKey], 'no alternate identity key derived from the reclaimed leaseId/resumeCount may appear anywhere in the workset identity or post-bridge identity');
});

test('rejects schema_version 0, 3, the string "2", absent, or null before any preview claim, runtime construction, or post-bridge call', async () => {
  const variants = [0, 3, '2', undefined, null];
  for (const schema_version of variants) {
    const frozenEngineInput = { ...JOB.frozenEngineInput };
    if (schema_version === undefined) delete frozenEngineInput.schema_version;
    else frozenEngineInput.schema_version = schema_version;
    const job = { ...JOB, frozenEngineInput };
    const { executor, calls } = harness();
    const result = await executor({ kind: 'db' }, job);
    assert.deepEqual(result, SAFE_CONFIG_REJECTION, `schema_version ${JSON.stringify(schema_version)} must be rejected`);
    assert.equal(calls.claim.length, 0);
    assert.equal(calls.runtime.length, 0);
    assert.equal(calls.post.length, 0);
  }
});

// Defense in depth: the governed document-workset extension (agt002-reanalysis-input.js's
// buildAgt002FrozenEngineInput / validateAgt002GovernedWorksetExtension) is only ever composed
// onto a schema_version 2 frozen input — the builder always freezes schema_version 2 whenever a
// governedWorksetExtension is supplied. A durable job whose frozen input pairs schema_version 1
// with a syntactically plausible `document_workset_identity` + `governed_workset_members` can
// never come from any real builder and must still fail closed here, before any preview claim or
// runtime construction, exactly like every other malformed/tampered frozen-input combination
// above — never merely logged and executed anyway. Legacy schema_version 1 WITHOUT the extension
// present must keep succeeding unchanged (see the pre-existing tests above using the bare JOB
// fixture, none of which are touched by this test).
test('rejects a durable job pairing schema_version 1 with a syntactically plausible governed workset extension, before any preview claim or runtime construction', async () => {
  const governedExtension = {
    document_workset_identity: {
      opportunity_id: '11111111-1111-1111-1111-111111111111',
      tender_id: '22222222-2222-2222-2222-222222222222',
      snapshot_id: '33333333-3333-3333-3333-333333333333',
      context_version_id: '44444444-4444-4444-4444-444444444444',
      selection_hash: 'a'.repeat(64),
    },
    governed_workset_members: [
      {
        document_version_id: '55555555-5555-5555-5555-555555555555',
        source_classification: 'official',
        inclusion_reason: 'required by pliego',
      },
    ],
  };
  const durableJob = {
    ...JOB,
    executionMode: 'durable_batched_v1',
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      schema_version: 1,
      ...governedExtension,
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, durableJob);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0, 'a tampered schema_version/governed-extension combination must never reach claimPreviewRun');
  assert.equal(calls.runtime.length, 0, 'a tampered schema_version/governed-extension combination must never reach createRuntime');
  assert.equal(calls.post.length, 0, 'a tampered schema_version/governed-extension combination must never reach runPostBridgeAnalysis');
});

// Focused/table-driven: the SAME syntactically valid governed workset extension the schema-
// pairing test above uses, this time correctly paired with schema_version 2 — the only shape any
// real builder (agt002-reanalysis-input.js's buildAgt002FrozenEngineInput /
// validateAgt002GovernedWorksetExtension) ever produces. The valid shape must still be accepted;
// every malformed variant below must fail closed the same way as every other malformed/tampered
// frozen-input combination above — before any preview claim or runtime construction. Defense in
// depth: the executor re-validates the governed extension's own shape, never trusting a durable
// value verbatim.
test('a schema_version 2 durable job\'s governed workset extension: the valid shape is accepted, and each malformed variant is rejected before any preview claim or runtime construction', async () => {
  // Base fixtures for the malformed-SHAPE table below only — kept as a single member so each
  // shape mutation below stays byte-identical to its pre-existing form. The scope/projection
  // table further below uses its OWN independent two-member fixtures (BASE_IDENTITY/BASE_MEMBERS)
  // so neither table can contaminate the other.
  const validExtension = Object.freeze({
    document_workset_identity: Object.freeze({
      opportunity_id: '11111111-1111-1111-1111-111111111111',
      tender_id: '22222222-2222-2222-2222-222222222222',
      snapshot_id: '33333333-3333-3333-3333-333333333333',
      context_version_id: '44444444-4444-4444-4444-444444444444',
      selection_hash: 'a'.repeat(64),
    }),
    governed_workset_members: Object.freeze([
      Object.freeze({
        document_version_id: '55555555-5555-5555-5555-555555555555',
        source_classification: 'official',
        inclusion_reason: 'required by pliego',
      }),
    ]),
  });

  function buildJob(extension) {
    return {
      ...JOB,
      executionMode: 'durable_batched_v1',
      frozenEngineInput: { ...JOB.frozenEngineInput, schema_version: 2, ...extension },
    };
  }

  const variants = [
    ['identity missing opportunity_id', ext => {
      const { opportunity_id, ...rest } = ext.document_workset_identity;
      return { ...ext, document_workset_identity: rest };
    }],
    ['identity opportunity_id is not a UUID', ext => ({
      ...ext, document_workset_identity: { ...ext.document_workset_identity, opportunity_id: 'not-a-uuid' },
    })],
    ['identity selection_hash is not 64 hex chars', ext => ({
      ...ext, document_workset_identity: { ...ext.document_workset_identity, selection_hash: 'short' },
    })],
    ['governed_workset_members is empty', ext => ({ ...ext, governed_workset_members: [] })],
    ['member missing inclusion_reason', ext => ({
      ...ext,
      governed_workset_members: [{
        document_version_id: ext.governed_workset_members[0].document_version_id,
        source_classification: ext.governed_workset_members[0].source_classification,
      }],
    })],
    ['member carries an unexpected extra key', ext => ({
      ...ext, governed_workset_members: [{ ...ext.governed_workset_members[0], extra: 'unexpected' }],
    })],
    ['member document_version_id is not a UUID', ext => ({
      ...ext, governed_workset_members: [{ ...ext.governed_workset_members[0], document_version_id: 'not-a-uuid' }],
    })],
    ['member source_classification is not an allowlisted value', ext => ({
      ...ext, governed_workset_members: [{ ...ext.governed_workset_members[0], source_classification: 'bogus' }],
    })],
    ['member inclusion_reason is blank', ext => ({
      ...ext, governed_workset_members: [{ ...ext.governed_workset_members[0], inclusion_reason: '   ' }],
    })],
  ];

  for (const [label, mutate] of variants) {
    const extension = mutate(validExtension);
    const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
    const result = await executor({ kind: 'db' }, buildJob(extension));
    assert.deepEqual(result, SAFE_CONFIG_REJECTION, `${label} must be rejected`);
    assert.equal(calls.claim.length, 0, `${label} must never reach claimPreviewRun`);
    assert.equal(calls.runtime.length, 0, `${label} must never reach createRuntime`);
  }
});

// RED: the governed workset extension is not merely a syntactically-valid identity/member
// shape (covered above) — it must also be SCOPE-CONSISTENT with the job it rides on (the
// document_workset_identity is the frozen claim of what the analysis is FOR; a durable job whose
// own opportunityId/tenderId/snapshotId/contextVersionId disagree with that claim, even by one
// field, can never be trusted) and the analysis_context.documents the engine actually reads must
// be an EXACT deep projection — same members, same fields, same order — of governed_workset_members,
// never a superset, subset, reordering or per-field divergence. None of this is validated by
// validFrozenInput or validateAgt002GovernedWorksetExtension today: every case below is expected
// to fail (RED) until that scope/projection check is added.
test('a schema_version 2 durable job\'s governed workset extension: the valid shape is scope-consistent with the job, and each scope/projection violation is rejected before any preview claim, runtime construction or post-bridge call', async () => {
  const BASE_OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
  const BASE_TENDER_ID = '22222222-2222-2222-2222-222222222222';
  const MEMBER_A = Object.freeze({
    document_version_id: '55555555-5555-5555-5555-555555555555',
    source_classification: 'official',
    inclusion_reason: 'required by pliego',
    content_hash: 'a'.repeat(64),
    extraction_id: 'aaaaaaaa-1111-1111-1111-111111111111',
    extraction_text_hash: 'b'.repeat(64),
  });
  const MEMBER_B = Object.freeze({
    document_version_id: '66666666-6666-6666-6666-666666666666',
    source_classification: 'corporate',
    inclusion_reason: 'supporting annex',
    content_hash: 'c'.repeat(64),
    extraction_id: 'bbbbbbbb-2222-2222-2222-222222222222',
    extraction_text_hash: 'd'.repeat(64),
  });
  const BASE_MEMBERS = Object.freeze([MEMBER_A, MEMBER_B]); // canonically ordered: 55… < 66…
  // The real executor recomputes the selection hash from the six-field members and requires an
  // exact match against document_workset_identity.selection_hash, so this fixture (unlike the
  // malformed-shape table above, which only expects rejection) must carry the actual computed
  // hash for its valid/scope-consistent base case to be accepted.
  const BASE_IDENTITY = Object.freeze({
    opportunity_id: BASE_OPPORTUNITY_ID,
    tender_id: BASE_TENDER_ID,
    snapshot_id: '33333333-3333-3333-3333-333333333333',
    context_version_id: '44444444-4444-4444-4444-444444444444',
    selection_hash: computeAgt002WorksetSelectionHash({ opportunityId: BASE_OPPORTUNITY_ID, tenderId: BASE_TENDER_ID, members: BASE_MEMBERS }),
  });
  const BASE_EXTENSION = Object.freeze({ document_workset_identity: BASE_IDENTITY, governed_workset_members: BASE_MEMBERS });

  function projectDocuments(members) {
    return members.map(({ document_version_id, source_classification, inclusion_reason }) => (
      { document_version_id, source_classification, inclusion_reason }
    ));
  }

  function buildJob({
    extension = BASE_EXTENSION,
    opportunityId = BASE_IDENTITY.opportunity_id,
    tenderId = BASE_IDENTITY.tender_id,
    snapshotId = BASE_IDENTITY.snapshot_id,
    contextVersionId = BASE_IDENTITY.context_version_id,
    documents = projectDocuments(BASE_MEMBERS),
  } = {}) {
    // The job's own idempotency key and its frozen engine identity's idempotency_key must both be
    // the SAME server-computed key (computeAgt002GovernedWorksetIdempotencyKey) a real governed-
    // workset freeze would have produced for this job scope + selection_hash — never an arbitrary
    // literal — so this valid base job stays valid regardless of any selection-hash/idempotency
    // consistency check the executor may enforce.
    const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
      opportunityId, tenderId, snapshotId, contextVersionId, selectionHash: BASE_IDENTITY.selection_hash,
    });
    return {
      ...JOB,
      opportunityId,
      tenderId,
      snapshotId,
      contextVersionId,
      idempotencyKey,
      executionMode: 'durable_batched_v1',
      frozenEngineInput: {
        ...JOB.frozenEngineInput,
        schema_version: 2,
        engine_identity: { ...JOB.frozenEngineInput.engine_identity, idempotency_key: idempotencyKey },
        analysis_context: {
          ...JOB.frozenEngineInput.analysis_context,
          opportunity: { id: opportunityId },
          snapshotId,
          documents,
        },
        ...extension,
      },
    };
  }

  {
    const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
    const result = await executor({ kind: 'db' }, buildJob());
    assert.deepEqual(
      result,
      { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false, queue_finalized: true },
      'a governed extension whose identity exactly matches the job scope, with a canonically ordered exact documents projection, must be accepted',
    );
    assert.equal(calls.claim.length, 1, 'the scope-consistent valid path must claim exactly once');
    assert.equal(calls.runtime.length, 1, 'the scope-consistent valid path must reach runtime construction exactly once');
    assert.equal(calls.post.length, 1, 'the scope-consistent valid path must complete exactly once');
  }

  const variants = [
    ['document_workset_identity.opportunity_id is a valid UUID but differs from job.opportunityId', () => ({
      extension: {
        ...BASE_EXTENSION,
        document_workset_identity: { ...BASE_IDENTITY, opportunity_id: '77777777-7777-7777-7777-777777777777' },
      },
    })],
    ['document_workset_identity.tender_id differs from job.tenderId', () => ({
      extension: {
        ...BASE_EXTENSION,
        document_workset_identity: { ...BASE_IDENTITY, tender_id: '88888888-8888-8888-8888-888888888888' },
      },
    })],
    ['document_workset_identity.snapshot_id differs from job.snapshotId', () => ({
      extension: {
        ...BASE_EXTENSION,
        document_workset_identity: { ...BASE_IDENTITY, snapshot_id: '99999999-9999-9999-9999-999999999999' },
      },
    })],
    ['document_workset_identity.context_version_id differs from job.contextVersionId', () => ({
      extension: {
        ...BASE_EXTENSION,
        document_workset_identity: { ...BASE_IDENTITY, context_version_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      },
    })],
    ['analysis_context.documents carries an extra, unselected, valid-looking document', () => ({
      documents: [
        ...projectDocuments(BASE_MEMBERS),
        { document_version_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', source_classification: 'draft', inclusion_reason: 'not actually selected' },
      ],
    })],
    ['analysis_context.documents omits a selected governed member', () => ({
      documents: [projectDocuments(BASE_MEMBERS)[0]],
    })],
    ['analysis_context.documents order is reversed relative to governed_workset_members', () => ({
      documents: [...projectDocuments(BASE_MEMBERS)].reverse(),
    })],
    ['an analysis_context.documents member diverges from its governed_workset_members projection (source_classification)', () => {
      const documents = projectDocuments(BASE_MEMBERS);
      documents[0] = { ...documents[0], source_classification: 'draft' };
      return { documents };
    }],
    ['governed_workset_members contains a duplicate document_version_id', () => {
      const duplicateMembers = [MEMBER_A, { ...MEMBER_B, document_version_id: MEMBER_A.document_version_id }];
      return {
        extension: { ...BASE_EXTENSION, governed_workset_members: duplicateMembers },
        documents: projectDocuments(duplicateMembers),
      };
    }],
    ['a governed_workset_members inclusion_reason is 501 characters', () => {
      const members = [{ ...MEMBER_A, inclusion_reason: 'x'.repeat(501) }, MEMBER_B];
      return {
        extension: { ...BASE_EXTENSION, governed_workset_members: members },
        documents: projectDocuments(members),
      };
    }],
  ];

  for (const [label, makeOverrides] of variants) {
    const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
    const result = await executor({ kind: 'db' }, buildJob(makeOverrides()));
    assert.deepEqual(result, SAFE_CONFIG_REJECTION, `${label} must be rejected`);
    assert.equal(calls.claim.length, 0, `${label} must never reach claimPreviewRun`);
    assert.equal(calls.runtime.length, 0, `${label} must never reach createRuntime`);
    assert.equal(calls.post.length, 0, `${label} must never reach runPostBridgeAnalysis`);
  }
});

// RED: a governed workset extension's document_workset_identity.selection_hash is not merely a
// syntactically-well-formed 64-hex string (already covered above) — it is part of the very
// identity computeAgt002GovernedWorksetIdempotencyKey binds into the job's own idempotencyKey (and
// the frozen engine_identity.idempotency_key mirroring it) at freeze time. A durable job whose
// selection_hash was altered afterward — while its opportunity/tender/snapshot/context scope,
// governed_workset_members and analysis_context.documents projection all stay otherwise valid —
// can never come from any real builder (the idempotency key would no longer match) and must still
// fail closed here, before any preview claim, runtime construction or post-bridge call, exactly
// like every other tampered frozen-input combination above. None of this is validated by
// validFrozenInput today: this case is expected to fail (RED) until that selection-hash/identity
// consistency check is added.
test('a schema_version 2 durable job whose document_workset_identity.selection_hash was altered after freezing (scope, members and documents otherwise valid) is rejected, before any preview claim, runtime construction or post-bridge call', async () => {
  const IDENTITY = Object.freeze({
    opportunity_id: '11111111-1111-1111-1111-111111111111',
    tender_id: '22222222-2222-2222-2222-222222222222',
    snapshot_id: '33333333-3333-3333-3333-333333333333',
    context_version_id: '44444444-4444-4444-4444-444444444444',
    selection_hash: 'a'.repeat(64),
  });
  const MEMBER = Object.freeze({
    document_version_id: '55555555-5555-5555-5555-555555555555',
    source_classification: 'official',
    inclusion_reason: 'required by pliego',
  });
  // The job's own idempotencyKey/engine_identity.idempotency_key are the SAME server-computed key
  // a real freeze would have produced for the ORIGINAL selection_hash — never recomputed for the
  // tampered one below.
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: IDENTITY.opportunity_id,
    tenderId: IDENTITY.tender_id,
    snapshotId: IDENTITY.snapshot_id,
    contextVersionId: IDENTITY.context_version_id,
    selectionHash: IDENTITY.selection_hash,
  });
  const tamperedIdentity = { ...IDENTITY, selection_hash: 'b'.repeat(64) };
  const durableJob = {
    ...JOB,
    opportunityId: IDENTITY.opportunity_id,
    tenderId: IDENTITY.tender_id,
    snapshotId: IDENTITY.snapshot_id,
    contextVersionId: IDENTITY.context_version_id,
    idempotencyKey,
    executionMode: 'durable_batched_v1',
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      schema_version: 2,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, idempotency_key: idempotencyKey },
      analysis_context: {
        ...JOB.frozenEngineInput.analysis_context,
        opportunity: { id: IDENTITY.opportunity_id },
        snapshotId: IDENTITY.snapshot_id,
        documents: [MEMBER],
      },
      document_workset_identity: tamperedIdentity,
      governed_workset_members: [MEMBER],
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, durableJob);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0, 'an altered selection_hash must never reach claimPreviewRun');
  assert.equal(calls.runtime.length, 0, 'an altered selection_hash must never reach createRuntime');
  assert.equal(calls.post.length, 0, 'an altered selection_hash must never reach runPostBridgeAnalysis');
});

// RED: governed_workset_members and analysis_context.documents jointly reordered stay a valid
// EXACT projection of each other (same members, same fields, same order relative to one another —
// already covered above), but a real freeze always orders governed_workset_members by ascending
// lexical lowercase document_version_id, and that canonical order is itself part of the frozen
// identity. A durable job whose members/documents are jointly reordered OUTSIDE that canonical
// order can never come from any real builder and must still fail closed here, before any preview
// claim, runtime construction or post-bridge call. None of this is validated by validFrozenInput
// today: this case is expected to fail (RED) until that canonical-order check is added.
test('a schema_version 2 durable job whose governed_workset_members and analysis_context.documents are jointly reordered outside ascending lexical lowercase document_version_id canonical order is rejected, before any preview claim, runtime construction or post-bridge call', async () => {
  const IDENTITY = Object.freeze({
    opportunity_id: '11111111-1111-1111-1111-111111111111',
    tender_id: '22222222-2222-2222-2222-222222222222',
    snapshot_id: '33333333-3333-3333-3333-333333333333',
    context_version_id: '44444444-4444-4444-4444-444444444444',
    selection_hash: 'a'.repeat(64),
  });
  const MEMBER_A = Object.freeze({
    document_version_id: '55555555-5555-5555-5555-555555555555',
    source_classification: 'official',
    inclusion_reason: 'required by pliego',
  });
  const MEMBER_B = Object.freeze({
    document_version_id: '66666666-6666-6666-6666-666666666666',
    source_classification: 'corporate',
    inclusion_reason: 'supporting annex',
  });
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: IDENTITY.opportunity_id,
    tenderId: IDENTITY.tender_id,
    snapshotId: IDENTITY.snapshot_id,
    contextVersionId: IDENTITY.context_version_id,
    selectionHash: IDENTITY.selection_hash,
  });
  function projectDocument({ document_version_id, source_classification, inclusion_reason }) {
    return { document_version_id, source_classification, inclusion_reason };
  }
  // 66… sorts after 55… in ascending lexical lowercase order, so [B, A] is a joint reordering
  // outside canonical order even though members and documents stay in lockstep with each other.
  const reorderedMembers = [MEMBER_B, MEMBER_A];
  const durableJob = {
    ...JOB,
    opportunityId: IDENTITY.opportunity_id,
    tenderId: IDENTITY.tender_id,
    snapshotId: IDENTITY.snapshot_id,
    contextVersionId: IDENTITY.context_version_id,
    idempotencyKey,
    executionMode: 'durable_batched_v1',
    frozenEngineInput: {
      ...JOB.frozenEngineInput,
      schema_version: 2,
      engine_identity: { ...JOB.frozenEngineInput.engine_identity, idempotency_key: idempotencyKey },
      analysis_context: {
        ...JOB.frozenEngineInput.analysis_context,
        opportunity: { id: IDENTITY.opportunity_id },
        snapshotId: IDENTITY.snapshot_id,
        documents: reorderedMembers.map(projectDocument),
      },
      document_workset_identity: IDENTITY,
      governed_workset_members: reorderedMembers,
    },
  };
  const { executor, calls } = harness();
  const result = await executor({ kind: 'db' }, durableJob);
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0, 'a canonical-order violation must never reach claimPreviewRun');
  assert.equal(calls.runtime.length, 0, 'a canonical-order violation must never reach createRuntime');
  assert.equal(calls.post.length, 0, 'a canonical-order violation must never reach runPostBridgeAnalysis');
});

// Security remediation: a governed extension's inclusion_reason mutated identically in BOTH
// governed_workset_members and analysis_context.documents stays an internally-consistent exact
// projection of itself, but no longer matches the content the ORIGINAL selection_hash/idempotency
// key were computed over. Retaining the original selection_hash/idempotency key while tampering
// the member content this way can never come from any real freeze and must fail closed here,
// before any preview claim, runtime construction or post-bridge call.
test('mutating inclusion_reason in both governed_workset_members and analysis_context.documents while keeping the original selection_hash/idempotency key fails closed before any claim/runtime/post', async () => {
  const GOV_OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
  const GOV_TENDER_ID = '22222222-2222-2222-2222-222222222222';
  const GOV_SNAPSHOT_ID = '33333333-3333-3333-3333-333333333333';
  const GOV_CONTEXT_VERSION_ID = '44444444-4444-4444-4444-444444444444';
  const GOV_DOCUMENT_VERSION_ID = '55555555-5555-5555-5555-555555555555';
  const GOV_EXTRACTION_ID = '66666666-6666-6666-6666-666666666666';

  const evidenceRow = {
    document_version_id: GOV_DOCUMENT_VERSION_ID,
    opportunity_id: GOV_OPPORTUNITY_ID,
    tender_id: GOV_TENDER_ID,
    current: true,
    extraction_status: 'ok',
    content_hash: 'c'.repeat(64),
    extraction_id: GOV_EXTRACTION_ID,
    extraction_text_hash: 'd'.repeat(64),
  };
  const requestedMember = {
    document_version_id: GOV_DOCUMENT_VERSION_ID,
    source_classification: 'official',
    inclusion_reason: 'required by pliego',
  };
  // A real, fully consistent full member (all six evidence fields) built the same way a real
  // freeze builds one — never a hand-rolled/partial shape.
  const frozen = freezeAgt002WorksetEvidence({
    opportunityId: GOV_OPPORTUNITY_ID, tenderId: GOV_TENDER_ID, requestedMembers: [requestedMember], evidenceRows: [evidenceRow],
  });
  const documents = [{ document_version_id: GOV_DOCUMENT_VERSION_ID, source_classification: 'official', inclusion_reason: 'required by pliego' }];
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: GOV_OPPORTUNITY_ID, tenderId: GOV_TENDER_ID, snapshotId: GOV_SNAPSHOT_ID, contextVersionId: GOV_CONTEXT_VERSION_ID, selectionHash: frozen.selectionHash,
  });

  function buildGovernedJob({ members, documents: jobDocuments }) {
    return {
      ...JOB,
      opportunityId: GOV_OPPORTUNITY_ID,
      tenderId: GOV_TENDER_ID,
      snapshotId: GOV_SNAPSHOT_ID,
      contextVersionId: GOV_CONTEXT_VERSION_ID,
      idempotencyKey,
      executionMode: 'durable_batched_v1',
      frozenEngineInput: {
        ...JOB.frozenEngineInput,
        schema_version: 2,
        engine_identity: { ...JOB.frozenEngineInput.engine_identity, idempotency_key: idempotencyKey },
        analysis_context: {
          ...JOB.frozenEngineInput.analysis_context,
          opportunity: { id: GOV_OPPORTUNITY_ID },
          snapshotId: GOV_SNAPSHOT_ID,
          documents: jobDocuments,
        },
        document_workset_identity: {
          opportunity_id: GOV_OPPORTUNITY_ID, tender_id: GOV_TENDER_ID, snapshot_id: GOV_SNAPSHOT_ID,
          context_version_id: GOV_CONTEXT_VERSION_ID, selection_hash: frozen.selectionHash,
        },
        governed_workset_members: members,
      },
    };
  }

  // Sanity: the untampered valid job reaches claim/runtime/post exactly once.
  {
    const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
    const result = await executor({ kind: 'db' }, buildGovernedJob({ members: frozen.members, documents }));
    assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-1', error_code: null, reused: false, queue_finalized: true });
    assert.equal(calls.claim.length, 1);
    assert.equal(calls.runtime.length, 1);
    assert.equal(calls.post.length, 1);
  }

  const tamperedReason = 'tampered inclusion reason, never part of the original freeze';
  const tamperedMembers = frozen.members.map((m) => ({ ...m, inclusion_reason: tamperedReason }));
  const tamperedDocuments = documents.map((d) => ({ ...d, inclusion_reason: tamperedReason }));
  const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
  const result = await executor({ kind: 'db' }, buildGovernedJob({ members: tamperedMembers, documents: tamperedDocuments }));

  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false });
  assert.equal(calls.claim.length, 0, 'a tampered inclusion_reason under the original selection_hash/idempotency key must never reach claimPreviewRun');
  assert.equal(calls.runtime.length, 0, 'a tampered inclusion_reason under the original selection_hash/idempotency key must never reach createRuntime');
  assert.equal(calls.post.length, 0, 'a tampered inclusion_reason under the original selection_hash/idempotency key must never reach runPostBridgeAnalysis');
});

// Security remediation: a governed extension's engine_identity.idempotency_key is REQUIRED (never
// merely present-if-supplied like the legacy schema_version 1/2 idempotency check) — an absent or
// explicitly null idempotency_key must fail closed before any preview claim, runtime construction
// or post-bridge call, even though every other field of the extension is otherwise valid.
test('a governed schema_version 2 job with engine_identity.idempotency_key absent or null fails closed before any claim/runtime/post', async () => {
  const GOV_OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
  const GOV_TENDER_ID = '22222222-2222-2222-2222-222222222222';
  const GOV_SNAPSHOT_ID = '33333333-3333-3333-3333-333333333333';
  const GOV_CONTEXT_VERSION_ID = '44444444-4444-4444-4444-444444444444';
  const GOV_DOCUMENT_VERSION_ID = '55555555-5555-5555-5555-555555555555';
  const GOV_EXTRACTION_ID = '66666666-6666-6666-6666-666666666666';

  const evidenceRow = {
    document_version_id: GOV_DOCUMENT_VERSION_ID,
    opportunity_id: GOV_OPPORTUNITY_ID,
    tender_id: GOV_TENDER_ID,
    current: true,
    extraction_status: 'ok',
    content_hash: 'c'.repeat(64),
    extraction_id: GOV_EXTRACTION_ID,
    extraction_text_hash: 'd'.repeat(64),
  };
  const requestedMember = {
    document_version_id: GOV_DOCUMENT_VERSION_ID,
    source_classification: 'official',
    inclusion_reason: 'required by pliego',
  };
  const frozen = freezeAgt002WorksetEvidence({
    opportunityId: GOV_OPPORTUNITY_ID, tenderId: GOV_TENDER_ID, requestedMembers: [requestedMember], evidenceRows: [evidenceRow],
  });
  const documents = [{ document_version_id: GOV_DOCUMENT_VERSION_ID, source_classification: 'official', inclusion_reason: 'required by pliego' }];
  const idempotencyKey = computeAgt002GovernedWorksetIdempotencyKey({
    opportunityId: GOV_OPPORTUNITY_ID, tenderId: GOV_TENDER_ID, snapshotId: GOV_SNAPSHOT_ID, contextVersionId: GOV_CONTEXT_VERSION_ID, selectionHash: frozen.selectionHash,
  });

  for (const idempotencyKeyValue of [undefined, null]) {
    const engineIdentity = { ...JOB.frozenEngineInput.engine_identity };
    if (idempotencyKeyValue === undefined) delete engineIdentity.idempotency_key;
    else engineIdentity.idempotency_key = idempotencyKeyValue;

    const durableJob = {
      ...JOB,
      opportunityId: GOV_OPPORTUNITY_ID,
      tenderId: GOV_TENDER_ID,
      snapshotId: GOV_SNAPSHOT_ID,
      contextVersionId: GOV_CONTEXT_VERSION_ID,
      idempotencyKey,
      executionMode: 'durable_batched_v1',
      frozenEngineInput: {
        ...JOB.frozenEngineInput,
        schema_version: 2,
        engine_identity: engineIdentity,
        analysis_context: {
          ...JOB.frozenEngineInput.analysis_context,
          opportunity: { id: GOV_OPPORTUNITY_ID },
          snapshotId: GOV_SNAPSHOT_ID,
          documents,
        },
        document_workset_identity: {
          opportunity_id: GOV_OPPORTUNITY_ID, tender_id: GOV_TENDER_ID, snapshot_id: GOV_SNAPSHOT_ID,
          context_version_id: GOV_CONTEXT_VERSION_ID, selection_hash: frozen.selectionHash,
        },
        governed_workset_members: frozen.members,
      },
    };
    const { executor, calls } = harness({ getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }) });
    const result = await executor({ kind: 'db' }, durableJob);
    assert.deepEqual(
      result,
      { status: 'unavailable', analysis_run_id: null, error_code: 'invalid_output', reused: false },
      `engine_identity.idempotency_key ${JSON.stringify(idempotencyKeyValue)} must be rejected`,
    );
    assert.equal(calls.claim.length, 0, `idempotency_key ${JSON.stringify(idempotencyKeyValue)} must never reach claimPreviewRun`);
    assert.equal(calls.runtime.length, 0, `idempotency_key ${JSON.stringify(idempotencyKeyValue)} must never reach createRuntime`);
    assert.equal(calls.post.length, 0, `idempotency_key ${JSON.stringify(idempotencyKeyValue)} must never reach runPostBridgeAnalysis`);
  }
});

// ---------------------------------------------------------------------------------------------
// HIGH remediation 1+2 (RED — docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "8. Final
// envelope and publication"): the durable_batched_v1 executor must supply runPostBridgeAnalysis
// with a `persistAnalysis` function that routes the canonical persistence RPC through the single
// atomic finalizeDurableAnalysis call (finalizeAgt002DurableBatchedAnalysis /
// psi_finalize_agt002_durable_batched_analysis) instead of letting registerPreviewAnalysis reach
// the legacy standalone canonical-run RPC against the base database — and a completed durable
// outcome must expose `queue_finalized: true` so the worker can skip its own legacy complete RPC.
// ---------------------------------------------------------------------------------------------

test('a durable_batched_v1 job supplies a persistAnalysis function to runPostBridgeAnalysis that routes the canonical persistence RPC through finalizeDurableAnalysis instead of the base database, and marks the completed outcome queue_finalized', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const worksetId = 'workset-1';
  const baseRpcCalls = [];
  const database = {
    async rpc(name, params) {
      baseRpcCalls.push({ name, params });
      throw new Error(`legacy canonical RPC must never reach the base database (got ${name})`);
    },
  };

  const finalizeCalls = [];
  const finalizeDurableAnalysis = async (db, params) => {
    finalizeCalls.push({ db, params });
    return { analysisRunId: 'run-durable-1', worksetId: params.worksetId, jobId: params.jobId };
  };

  const registerCalls = [];
  // A realistic stand-in for agt002-preview-persistence.js's registerAgt002PreviewAnalysis: it
  // performs the normal canonical-run RPC through whatever database it is handed, exactly the
  // real RPC name and p_* param shape agt002-preview-persistence.js uses.
  const registerPreviewAnalysis = async (db, params) => {
    registerCalls.push({ db, params });
    const { data, error } = await db.rpc('psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: params.snapshot_id,
      p_opportunity_id: params.opportunity_id,
      p_tender_id: params.tender_id,
      p_result: params.envelope,
      p_critical_open_count: 2,
      p_idempotency_key: durableJob.idempotencyKey,
      p_schema_version: params.envelope.schema_version,
      p_policy_version: params.envelope.policy_version,
      p_model: params.envelope.usage.model,
      p_usage: params.envelope.usage,
      p_context_version_id: params.context_version_id,
    });
    if (error) throw error;
    return { run_id: data.id, snapshot_id: data.snapshot_id, canonical: data.canonical === true };
  };

  const envelope = { schema_version: 3, policy_version: 'policy-1', usage: { model: 'model-1', input_tokens: 10, output_tokens: 5 } };
  const runPostBridgeAnalysis = async (db, context, deps) => {
    assert.equal(typeof deps.persistAnalysis, 'function', 'the durable path must supply a persistAnalysis function to runPostBridgeAnalysis');
    const registered = await deps.persistAnalysis(db, {
      opportunity_id: context.opportunityId,
      tender_id: context.tenderId,
      snapshot_id: context.snapshotId,
      envelope,
      canonicalOnly: true,
      context_version_id: context.contextVersionId,
    });
    return { status: 'completed', analysis_run_id: registered.run_id, error_code: null };
  };

  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const { executor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId, published: false }),
    finalizeDurableAnalysis,
    registerPreviewAnalysis,
    runPostBridgeAnalysis,
  });

  const result = await executor(database, durableJob);

  assert.equal(baseRpcCalls.length, 0, 'the legacy canonical-run RPC must never be sent to the base database');
  assert.equal(registerCalls.length, 1, 'the injected registerPreviewAnalysis must still be invoked exactly once');
  assert.equal(finalizeCalls.length, 1, 'the canonical RPC must be intercepted and replaced by exactly one finalizeDurableAnalysis call');
  assert.notEqual(registerCalls[0].params, database, 'registerPreviewAnalysis must receive the persistence params/envelope, not the database object, as its second argument');
  assert.equal(registerCalls[0].params.envelope, envelope, 'registerPreviewAnalysis must receive the actual persistence params/envelope as its second argument');
  const finalized = finalizeCalls[0].params;
  assert.equal(finalized.jobId, 'job-1');
  assert.equal(finalized.leaseId, 'lease-1');
  assert.equal(finalized.worksetId, worksetId);
  assert.equal(finalized.snapshotId, JOB.snapshotId, 'finalize must receive fields mapped from the canonical RPC params');
  assert.equal(finalized.opportunityId, JOB.opportunityId);
  assert.equal(finalized.tenderId, JOB.tenderId);
  assert.deepEqual(finalized.result, envelope, 'the finalize call must carry the same content the canonical RPC would have persisted');
  assert.equal(finalized.criticalOpenCount, 2);
  assert.equal(finalized.idempotencyKey, durableJob.idempotencyKey);
  assert.equal(finalized.schemaVersion, envelope.schema_version);
  assert.equal(finalized.policyVersion, envelope.policy_version);
  assert.equal(finalized.model, envelope.usage.model);
  assert.deepEqual(finalized.usage, envelope.usage);
  assert.equal(finalized.contextVersionId, JOB.contextVersionId);

  assert.deepEqual(
    result,
    { status: 'completed', analysis_run_id: 'run-durable-1', error_code: null, reused: false, queue_finalized: true },
    'a completed durable outcome must expose queue_finalized so the worker can skip the legacy complete RPC',
  );
});

test('a completed durable_batched_v1 outcome exposes queue_finalized: true; a completed legacy/single_turn outcome never carries that key', async () => {
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const { executor: durableExecutor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId: 'workset-1', published: false }),
  });
  const durableResult = await durableExecutor({ kind: 'db' }, { ...JOB, executionMode: 'durable_batched_v1' });
  assert.equal(durableResult.status, 'completed');
  assert.equal(durableResult.queue_finalized, true, 'a completed durable_batched_v1 job must signal the worker so it can skip the legacy complete RPC');

  const { executor: legacyExecutor } = harness();
  const legacyResult = await legacyExecutor({ kind: 'db' }, JOB);
  assert.equal(legacyResult.status, 'completed');
  assert.equal(Object.hasOwn(legacyResult, 'queue_finalized'), false, 'a legacy/single_turn job must never carry queue_finalized — the worker still owns its own completion RPC for it');
});

// ---------------------------------------------------------------------------------------------
// HIGH remediation 1+2, fail-closed coverage (RED): a malformed get-or-create-workset response
// or a malformed finalizeDurableAnalysis response must never be trusted verbatim. Both must fail
// closed as `persistence_failure`, and neither may ever let a canonical RPC reach legacy
// persistence on the base database.
// ---------------------------------------------------------------------------------------------

test('a malformed get-or-create-workset response fails closed as persistence_failure before any checkpoint adapter, runtime, or post-bridge call, and never touches legacy persistence', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const baseRpcCalls = [];
  const database = { async rpc(name, params) { baseRpcCalls.push({ name, params }); throw new Error(`must never be called (got ${name})`); } };
  const adapterCalls = [];
  const createCheckpointAdapter = (...args) => { adapterCalls.push(args); return {}; };
  // Malformed: missing worksetId entirely.
  const getOrCreateWorkset = async () => ({ status: 'created', published: false });

  const { executor, calls } = harness({ createCheckpointAdapter, getOrCreateWorkset });
  const result = await executor(database, durableJob);

  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'persistence_failure', reused: false });
  assert.equal(adapterCalls.length, 0, 'a malformed workset response must never reach checkpoint adapter construction');
  assert.equal(calls.runtime.length, 0);
  assert.equal(calls.post.length, 0);
  assert.equal(baseRpcCalls.length, 0, 'a malformed workset response must never fall through to legacy persistence');
  assert.equal(calls.claim.length, 1, 'the preview lease was already claimed and must still be released');
  assert.equal(calls.release.length, 1);
});

test('a malformed finalizeDurableAnalysis response fails closed as persistence_failure and never falls through to the legacy canonical RPC on the base database', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const worksetId = 'workset-1';
  const baseRpcCalls = [];
  const database = { async rpc(name, params) { baseRpcCalls.push({ name, params }); throw new Error(`must never be called (got ${name})`); } };

  // Malformed: missing analysisRunId entirely.
  const finalizeCalls = [];
  const finalizeDurableAnalysis = async (db, params) => { finalizeCalls.push(params); return { worksetId: params.worksetId, jobId: params.jobId }; };

  const registerCalls = [];
  const registerPreviewAnalysis = async (db, params) => {
    registerCalls.push(params);
    const { data, error } = await db.rpc('psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: params.snapshot_id, p_opportunity_id: params.opportunity_id, p_tender_id: params.tender_id,
      p_result: params.envelope, p_critical_open_count: 0, p_idempotency_key: durableJob.idempotencyKey,
      p_schema_version: params.envelope.schema_version, p_policy_version: params.envelope.policy_version,
      p_model: params.envelope.usage.model, p_usage: params.envelope.usage, p_context_version_id: params.context_version_id,
    });
    if (error) throw error;
    return { run_id: data.id };
  };

  const envelope = { schema_version: 3, policy_version: 'policy-1', usage: { model: 'model-1' } };
  const runPostBridgeAnalysis = async (db, context, deps) => {
    try {
      await deps.persistAnalysis(db, {
        opportunity_id: context.opportunityId, tender_id: context.tenderId, snapshot_id: context.snapshotId,
        envelope, canonicalOnly: true, context_version_id: context.contextVersionId,
      });
      return { status: 'completed', analysis_run_id: 'should-not-happen', error_code: null };
    } catch {
      return { status: 'unavailable', analysis_run_id: null, error_code: AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED };
    }
  };

  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const { executor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId, published: false }),
    finalizeDurableAnalysis,
    registerPreviewAnalysis,
    runPostBridgeAnalysis,
  });

  const result = await executor(database, durableJob);

  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'persistence_failure', reused: false });
  assert.equal(finalizeCalls.length, 1);
  assert.equal(registerCalls.length, 1);
  assert.equal(baseRpcCalls.length, 0, 'the legacy canonical RPC must never reach the base database even when finalize itself fails');
  assert.equal(Object.hasOwn(result, 'queue_finalized'), false, 'a failed durable run must never claim queue_finalized');
});

// ---------------------------------------------------------------------------------------------
// Final-persistence queue-lease blocker (RED, test-only): the durable_batched_v1 path's
// `persistAnalysis` (createAgt002DurablePersistAnalysis) routes every canonical persistence RPC
// through the single atomic finalizeDurableAnalysis call, but today it does so with no regard for
// the OUTER queue job lease at all — only the inner preview claim is renewed, by
// runAgt002PostBridgeAnalysis's own `leaseSeconds` fencing. A bounded persistence retry (a
// transient finalize failure re-attempted from runAgt002PostBridgeAnalysis's own retry loop) can
// therefore re-attempt the atomic finalize write after the queue's own job lease has already
// expired and been reclaimed by another worker — a second, concurrent finalize on the same
// worksetId/jobId. Every durable final-persistence attempt must renew the OUTER queue lease
// (the executor's own `beforeProviderCall: jobLeaseHeartbeat` seam, fenced by job.jobId +
// job.leaseId — see agt002-reanalysis-worker.js) immediately before its atomic finalize write,
// and a lost queue lease must abort before that write ever happens.
// ---------------------------------------------------------------------------------------------

test('every durable final-persistence attempt renews the OUTER queue lease immediately before its atomic finalize write', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const worksetId = 'workset-1';
  const callOrder = [];
  const heartbeatCalls = [];
  const jobLeaseHeartbeat = async (...args) => { callOrder.push('job-heartbeat'); heartbeatCalls.push(args); };

  const finalizeDurableAnalysis = async (db, params) => {
    callOrder.push('finalize');
    return { analysisRunId: 'run-durable-1', worksetId: params.worksetId, jobId: params.jobId };
  };

  // A realistic stand-in for agt002-preview-persistence.js's registerAgt002PreviewAnalysis (same
  // shape as the other durable persistAnalysis tests above).
  const registerPreviewAnalysis = async (db, params) => {
    const { data, error } = await db.rpc('psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: params.snapshot_id,
      p_opportunity_id: params.opportunity_id,
      p_tender_id: params.tender_id,
      p_result: params.envelope,
      p_critical_open_count: 2,
      p_idempotency_key: durableJob.idempotencyKey,
      p_schema_version: params.envelope.schema_version,
      p_policy_version: params.envelope.policy_version,
      p_model: params.envelope.usage.model,
      p_usage: params.envelope.usage,
      p_context_version_id: params.context_version_id,
    });
    if (error) throw error;
    return { run_id: data.id };
  };

  const envelope = { schema_version: 3, policy_version: 'policy-1', usage: { model: 'model-1' } };
  // Representing a transient retry: runPostBridgeAnalysis hands the SAME valid persistence params
  // to `deps.persistAnalysis` twice.
  const runPostBridgeAnalysis = async (db, context, deps) => {
    const persistenceParams = {
      opportunity_id: context.opportunityId, tender_id: context.tenderId, snapshot_id: context.snapshotId,
      envelope, canonicalOnly: true, context_version_id: context.contextVersionId,
    };
    await deps.persistAnalysis(db, persistenceParams);
    const registered = await deps.persistAnalysis(db, persistenceParams);
    return { status: 'completed', analysis_run_id: registered.run_id, error_code: null };
  };

  const database = { async rpc(name) { throw new Error(`legacy canonical RPC must never reach the base database (got ${name})`); } };
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const { executor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId, published: false }),
    finalizeDurableAnalysis,
    registerPreviewAnalysis,
    runPostBridgeAnalysis,
  });

  const result = await executor(database, durableJob, { beforeProviderCall: jobLeaseHeartbeat });

  assert.deepEqual(
    callOrder,
    ['job-heartbeat', 'finalize', 'job-heartbeat', 'finalize'],
    'every durable final-persistence attempt must renew the OUTER queue lease immediately before its atomic finalize write',
  );
  assert.equal(heartbeatCalls.length, 2, 'the queue heartbeat must fire exactly once per final-persistence attempt');
  // Do not overfit the exact descriptor wording/shape — only that, if the production seam passes
  // one at all, it identifies a stable final-persistence boundary rather than varying per attempt.
  assert.deepEqual(
    heartbeatCalls[0], heartbeatCalls[1],
    'a final-persistence boundary descriptor (if the seam passes one) must be stable across attempts, never attempt-specific',
  );
  assert.deepEqual(
    result,
    { status: 'completed', analysis_run_id: 'run-durable-1', error_code: null, reused: false, queue_finalized: true },
  );
});

test('a lost OUTER queue lease reported by the heartbeat during final persistence aborts before any atomic finalize write and closes as lease_lost', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const worksetId = 'workset-1';

  const leaseLostError = Object.assign(new Error('queue lease lost'), { code: 'AGT002_REANALYSIS_LEASE_LOST' });
  const jobLeaseHeartbeat = async () => { throw leaseLostError; };

  const finalizeCalls = [];
  const finalizeDurableAnalysis = async (db, params) => {
    finalizeCalls.push(params);
    return { analysisRunId: 'should-not-happen', worksetId: params.worksetId, jobId: params.jobId };
  };

  const registerPreviewAnalysis = async (db, params) => {
    const { data, error } = await db.rpc('psi_record_agt002_canonical_analysis_run', {
      p_snapshot_id: params.snapshot_id, p_opportunity_id: params.opportunity_id, p_tender_id: params.tender_id,
      p_result: params.envelope, p_critical_open_count: 0, p_idempotency_key: durableJob.idempotencyKey,
      p_schema_version: params.envelope.schema_version, p_policy_version: params.envelope.policy_version,
      p_model: params.envelope.usage.model, p_usage: params.envelope.usage, p_context_version_id: params.context_version_id,
    });
    if (error) throw error;
    return { run_id: data.id };
  };

  const envelope = { schema_version: 3, policy_version: 'policy-1', usage: { model: 'model-1' } };
  // No try/catch here: a lost outer queue lease must propagate out of persistAnalysis exactly
  // like a lost preview claim already does elsewhere in this module — it is never a persistence
  // outcome for runPostBridgeAnalysis itself to swallow or retry.
  const runPostBridgeAnalysis = async (db, context, deps) => {
    const registered = await deps.persistAnalysis(db, {
      opportunity_id: context.opportunityId, tender_id: context.tenderId, snapshot_id: context.snapshotId,
      envelope, canonicalOnly: true, context_version_id: context.contextVersionId,
    });
    return { status: 'completed', analysis_run_id: registered.run_id, error_code: null };
  };

  const database = { async rpc(name) { throw new Error(`must never be called (got ${name})`); } };
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });
  const { executor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId, published: false }),
    finalizeDurableAnalysis,
    registerPreviewAnalysis,
    runPostBridgeAnalysis,
  });

  const result = await executor(database, durableJob, { beforeProviderCall: jobLeaseHeartbeat });

  assert.equal(finalizeCalls.length, 0, 'a lost outer queue lease must abort before the atomic finalize write ever runs');
  assert.deepEqual(result, { status: 'unavailable', analysis_run_id: null, error_code: 'lease_lost', reused: false });
});

test('a durable_batched_v1 job\'s persistenceRetry policy never carries the stale absolute deadlineAt derived before the initial preview claim (it may still carry now); a legacy/single-turn job keeps the existing deadlineAt behavior', async () => {
  const durableJob = { ...JOB, executionMode: 'durable_batched_v1' };
  const worksetId = 'workset-1';
  const checkpointHooks = Object.freeze({ loadCheckpoint: async () => ({ hit: false }), storeCheckpoint: async () => ({ status: 'created', checkpointId: 'cp-1' }) });

  let durableDeps;
  const durableRunPostBridgeAnalysis = async (db, context, deps) => { durableDeps = deps; return { status: 'completed', analysis_run_id: 'run-1', error_code: null }; };
  const { executor: durableExecutor } = harness({
    createCheckpointAdapter: () => checkpointHooks,
    getOrCreateWorkset: async () => ({ status: 'created', worksetId, published: false }),
    runPostBridgeAnalysis: durableRunPostBridgeAnalysis,
  });
  await durableExecutor({ kind: 'db' }, durableJob);

  assert.equal(
    Object.hasOwn(durableDeps.persistenceRetry ?? {}, 'deadlineAt'), false,
    'a durable_batched_v1 job must never receive the stale, pre-claim absolute deadlineAt: each final-persistence attempt is lease-gated by the queue heartbeat instead, never by a fixed wall-clock deadline computed before the initial preview claim',
  );
  assert.equal(typeof durableDeps.persistenceRetry?.now, 'function', 'the deterministic now() source may still be forwarded to post-bridge');

  let legacyDeps;
  const legacyRunPostBridgeAnalysis = async (db, context, deps) => { legacyDeps = deps; return { status: 'completed', analysis_run_id: 'run-1', error_code: null }; };
  const { executor: legacyExecutor } = harness({ runPostBridgeAnalysis: legacyRunPostBridgeAnalysis });
  await legacyExecutor({ kind: 'db' }, JOB);

  assert.equal(
    typeof legacyDeps.persistenceRetry?.deadlineAt, 'number',
    'the existing legacy/single-turn deadline behavior — bounding the in-memory retry by the real claim lease — must be preserved unchanged',
  );
  assert.equal(typeof legacyDeps.persistenceRetry?.now, 'function');
});
