// AGT-002 durable reanalysis PERSISTENCE frontier (AGT002_PERSISTENCE_FAILED at stage
// 'persistence' with no psi_tender_analysis_runs row for the reserved key).
//
// What these tests pin: after the bridge has already answered and the envelope has already been
// validated, a TRANSIENT database/network rejection of the persistence RPC must be re-attempted
// IN MEMORY against that same envelope — never by re-invoking the engine, the bridge or the
// provider — while a permanent or unrecognized rejection must still fail closed on the first
// attempt, and no failure may ever fabricate a run or leak a raw database message.
//
// Every scenario drives the REAL engine (agt002-preview-engine.js), the REAL persistence functions
// (agt002-preview-persistence.js, including its real envelope/semantic validation and its real
// idempotency-key recomputation) and the REAL post-bridge orchestrator. The only two fakes are the
// bridge client's `.run()` and the Supabase-shaped `.rpc()` double — no network, no Supabase, no
// bridge, no provider, no secret. Nothing here reproduces the production incident mechanically or
// uses its real ids, timings or payload: every fixture below is synthetic.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';
import { createAgt002AnalysisObservability } from '../agt002-analysis-observability.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';
import { claimAgt002PreviewRun, releaseAgt002PreviewClaim } from '../agt002-preview-persistence.js';
import {
  AGT002_PERSISTENCE_RETRY_DEFAULTS,
  AGT002_PERSISTENCE_SUBCODES,
  AGT002_RETRYABLE_PERSISTENCE_SQLSTATES,
  AGT002_RETRYABLE_PERSISTENCE_TRANSPORT_CODES,
  agt002PersistenceRetryDelayMs,
  classifyAgt002PersistenceError,
  resolveAgt002PersistenceRetryPolicy,
  safeAgt002PersistenceSubcode,
  shouldRetryAgt002Persistence,
} from '../agt002-persistence-retry.js';
import {
  AGT002_PERSISTENCE_RETRY_LEASE_RESERVE_MS,
  createAgt002ReanalysisExecutor,
} from '../agt002-reanalysis-executor.js';

// Synthetic ids only — deliberately NOT the production job/correlation ids.
const IDS = Object.freeze({
  correlation: '00000000-0000-4000-8000-0000000000c1',
  opportunity: '00000000-0000-4000-8000-0000000000c2',
  tender: '00000000-0000-4000-8000-0000000000c3',
  snapshot: '00000000-0000-4000-8000-0000000000c4',
  contextVersion: '00000000-0000-4000-8000-0000000000c5',
  run: '00000000-0000-4000-8000-0000000000ca',
});

// A raw database message shaped like the ones PostgREST really forwards: constraint name, DETAIL
// with a key value, and an opaque token. Nothing derived from it may ever reach a durable row or
// an observability sink.
const RAW_DB_MESSAGE = 'canceling statement due to statement timeout on relation '
  + '"psi_tender_analysis_runs_idempotency_key_key" DETAIL: Key (idempotency_key)=(secret-key-value) '
  + 'conn=sk-live-AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const RAW_DB_FRAGMENTS = Object.freeze([
  'canceling statement',
  'statement timeout',
  'psi_tender_analysis_runs_idempotency_key_key',
  'DETAIL',
  'secret-key-value',
  'sk-live-',
]);

// --- Real V3 fixtures (same construction pattern as tests/agt002-post-bridge-observability.test.mjs) ---

const v3ContextV2Sections = {
  ...buildAgt002OpportunityContextV2({
    opportunity: { id: IDS.opportunity, updated_at: '2026-08-01T10:00:00.000Z' },
    tender: { id: IDS.tender, title: 'Vigilancia sintética', entity: 'Entidad sintética', updated_at: '2026-08-01T10:00:00.000Z' },
  }),
  company_dossier: buildAgt002CompanyDossier({
    profile: { legal_name: 'Seguridad Sintética Ltda.', updated_at: '2026-08-01T10:00:00.000Z' },
    documents: [],
  }),
};
const v3RetrievalDocuments = [{
  document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: IDS.opportunity, snapshot_id: null,
  document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
  extracted_text: 'Requiere póliza vigente de cumplimiento.',
}];
const v3RetrievalDeepAnalysis = {
  matrix: {
    legal: [{
      id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
      evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
    }],
    financial: [], technical: [],
  },
};
const v3Context = {
  documents: v3RetrievalDocuments, deepAnalysis: v3RetrievalDeepAnalysis,
  snapshotId: IDS.snapshot, contextV2Sections: v3ContextV2Sections,
};

