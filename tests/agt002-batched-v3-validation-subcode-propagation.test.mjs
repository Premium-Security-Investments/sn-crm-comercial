// AGT-002 durable batched V3 — closed semantic-validation SUBCODE propagation (RED, TDD).
//
// WHY THIS FILE EXISTS
//   The one-turn V3 path (runOnceV3) already re-gates a validateAgt002PreviewModelOutputV3
//   rejection against the closed AGT002_V3_SAFE_VALIDATION_CODES allowlist and attaches the
//   surviving subcode to its safe error, so runAgt002PostBridgeAnalysis can persist the EXISTING
//   generic AGT002_INTEGRAL_V3_INVALID message with `[subcode]` appended — the only thing that
//   makes a production V3 rejection diagnosable to the exact invariant.
//
//   The durable BATCHED path throws that information away: executeBatch catches every
//   validateAgt002PreviewModelOutputV3Batch rejection and replaces it with the generic closed
//   AGT002_BATCHED_V3_BATCH_FAILED, so every batched V3 semantic failure reaches the durable
//   attempt row as the bare generic message. These tests pin the missing propagation.
//
// WHAT IS REAL AND WHAT IS NOT
//   Real: createAgt002PreviewEngine, the discovered-frontier assembly, the V3 validation context,
//   the real planner/projector/per-batch contract (validateAgt002PreviewModelOutputV3Batch), the
//   real runAgt002PostBridgeAnalysis, the real closed catalogs. Fake: the provider client (a pure
//   function over the input it is handed), the semantic-discovery provider (structural, no turn),
//   the checkpoint hooks (in-memory, always a miss) and the Supabase-shaped database double.
//   No provider, bridge, network, Supabase or secret is touched; every fixture is synthetic.
//
// SCOPE GUARD (what these tests deliberately do NOT change)
//   Business decisions, frozen input identity, retry policy, API auth, persistence atomicity and
//   human-gate semantics are all out of scope: the ONLY thing asserted here is which closed
//   diagnostic subcode survives, and that nothing else does.
//
// Run: node --test tests/agt002-batched-v3-validation-subcode-propagation.test.mjs
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  AGT002_INTEGRAL_V3_POLICY,
  AGT002_V3_SAFE_VALIDATION_CODES,
  createAgt002PreviewEngine,
} from '../agt002-preview-engine.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';
import { buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

const hash = value => createHash('sha256').update(value).digest('hex');

const MODEL = 'synthetic-codex-model';
const POLICY_VERSION = 'agt002-integral-v3-policy-test';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';
const SERVER_OWNED_MAX_INPUT_TOKENS = 180_000;

// The engine's own fixed public texts. Pinned here so a test can prove the public `.message`
// contract is unchanged by the subcode propagation.
const SAFE_UNAVAILABLE = 'AGT-002 Preview no está disponible en este momento.';
const GENERIC_V3_ATTEMPT_MESSAGE = 'Vig-IA no completó el análisis: la salida integral v3 no superó la validación.';

const IDS = Object.freeze({
  correlation: '00000000-0000-4000-8000-0000000000a1',
  opportunity: '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b',
  tender: '00000000-0000-4000-8000-0000000000a3',
  snapshot: '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a',
  contextVersion: '00000000-0000-4000-8000-0000000000a5',
});

// A hostile marker planted INSIDE the model turn this run rejects. Nothing derived from the model
// output may ever reach a thrown error, an observability record or a durable row, so every test
// below sweeps the full serialized surface for it.
const HOSTILE_MODEL_MARKER = 'MODELO-FILTRADO; DROP TABLE psi_agt002_analysis_attempt_events; 5ec3f-secret-token';

// Fragments of the REAL Spanish validator messages (agt002-preview-contract.js /
// agt002-integral-analysis-v3.js). A validator message is never a public string: none of these
// may appear anywhere either.
const VALIDATOR_MESSAGE_FRAGMENTS = [
  'La cobertura local del lote',
  'no coincide exactamente',
  'claves no permitidas',
  'gobernados por el servidor',
];

// Four single-newline lines, so the inventory segments one source unit per line and discovery
// resolves exactly two requirements. Mirrors tests/agt002-batched-v3-real-happy-path.test.mjs.
const PLIEGO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
].join('\n');

const documents = [{
  document_id: 'sintetico-pliego',
  document_version_id: 'sintetico-pliego-v1',
  opportunity_id: IDS.opportunity,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: IDS.opportunity, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-24T00:00:00.000Z' },
      tender: {
        id: 'tender-sintetico', title: 'Proceso sintético', entity: 'Entidad sintética',
        source: 'SECOP II', updated_at: '2026-08-24T00:00:00.000Z',
      },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Sintética Ltda.', updated_at: '2026-08-24T00:00:00.000Z' },
      documents: [],
    }),
  };
}

