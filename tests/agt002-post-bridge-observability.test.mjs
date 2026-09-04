// RED (TDD): specifies the desired orchestration contract for AGT-002 post-human-answer
// reanalysis (server/index.js's reanalyzeAgt002AfterHumanAnswer). Today that function ends in
// one generic `catch (error) { ... return { status: 'unavailable', context_version_id } }` with
// no per-stage classification and NO durable attempt event on this route at all — see
// server/index.js around reanalyzeAgt002AfterHumanAnswer. These tests pin the missing
// observability + durable attempt lifecycle via a not-yet-existing orchestrator,
// runAgt002PostBridgeAnalysis, exercised through the REAL engine (agt002-preview-engine.js),
// REAL persistence functions (agt002-preview-persistence.js) and REAL envelope validator
// (tender-analysis-domain.js). The only two fakes are: (a) the bridge client's `.run()` —
// exactly the boundary that produced the real bridge_success event (correlation_id
// a23833ff-3672-4ca5-9c5d-084627b430e7, code OK, latency_ms 62336, non-empty response) followed
// by an unavailable result with analysis_run_id null — and (b) the Supabase-shaped database
// double. No real network, Supabase, bridge, provider, or secret is used. These tests classify
// FRONTIERS only; none of them reproduces the historical incident mechanically, and none uses
// its real correlation_id, timings, or payload — every fixture below is synthetic.
//
// Expected to fail at import time ("Cannot find module '../agt002-post-bridge-observability.js'")
// until that module exists. That is the RED signal for this whole file — absence of
// functionality, not a syntax defect in the test.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AGT002_V3_SAFE_VALIDATION_CODES, createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';

const IDS = Object.freeze({
  // Deliberately NOT the real historical correlation id (a23833ff-3672-4ca5-9c5d-084627b430e7);
  // this is a synthetic fixture id so no test can be mistaken for reproducing that incident.
  correlation: '00000000-0000-4000-8000-000000000001',
  opportunity: '00000000-0000-4000-8000-000000000002',
  tender: '00000000-0000-4000-8000-000000000003',
  snapshot: '00000000-0000-4000-8000-000000000004',
  contextVersion: '00000000-0000-4000-8000-000000000005',
});

// V2 (non-integral-contract) context/fixtures below are kept ONLY as an additional control —
// they are not a substitute for the V3 scenarios required for AGT002_INTEGRAL_CONTRACT_V3
// (see the "V3:" block further down), which is the contract actually governed by
// reanalyzeAgt002AfterHumanAnswer's registerAgt002PreviewAnalysis(canonicalOnly) path.
const analysisContext = {
  opportunity: { id: IDS.opportunity, company_name: 'Entidad sintética', title: 'Vigilancia sintética' },
  documents: [
    { id: 'doc-01', name: 'Pliego', document_type: 'pliego', extracted_text: 'Requiere póliza vigente.' },
  ],
  companyProfile: { working_capital: 500 },
  deepAnalysis: {},
  snapshotId: IDS.snapshot,
};

// --- V3 (AGT002_INTEGRAL_CONTRACT_V3) fixtures, built with the same real helpers and pattern
// already used in tests/agt002-preview-engine.test.mjs (buildAgt002OpportunityContextV2,
// buildAgt002CompanyDossier, the governed requirement/category/evidence-class wiring). Every
// V3 scenario below drives the REAL engine (agt002-preview-engine.js) end to end through real
// parsing/validation; the bridge client is the only fake at that boundary. ---
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
  return engineOptions({
    contextV2: true, documentRetrieval: true, integralContractV3: true,
    categoryOverrides: { 'req-poliza': 'habilitating' },
    governanceProvenance: governanceProvenanceFixture(),
    companyEvidenceClassesProvider: () => [],
    ...overrides,
  });
}

/** Mirrors buildV3ModelOutput from tests/agt002-preview-engine.test.mjs: a real, fully valid
 * V3 model output for the single governed requirement in v3RetrievalDeepAnalysis above. */