function governanceProvenanceFixture() {
  return {
    'category_override:req-poliza': {
      requirement_id: 'req-poliza', override_kind: 'category_override', category_value: 'habilitating',
      rationale: 'El pliego exige tratar la póliza como habilitante, no como técnico.', source_reference: 'pliego:seccion-2:habilitantes',
      curated_by: '10101010-1010-4010-8010-101010101010', curated_at: '2026-08-07T00:00:00.000Z', version: 1,
    },
    'evidence_class_link:req-poliza': {
      requirement_id: 'req-poliza', override_kind: 'evidence_class_link', evidence_class_id: 'rup',
      rationale: 'El RUP acredita la póliza exigida por el requisito.', source_reference: 'pliego:anexo-1:requisitos-habilitantes',
      curated_by: '10101010-1010-4010-8010-101010101010', curated_at: '2026-08-07T00:00:00.000Z', version: 2,
    },
  };
}

function v3EngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true, documentRetrieval: true, integralContractV3: true,
    categoryOverrides: { 'req-poliza': 'habilitating' },
    governanceProvenance: governanceProvenanceFixture(),
    companyEvidenceClassesProvider: () => [],
    ...overrides,
  };
}

function buildV3ModelOutput(options, evidenceState = AGT002_EVIDENCE_STATE_SAFE_UNKNOWN) {
  const requirementEntry = options.input.document_evidence.requirement_manifest[0];
  const allowedRef = options.input.document_evidence.citation_allowlist[0];
  return {
    integral_analysis: {
      analysis_units: [{
        unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: requirementEntry.requirement_id,
        category: null, sequence: 1, title: 'Póliza vigente', assessment_mode: 'assessed',
        conclusion: { status: 'human_validation_required', summary: 'Evidencia disponible; sin determinación de cumplimiento gobernada.', confidence: 'medium' },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
        evidence_state: null,
        evidence_refs: [{ ref: allowedRef, source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [],
        commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
        actions: [],
        milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
        escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
        closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
        human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
      }],
    },
  };
}

/** Fake exactly at the bridge boundary: client.run(). Counts every provider invocation. */
function trackedClient(handler) {
  const calls = [];
  const telemetry = { invocationStarted: false, responseReceived: false };
  return {
    calls,
    telemetry,
    client: {
      run: async (options) => {
        telemetry.invocationStarted = true;
        calls.push(options);
        const result = await handler(options, calls.length);
        telemetry.responseReceived = true;
        return result;
      },
    },
  };
}

function validV3Client() {
  return trackedClient(async (options) => ({
    content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 11, output_tokens: 7 },
  }));
}

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

/** Supabase-shaped `.rpc()` double. `onRecordRun` sees the 1-based attempt number. */
function fakeDatabase({ onRecordRun, onAppendAttempt, onReleaseClaim } = {}) {
  const calls = [];
  let attemptSeq = 0;
  let recordRunSeq = 0;
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_append_agt002_analysis_attempt') {
        attemptSeq += 1;
        if (onAppendAttempt) {
          const forced = onAppendAttempt(params, attemptSeq);
          if (forced) return forced;
        }
        return { data: { id: `attempt-event-${attemptSeq}`, ...params }, error: null };
      }
      if (name === 'psi_record_agt002_canonical_analysis_run') {
        recordRunSeq += 1;
        return onRecordRun
          ? onRecordRun(params, recordRunSeq)
          : { data: null, error: { message: 'no onRecordRun handler configured for this fixture' } };
      }
      if (name === 'psi_release_agt002_preview_claim') {
        return onReleaseClaim ? onReleaseClaim(params) : { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

function persistedRunResponse(params) {
  return {
    data: {
      id: IDS.run, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
      status: 'completed', canonical: true, critical_open_count: 0, context_version_id: params.p_context_version_id,
    },
    error: null,
  };
}

function rpcError(message, code) {
  return { data: null, error: code === undefined ? { message } : { message, code } };
}

function requestContext(overrides = {}) {
  return {
    opportunityId: IDS.opportunity,
    tenderId: IDS.tender,
    snapshotId: IDS.snapshot,
    contextVersionId: IDS.contextVersion,
    attemptKey: `reanalysis:${IDS.contextVersion}`,
    correlationId: IDS.correlation,
    claimId: 'claim-1',
    idempotencyKey: 'a'.repeat(64),
    canonicalOnly: true,
    ...overrides,
  };
}

/** No real wall clock is ever spent: backoff is observed, not slept through. */
function fakeClock(startMs = 1_000_000) {
  const slept = [];
  let current = startMs;
  return {
    slept,
    now: () => current,
    sleep: async (ms) => { slept.push(ms); current += ms; },
  };
}

const attemptStates = db => db.calls.filter(c => c.name === 'psi_append_agt002_analysis_attempt').map(c => c.params.p_state);
const recordRunCalls = db => db.calls.filter(c => c.name === 'psi_record_agt002_canonical_analysis_run');
const releaseClaimCount = db => db.calls.filter(c => c.name === 'psi_release_agt002_preview_claim').length;
const unavailableAttempt = db => db.calls.find(c => c.name === 'psi_append_agt002_analysis_attempt' && c.params.p_state === 'unavailable')?.params ?? null;
const outcomeRecord = obs => obs.records.find(r => r.eventType === 'reanalysis_post_bridge_outcome') ?? null;

// ===========================================================================================
// 1. Root cause, stated as a test: unwrapRpc used to collapse a Supabase error into a bare
//    Error(message), so the SQLSTATE that distinguishes a transient frontier from a permanent
//    rejection did not exist by the time runAgt002PostBridgeAnalysis caught it.
// ===========================================================================================

test('unwrapRpc preserves the SQLSTATE category and RPC name as structural metadata, without moving the raw message anywhere new', async () => {
  const database = { async rpc() { return rpcError(RAW_DB_MESSAGE, '57014'); } };

  await assert.rejects(
    () => claimAgt002PreviewRun(database, {
      idempotencyKey: 'a'.repeat(64), dailyMaxRuns: 5, maxConcurrent: 2, leaseSeconds: 270,
    }),
    (error) => {
      assert.equal(error.rpc_sqlstate, '57014', 'the SQLSTATE category must survive unwrapRpc');
      assert.equal(error.rpc_name, 'psi_claim_agt002_preview_run');
      assert.equal(error.code, undefined, 'the engine/bridge `.code` vocabulary must never be overwritten by a SQLSTATE');
      assert.equal(error.message, RAW_DB_MESSAGE, 'the raw text stays exactly where it always was: `.message` only');
      return true;
    },
  );
});

test('unwrapRpc drops a code that is not SQLSTATE-shaped rather than forwarding it', async () => {
  const database = { async rpc() { return rpcError('boom', 'this is not a sqlstate, it is free text'); } };
  await assert.rejects(
    () => releaseAgt002PreviewClaim(database, { idempotencyKey: 'a'.repeat(64), claimId: 'claim-1' }),
    (error) => {
      assert.equal(error.rpc_sqlstate, undefined, 'only a SQLSTATE-shaped code may ever be attached');
      assert.equal(error.rpc_name, 'psi_release_agt002_preview_claim');
      return true;
    },
  );
});

test('an RPC that returns neither data nor an error still fails closed, with no fabricated metadata', async () => {
  const database = { async rpc() { return { data: null, error: null }; } };
  await assert.rejects(
    () => claimAgt002PreviewRun(database, {
      idempotencyKey: 'a'.repeat(64), dailyMaxRuns: 5, maxConcurrent: 2, leaseSeconds: 270,
    }),
    (error) => {
      assert.equal(error.rpc_sqlstate, undefined);
      assert.equal(classifyAgt002PersistenceError(error).retryable, false, 'an empty RPC result is not a transient frontier');
      return true;
    },
  );
});

// ===========================================================================================
// 2. Engine/provider called EXACTLY ONCE when a transient persistence failure is retried.
// ===========================================================================================

test('a transient persistence failure is retried in memory and the engine/provider is invoked exactly once', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const clock = fakeClock();
  const database = fakeDatabase({
    onRecordRun: (params, attempt) => (attempt === 1 ? rpcError(RAW_DB_MESSAGE, '57014') : persistedRunResponse(params)),
  });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.analysis_run_id, IDS.run);
  assert.equal(result.error_code, null);
  assert.equal(clientCalls.length, 1, 'the bridge/provider must be invoked exactly once across the retry');
  assert.equal(recordRunCalls(database).length, 2, 'persistence must have been re-attempted exactly once');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed'], 'a retry adds no extra durable lifecycle event');
  assert.equal(releaseClaimCount(database), 1, 'the claim is still released exactly once');
  assert.deepEqual(clock.slept, [AGT002_PERSISTENCE_RETRY_DEFAULTS.baseDelayMs], 'exactly one bounded backoff');

  const outcome = outcomeRecord(observability);
  assert.equal(outcome.fields.stage, 'response_received');
  assert.equal(outcome.fields.error_code, null);
  assert.equal(outcome.fields.persistence_attempts, 2);
  assert.equal(outcome.fields.persistence_subcode, null, 'a run that persisted carries no persistence subcode');

  const retryEvents = observability.records.filter(r => r.eventType === 'retry_scheduled');
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].fields.stage, 'persistence');
  assert.equal(retryEvents[0].fields.persistence_subcode, AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT);
  assert.equal(retryEvents[0].fields.reason, undefined, 'the persistence subcode must never be carried in the generic reason field');
});