const analysisContext = () => ({
  snapshotId: IDS.snapshot, documents, documentGaps: [], deepAnalysis: {}, contextV2Sections: contextV2Sections(),
});

function structuralDiscovery(options) {
  const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
  return {
    semanticManifest: discovered,
    categoryOverrides: Object.fromEntries(discovered.requirements.map(requirement => [
      requirement.requirement_id,
      requirement.front === 'financial' ? 'habilitating' : 'technical',
    ])),
    usage: { input_tokens: 11, output_tokens: 5 },
  };
}

/** One governed-abstention WIRE unit per requirement the batch turn was handed (closed batch key set). */
function buildV3BatchWireUnits(input) {
  return input.document_evidence.requirement_manifest.map(entry => ({
    unit_kind: 'tender_requirement',
    requirement_id: entry.requirement_id,
    title: entry.label.slice(0, 200),
    assessment_mode: 'abstained',
    conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
    evidence_refs: [],
    missing_evidence: [],
    commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
  }));
}

/**
 * Answers every batch turn from the input it was handed, after handing the wire units to
 * `mutate` so a test can drive a REAL batch-contract rejection.
 */
function batchAnsweringClient(mutate = units => units) {
  const calls = [];
  const telemetry = { invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 };
  return {
    calls,
    telemetry,
    client: {
      run: async (options) => {
        telemetry.invocationStarted = true;
        telemetry.invocationCount += 1;
        calls.push(options);
        const units = mutate(buildV3BatchWireUnits(options.input), options);
        telemetry.responseReceived = true;
        telemetry.responseCount += 1;
        return {
          content: JSON.stringify({ integral_analysis: { analysis_units: units } }),
          usage: { input_tokens: 13, output_tokens: 17 },
        };
      },
    },
  };
}

/** Always-miss hooks: every batch really executes, and no durable store is ever reached. */
function recordingCheckpointHooks() {
  const loads = [];
  const stores = [];
  return {
    loads,
    stores,
    loadCheckpoint: async (options) => { loads.push(options); return { hit: false }; },
    storeCheckpoint: async (options) => { stores.push(options); return { status: 'created', checkpointId: `cp-${stores.length + 1}` }; },
  };
}

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

function discoveryEngine(client, overrides = {}) {
  return createAgt002PreviewEngine({
    client,
    model: MODEL,
    policyVersion: POLICY_VERSION,
    policyText: AGT002_INTEGRAL_V3_POLICY,
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider: async options => structuralDiscovery(options),
    promptBudget: true,
    promptMaxInputTokens: SERVER_OWNED_MAX_INPUT_TOKENS,
    checkpointHooks: recordingCheckpointHooks(),
    ...overrides,
  });
}

/** Supabase-shaped `.rpc()` double — no real Supabase, pglite or network. */
function fakeDatabase() {
  const calls = [];
  let attemptSeq = 0;
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_append_agt002_analysis_attempt') {
        attemptSeq += 1;
        return { data: { id: `attempt-event-${attemptSeq}`, ...params }, error: null };
      }
      if (name === 'psi_release_agt002_preview_claim') return { data: true, error: null };
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

function unavailableAttemptParams(database) {
  const call = database.calls.find(c => c.name === 'psi_append_agt002_analysis_attempt' && c.params.p_state === 'unavailable');
  return call ? call.params : null;
}

function attemptStates(database) {
  return database.calls.filter(call => call.name === 'psi_append_agt002_analysis_attempt').map(call => call.params.p_state);
}

/** Sweeps an entire serialized surface for anything that must never leave the server. */
function assertNoLeak(surface, label) {
  const serialized = JSON.stringify(surface);
  assert.equal(serialized.includes(HOSTILE_MODEL_MARKER), false, `${label}: raw model output must never leak`);
  assert.equal(serialized.includes('DROP TABLE'), false, `${label}: raw model output must never leak`);
  assert.equal(serialized.includes('5ec3f-secret-token'), false, `${label}: raw model output must never leak`);
  assert.equal(serialized.includes('Residencia de datos'), false, `${label}: raw source text must never leak`);
  for (const fragment of VALIDATOR_MESSAGE_FRAGMENTS) {
    assert.equal(serialized.includes(fragment), false, `${label}: the raw validator message "${fragment}" must never leak`);
  }
}

// --- The two REAL batch-contract violations these tests drive -------------------------------

/**
 * An ALLOWLISTED closed invariant: a `not_applicable` legal assessment that still cites a legal
 * basis. Raised by the shared, unweakened validateAgt002IntegralAnalysisV3Unit that the batch
 * contract runs per unit, with the fixed code `v3_legal_assessment_invariant` — an
 * AGT002_V3_SAFE_VALIDATION_CODES member, exactly like the one-turn path's own rejection.
 */