function buildV3ModelOutput(options, evidenceState = AGT002_EVIDENCE_STATE_SAFE_UNKNOWN) {
  const requirementEntry = options.input.document_evidence.requirement_manifest[0];
  const allowedRef = options.input.document_evidence.citation_allowlist[0];
  return {
    integral_analysis: {
      // Model-facing shape only: contract_version/coverage are server-assembled by the
      // engine from validationContext, never offered as a slot the model could fill in
      // (mirrors buildV3ModelOutput in tests/agt002-preview-engine.test.mjs).
      analysis_units: [{
        unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: requirementEntry.requirement_id,
        category: null, sequence: 1, title: 'Póliza vigente', assessment_mode: 'assessed',
        conclusion: { status: 'human_validation_required', summary: 'Evidencia disponible; sin determinación de cumplimiento gobernada.', confidence: 'medium' },
        blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
        // Governed-unit contract: category/evidence_state are server-assembled for a
        // tender requirement and must be null on the model wire.
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

function validModelOutput(overrides = {}) {
  return {
    recommendation: 'pause',
    summary: 'Falta confirmar la póliza.',
    strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [],
    questions: [],
    unverified: [],
    next_action: 'Solicitar póliza vigente.',
    human_review_required: true,
    ...overrides,
  };
}

function engineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    ...overrides,
  };
}

/** Fake exactly at the bridge_success-equivalent boundary: client.run(). Tracks whether the
 * bridge call started and whether a response was actually received (mirrors the production
 * onBridgeInvocationStarted hook in agt002-preview-runtime.js, plus a response counterpart). */
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

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

/** Fake verifiable DB double: Supabase-shaped `.rpc()` only (no real Supabase/pglite/network). */
function fakeDatabase({ onRecordRun, onAppendAttempt, onReleaseClaim } = {}) {
  const calls = [];
  let attemptSeq = 0;
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
        return onRecordRun ? onRecordRun(params) : { data: null, error: { message: 'no onRecordRun handler configured for this fixture' } };
      }
      if (name === 'psi_release_agt002_preview_claim') {
        return onReleaseClaim ? onReleaseClaim(params) : { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
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

function attemptStates(database) {
  return database.calls.filter(call => call.name === 'psi_append_agt002_analysis_attempt').map(call => call.params.p_state);
}

function releaseClaimCallCount(database) {
  return database.calls.filter(call => call.name === 'psi_release_agt002_preview_claim').length;
}

function recordRunCallCount(database) {
  return database.calls.filter(call => call.name === 'psi_record_agt002_canonical_analysis_run').length;
}

// --- Requirement 2/3: transport failure vs a genuine bridge_success (response_received). ---

test('a bridge transport failure never reaches response_received, is durably marked unavailable exactly once, and releases the claim', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => {
    const error = new Error('El servicio de AGT-002 Preview no está disponible.');
    error.code = 'AGT002_CODEX_TRANSPORT_ERROR';
    throw error;
  });
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(clientCalls.length, 1, 'zero retry: the bridge must be called exactly once');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(recordRunCallCount(database), 0, 'a transport failure must never reach persistence');
  assert.equal(releaseClaimCallCount(database), 1, 'the claim must always be released');

  assert.equal(observability.records.length, 1);
  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'transport');
  assert.equal(fields.error_code, 'AGT002_TRANSPORT_ERROR');
  assert.equal(fields.bridge_invocation_started, true);
  assert.equal(fields.bridge_response_received, false, 'a transport error means no response was ever received');
  assert.equal(fields.correlation_id, IDS.correlation);
  assert.equal(fields.context_version_id, IDS.contextVersion);
  assert.equal(fields.opportunity_id, IDS.opportunity);
  assert.equal(fields.snapshot_id, IDS.snapshot);
  assert.equal(typeof fields.duration_ms, 'number');
});

test('a provider-reported failure (AGT002_CODEX_PROVIDER_ERROR) classifies as provider error, never transport, is durably marked unavailable, and releases the claim without leaking the raw error text', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => {
    const error = new Error('El proveedor Codex reportó un fallo de turno.');
    error.code = 'AGT002_CODEX_PROVIDER_ERROR';
    error.providerStatus = 'failed';
    error.providerErrorCode = 'other';
    throw error;
  });
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(result.error_code, 'AGT002_PROVIDER_ERROR');
  assert.equal(clientCalls.length, 1, 'zero retry: the bridge must be called exactly once');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(recordRunCallCount(database), 0, 'a provider-reported failure must never reach persistence');
  assert.equal(releaseClaimCallCount(database), 1, 'the claim must always be released');

  assert.equal(observability.records.length, 1);
  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'transport');
  assert.equal(fields.error_code, 'AGT002_PROVIDER_ERROR');
  assert.notEqual(fields.error_code, 'AGT002_TRANSPORT_ERROR', 'a provider-reported failure must never be misclassified as a transport failure');
  assert.equal(fields.bridge_invocation_started, true);
  assert.equal(fields.bridge_response_received, false, 'the boundary rejected rather than resolving, mirroring how bridgeClient.run() propagates a provider error');

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  assert.ok(!serialized.includes('El proveedor Codex reportó un fallo de turno.'), 'the raw provider error message must never leak into the outcome, durable row, or observability');
});

test('a pre-bridge engine rejection is unexpected, never transport/provider, when invocation never started', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => {
    throw new Error('the bridge fixture must not be reached');
  });
  const engine = createAgt002PreviewEngine({
    client,
    ...engineOptions({ countDailyRuns: async () => 5, dailyMaxRuns: 5 }),
  });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(clientCalls.length, 0, 'the bridge must not be called for a pre-bridge rejection');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(recordRunCallCount(database), 0);
  assert.equal(releaseClaimCallCount(database), 1);
  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'unexpected');
  assert.equal(fields.error_code, 'AGT002_UNEXPECTED_ERROR');
  assert.equal(fields.bridge_invocation_started, false);
  assert.equal(fields.bridge_response_received, false);
});

// --- Requirement 3: non-JSON content after a genuine bridge_success. ---

test('non-JSON bridge content after a real bridge_success classifies as json_parse, not a transport/bridge stage, and never persists', async () => {
  const rawContent = '```json\n{not valid json\n```';
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: rawContent, usage: { input_tokens: 5, output_tokens: 2 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(clientCalls.length, 1);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(recordRunCallCount(database), 0, 'malformed content must never reach persistence');

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'json_parse');
  assert.notEqual(fields.stage, 'transport');
  assert.notEqual(fields.stage, 'response_received');
  assert.equal(fields.bridge_invocation_started, true);
  assert.equal(fields.bridge_response_received, true, 'the bridge DID answer here; the failure is purely in parsing its content');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes(rawContent), 'raw bridge content must never leak into an observability record');
});

