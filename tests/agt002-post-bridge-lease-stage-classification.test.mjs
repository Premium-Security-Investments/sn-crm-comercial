// AGT-002 — the lost-lease frontier after semantic discovery, and the fail-open queue mapping that
// hid it.
//
// WHAT THE REAL RUN ACTUALLY PROVES (and no more): a real, authorized Procuraduria reanalysis
// completed its semantic-discovery stage — 18 successful bridge turns, one per batch, timeout_ms
// 285000, max observed turn latency ~89s, no 19th bridge call — and then ended `status=unavailable`,
// `error_code=provider_error`, with no analysis_run and the previous canonical analysis preserved.
// The durable evidence for that run is exactly: `stage=unexpected`, `bridge_response_received`
// latched true, `persistence_attempts=0`. That is ALL the logs prove. They do NOT prove a lost
// preview lease specifically — that is one hypothesis consistent with the signature, not a
// confirmed root cause; any other untagged local failure between the last discovery turn and the
// analysis bridge call (e.g. discovered-input assembly or validation-context construction — see
// agt002-preview-engine.js) would have produced the identical observable signature.
//
// REPLAYED HERE (deterministically, with no provider, no network, no secret, no Supabase and no
// tender/company content of any kind — every fixture below is synthetic and structural) is the
// MECHANISM this module now closes for the lease-loss hypothesis specifically, so that IF a lease
// loss is what happened, it is attributed correctly rather than defaulting to provider_error. The
// chain this test file exercises, end to end, for that one hypothesis:
//     1. agt002-preview-engine.js awaits `beforeProviderCall()` immediately before the analysis turn
//        (the deterministic stage-boundary heartbeat). agt002-preview-runtime.js composes it from
//        the durable job-lease renewal and the fenced preview-claim renewal.
//     2. agt002-preview-persistence.js's renewAgt002PreviewClaim would reject with the closed code
//        `AGT002_PREVIEW_LEASE_LOST` if the lease were actually gone — a plain Error with a `.code`
//        and NO `.stage`.
//     3. The engine's generic catch wraps it as its own SAFE_UNAVAILABLE, deliberately preserving
//        only `.code` (never the message).
//     4. agt002-post-bridge-observability.js's classifyEnginePhase saw no `.stage`, and saw its
//        run-level `bridgeTelemetry.responseReceived` LATCHED true by the discovery turns — so
//        (before this fix) it could only say 'unexpected' -> AGT002_UNEXPECTED_ERROR.
//     5. agt002-reanalysis-executor.js's mapPostBridgeOutcomeCode matched substrings and DEFAULTED
//        to 'provider_error' for anything it did not recognize. AGT002_UNEXPECTED_ERROR contains
//        none of them.
//
//   Net effect verified below: WHEN a lease-lost code is actually present, it is now attributed to
//   the closed queue code this codebase already has for it (`lease_lost`, migration 068) instead of
//   defaulting to provider_error for a provider that was never called. This module does not, and
//   cannot, prove the real incident's root cause was specifically a lost lease — only that if it
//   was, the classification is now correct, and if it was one of the other untagged local
//   frontiers instead, those are now also given closed stages of their own (see
//   agt002-preview-engine.js and tests/agt002-post-bridge-discovered-frontier-stage-classification
//   coverage) so neither collapses into 'unexpected'/provider_error either. Two more closed codes
//   (ATTEMPT_UPDATE_FAILED, RESPONSE_SERIALIZATION_FAILED) collapsed the same way as
//   AGT002_UNEXPECTED_ERROR before this fix.
//
// Each test below pins one link of the lease-loss mechanism, and the last two pin the end-to-end
// queue outcome for that mechanism specifically.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGT002_LEASE_LOST_CODES,
  AGT002_POST_BRIDGE_ERROR_CODES,
  AGT002_POST_BRIDGE_STAGES,
  classifyAgt002PostBridgeFailure,
  isAgt002LeaseLostError,
  runAgt002PostBridgeAnalysis,
} from '../agt002-post-bridge-observability.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';
import { AGT002_REANALYSIS_QUEUE_ERROR_CODES, createAgt002ReanalysisWorker } from '../agt002-reanalysis-worker.js';