const ALLOWLISTED_SUBCODE = 'v3_legal_assessment_invariant';
function violateAllowlistedInvariant(units) {
  units[0].title = `${HOSTILE_MODEL_MARKER} ${units[0].title}`.slice(0, 200);
  units[0].legal_assessment = {
    status: 'not_applicable',
    basis_refs: ['legal:unknown'],
    summary: 'No aplica.',
    human_legal_review_required: false,
  };
  return units;
}

/**
 * A NON-allowlisted closed validator code: the batch coverage guard's own
 * `v3_batch_coverage_mismatch`, which is deliberately absent from
 * AGT002_V3_SAFE_VALIDATION_CODES. It must collapse to the generic closed batch code and never
 * reach a durable row — the same fate an unknown/future/hostile code must meet.
 */
function violateNonAllowlistedBatchContract(units) {
  units[0].title = `${HOSTILE_MODEL_MARKER} ${units[0].title}`.slice(0, 200);
  units[0].requirement_id = 'req-que-nunca-fue-asignado';
  return units;
}

// =============================================================================================
// 0. Precondition: the two fixtures really do straddle the closed allowlist boundary.
// =============================================================================================

test('precondition: the driven subcodes straddle the closed allowlist boundary', () => {
  assert.ok(
    AGT002_V3_SAFE_VALIDATION_CODES.includes(ALLOWLISTED_SUBCODE),
    'the allowlisted fixture must name a real AGT002_V3_SAFE_VALIDATION_CODES member',
  );
  assert.equal(
    AGT002_V3_SAFE_VALIDATION_CODES.includes('v3_batch_coverage_mismatch'), false,
    'the non-allowlisted fixture must name a real validator code that is NOT allowlisted',
  );
});

// =============================================================================================
// 1. An allowlisted closed subcode survives the batched path, on the engine's own safe error.
// =============================================================================================

test('batched V3: an allowlisted semantic-validation subcode survives on the engine safe error, stage and public message unchanged', async () => {
  const { client, calls } = batchAnsweringClient(violateAllowlistedInvariant);
  const engine = discoveryEngine(client);

  const error = await engine.analyze(analysisContext()).then(
    () => { throw new Error('test bug: the batched run must reject on the invalid batch turn'); },
    rejection => rejection,
  );

  assert.ok(calls.length >= 1, 'precondition: a real batch turn must have been taken');
  assert.equal(error.code, ALLOWLISTED_SUBCODE, 'the closed, allowlisted invariant subcode must survive to the caller');
  assert.equal(
    error.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
    'the closed semantic_validation stage must be preserved exactly as before',
  );
  assert.equal(error.message, SAFE_UNAVAILABLE, 'the engine public message contract must be unchanged');
  assertNoLeak({ message: error.message, code: error.code, stage: error.stage }, 'engine safe error');
});

// =============================================================================================
// 2. End to end: the subcode reaches the DURABLE attempt row, appended to the EXISTING generic
//    AGT002_INTEGRAL_V3_INVALID message — byte-for-byte the shape the one-turn V3 path produces.
// =============================================================================================

test('batched V3: the allowlisted subcode reaches the durable attempt error_message; generic error_code and generic message preserved', async () => {
  const { client, telemetry } = batchAnsweringClient(violateAllowlistedInvariant);
  const engine = discoveryEngine(client);
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: analysisContext(), bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'AGT002_INTEGRAL_V3_INVALID', 'the generic public error_code must be preserved unchanged');
  assert.deepEqual(attemptStates(database), ['queued', 'running', 'unavailable']);

  const params = unavailableAttemptParams(database);
  assert.equal(params.p_error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.equal(
    params.p_error_message,
    `${GENERIC_V3_ATTEMPT_MESSAGE} [${ALLOWLISTED_SUBCODE}]`,
    'the durable row must carry the fixed generic message with the closed subcode appended — exactly as the one-turn V3 path does',
  );

  const outcome = observability.records.find(record => record.eventType === 'reanalysis_post_bridge_outcome');
  assert.equal(outcome.fields.stage, 'integral_v3_validation', 'the existing post-bridge stage classification is unchanged');
  assert.equal(outcome.fields.error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assertNoLeak({ result, calls: database.calls, records: observability.records }, 'durable + observability surface');
});

// =============================================================================================
// 3. A non-allowlisted closed validator code collapses to the generic closed batch code, and the
//    durable row gets the fixed generic message with NO subcode appended.
// =============================================================================================

test('batched V3: a non-allowlisted validator code never survives; it collapses to the generic closed batch code', async () => {
  const { client, calls } = batchAnsweringClient(violateNonAllowlistedBatchContract);
  const engine = discoveryEngine(client);

  const error = await engine.analyze(analysisContext()).then(
    () => { throw new Error('test bug: the batched run must reject on the invalid batch turn'); },
    rejection => rejection,
  );

  assert.ok(calls.length >= 1, 'precondition: a real batch turn must have been taken');
  // Byte-identical to the pre-change behaviour: a stage-tagged batch rejection whose code is not
  // allowlisted keeps the generic closed invalid-output code it has always had.
  assert.equal(
    error.code, 'AGT002_BATCHED_V3_VALIDATION_INVALID',
    'a non-allowlisted validator code must collapse to the existing generic closed batch code',
  );
  assert.equal(
    error.code.includes('v3_batch_coverage_mismatch'), false,
    'the raw non-allowlisted validator code must never reach the caller',
  );
  assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION, 'the closed stage is still preserved');
  assert.equal(error.message, SAFE_UNAVAILABLE);
  assertNoLeak({ message: error.message, code: error.code, stage: error.stage }, 'engine safe error (non-allowlisted)');
});