// --- Requirement 3 (continued): missing/empty bridge content (nothing to parse at all) after a
// real bridge_success classifies as content_extraction, distinct from json_parse, and never
// reaches persistence. ---

test('missing/empty bridge content after a real bridge_success classifies as content_extraction, not json_parse, and never persists', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: '', usage: { input_tokens: 3, output_tokens: 0 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(clientCalls.length, 1);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(recordRunCallCount(database), 0, 'missing content must never reach persistence');

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'content_extraction');
  assert.notEqual(fields.stage, 'json_parse');
  assert.equal(fields.bridge_invocation_started, true);
  assert.equal(fields.bridge_response_received, true, 'the bridge DID answer here; there was simply nothing usable in it');
});

// --- Requirement 4: well-formed JSON, invalid model output => model_output_validation, never persistence. ---

test('a hallucinated evidence_id (schema-valid JSON, invalid model output) classifies as model_output_validation, never persistence', async () => {
  const rawOutput = validModelOutput({ weaknesses: [{ id: 'f-1', text: 'x', critical: true, evidence_refs: ['document:doc-99-never-sent'] }] });
  const { client, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 9, output_tokens: 4 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(recordRunCallCount(database), 0);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'model_output_validation');
  assert.notEqual(fields.stage, 'persistence');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes('document:doc-99-never-sent'), 'a hallucinated evidence id must never leak into observability');
});

// --- Requirement 5: schema-valid output, envelope assembly fails => envelope_build. ---

test('a schema-valid output whose envelope fails to assemble classifies as envelope_build', async () => {
  const rawOutput = validModelOutput();
  const { client, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 6, output_tokens: 3 } }));
  // A broken idGenerator is a legitimate engine construction option (not a boundary fake): it
  // deterministically drives the REAL envelope validator (tender-analysis-domain.js) to reject
  // run_id's shape, reaching the ENVELOPE stage without hand-forging an invalid envelope.
  const engine = createAgt002PreviewEngine({ client, ...engineOptions(), idGenerator: () => 'not-a-uuid' });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(recordRunCallCount(database), 0, 'an envelope that fails to assemble must never reach persistence');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(observability.records[0].fields.stage, 'envelope_build');
});

// --- Requirement 6: a valid envelope that persistence itself rejects => persistence. ---

test('a fully valid envelope rejected by persistence classifies as persistence, and still releases the claim', async () => {
  const rawOutput = validModelOutput();
  const { client, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 12, output_tokens: 6 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase({
    onRecordRun: () => ({ data: null, error: { message: 'duplicate key value violates unique constraint' } }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(recordRunCallCount(database), 1, 'persistence must actually have been attempted, exactly once');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);
  assert.equal(observability.records[0].fields.stage, 'persistence');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes('duplicate key value violates unique constraint'), 'the raw DB error message must never leak into observability');
});

// --- Requirement 7: a fully valid V3-shaped output persists and completes. ---

test('a fully valid model output is persisted through the real engine and persistence, and the attempt completes exactly once', async () => {
  const rawOutput = validModelOutput();
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 20, output_tokens: 10 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-000000000009';
  const database = fakeDatabase({
    onRecordRun: params => ({
      data: {
        id: persistedRunId, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
        status: 'completed', canonical: true, critical_open_count: 0, context_version_id: params.p_context_version_id,
      },
      error: null,
    }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.analysis_run_id, persistedRunId);
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCallCount(database), 1);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed']);
  assert.equal(attemptStates(database).filter(state => state === 'unavailable').length, 0);
  assert.equal(releaseClaimCallCount(database), 1);

  const completedAttempt = database.calls.find(call => call.name === 'psi_append_agt002_analysis_attempt' && call.params.p_state === 'completed');
  assert.equal(completedAttempt.params.p_analysis_run_id, persistedRunId, 'the completed attempt event must carry the real persisted run id');
});

// ===========================================================================================
// V3 (AGT002_INTEGRAL_CONTRACT_V3): the four scenarios explicitly required — these are the
// contract reanalyzeAgt002AfterHumanAnswer actually runs under canonicalOnly, and are not
// interchangeable with the V2 control scenarios above.
// ===========================================================================================

// Requirement 4 (V3): JSON válido pero output V3 inválido (invariante real violado por
// validateAgt002PreviewModelOutputV3) => integral_v3_validation, nunca persistence, y nunca
// reportado bajo la etiqueta v2 (model_output_validation).
test('V3: JSON válido pero output V3 inválido clasifica como integral_v3_validation, nunca persistence ni model_output_validation', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async (options) => {
    const output = buildV3ModelOutput(options);
    // A real, engine-rejected invariant violation that the conservative no-corpus normalizer
    // must not repair: a not-applicable assessment smuggling a non-allowlisted legal basis.
    output.integral_analysis.analysis_units[0].legal_assessment = {
      status: 'not_applicable', basis_refs: ['legal:unknown'], summary: 'No aplica.', human_legal_review_required: false,
    };
    return { content: JSON.stringify(output), usage: { input_tokens: 5, output_tokens: 5 } };
  });
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(clientCalls.length, 1, 'zero retry');
  assert.equal(recordRunCallCount(database), 0, 'an invalid V3 output must never reach persistence');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'integral_v3_validation');
  assert.notEqual(fields.stage, 'model_output_validation', 'v3 must not be reported under the v2 stage label');
  assert.notEqual(fields.stage, 'persistence');
});