test('the retried attempt re-sends byte-identical RPC params: the recomputed idempotency identity and V3 payload are unchanged', async () => {
  const { client, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const clock = fakeClock();
  const database = fakeDatabase({
    onRecordRun: (params, attempt) => (attempt === 1 ? rpcError('lock timeout', '55P03') : persistedRunResponse(params)),
  });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability: spyObservability(), analysisContext: v3Context, bridgeTelemetry: telemetry,
    integralContractV3: true, persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  assert.equal(result.status, 'completed');
  const [first, second] = recordRunCalls(database);
  assert.deepEqual(second.params, first.params, 'the frozen identity must recompute exactly equal on the re-attempt');
  assert.equal(typeof first.params.p_idempotency_key, 'string');
  assert.match(first.params.p_idempotency_key, /^[0-9a-f]{64}$/);
  assert.equal(first.params.p_schema_version, second.params.p_schema_version);
  assert.deepEqual(first.params.p_result, second.params.p_result, 'the SAME already-validated envelope is re-persisted, never a re-derived one');
});

test('the retry re-uses the envelope object itself: engine.analyze is never called a second time even when persistence fails twice', async () => {
  let analyzeCalls = 0;
  const { client, telemetry } = validV3Client();
  const realEngine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const engine = {
    manifestScope: null,
    analyze: async (...args) => { analyzeCalls += 1; return realEngine.analyze(...args); },
  };
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError('deadlock detected', '40P01') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability: spyObservability(), analysisContext: v3Context, bridgeTelemetry: telemetry,
    integralContractV3: true, persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(analyzeCalls, 1);
  assert.equal(recordRunCalls(database).length, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts);
});

// ===========================================================================================
// 3. Permanent / unknown persistence failures are NEVER retried.
// ===========================================================================================

const NON_RETRYABLE_CASES = [
  { label: 'idempotency conflict (23505)', code: '23505', subcode: AGT002_PERSISTENCE_SUBCODES.IDEMPOTENCY_CONFLICT },
  { label: 'check constraint (23514)', code: '23514', subcode: AGT002_PERSISTENCE_SUBCODES.CONSTRAINT_VIOLATION },
  { label: 'foreign key (23503)', code: '23503', subcode: AGT002_PERSISTENCE_SUBCODES.CONSTRAINT_VIOLATION },
  { label: 'invalid input (22023)', code: '22023', subcode: AGT002_PERSISTENCE_SUBCODES.INVALID_INPUT },
  { label: 'missing reference (P0002)', code: 'P0002', subcode: AGT002_PERSISTENCE_SUBCODES.REFERENCE_NOT_FOUND },
  { label: 'permission denied (42501)', code: '42501', subcode: AGT002_PERSISTENCE_SUBCODES.PERMISSION_DENIED },
  { label: 'unknown SQLSTATE (XX000)', code: 'XX000', subcode: AGT002_PERSISTENCE_SUBCODES.SQL_ERROR },
  { label: 'ambiguous completion (40003) is deliberately not retryable', code: '40003', subcode: AGT002_PERSISTENCE_SUBCODES.SQL_ERROR },
  { label: 'no structural metadata at all', code: undefined, subcode: AGT002_PERSISTENCE_SUBCODES.UNCLASSIFIED },
];

for (const scenario of NON_RETRYABLE_CASES) {
  test(`a permanent/unknown persistence failure is never retried: ${scenario.label}`, async () => {
    const { client, calls: clientCalls, telemetry } = validV3Client();
    const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
    const observability = spyObservability();
    const clock = fakeClock();
    const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, scenario.code) });

    const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
      engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
      persistenceRetry: { now: clock.now, sleep: clock.sleep },
    });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.analysis_run_id, null, 'a failed persistence must never fabricate a run');
    assert.equal(result.error_code, 'AGT002_PERSISTENCE_FAILED');
    assert.equal(clientCalls.length, 1);
    assert.equal(recordRunCalls(database).length, 1, 'persistence must be attempted exactly once');
    assert.deepEqual(clock.slept, [], 'no backoff may be spent on a non-retryable failure');
    assert.equal(observability.records.filter(r => r.eventType === 'retry_scheduled').length, 0);

    const params = unavailableAttempt(database);
    assert.equal(params.p_error_code, 'AGT002_PERSISTENCE_FAILED');
    assert.equal(params.p_analysis_run_id, null);
    assert.equal(
      params.p_error_message,
      `Vig-IA no completó el análisis: la persistencia rechazó el resultado. [${scenario.subcode}]`,
    );
    assert.equal(outcomeRecord(observability).fields.persistence_subcode, scenario.subcode);
    assert.equal(outcomeRecord(observability).fields.persistence_attempts, 1);
  });
}