test('batched V3: a non-allowlisted validator code leaves the durable row at the fixed generic message, with no subcode', async () => {
  const { client, telemetry } = batchAnsweringClient(violateNonAllowlistedBatchContract);
  const engine = discoveryEngine(client);
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, requestContext(), {
    engine, observability, analysisContext: analysisContext(), bridgeTelemetry: telemetry, integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  const params = unavailableAttemptParams(database);
  assert.equal(params.p_error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.equal(
    params.p_error_message, GENERIC_V3_ATTEMPT_MESSAGE,
    'a non-allowlisted code must leave the fixed generic message untouched — never append an unknown subcode',
  );
  assert.equal(
    params.p_error_message.includes('v3_batch_coverage_mismatch'), false,
    'the raw non-allowlisted validator code must never reach the durable column',
  );
  assertNoLeak({ result, calls: database.calls, records: observability.records }, 'durable + observability surface (non-allowlisted)');
});

// =============================================================================================
// 4. The safe output_rejected diagnostic event is emitted for the batch semantic rejection, with
//    only closed/derived fields — never raw content — exactly like the one-turn V3 path.
// =============================================================================================

test('batched V3: the batch semantic rejection emits the existing safe output_rejected event with only closed, derived fields', async () => {
  const observability = spyObservability();
  const { client } = batchAnsweringClient(violateAllowlistedInvariant);
  const engine = discoveryEngine(client, { observability });

  await engine.analyze(analysisContext()).catch(() => {});

  const rejected = observability.records.filter(record => record.eventType === 'output_rejected');
  assert.equal(rejected.length, 1, 'exactly one output_rejected event per batch semantic rejection — never one per retry');
  const fields = rejected[0].fields;
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(fields.validation_code, ALLOWLISTED_SUBCODE, 'the closed allowlisted subcode is the diagnostic value');
  assert.equal(fields.snapshot_id, IDS.snapshot);
  assert.match(fields.content_sha256, /^[0-9a-f]{64}$/, 'content is hashed, never carried');
  assert.ok(Number.isInteger(fields.content_bytes) && fields.content_bytes > 0, 'content is measured, never carried');
  assert.equal(fields.input_tokens, 13);
  assert.equal(fields.output_tokens, 17);
  assertNoLeak(rejected, 'output_rejected event');
});

test('batched V3: a non-allowlisted validator code degrades the output_rejected event to the generic closed diagnostic value', async () => {
  const observability = spyObservability();
  const { client } = batchAnsweringClient(violateNonAllowlistedBatchContract);
  const engine = discoveryEngine(client, { observability });

  await engine.analyze(analysisContext()).catch(() => {});

  const rejected = observability.records.filter(record => record.eventType === 'output_rejected');
  assert.equal(rejected.length, 1);
  assert.equal(
    rejected[0].fields.validation_code, 'v3_invariant_violation',
    'an unknown/non-allowlisted validator code must degrade to the generic closed diagnostic value, never be copied',
  );
  assertNoLeak(rejected, 'output_rejected event (non-allowlisted)');
});

// =============================================================================================
// 5. The EXISTING queue classification is unchanged: a batched V3 semantic-validation rejection
//    is still invalid_output — never provider_error — whichever frontier it is classified at.
// =============================================================================================

test('batched V3: the semantic-validation rejection still classifies as invalid_output, never provider_error', async () => {
  const { client } = batchAnsweringClient(violateAllowlistedInvariant);
  const engine = discoveryEngine(client);

  const error = await engine.analyze(analysisContext()).then(
    () => { throw new Error('test bug: the batched run must reject on the invalid batch turn'); },
    rejection => rejection,
  );

  assert.equal(
    classifyAgt002ReanalysisWorkerError(error), 'invalid_output',
    'preserving the closed subcode must not reclassify a semantic-validation rejection as a provider failure',
  );
});