const RELEASE_RPC = 'psi_release_agt002_preview_claim';
const RUN_RPC = 'psi_record_agt002_canonical_analysis_run';
const LEGACY_RUN_RPC = 'psi_record_tender_analysis_run';
const ATTEMPT_RPC = 'psi_append_agt002_analysis_attempt';

const IDEMPOTENCY_KEY = 'e'.repeat(64);
const CLAIM_ID = '00000000-0000-4000-8000-0000000000ca';

// How many provider turns the discovery stage took before the analysis turn in the real run. The
// exact number is irrelevant to the contract — what matters is that it is > 0, which is precisely
// what latched the run-level telemetry boolean.
const DISCOVERY_TURNS = 18;

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    names: () => rpcCalls.map(call => call.name),
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

/** The exact rejection agt002-preview-persistence.js mints when a fenced renewal finds the lease gone. */
function leaseLostRejection() {
  const error = new Error('La reserva AGT-002 Preview se perdió antes de renovarse.');
  error.code = 'AGT002_PREVIEW_LEASE_LOST';
  return error;
}

/**
 * The telemetry object agt002-reanalysis-executor.js hands the orchestrator, in the state the
 * runtime's own bridge hooks leave it in after the discovery stage completed every one of its turns
 * and the analysis turn was never issued: N invocations, N responses, nothing outstanding.
 */
function telemetryAfterDiscovery(turns = DISCOVERY_TURNS) {
  return {
    invocationStarted: turns > 0,
    responseReceived: turns > 0,
    invocationCount: turns,
    responseCount: turns,
  };
}