test('a semantic/envelope rejection raised BEFORE the RPC is never retried and never carries a persistence subcode', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const realEngine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  // Corrupt exactly one already-computed field so the REAL pre-RPC consistency guard in
  // registerAgt002PreviewAnalysis rejects — every earlier stage still ran for real.
  const engine = {
    analyze: async (...args) => {
      const envelope = await realEngine.analyze(...args);
      return { ...envelope, v2_projection: { ...envelope.v2_projection, recommendation: 'corrupted_for_test_only_never_a_real_engine_output' } };
    },
  };
  const observability = spyObservability();
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'AGT002_ENVELOPE_INVALID');
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCalls(database).length, 0, 'the RPC was never reached, so nothing may be re-attempted');
  assert.deepEqual(clock.slept, []);
  assert.equal(outcomeRecord(observability).fields.stage, 'envelope_build');
  assert.equal(outcomeRecord(observability).fields.persistence_subcode, null, 'a non-persistence failure carries no persistence subcode');
  assert.equal(
    unavailableAttempt(database).p_error_message,
    'Vig-IA no completó el análisis: el resultado ensamblado no es válido.',
  );
});

// ===========================================================================================
// 4. Retry exhaustion stays fail-closed.
// ===========================================================================================

test('retry exhaustion remains unavailable, fabricates no run, and reports the transient subcode', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null, 'exhaustion must never fabricate a run');
  assert.equal(result.error_code, 'AGT002_PERSISTENCE_FAILED');
  assert.equal(clientCalls.length, 1, 'exhaustion must never re-invoke the engine/provider');
  assert.equal(recordRunCalls(database).length, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts);
  assert.equal(clock.slept.length, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts - 1);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCount(database), 1);

  const params = unavailableAttempt(database);
  assert.equal(params.p_analysis_run_id, null);
  assert.equal(params.p_error_code, 'AGT002_PERSISTENCE_FAILED');
  assert.equal(outcomeRecord(observability).fields.persistence_attempts, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts);
  assert.equal(outcomeRecord(observability).fields.persistence_subcode, AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT);
});