// Requirement 5 (V3): output V3 válido, pero el envelope resultante es internamente
// inconsistente (v2_projection no coincide con la proyección recomputada desde
// integral_analysis) => envelope_build, detectado por la validación real en
// agt002-preview-persistence.js (registerAgt002PreviewAnalysis), antes de cualquier RPC.
test('V3: output válido pero envelope internamente inconsistente clasifica como envelope_build, antes de cualquier RPC de persistencia', async () => {
  const { client, telemetry } = trackedClient(async (options) => ({
    content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 4, output_tokens: 4 },
  }));
  const realEngine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  // The real engine never legitimately produces an envelope whose v2_projection disagrees with
  // its own integral_analysis — that inconsistency is exactly what
  // agt002-preview-persistence.js's registerAgt002PreviewAnalysis guards against for a
  // hypothetical non-engine caller (see its "v2_projection no coincide..." check). To reach
  // that real guard deterministically without hand-forging a whole fake envelope, this wraps
  // the REAL engine and corrupts exactly one already-computed field (v2_projection.recommendation)
  // on the way out — every earlier stage (bridge call, JSON parse, V3 semantic validation) still
  // ran for real against real content.
  const engine = {
    analyze: async (...args) => {
      const envelope = await realEngine.analyze(...args);
      return { ...envelope, v2_projection: { ...envelope.v2_projection, recommendation: 'corrupted_for_test_only_never_a_real_engine_output' } };
    },
  };
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(recordRunCallCount(database), 0, 'an internally inconsistent envelope must never reach the persistence RPC');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);
  assert.equal(observability.records[0].fields.stage, 'envelope_build');
});

// Requirement 6 (V3): envelope V3 válido, pero la RPC de persistencia lo rechaza => persistence.
test('V3: envelope válido rechazado por la RPC de persistencia clasifica como persistence, y libera el claim', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async (options) => ({
    content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 7, output_tokens: 6 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase({
    onRecordRun: () => ({ data: null, error: { message: 'duplicate key value violates unique constraint' } }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCallCount(database), 1, 'persistence must actually have been attempted, exactly once, with a genuinely valid V3 envelope');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);
  assert.equal(observability.records[0].fields.stage, 'persistence');
});

// Requirement 7 (V3): output V3 completamente válido => run persistido (vía
// registerAgt002PreviewAnalysis real) y attempt 'completed' exactamente una vez.
test('V3: output completamente válido se persiste vía el motor y la persistencia reales, y el attempt completa exactamente una vez', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async (options) => ({
    content: JSON.stringify(buildV3ModelOutput(options)), usage: { input_tokens: 15, output_tokens: 9 },
  }));
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-00000000000a';
  const database = fakeDatabase({
    onRecordRun: params => ({
      data: {
        id: persistedRunId, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
        status: 'completed', canonical: true, critical_open_count: 0, context_version_id: params.p_context_version_id,
      },
      error: null,
    }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.analysis_run_id, persistedRunId);
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCallCount(database), 1);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed']);
  assert.equal(attemptStates(database).filter(state => state === 'unavailable').length, 0);
  assert.equal(releaseClaimCallCount(database), 1);

  const completedAttempt = database.calls.find(call => call.name === 'psi_append_agt002_analysis_attempt' && call.params.p_state === 'completed');
  assert.equal(completedAttempt.params.p_analysis_run_id, persistedRunId);
});

// ===========================================================================================
// V3 durable validation subcode propagation. The engine already classifies a v3 semantic
// failure into a CLOSED, allowlisted AGT002_V3_SAFE_VALIDATION_CODES value for its own
// output_rejected observability event — but that subcode is lost before the DURABLE
// psi_agt002_analysis_attempt_events row is written, which today only carries the generic
// AGT002_INTEGRAL_V3_INVALID code + a fixed generic message. These tests pin the missing
// propagation: the allowlisted subcode must reach the durable attempt event's error_message so
// the incident is diagnosable to the exact invariant, while (a) the generic public error_code is
// preserved unchanged, (b) the fixed generic public message is preserved, and (c) any
// unknown/hostile/non-allowlisted value collapses to the fixed safe message and NEVER leaks a
// raw validator/model string into the durable row.
// ===========================================================================================

test('V3: the exported safe validation code catalog is an immutable value list, never a shared mutable Set', () => {
  assert.ok(Array.isArray(AGT002_V3_SAFE_VALIDATION_CODES));
  assert.ok(Object.isFrozen(AGT002_V3_SAFE_VALIDATION_CODES));
  assert.throws(() => AGT002_V3_SAFE_VALIDATION_CODES.push('hostile_runtime_code'), TypeError);
  assert.ok(!AGT002_V3_SAFE_VALIDATION_CODES.includes('hostile_runtime_code'));
});

function unavailableAttemptParams(database) {
  const call = database.calls.find(c => c.name === 'psi_append_agt002_analysis_attempt' && c.params.p_state === 'unavailable');
  return call ? call.params : null;
}

// Allowed value: a real, engine-classified, allowlisted invariant. Sending a server-governed key
// ('coverage') the model must never emit drives the REAL validateAgt002PreviewModelOutputV3 shape
// guard, whose closed error code 'v3_model_output_shape_mismatch' is an
// AGT002_V3_SAFE_VALIDATION_CODES member — exactly the closed subcode that must survive to the
// durable row.
test('V3: an allowlisted invariant subcode reaches the durable unavailable attempt error_message; generic error_code and generic message preserved', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async (options) => {
    const output = buildV3ModelOutput(options);
    output.integral_analysis.coverage = { forged: true };
    return { content: JSON.stringify(output), usage: { input_tokens: 5, output_tokens: 5 } };
  });
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(clientCalls.length, 1, 'zero retry');
  assert.equal(recordRunCallCount(database), 0, 'an invalid V3 output must never reach persistence');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);

  const params = unavailableAttemptParams(database);
  assert.equal(params.p_error_code, 'AGT002_INTEGRAL_V3_INVALID', 'the generic public error_code must be preserved unchanged');
  assert.match(params.p_error_message, /v3_model_output_shape_mismatch/, 'the closed, allowlisted validation subcode must reach the durable attempt event');
  assert.match(params.p_error_message, /la salida integral v3 no superó la validación/, 'the fixed generic public message must be preserved alongside the subcode');

  assert.equal(observability.records[0].fields.stage, 'integral_v3_validation');
  assert.equal(observability.records[0].fields.error_code, 'AGT002_INTEGRAL_V3_INVALID');
});

