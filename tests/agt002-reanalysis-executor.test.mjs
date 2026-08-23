import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';

const JOB = Object.freeze({
  jobId: 'job-1', leaseId: 'lease-1', opportunityId: 'opp-1', tenderId: 'tender-1',
  snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-1', requestedBy: 'actor-1',
  frozenEngineInput: {
    schema_version: 1,
    engine_identity: { model: 'model-1', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2 },
    analysis_flags: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
    analysis_context: { opportunity: { id: 'opp-1' }, documents: [], snapshotId: 'snapshot-1', canonicalOnly: true },
    legal_corpus_context: null,
    integral_v3_governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
    manizales_manifest_source: null,
  },
});

function harness({ previewClaim = { status: 'claimed', claim_id: 'preview-lease-1' }, postOutcome = { status: 'completed', analysis_run_id: 'run-1', error_code: null }, runtimeError = null } = {}) {
  const calls = { claim: [], find: [], release: [], runtime: [], post: [], count: [] };
  const executor = createAgt002ReanalysisExecutor({
    environment: { AGT002_HETZNER_BRIDGE_URL: 'https://bridge.invalid', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'not-observed' },
    claimPreviewRun: async (...args) => { calls.claim.push(args); return previewClaim; },
    findPreviewRun: async (...args) => { calls.find.push(args); return { run_id: 'existing-run-1' }; },
    releasePreviewClaim: async (...args) => { calls.release.push(args); },
    countDailyRuns: async (...args) => { calls.count.push(args); return 0; },
    createRuntime: options => { calls.runtime.push(options); if (runtimeError) throw runtimeError; return { analyze() {}, manifestScope: { scope: 'fixed' } }; },
    runPostBridgeAnalysis: async (...args) => { calls.post.push(args); return postOutcome; },
    createCorrelationId: () => 'correlation-1',
    observability: { record() {} },
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
  assert.equal(runtimeOptions.environment.AGT002_PREVIEW_MODEL, 'model-1');
  assert.equal(runtimeOptions.environment.AGT002_PREVIEW_POLICY_VERSION, 'policy-1');
  assert.equal(runtimeOptions.environment.AGT002_INTEGRAL_CONTRACT_V3, 'true');
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

test('a persisted canonical run wins even if presentation later reports unavailable', async () => {
  const { executor } = harness({ postOutcome: { status: 'unavailable', analysis_run_id: 'run-persisted', error_code: 'response_serialization_failed' } });
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(result, { status: 'completed', analysis_run_id: 'run-persisted', error_code: null, reused: false });
});