test('a retry that exhausts is bounded by maxAttempts even when every attempt is transient and the budget is generous', async () => {
  const { client, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError('serialization failure', '40001') });

  await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability: spyObservability(), analysisContext: v3Context, bridgeTelemetry: telemetry,
    integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep, maxAttempts: 3, budgetMs: 15_000 },
  });

  assert.equal(recordRunCalls(database).length, 3, 'the hard attempt ceiling is honoured');
  assert.deepEqual(clock.slept, [250, 500], 'exponential backoff, clamped by the policy');
});

// ===========================================================================================
// 5. Lease/budget bounding.
// ===========================================================================================

test('a transient failure is NOT retried once the caller-supplied lease deadline has passed', async () => {
  const { client, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep, deadlineAt: clock.now() - 1 },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(recordRunCalls(database).length, 1, 'an expired lease must not fund a re-attempt');
  assert.deepEqual(clock.slept, []);
  assert.equal(outcomeRecord(observability).fields.persistence_subcode, AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT);
});

test('a transient failure is NOT retried once the retry budget cannot even fund the backoff', async () => {
  const { client, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability: spyObservability(), analysisContext: v3Context, bridgeTelemetry: telemetry,
    integralContractV3: true, persistenceRetry: { now: clock.now, sleep: clock.sleep, budgetMs: 0 },
  });

  assert.equal(recordRunCalls(database).length, 1);
  assert.deepEqual(clock.slept, []);
});

test('a transient failure is NOT retried when the post-sleep clock lands EXACTLY on the retry-window budget boundary', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const startMs = 3_000_000;
  const budgetMs = 500;
  const slept = [];
  let current = startMs;
  const now = () => current;
  // Lands the clock at PRECISELY retryWindowStartedAt + budgetMs — not past it, the way the
  // oversleep tests do — to pin the exclusive equality boundary itself: elapsedMs + delayMs ===
  // budgetMs on the post-sleep gate must still reject, never be treated as still-inside-budget.
  const sleep = async (ms) => { slept.push(ms); current = startMs + budgetMs; };
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now, sleep, budgetMs },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null, 'the exact-boundary rejection must never fabricate a run');
  assert.equal(result.error_code, 'AGT002_PERSISTENCE_FAILED');
  assert.equal(clientCalls.length, 1, 'the engine/provider must still be invoked exactly once');
  assert.equal(recordRunCalls(database).length, 1, 'no second persistence RPC may start exactly at budget exhaustion');
  assert.equal(slept.length, 1, 'the pre-sleep check must have allowed exactly one backoff attempt');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCount(database), 1, 'the claim is still released exactly once');

  const outcome = outcomeRecord(observability);
  assert.equal(outcome.fields.persistence_attempts, 1, 'the boundary rejection must not count as a second persistence attempt');
  assert.equal(outcome.fields.persistence_subcode, AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT);
});