function postBridgeContext(overrides = {}) {
  return {
    opportunityId: '00000000-0000-4000-8000-000000000021',
    tenderId: '00000000-0000-4000-8000-000000000022',
    snapshotId: '00000000-0000-4000-8000-000000000023',
    contextVersionId: '00000000-0000-4000-8000-000000000024',
    attemptKey: 'attempt-lease-1',
    correlationId: '00000000-0000-4000-8000-000000000025',
    claimId: CLAIM_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Link 1-3: the real engine turns a heartbeat rejection into an untagged safe error that carries
// ONLY the closed lease code. This is the exact input the classifier has to work with.
// ---------------------------------------------------------------------------------------------

test('the real engine forwards a lost-lease heartbeat rejection as a code-only, stage-less safe error', async () => {
  const engine = createAgt002PreviewEngine({
    client: { run: async () => { throw new Error('the provider must never be reached'); } },
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v2',
    countDailyRuns: async () => 0,
    beforeProviderCall: async () => { throw leaseLostRejection(); },
  });

  await assert.rejects(
    () => engine.analyze({
      opportunity: {},
      documents: [{ id: 'd1', name: 'n', document_type: 't', extracted_text: 'x' }],
      companyProfile: {},
      deepAnalysis: {},
      snapshotId: '00000000-0000-4000-8000-000000000023',
    }, { idempotencyKey: IDEMPOTENCY_KEY }),
    error => {
      assert.equal(error.code, 'AGT002_PREVIEW_LEASE_LOST', 'the closed lease code is the only thing the engine forwards');
      assert.equal(error.stage, undefined, 'a lease loss is not an output rejection, so the engine attaches no output-rejection stage');
      assert.doesNotMatch(String(error.message), /reserva AGT-002 Preview se perdió/, 'the raw rejection message must never reach the caller');
      return true;
    },
  );
});

test('the closed lease-code catalog names both fenced heartbeats and matches exactly, never by substring', () => {
  assert.deepEqual([...AGT002_LEASE_LOST_CODES].sort(), ['AGT002_PREVIEW_LEASE_LOST', 'AGT002_REANALYSIS_LEASE_LOST']);
  assert.equal(isAgt002LeaseLostError({ code: 'AGT002_PREVIEW_LEASE_LOST' }), true);
  assert.equal(isAgt002LeaseLostError({ code: 'AGT002_REANALYSIS_LEASE_LOST' }), true);
  assert.equal(isAgt002LeaseLostError({ code: 'AGT002_SOMETHING_LEASE_ADJACENT' }), false, 'a substring must never be enough');
  assert.equal(isAgt002LeaseLostError(new Error('no code at all')), false);
  assert.equal(isAgt002LeaseLostError(undefined), false);
});

// ---------------------------------------------------------------------------------------------
// Link 4: the classifier. A lost lease is its own frontier, and multi-turn telemetry no longer
// destroys transport attribution.
// ---------------------------------------------------------------------------------------------

test('the lease frontier has a closed stage and code of its own, distinct from transport/persistence/unexpected', () => {
  const result = classifyAgt002PostBridgeFailure({ phase: 'lease_renewal', error: leaseLostRejection() });
  assert.deepEqual(Object.keys(result).sort(), ['error_code', 'stage'], 'the classifier still returns nothing but structural metadata');
  assert.equal(result.stage, AGT002_POST_BRIDGE_STAGES.LEASE_RENEWAL);
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST);
  for (const wrong of [
    AGT002_POST_BRIDGE_STAGES.TRANSPORT,
    AGT002_POST_BRIDGE_STAGES.PERSISTENCE,
    AGT002_POST_BRIDGE_STAGES.UNEXPECTED,
  ]) assert.notEqual(result.stage, wrong);
  assert.doesNotMatch(JSON.stringify(result), /perdió|reserva/, 'no raw rejection text may travel with the classification');
});

test('a lost lease after N successful discovery turns is attributed to the lease frontier, not to the provider', async () => {
  const database = fakeDb({
    rpcResults: {
      [ATTEMPT_RPC]: { data: { id: '00000000-0000-4000-8000-0000000000e2' }, error: null },
      [RELEASE_RPC]: { data: true, error: null },
    },
  });
  const records = [];
  const result = await runAgt002PostBridgeAnalysis(database, postBridgeContext(), {
    // Exactly what the real engine produces for this failure (see the first test above).
    engine: { analyze: async () => { throw Object.assign(new Error('AGT-002 Preview no está disponible en este momento.'), { code: 'AGT002_PREVIEW_LEASE_LOST' }); } },
    observability: { record: (event, fields) => { records.push({ event, fields }); } },
    analysisContext: { documents: [] },
    bridgeTelemetry: telemetryAfterDiscovery(),
    integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null, 'no run may be fabricated for an analysis turn that never happened');
  assert.equal(
    result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST,
    'REGRESSION: this used to be AGT002_UNEXPECTED_ERROR purely because the discovery turns had latched responseReceived',
  );
  assert.notEqual(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR);
  assert.notEqual(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);

  const outcome = records.find(record => record.event === 'reanalysis_post_bridge_outcome');
  assert.ok(outcome, 'exactly one outcome event is still emitted');
  assert.equal(outcome.fields.stage, AGT002_POST_BRIDGE_STAGES.LEASE_RENEWAL);
  assert.equal(outcome.fields.persistence_subcode, null, 'a lost lease is not a persistence rejection and carries no persistence subcode');

  // Fail-closed shape is unchanged: nothing persisted, the claim released exactly once.
  assert.equal(database.names().includes(RUN_RPC), false, 'the canonical run RPC must never be attempted');
  assert.equal(database.names().includes(LEGACY_RUN_RPC), false, 'no legacy run RPC either');
  assert.equal(database.rpcCalls.filter(call => call.name === RELEASE_RPC).length, 1, 'the claim is still released exactly once');

  const durableAttempt = database.rpcCalls.filter(call => call.name === ATTEMPT_RPC).at(-1);
  assert.equal(durableAttempt.args.p_state, 'unavailable');
  assert.equal(durableAttempt.args.p_error_code, AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST);
  assert.match(durableAttempt.args.p_error_message, /reserva del trabajo se perdió/, 'the durable row carries the fixed generic message for this closed code');
});

test('a real transport failure on the analysis turn is still transport, even after N discovery turns answered', async () => {
  const database = fakeDb({
    rpcResults: {
      [ATTEMPT_RPC]: { data: { id: '00000000-0000-4000-8000-0000000000e3' }, error: null },
      [RELEASE_RPC]: { data: true, error: null },
    },
  });
  // The runtime's hooks fire onBridgeInvocationStarted for the analysis turn and never fire
  // onBridgeResponseReceived, because the call itself threw: one invocation is outstanding.
  const telemetry = telemetryAfterDiscovery();
  telemetry.invocationCount += 1;

  const result = await runAgt002PostBridgeAnalysis(database, postBridgeContext({ attemptKey: 'attempt-lease-2' }), {
    engine: { analyze: async () => { throw Object.assign(new Error('AGT-002 Preview no está disponible en este momento.'), { code: 'AGT002_CODEX_TRANSPORT_ERROR' }); } },
    observability: { record: () => {} },
    analysisContext: { documents: [] },
    bridgeTelemetry: telemetry,
    integralContractV3: true,
  });

  assert.equal(
    result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR,
    'REGRESSION: a latched run-level responseReceived used to force this to "unexpected" once discovery had answered once',
  );
});

test('a genuinely unknown local failure with no outstanding bridge call stays unexpected — it is never upgraded to transport', async () => {
  const database = fakeDb({
    rpcResults: {
      [ATTEMPT_RPC]: { data: { id: '00000000-0000-4000-8000-0000000000e4' }, error: null },
      [RELEASE_RPC]: { data: true, error: null },
    },
  });
  const result = await runAgt002PostBridgeAnalysis(database, postBridgeContext({ attemptKey: 'attempt-lease-3' }), {
    engine: { analyze: async () => { throw new Error('AGT-002 Preview no está disponible en este momento.'); } },
    observability: { record: () => {} },
    analysisContext: { documents: [] },
    bridgeTelemetry: telemetryAfterDiscovery(),
    integralContractV3: true,
  });
  assert.equal(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);
});

// ---------------------------------------------------------------------------------------------
// Link 5: the queue mapping. provider_error must require positive evidence of a provider failure.
// ---------------------------------------------------------------------------------------------

const JOB = Object.freeze({
  jobId: 'job-lease-1', leaseId: 'lease-lease-1', opportunityId: 'opp-1', tenderId: 'tender-1',
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

function executorFor(postOutcome) {
  const calls = { release: [], runtime: [] };
  const executor = createAgt002ReanalysisExecutor({
    environment: { AGT002_HETZNER_BRIDGE_URL: 'https://bridge.invalid', AGT002_HETZNER_BRIDGE_HMAC_SECRET: 'not-observed' },
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'preview-lease-1' }),
    findPreviewRun: async () => ({ run_id: 'existing-run-1' }),
    releasePreviewClaim: async (...args) => { calls.release.push(args); },
    countDailyRuns: async () => 0,
    createRuntime: options => { calls.runtime.push(options); return { analyze() {}, manifestScope: null }; },
    runPostBridgeAnalysis: async () => postOutcome,
    createCorrelationId: () => 'correlation-lease-1',
    observability: { record() {} },
  });
  return { executor, calls };
}

test('the executor maps the lost-lease frontier onto the queue code that already exists for it', async () => {
  const { executor } = executorFor({ status: 'unavailable', analysis_run_id: null, error_code: AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST });
  const result = await executor({ kind: 'db' }, JOB);
  assert.deepEqual(
    result,
    { status: 'unavailable', analysis_run_id: null, error_code: 'lease_lost', reused: false },
    'REGRESSION: before this fix, this hypothetical lease-loss scenario would have defaulted to provider_error, the generic code the real Procuraduria run actually reported',
  );
});

test('every closed post-bridge code maps deliberately, and provider_error has exactly one source', async () => {
  const expected = new Map([
    [AGT002_POST_BRIDGE_ERROR_CODES.TRANSPORT_ERROR, 'timeout'],
    [AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR, 'provider_error'],
    [AGT002_POST_BRIDGE_ERROR_CODES.CONTENT_EXTRACTION_FAILED, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.JSON_PARSE_FAILED, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.MODEL_OUTPUT_INVALID, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.INTEGRAL_V3_INVALID, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST, 'lease_lost'],
    [AGT002_POST_BRIDGE_ERROR_CODES.PERSISTENCE_FAILED, 'persistence_failure'],
    [AGT002_POST_BRIDGE_ERROR_CODES.ATTEMPT_UPDATE_FAILED, 'persistence_failure'],
    [AGT002_POST_BRIDGE_ERROR_CODES.RESPONSE_SERIALIZATION_FAILED, 'invalid_output'],
    [AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR, 'invalid_output'],
  ]);

  // Exhaustive by construction: a new closed code added without a deliberate queue mapping fails here.
  assert.deepEqual(
    [...expected.keys()].sort(), Object.values(AGT002_POST_BRIDGE_ERROR_CODES).sort(),
    'every member of the closed post-bridge catalog needs an explicit queue mapping',
  );

  for (const [postBridgeCode, queueCode] of expected) {
    const { executor } = executorFor({ status: 'unavailable', analysis_run_id: null, error_code: postBridgeCode });
    const result = await executor({ kind: 'db' }, JOB);
    assert.equal(result.error_code, queueCode, `${postBridgeCode} must map to ${queueCode}`);
    assert.ok(AGT002_REANALYSIS_QUEUE_ERROR_CODES.includes(result.error_code), 'only migration 068 codes may ever reach the queue');
  }

  const providerSources = [...expected.entries()].filter(([, queueCode]) => queueCode === 'provider_error');
  assert.deepEqual(
    providerSources.map(([code]) => code), [AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR],
    'provider_error must require positive evidence that the provider itself reported the failure',
  );
});

test('an unknown or absent post-bridge code fails closed to invalid_output, never to provider_error', async () => {
  for (const unknown of [undefined, null, '', 'AGT002_SOMETHING_FROM_THE_FUTURE', 'provider_error']) {
    const { executor } = executorFor({ status: 'unavailable', analysis_run_id: null, error_code: unknown });
    const result = await executor({ kind: 'db' }, JOB);
    assert.equal(result.error_code, 'invalid_output', `an unmapped code (${String(unknown)}) must not be blamed on the provider`);
  }
});

// ---------------------------------------------------------------------------------------------
// End to end: the durable queue row an operator actually reads.
// ---------------------------------------------------------------------------------------------

test('the durable job closes as lease_lost, preserving fail-closed semantics and the current analysis', async () => {
  const failed = [];
  const completed = [];
  const worker = createAgt002ReanalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    claimJob: async () => JOB,
    completeJob: async (...args) => { completed.push(args); },
    failJob: async (database, params) => { failed.push(params); return { status: 'unavailable' }; },
    // The executor's real mapping, exercised through the real worker.
    executeJob: executorFor({ status: 'unavailable', analysis_run_id: null, error_code: AGT002_POST_BRIDGE_ERROR_CODES.LEASE_LOST }).executor,
  });

  const outcome = await worker.runOnce();
  assert.deepEqual(outcome, { status: 'unavailable', jobId: JOB.jobId, errorCode: 'lease_lost' });
  assert.equal(completed.length, 0, 'nothing may be completed: no analysis_run exists');
  assert.deepEqual(failed, [{ jobId: JOB.jobId, leaseId: JOB.leaseId, errorCode: 'lease_lost' }]);
  assert.ok(
    AGT002_REANALYSIS_QUEUE_ERROR_CODES.includes(failed[0].errorCode),
    'the code must be a member of the closed catalog migration 068 enforces, so no migration is needed',
  );
});