// Hostile value at the runner boundary: a buggy/compromised engine hands back an error whose
// `.code` is NOT an allowlisted closed subcode but a raw model/validator string (embedding an
// evidence id + a SQL-shaped payload). The runner must independently re-gate against the
// allowlist and collapse to the FIXED safe message — never persist or leak the raw string.
test('V3: a non-allowlisted/hostile engine validation code never reaches the durable row; it collapses to the fixed safe message', async () => {
  const hostile = 'omitió una fuente incierta: cite-99; DROP TABLE psi_agt002_analysis_attempt_events; 5ec3f-secret-token';
  const engine = {
    analyze: async () => {
      const error = new Error('AGT-002 Preview no produjo una respuesta válida.');
      // Same closed structural stage a real v3 semantic rejection carries (so the runner
      // classifies it as integral_v3_validation), but a hostile, non-allowlisted `.code`.
      error.stage = AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION;
      error.code = hostile;
      throw error;
    },
  };
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context,
    bridgeTelemetry: { invocationStarted: true, responseReceived: true }, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  const params = unavailableAttemptParams(database);
  assert.equal(params.p_error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.equal(
    params.p_error_message,
    'Vig-IA no completó el análisis: la salida integral v3 no superó la validación.',
    'a non-allowlisted code must collapse to the fixed generic message with no subcode appended',
  );

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const forbidden of ['DROP TABLE', 'cite-99', '5ec3f-secret-token']) {
    assert.ok(!serialized.includes(forbidden), `"${forbidden}" must never appear anywhere in the durable/observability payload`);
  }
});