test('an oversleep past the deadline during backoff exits fail-closed without starting a second persistence attempt', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const startMs = 1_000_000;
  const slept = [];
  let current = startMs;
  const now = () => current;
  // Simulates an event-loop pause far longer than the scheduled backoff: the clock jumps well
  // past the deadline while "asleep" — exactly the frontier the post-sleep gate must catch before
  // any next persistence RPC starts.
  const sleep = async (ms) => { slept.push(ms); current += ms + 10_000; };
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now, sleep, deadlineAt: startMs + 1000 },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null, 'an oversleep past the deadline must never fabricate a run');
  assert.equal(result.error_code, 'AGT002_PERSISTENCE_FAILED');
  assert.equal(clientCalls.length, 1, 'the engine/provider must still be invoked exactly once');
  assert.equal(recordRunCalls(database).length, 1, 'no second persistence RPC may start once the deadline has passed during backoff');
  assert.equal(slept.length, 1, 'exactly one backoff sleep was attempted before the gate caught the oversleep');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCount(database), 1, 'the claim is still released exactly once');

  const outcome = outcomeRecord(observability);
  assert.equal(outcome.fields.persistence_attempts, 1, 'the oversleep must not count as a second persistence attempt');
  assert.equal(outcome.fields.persistence_subcode, AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT, 'the original persistence failure is preserved, not a fabricated one');
});

test('an oversleep that only exhausts the retry-window budget (no deadlineAt) exits fail-closed the same way', async () => {
  const { client, calls: clientCalls, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const startMs = 2_000_000;
  const slept = [];
  let current = startMs;
  const now = () => current;
  const sleep = async (ms) => { slept.push(ms); current += ms + AGT002_PERSISTENCE_RETRY_DEFAULTS.budgetMs; };
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now, sleep },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCalls(database).length, 1, 'the exhausted retry-window budget must block the second RPC even with no lease deadline');
  assert.equal(slept.length, 1);
});

test('the executor derives the persistence retry deadline from the very lease its claim funded', async () => {
  const captured = [];
  const frozenNow = 5_000_000;
  const executor = createAgt002ReanalysisExecutor({
    environment: {},
    now: () => frozenNow,
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'claim-1' }),
    findPreviewRun: async () => null,
    releasePreviewClaim: async () => true,
    countDailyRuns: async () => 0,
    createRuntime: () => ({ analyze: async () => ({}) }),
    createCorrelationId: () => IDS.correlation,
    runPostBridgeAnalysis: async (_database, _context, deps) => {
      captured.push(deps.persistenceRetry);
      return { status: 'completed', analysis_run_id: IDS.run };
    },
  });

  const timeoutMs = 120_000;
  const job = {
    idempotencyKey: 'b'.repeat(64), opportunityId: IDS.opportunity, tenderId: IDS.tender,
    snapshotId: IDS.snapshot, contextVersionId: IDS.contextVersion,
    frozenEngineInput: {
      schema_version: 1,
      engine_identity: {
        model: 'synthetic-codex-model', policy_version: 'agt002-preview-policy-v1', timeout_ms: timeoutMs,
        daily_max_runs: 5, max_concurrent: 2, idempotency_key: 'b'.repeat(64),
      },
      analysis_flags: { AGT002_CANONICAL_ONLY: true },
      analysis_context: { opportunity: { id: IDS.opportunity }, snapshotId: IDS.snapshot, canonicalOnly: true },
    },
  };

  const outcome = await executor({ rpc: async () => ({ data: null, error: null }) }, job);
  assert.equal(outcome.status, 'completed');
  assert.equal(captured.length, 1);
  const expectedLeaseSeconds = 2 * (timeoutMs / 1000) + 30;
  assert.equal(
    captured[0].deadlineAt,
    frozenNow + (expectedLeaseSeconds * 1000) - AGT002_PERSISTENCE_RETRY_LEASE_RESERVE_MS,
  );
  assert.ok(AGT002_PERSISTENCE_RETRY_LEASE_RESERVE_MS > 0, 'a tail reserve must exist for the durable write and claim release');
});

// ===========================================================================================
// 6. Safe observability: no raw database message anywhere.
// ===========================================================================================

test('no raw database message, detail or token ever reaches a durable row or an observability sink', async () => {
  const { client, telemetry } = validV3Client();
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const clock = fakeClock();
  const database = fakeDatabase({ onRecordRun: () => rpcError(RAW_DB_MESSAGE, '57014') });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
    persistenceRetry: { now: clock.now, sleep: clock.sleep },
  });

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const fragment of RAW_DB_FRAGMENTS) {
    assert.equal(serialized.includes(fragment), false, `raw database text leaked: ${fragment}`);
  }
  // The safe subcode IS present — diagnosability without the raw text.
  assert.ok(serialized.includes(AGT002_PERSISTENCE_SUBCODES.STATEMENT_TIMEOUT));
});

test('the real observability recorder only lets a closed persistence subcode through', () => {
  const emitted = [];
  const recorder = createAgt002AnalysisObservability({ emit: record => emitted.push(record), now: () => 0 });

  recorder.record('reanalysis_post_bridge_outcome', {
    correlation_id: IDS.correlation, stage: 'persistence', error_code: 'AGT002_PERSISTENCE_FAILED',
    persistence_subcode: AGT002_PERSISTENCE_SUBCODES.LOCK_TIMEOUT, persistence_attempts: 2,
  });
  assert.equal(emitted[0].persistence_subcode, AGT002_PERSISTENCE_SUBCODES.LOCK_TIMEOUT);
  assert.equal(emitted[0].persistence_attempts, 2);

  recorder.record('reanalysis_post_bridge_outcome', {
    correlation_id: IDS.correlation, stage: 'persistence', error_code: 'AGT002_PERSISTENCE_FAILED',
    persistence_subcode: RAW_DB_MESSAGE, persistence_attempts: 1.5,
  });
  assert.equal(emitted[1].persistence_subcode, undefined, 'a raw message must be dropped, never bounded-and-forwarded');
  assert.equal(emitted[1].persistence_attempts, undefined);
  assert.equal(JSON.stringify(emitted).includes('sk-live-'), false);
});

test('a hostile persistence subcode can never reach the durable attempt row', () => {
  assert.equal(safeAgt002PersistenceSubcode(RAW_DB_MESSAGE), null);
  assert.equal(safeAgt002PersistenceSubcode('persistence_statement_timeout '), null);
  assert.equal(safeAgt002PersistenceSubcode(null), null);
  assert.equal(safeAgt002PersistenceSubcode({ toString: () => 'persistence_statement_timeout' }), null);
  assert.equal(
    safeAgt002PersistenceSubcode(AGT002_PERSISTENCE_SUBCODES.DEADLOCK_DETECTED),
    AGT002_PERSISTENCE_SUBCODES.DEADLOCK_DETECTED,
  );
});

// ===========================================================================================
// 7. Classifier unit contract.
// ===========================================================================================

test('the transient allowlist is exactly the closed SQLSTATE set, and nothing else is retryable', () => {
  for (const sqlstate of AGT002_RETRYABLE_PERSISTENCE_SQLSTATES) {
    assert.equal(classifyAgt002PersistenceError({ rpc_sqlstate: sqlstate }).retryable, true, sqlstate);
  }
  for (const sqlstate of ['23505', '23503', '23502', '23514', '22023', 'P0002', '42501', 'XX000', '40003', 'PGRST202']) {
    assert.equal(classifyAgt002PersistenceError({ rpc_sqlstate: sqlstate }).retryable, false, sqlstate);
  }
  // A SQLSTATE-shaped string that is also an Object.prototype key must resolve to the closed
  // fallback, never to something inherited.
  for (const inherited of ['toString', 'valueOf', 'isPrototypeOf']) {
    const classified = classifyAgt002PersistenceError({ rpc_sqlstate: inherited });
    assert.equal(classified.retryable, false, inherited);
    assert.equal(classified.subcode, AGT002_PERSISTENCE_SUBCODES.SQL_ERROR, inherited);
    assert.equal(safeAgt002PersistenceSubcode(classified.subcode), AGT002_PERSISTENCE_SUBCODES.SQL_ERROR);
  }
  assert.ok(Object.isFrozen(AGT002_RETRYABLE_PERSISTENCE_SQLSTATES));
  assert.throws(() => AGT002_RETRYABLE_PERSISTENCE_SQLSTATES.push('23505'), TypeError);
});

test('a SQLSTATE is only ever read from rpc_sqlstate, never from an engine/bridge `.code`', () => {
  assert.equal(classifyAgt002PersistenceError({ code: '57014' }).retryable, false);
  assert.equal(classifyAgt002PersistenceError({ code: '57014' }).subcode, AGT002_PERSISTENCE_SUBCODES.UNCLASSIFIED);
  assert.equal(classifyAgt002PersistenceError({ code: 'AGT002_CODEX_TIMEOUT' }).retryable, false);
  assert.equal(classifyAgt002PersistenceError(new Error('la persistencia rechazó el resultado')).retryable, false);
  assert.equal(classifyAgt002PersistenceError(undefined).subcode, AGT002_PERSISTENCE_SUBCODES.UNCLASSIFIED);
});