// Real semantic-domain value THROUGH the real engine: a legal cross-field violation receives
// the fixed call-site code and both the engine and durable runner accept it only because it is
// present in the shared immutable allowlist. Unknown/hostile values remain covered separately
// above and still collapse to the generic message.
test('V3: a real legal-assessment invariant persists its closed domain code through engine and runner', async () => {
  const { client, telemetry } = trackedClient(async (options) => {
    const output = buildV3ModelOutput(options);
    output.integral_analysis.analysis_units[0].legal_assessment = {
      status: 'not_applicable', basis_refs: ['legal:unknown'], summary: 'No aplica.', human_legal_review_required: false,
    };
    return { content: JSON.stringify(output), usage: { input_tokens: 5, output_tokens: 5 } };
  });
  const engine = createAgt002PreviewEngine({ client, ...v3EngineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: v3Context, bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  const params = unavailableAttemptParams(database);
  assert.equal(params.p_error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.equal(
    params.p_error_message,
    'Vig-IA no completó el análisis: la salida integral v3 no superó la validación. [v3_legal_assessment_invariant]',
    'the fixed legal-assessment domain code must survive both closed allowlist gates',
  );
});

// --- Requirement 8: a genuinely unattributed post-response failure (the engine throws with no
// stage this module recognizes, after the bridge has already answered) classifies as unexpected
// — never mislabeled as a bridge/transport/provider problem it demonstrably was not. ---

test('an unrecognized post-response engine failure (no known stage) classifies as unexpected, never transport, once the bridge has responded', async () => {
  const telemetry = { invocationStarted: true, responseReceived: true };
  const engine = {
    analyze: async () => { throw new Error('a genuinely unattributed failure with no known stage'); },
  };
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(recordRunCallCount(database), 0);
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'unexpected');
  assert.notEqual(fields.stage, 'transport');
  assert.equal(fields.bridge_response_received, true, 'the bridge DID answer; the failure is genuinely unattributed, not a transport problem');
});

// --- response_serialization safe semantics: presentation is its own frontier, strictly AFTER
// the run is already durable. A presentAnalysis failure must never un-persist the real run: the
// durable attempt stays 'completed' (carrying the real analysis_run_id), while the caller-facing
// result degrades to a sanitary 'unavailable' — and the attempt lifecycle must never end up
// recording an 'unavailable' state alongside a completed, persisted run. ---

test('a presentAnalysis failure after a real persist keeps the run/attempt completed but returns a sanitary unavailable result, classified as response_serialization', async () => {
  const rawOutput = validModelOutput();
  const { client, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 5, output_tokens: 3 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-00000000000b';
  const database = fakeDatabase({
    onRecordRun: params => ({
      data: {
        id: persistedRunId, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
        status: 'completed', canonical: true, critical_open_count: 0, context_version_id: params.p_context_version_id,
      },
      error: null,
    }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
    presentAnalysis: () => { throw new Error('cannot present analysis'); },
  });

  assert.equal(result.status, 'unavailable', 'a presentation failure must degrade to a sanitary unavailable result, never a fabricated success');
  assert.equal(result.analysis_run_id, persistedRunId, 'the module still knows the real run id internally; only the caller-facing status is sanitary');
  assert.equal(recordRunCallCount(database), 1, 'the run is real and already persisted before presentation ever runs');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed'], 'the durable attempt must stay completed: the run itself is real and was never undone');

  const completedAttempt = database.calls.find(call => call.name === 'psi_append_agt002_analysis_attempt' && call.params.p_state === 'completed');
  assert.equal(completedAttempt.params.p_analysis_run_id, persistedRunId);
  assert.equal(completedAttempt.params.p_error_code, null, 'a completed attempt never carries an error_code');

  const unavailableAttempt = database.calls.find(call => call.name === 'psi_append_agt002_analysis_attempt' && call.params.p_state === 'unavailable');
  assert.equal(unavailableAttempt, undefined, 'a completed, persisted run must never also be recorded as an unavailable attempt');

  assert.equal(observability.records[0].fields.stage, 'response_serialization');
  assert.equal(releaseClaimCallCount(database), 1);
});

// --- Requirement 9: an observability-write failure must never flip a real failure into success,
// and must never block the durable attempt write or the claim release. ---

test('an observability recorder that throws does not convert an unavailable outcome into completed, and does not block the attempt write or claim release', async () => {
  const { client, telemetry } = trackedClient(async () => ({ content: 'not json at all', usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const throwingObservability = { record: () => { throw new Error('observability sink is down'); } };
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability: throwingObservability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable', 'a broken observability sink must never be mistaken for success');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1, 'the claim must still be released even if observability itself is broken');
});

// --- Requirement 9 (continued): an attempt-write failure must not silently convert the
// outcome, and the claim must still be released. ---

test('a failure while writing the terminal attempt event does not silently convert the real outcome, and the claim is still released', async () => {
  const rawOutput = validModelOutput();
  const { client, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 4, output_tokens: 2 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  let attemptWrites = 0;
  const database = fakeDatabase({
    onRecordRun: () => ({ data: null, error: { message: 'persistence unavailable' } }),
    onAppendAttempt: (params) => {
      attemptWrites += 1;
      // The terminal ("unavailable") write itself fails; queued/running still succeed.
      if (params.p_state === 'unavailable') return { data: null, error: { message: 'attempt event table unreachable' } };
      return null; // fall through to the default success response
    },
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  assert.equal(result.status, 'unavailable', 'the real outcome must surface even if durably recording it failed');
  assert.ok(attemptWrites >= 3, 'the terminal attempt write must actually have been attempted');
  assert.equal(releaseClaimCallCount(database), 1, 'the claim must still be released even if the durable attempt write failed');
});

// --- Requirement 10: zero retry, zero fallback, claim always released — cross-checked across
// every scenario above via clientCalls.length and releaseClaimCallCount; this test pins the
// "no fallback engine" half explicitly: a second engine must never be constructed/used. ---

test('exactly one engine is used end to end; nothing about a failed post-bridge analysis triggers a second, fallback engine call', async () => {
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: 'not json', usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
    // No fallback engine/client is provided on purpose: the wrapper must not require, construct
    // or reach for one on failure.
  });

  assert.equal(clientCalls.length, 1, 'the bridge must be invoked exactly once: no retry, no fallback call');
});

// --- Requirement 12: no sensitive leakage, across the full outcome payload (not just the
// per-event fields already checked above). ---

test('the returned outcome and every observability record are free of prompt/document/header/secret content', async () => {
  // A synthetic, clearly-fake header value (never a real credential) shaped only enough to
  // prove a leak-detector would catch it if the wrapper ever forwarded raw provider headers.
  const secretish = 'Bearer test-only-placeholder-header-value-not-a-real-credential';
  const rawOutput = validModelOutput({ next_action: `Acción con ${secretish} filtrado por error del modelo` });
  const { client, telemetry } = trackedClient(async () => ({
    content: JSON.stringify(rawOutput),
    usage: { input_tokens: 3, output_tokens: 2 },
    headers: { authorization: secretish },
  }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase({ onRecordRun: () => ({ data: null, error: { message: `rejected: ${secretish}` } }) });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
  });

  const serialized = JSON.stringify({ result, records: observability.records });
  for (const forbidden of [secretish, 'Bearer', 'Requiere póliza vigente', analysisContext.opportunity.company_name]) {
    assert.ok(!serialized.includes(forbidden), `"${forbidden}" must never appear in the outcome or observability payload`);
  }
  assert.ok(!('stack' in (observability.records[0]?.fields || {})));
});

// --- Requirement 13: the eventual production wiring must keep server/index.js and
// api/[...path].js byte-identical, exactly like the existing canonical-preview parity gate
// (tests/agt002-canonical-unavailable-observability-static.test.mjs). This test only restates
// that existing invariant so the RED suite fails loudly if it is ever broken while this work
// lands, and to document that no new divergence is introduced by design. ---

test('server/index.js and api/[...path].js stay byte-identical (existing parity gate this work must not break)', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(server, api, 'production backends must remain byte-identical');
});

test('reanalyzeAgt002AfterHumanAnswer delegates provider execution to the durable queue', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const start = server.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
  const end = server.indexOf('\n}\n', start);
  const body = start >= 0 && end > start ? server.slice(start, end) : '';
  assert.ok(body, 'reanalyzeAgt002AfterHumanAnswer must exist in server/index.js');
  assert.match(body, /enqueueAgt002CanonicalReanalysis\(database,/);
  assert.doesNotMatch(body, /AGT002_POST_BRIDGE_STAGES|runAgt002PostBridgeAnalysis|engine\.analyze/,
    'the HTTP helper must not classify or execute provider work; the direct-host executor owns that frontier');
  const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');
  assert.match(executor, /runPostBridgeAnalysis\(database,/);
  assert.match(executor, /mapPostBridgeOutcomeCode/);
});

// ===========================================================================================
// Optional deps.persistAnalysis: a not-yet-existing production persistence seam. Today
// runAgt002PostBridgeAnalysis always persists a successful envelope through the module's own
// registerAgt002PreviewAnalysis (agt002-preview-persistence.js) — there is no way for a caller to
// substitute an alternative persistence path. These tests pin the not-yet-implemented contract:
// deps.persistAnalysis, when supplied, REPLACES that default registration call (never runs
// alongside it), receives the same tracked database and the exact already-built persistence
// params/envelope this module always assembles, and is folded into the SAME bounded persistence
// retry loop already used for the default path (agt002-persistence-retry.js) — so a transient
// failure that reached an RPC is retried in place, a deterministic pre-RPC rejection is not, and
// the engine/bridge is still invoked exactly once regardless. Absent, behavior is byte-identical
// to today. RED expected: deps.persistAnalysis does not exist in
// agt002-post-bridge-observability.js yet.
// ===========================================================================================

/** Records every (database, persistenceParams) pair a fake persistAnalysis was invoked with. */
function fakePersistAnalysisRecorder(handler) {
  const calls = [];
  return {
    calls,
    persistAnalysis: async (db, params) => {
      calls.push({ db, params });
      return handler(db, params, calls.length);
    },
  };
}

/** Wraps a real engine to also capture the exact envelope object it returns, so a persisted
 * params.envelope can be checked for referential identity against the one true build. */
function envelopeCapturingEngine(realEngine) {
  const captured = { envelope: null };
  return {
    captured,
    engine: {
      analyze: async (...args) => {
        captured.envelope = await realEngine.analyze(...args);
        return captured.envelope;
      },
    },
  };
}

test('deps.persistAnalysis absent: the default registerAgt002PreviewAnalysis registration path is exactly unchanged', async () => {
  const rawOutput = validModelOutput();
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 5, output_tokens: 3 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-00000000000c';
  const database = fakeDatabase({
    onRecordRun: params => ({
      data: {
        id: persistedRunId, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai',
        status: 'completed', canonical: true, critical_open_count: 0, context_version_id: params.p_context_version_id,
      },
      error: null,
    }),
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry,
    // No persistAnalysis supplied on purpose: this must behave exactly as every pre-existing test
    // above already pins (see the Requirement 7 test), unaffected by this new optional seam.
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.analysis_run_id, persistedRunId);
  assert.equal(clientCalls.length, 1);
  assert.equal(recordRunCallCount(database), 1, 'the real registerAgt002PreviewAnalysis RPC must still be reached when no persistAnalysis override is supplied');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed']);
  assert.equal(releaseClaimCallCount(database), 1);
});

test('deps.persistAnalysis, when supplied, is called instead of the default registration, exactly once, with the tracked database and the exact already-built persistence params/envelope, and a successful run yields a normal completed outcome/attempt/observability with no extra provider call', async () => {
  const rawOutput = validModelOutput();
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 5, output_tokens: 3 } }));
  const realEngine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const { engine, captured } = envelopeCapturingEngine(realEngine);
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-00000000000d';
  const { calls: persistCalls, persistAnalysis } = fakePersistAnalysisRecorder((db, params) => ({ run_id: persistedRunId }));
  const database = fakeDatabase();
  const ctx = { ...requestContext(), requireTenderRequirementInventory: false };

  const result = await runAgt002PostBridgeAnalysis(database, ctx, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry, persistAnalysis,
  });

  assert.equal(result.status, 'completed', 'a successful supplied persist must still complete normally');
  assert.equal(result.analysis_run_id, persistedRunId);
  assert.equal(clientCalls.length, 1, 'no extra provider call: the bridge/engine is invoked exactly once');
  assert.equal(persistCalls.length, 1, 'the supplied persistAnalysis must be called exactly once');
  assert.equal(
    recordRunCallCount(database), 0,
    'the module default registration RPC must never be reached once a persistAnalysis override is supplied',
  );

  const [{ db: seenDb, params: seenParams }] = persistCalls;
  assert.equal(typeof seenDb.rpc, 'function', 'persistAnalysis must receive a database-shaped object it can call .rpc on');
  assert.equal(seenParams.envelope, captured.envelope, 'persistAnalysis must receive the exact same already-built envelope object, not a rebuilt one');
  assert.equal(seenParams.opportunity_id, ctx.opportunityId);
  assert.equal(seenParams.tender_id, ctx.tenderId);
  assert.equal(seenParams.snapshot_id, ctx.snapshotId);
  assert.equal(seenParams.context_version_id, ctx.contextVersionId);
  assert.equal(seenParams.canonicalOnly, ctx.canonicalOnly);
  assert.equal(seenParams.requireTenderRequirementInventory, false);
  assert.deepEqual(seenParams.semanticSourceDocuments, analysisContext.documents);

  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed']);
  const completedAttempt = database.calls.find(call => call.name === 'psi_append_agt002_analysis_attempt' && call.params.p_state === 'completed');
  assert.equal(completedAttempt.params.p_analysis_run_id, persistedRunId);
  assert.equal(releaseClaimCallCount(database), 1);

  assert.equal(observability.records[0].fields.stage, 'response_received');
  assert.equal(observability.records[0].fields.error_code, null);
});

test('a transient error thrown by the supplied persistAnalysis after it reaches an RPC is classified/retried by the existing bounded persistence retry, against the same envelope, with no second engine call', async () => {
  const rawOutput = validModelOutput();
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 5, output_tokens: 3 } }));
  const realEngine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const { engine, captured } = envelopeCapturingEngine(realEngine);
  const observability = spyObservability();
  const persistedRunId = '00000000-0000-4000-8000-00000000000e';
  const database = fakeDatabase();

  const { calls: persistCalls, persistAnalysis } = fakePersistAnalysisRecorder(async (db, params, attemptNumber) => {
    // Reaches an RPC on every attempt (marks the module's own run-RPC tracking), exactly the
    // structural signal the existing retry classifier keys off of to tell "reached the RPC and it
    // was transient" apart from "rejected before any RPC".
    await db.rpc('psi_record_agt002_canonical_analysis_run', { p_attempt: attemptNumber });
    if (attemptNumber === 1) {
      const error = new Error('transient database blip');
      error.rpc_sqlstate = '57014'; // statement_timeout: a member of the existing retryable allowlist
      throw error;
    }
    return { run_id: persistedRunId };
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry, persistAnalysis,
    persistenceRetry: { sleep: async () => {} },
  });

  assert.equal(result.status, 'completed', 'the bounded retry must recover a genuinely transient failure');
  assert.equal(result.analysis_run_id, persistedRunId);
  assert.equal(clientCalls.length, 1, 'no second engine call: the retry re-uses the same already-built envelope');
  assert.equal(persistCalls.length, 2, 'exactly one bounded retry: two total persistAnalysis attempts');
  assert.equal(persistCalls[0].params.envelope, captured.envelope);
  assert.equal(persistCalls[1].params.envelope, captured.envelope, 'the retry must hand the SAME envelope object back, never a rebuilt one');
  assert.equal(recordRunCallCount(database), 2, 'both attempts reached the tracked run-persistence RPC');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'completed']);
  assert.equal(releaseClaimCallCount(database), 1);
});