test('a transient transport failure is recognized from either `code` or fetch\'s `cause.code`', () => {
  for (const code of AGT002_RETRYABLE_PERSISTENCE_TRANSPORT_CODES) {
    assert.equal(classifyAgt002PersistenceError({ code }).retryable, true, code);
    const fetchFailure = new TypeError('fetch failed');
    fetchFailure.cause = { code };
    const classified = classifyAgt002PersistenceError(fetchFailure);
    assert.equal(classified.retryable, true, code);
    assert.equal(classified.subcode, AGT002_PERSISTENCE_SUBCODES.NETWORK_FAILURE);
  }
  const dnsFailure = new TypeError('fetch failed');
  dnsFailure.cause = { code: 'ENOTFOUND' };
  assert.equal(classifyAgt002PersistenceError(dnsFailure).retryable, false, 'a permanently wrong host must fail closed');
});

test('the retry policy bounds every override to the safe default and never throws on a hostile one', () => {
  assert.deepEqual(
    resolveAgt002PersistenceRetryPolicy(null),
    { ...AGT002_PERSISTENCE_RETRY_DEFAULTS, deadlineAt: null },
  );
  const hostile = resolveAgt002PersistenceRetryPolicy({
    maxAttempts: 10_000, baseDelayMs: -1, maxDelayMs: 9_999_999, budgetMs: 10 ** 9, deadlineAt: 'soon',
  });
  assert.equal(hostile.maxAttempts, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts, 'an over-range override never widens the frontier');
  assert.equal(resolveAgt002PersistenceRetryPolicy({ maxAttempts: 3 }).maxAttempts, 3, 'the ceiling itself is still accepted');
  assert.equal(hostile.baseDelayMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.baseDelayMs);
  assert.equal(hostile.maxDelayMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxDelayMs);
  assert.equal(hostile.budgetMs, AGT002_PERSISTENCE_RETRY_DEFAULTS.budgetMs);
  assert.equal(hostile.deadlineAt, null);
  assert.ok(Object.isFrozen(hostile));
  assert.equal(resolveAgt002PersistenceRetryPolicy('not an object').maxAttempts, AGT002_PERSISTENCE_RETRY_DEFAULTS.maxAttempts);
});

test('shouldRetryAgt002Persistence answers no by default and yes only when every bound holds', () => {
  const policy = resolveAgt002PersistenceRetryPolicy({ maxAttempts: 3, budgetMs: 6000, deadlineAt: 10_000 });
  const base = { attempt: 1, retryable: true, policy, elapsedMs: 0, delayMs: 250, now: 1000 };
  assert.equal(shouldRetryAgt002Persistence(base), true);
  assert.equal(shouldRetryAgt002Persistence({ ...base, retryable: false }), false);
  assert.equal(shouldRetryAgt002Persistence({ ...base, attempt: 3 }), false, 'attempt ceiling');
  assert.equal(shouldRetryAgt002Persistence({ ...base, elapsedMs: 5900 }), false, 'retry budget');
  assert.equal(
    shouldRetryAgt002Persistence({ ...base, elapsedMs: policy.budgetMs - base.delayMs }),
    false,
    'the budget is a hard EXCLUSIVE boundary: elapsedMs + delayMs === budgetMs must still reject',
  );
  assert.equal(
    shouldRetryAgt002Persistence({ ...base, elapsedMs: policy.budgetMs - base.delayMs - 1 }),
    true,
    '1ms inside the budget must still be allowed to retry',
  );
  assert.equal(shouldRetryAgt002Persistence({ ...base, now: 9_900 }), false, 'lease deadline');
  assert.equal(shouldRetryAgt002Persistence({ ...base, elapsedMs: Number.NaN }), false);
  assert.equal(shouldRetryAgt002Persistence(), false, 'a call with no input must never retry');
});

test('backoff grows exponentially and is clamped by the policy ceiling', () => {
  const policy = resolveAgt002PersistenceRetryPolicy({ baseDelayMs: 250, maxDelayMs: 1000 });
  assert.equal(agt002PersistenceRetryDelayMs(0, policy), 250);
  assert.equal(agt002PersistenceRetryDelayMs(1, policy), 500);
  assert.equal(agt002PersistenceRetryDelayMs(2, policy), 1000);
  assert.equal(agt002PersistenceRetryDelayMs(50, policy), 1000);
  assert.equal(agt002PersistenceRetryDelayMs(-1, policy), 250);
});