test('a deterministic pre-RPC rejection from the supplied persistAnalysis classifies as envelope_build and is never retried', async () => {
  const rawOutput = validModelOutput();
  const { client, calls: clientCalls, telemetry } = trackedClient(async () => ({ content: JSON.stringify(rawOutput), usage: { input_tokens: 5, output_tokens: 3 } }));
  const engine = createAgt002PreviewEngine({ client, ...engineOptions() });
  const observability = spyObservability();
  const database = fakeDatabase();

  const { calls: persistCalls, persistAnalysis } = fakePersistAnalysisRecorder((db, params) => {
    // Throws BEFORE calling db.rpc at all: a deterministic, pre-RPC rejection (mirrors
    // registerAgt002PreviewAnalysis's own JS validation throws, which never reach the RPC either).
    throw new Error('deterministic pre-rpc envelope rejection');
  });

  const result = await runAgt002PostBridgeAnalysis(database, { ...requestContext(), requireTenderRequirementInventory: false }, {
    engine, observability, analysisContext, bridgeTelemetry: telemetry, persistAnalysis,
    persistenceRetry: { sleep: async () => {} },
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(clientCalls.length, 1, 'no second engine call');
  assert.equal(persistCalls.length, 1, 'a deterministic pre-RPC rejection must never be retried');
  assert.equal(recordRunCallCount(database), 0, 'no RPC was ever reached');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);
  assert.equal(releaseClaimCallCount(database), 1);
  assert.equal(observability.records[0].fields.stage, 'envelope_build');
});
