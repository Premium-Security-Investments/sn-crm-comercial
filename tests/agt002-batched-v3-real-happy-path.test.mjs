// AGT-002 durable batched V3 — the REAL happy path, end to end.
//
// WHY THIS FILE EXISTS
//   Every other test around this fix pins a REFUSAL (the planner failing closed, the cap being
//   forwarded, a bad projection being rejected). None of them proves the thing the fix actually
//   buys: that runAgt002BatchedV3Analysis, driving its REAL planner
//   (planAgt002IntegralAnalysisBatches) and its REAL executeBatch, now completes a discovered-
//   frontier run — sending the projected request, under the server-owned cap, with one durable
//   checkpoint per batch. Without this, a change that made planning "succeed" by producing a plan
//   nothing can execute would still look green.
//
// WHAT IS REAL AND WHAT IS NOT
//   Real: createAgt002PreviewEngine, the discovered-frontier packet assembly, the V3 validation
//   context, runAgt002BatchedV3Analysis (planner, projector, per-batch contract, merge, envelope).
//   Fake: the provider client (a pure function over the input it is handed), the semantic-discovery
//   provider (structural, no turn), and the checkpoint hooks (in-memory, always a miss).
//   No provider, bridge, network, Supabase or secret is touched; every fixture is synthetic.
//
// Run: node --test tests/agt002-batched-v3-real-happy-path.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  AGT002_INTEGRAL_V3_POLICY,
  AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY,
  createAgt002PreviewEngine,
  runAgt002BatchedV3Analysis,
} from '../agt002-preview-engine.js';
import { buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { estimateAgt002V3RequestTokens } from '../agt002-v3-prompt-budget.js';
import { projectAgt002IntegralAnalysisBatch } from '../agt002-integral-analysis-batches.js';

const hash = value => createHash('sha256').update(value).digest('hex');

const MODEL = 'synthetic-codex-model';
const SNAPSHOT_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const OPPORTUNITY_ID = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';
const POLICY_VERSION = 'agt002-integral-v3-policy-test';
const BATCHED_STAGE = 'integral_analysis_batch';

// The same server-owned, non-default cap the propagation test pins: comfortably above this tiny
// synthetic frontier, so the run must COMPLETE rather than fail closed.
const SERVER_OWNED_MAX_INPUT_TOKENS = 180_000;

// Four single-newline lines, so the inventory segments one source unit per line and discovery
// resolves exactly two requirements — enough to force a real multi-batch plan below.
const PLIEGO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
].join('\n');

const documents = [{
  document_id: 'sintetico-pliego',
  document_version_id: 'sintetico-pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
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
      opportunity: { id: OPPORTUNITY_ID, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-24T00:00:00.000Z' },
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
  snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: {}, contextV2Sections: contextV2Sections(),
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

// One governed-abstention WIRE unit per requirement the batch turn was actually handed. Deliberately
// the CLOSED batch key set (AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS): unit_id, sequence, category
// and evidence_state are server-owned and are rejected outright if a batch turn offers them, so a
// unit built for the one-turn contract would NOT validate here.
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

/** Records every provider turn verbatim and answers each one from the input it was handed. */
function batchAnsweringClient() {
  const calls = [];
  return {
    calls,
    run: async (options) => {
      calls.push(options);
      return {
        content: JSON.stringify({ integral_analysis: { analysis_units: buildV3BatchWireUnits(options.input) } }),
        usage: { input_tokens: 13, output_tokens: 17 },
      };
    },
  };
}

/** Always-miss hooks that record every durable boundary this run crosses. */
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
    ...overrides,
  });
}

/** The request size, measured exactly as the planner measures it, for a turn already taken. */
const sentRequestTokens = call => estimateAgt002V3RequestTokens({
  model: call.model, policy: call.policy, input: call.input, outputSchema: call.outputSchema,
});

function assertProjectedModelInput(input, label) {
  const evidence = input.document_evidence;
  assert.equal(
    Object.prototype.hasOwnProperty.call(evidence, 'tender_requirement_inventory'), false,
    `${label}: the per-source-unit inventory ledger must never be sent to the provider`,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(evidence, 'tender_semantic_manifest'), false,
    `${label}: the per-source-unit semantic ledger must never be sent to the provider`,
  );
  assert.ok(
    evidence[AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY],
    `${label}: the server-derived frontier summary must replace the two ledgers`,
  );
  // The summary is arithmetic only — no source unit may be identifiable through it.
  const serializedSummary = JSON.stringify(evidence[AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY]);
  assert.equal(serializedSummary.includes('SU-'), false, `${label}: no source_unit_id may reach the summary`);
  assert.equal(serializedSummary.includes('Residencia de datos'), false, `${label}: no raw source text may reach the summary`);
}

// =============================================================================================
// 1. MULTI-BATCH HAPPY PATH. The real orchestrator is reached through the engine (so the engine's
//    own server-owned cap really is what governs the plan) and is only re-entered with a smaller
//    maxRequirementsPerBatch — a value the engine does not expose — so this tiny frontier produces
//    a genuine two-batch plan. Everything downstream of that (planner, projector, per-batch
//    contract, merge, envelope) is the real implementation.
// =============================================================================================
test('a real discovered run completes: projected requests under the cap, one checkpoint per batch', async () => {
  const client = batchAnsweringClient();
  const hooks = recordingCheckpointHooks();
  let orchestratorArgs = null;
  const engine = discoveryEngine(client, {
    checkpointHooks: hooks,
    batchedV3Orchestrator: (args) => {
      orchestratorArgs = args;
      return runAgt002BatchedV3Analysis({ ...args, maxRequirementsPerBatch: 1 });
    },
  });

  const envelope = await engine.analyze(analysisContext());

  // --- the plan the run actually executed -----------------------------------------------------
  assert.equal(orchestratorArgs.maxInputTokens, SERVER_OWNED_MAX_INPUT_TOKENS, 'precondition: the server-owned cap governed this plan');
  const governedIds = orchestratorArgs.previewInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id);
  assert.ok(governedIds.length >= 2, 'precondition: the fixture must discover at least two requirements to produce two batches');
  assert.equal(client.calls.length, governedIds.length, 'one provider turn per single-requirement batch — the plan really was executed');

  // --- what was SENT ---------------------------------------------------------------------------
  const seenRequirementIds = [];
  for (const [index, call] of client.calls.entries()) {
    assertProjectedModelInput(call.input, `batch ${index}`);
    const batchMeta = call.input.document_evidence.integral_analysis_batch;
    assert.equal(batchMeta.batch_index, index, `batch ${index}: the projected batch carries its real index`);
    assert.equal(batchMeta.batch_count, governedIds.length, `batch ${index}: the projected batch carries the real shared batch_count`);
    assert.deepEqual(
      call.input.document_evidence.requirement_manifest.map(entry => entry.requirement_id), batchMeta.requirement_ids,
      `batch ${index}: the sliced manifest is exactly this batch's assignment`,
    );
    seenRequirementIds.push(...batchMeta.requirement_ids);

    // The whole point of the fix: what is sent fits the cap the plan was made against. (The plan's
    // own recorded estimate is a strict UPPER bound on this — it is computed with the wider
    // full-turn planning schema, since the narrow per-batch schema cannot exist before planning —
    // so a sent request under the cap is necessarily under its estimate too.)
    assert.ok(
      sentRequestTokens(call) <= SERVER_OWNED_MAX_INPUT_TOKENS,
      `batch ${index}: the request actually sent must fit the server-owned cap`,
    );
    assert.equal(call.model, MODEL);
    assert.equal(call.timeoutMs, 2000);
  }
  assert.deepEqual(seenRequirementIds, governedIds, 'every governed requirement is covered exactly once, in order, across the batches');

  // --- one durable checkpoint per batch --------------------------------------------------------
  assert.equal(hooks.loads.length, governedIds.length, 'every batch is looked up in the checkpoint store before its turn');
  assert.equal(hooks.stores.length, governedIds.length, 'exactly one checkpoint is written per batch');
  const requestHashes = new Set();
  for (const [index, store] of hooks.stores.entries()) {
    assert.equal(store.stage, BATCHED_STAGE);
    assert.equal(store.batchIndex, index);
    assert.equal(store.completedBatchCount, index + 1);
    assert.equal(store.totalBatchCount, governedIds.length);
    assert.equal(store.progressPhase, 'integral_analysis');
    assert.ok(store.requestHash, `batch ${index}: a checkpoint is always keyed by its request hash`);
    assert.equal(store.requestHash, hooks.loads[index].expectedRequestHash, `batch ${index}: load and store agree on the request hash`);
    requestHashes.add(store.requestHash);
    assert.match(store.outputSha256, /^[0-9a-f]{64}$/, `batch ${index}: the stored output is content-addressed`);
    assert.equal(store.usage.input_tokens, 13);
    assert.equal(store.usage.output_tokens, 17);
  }
  assert.equal(requestHashes.size, governedIds.length, 'each batch has its own distinct request hash — never a shared/colliding key');

  // --- the envelope ----------------------------------------------------------------------------
  assert.equal(envelope.status, 'completed');
  assert.equal(envelope.run_id, FIXED_RUN_ID);
  assert.equal(envelope.policy_version, POLICY_VERSION);
  assert.deepEqual(
    envelope.integral_analysis.analysis_units.map(unit => unit.requirement_id), governedIds,
    'the merged analysis covers the full governed frontier exactly once, in manifest order',
  );
  // Discovery's own usage plus every batch's, never dropped on the floor.
  assert.equal(envelope.usage.input_tokens, 11 + (13 * governedIds.length));
  assert.equal(envelope.usage.output_tokens, 5 + (17 * governedIds.length));
});

// =============================================================================================
// 2. The engine's OWN default orchestrator — no injection of any kind — completes the same run.
//    This is the path production takes; the test above only narrows maxRequirementsPerBatch.
// =============================================================================================
test('the engine\'s default batched orchestrator completes a discovered run with no injection', async () => {
  const client = batchAnsweringClient();
  const hooks = recordingCheckpointHooks();
  const engine = discoveryEngine(client, { checkpointHooks: hooks });

  const envelope = await engine.analyze(analysisContext());

  assert.equal(envelope.status, 'completed');
  assert.equal(client.calls.length, 1, 'this frontier fits one batch, so the real planner must not split it');
  assert.equal(hooks.stores.length, 1, 'one batch, one checkpoint');
  assertProjectedModelInput(client.calls[0].input, 'single batch');
  assert.ok(sentRequestTokens(client.calls[0]) <= SERVER_OWNED_MAX_INPUT_TOKENS);
  assert.ok(envelope.integral_analysis.analysis_units.length >= 2);

  // Privacy: neither the checkpoint payloads nor the plan metadata may carry expediente text.
  const serializedBoundaries = JSON.stringify({ loads: hooks.loads, stores: hooks.stores.map(store => ({
    stage: store.stage, batchIndex: store.batchIndex, requestHash: store.requestHash,
    stageContractVersion: store.stageContractVersion, outputSha256: store.outputSha256,
    completedBatchCount: store.completedBatchCount, totalBatchCount: store.totalBatchCount,
  })) });
  for (const leak of ['Residencia de datos', 'apalancamiento', 'REQUISITOS']) {
    assert.equal(serializedBoundaries.includes(leak), false, 'no expediente content may reach a checkpoint key or its metadata');
  }
});

// =============================================================================================
// 3. LEDGER-DOMINATED HAPPY PATH — the real incident's shape, end to end.
//
//    The two tests above run on a four-line pliego whose audit ledgers are negligible; the shape
//    that actually broke production is a discovered frontier with THOUSANDS of source units, where
//    `tender_requirement_inventory` + `tender_semantic_manifest` dwarf everything the model is ever
//    shown. This fixture reproduces that asymmetry with a real document, through the real engine and
//    the real default orchestrator, and pins that the run COMPLETES with the ledgers stripped from
//    every sent request.
// =============================================================================================

// ~900 NON-normative filler lines around the same two resolvable requirements: one source unit per
// line, so `tender_requirement_inventory` carries ~900 entries with their text — the exact asymmetry
// of a real expediente (thousands of source units, a handful of governed requirements) — while the
// governed frontier stays at two requirements.
const LEDGER_FILLER_LINES = 900;
const LEDGER_PLIEGO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  ...Array.from(
    { length: LEDGER_FILLER_LINES },
    (_value, index) => `Nota informativa ${String(index + 1).padStart(4, '0')} sobre la publicacion del proceso en la plataforma electronica con radicado numero ${String(index + 1).padStart(4, '0')}.`,
  ),
].join('\n');

const ledgerDocuments = [{
  ...documents[0],
  content_hash: hash(LEDGER_PLIEGO_TEXT),
  extracted_text: LEDGER_PLIEGO_TEXT,
}];

const ledgerAnalysisContext = () => ({
  snapshotId: SNAPSHOT_ID, documents: ledgerDocuments, documentGaps: [], deepAnalysis: {}, contextV2Sections: contextV2Sections(),
});

test('a ledger-dominated discovered frontier completes: the audit ledgers never reach the provider and every sent request stays far under the cap', async () => {
  const client = batchAnsweringClient();
  const hooks = recordingCheckpointHooks();
  let orchestratorArgs = null;
  const engine = discoveryEngine(client, {
    checkpointHooks: hooks,
    batchedV3Orchestrator: (args) => { orchestratorArgs = args; return runAgt002BatchedV3Analysis(args); },
  });

  const envelope = await engine.analyze(ledgerAnalysisContext());

  // --- fixture sanity: the ledgers really do dominate, exactly as they did in production --------
  // The canonical governed ORDER is the validation context's (withRequirementGovernedFields
  // re-projects document_evidence.requirement_manifest onto it before planning), so coverage is
  // asserted against that, never against the pre-governance manifest order.
  const governedIds = orchestratorArgs.validationContext.requirementManifest.map(entry => entry.requirement_id);
  const unprojected = projectAgt002IntegralAnalysisBatch({
    previewInput: orchestratorArgs.previewInput,
    batch: {
      batch_index: 0,
      batch_count: 1,
      requirement_ids: orchestratorArgs.previewInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id),
    },
  });
  const unprojectedTokens = estimateAgt002V3RequestTokens({
    model: MODEL, policy: AGT002_INTEGRAL_V3_POLICY, input: unprojected, outputSchema: {},
  });
  const sentTokens = sentRequestTokens(client.calls[0]);
  assert.ok(
    sentTokens * 4 < unprojectedTokens,
    `fixture sanity: the audit ledgers must dominate the un-projected shape (sent ${sentTokens} vs un-projected ${unprojectedTokens})`,
  );

  // --- the run completed, on the real planner + real executeBatch ------------------------------
  assert.equal(envelope.status, 'completed');
  assert.ok(client.calls.length >= 1, 'the provider really was asked');
  assert.equal(hooks.stores.length, client.calls.length, 'one durable checkpoint per batch turn');
  const seen = [];
  for (const [index, call] of client.calls.entries()) {
    assertProjectedModelInput(call.input, `ledger batch ${index}`);
    assert.ok(
      sentRequestTokens(call) <= SERVER_OWNED_MAX_INPUT_TOKENS,
      `ledger batch ${index}: the request actually sent must fit the server-owned cap`,
    );
    seen.push(...call.input.document_evidence.integral_analysis_batch.requirement_ids);
  }
  assert.deepEqual(seen, governedIds, 'every governed requirement is covered exactly once, in order');
  assert.deepEqual(
    envelope.integral_analysis.analysis_units.map(unit => unit.requirement_id), governedIds,
    'the merged envelope still covers the whole governed frontier',
  );

  // The durable envelope keeps the full per-source-unit ledgers the provider was never shown: the
  // projection is model-facing only, never a loss of governed audit material.
  const envelopeEvidence = envelope.evidence_coverage ?? {};
  assert.ok(
    JSON.stringify(envelopeEvidence).includes('Nota informativa') || Object.keys(envelopeEvidence).length > 0,
    'the durable envelope still carries its own evidence coverage, independent of what the model was shown',
  );
});

// =============================================================================================
// 4. NULL-OMISSION DOMINATED — the reduction ladder must run PER BATCH.
//
//    `omitted_chunks` entries with `requirement_id: null` are BATCH-INVARIANT: the Task-4 projector
//    deliberately keeps every one of them in every batch (they belong to no single requirement). So
//    when they dominate the request, splitting is powerless — halving the batches down to a lone
//    requirement changes nothing, and the planner fails closed with "un único requisito excede el
//    presupuesto" after re-serializing the whole list on every candidate.
//
//    The existing, already-governed reduction ladder (agt002-v3-prompt-budget.js: summarize
//    omitted_chunks first, then water-fill selected_chunks text) is exactly the right lever, and it
//    must be applied identically when PLANNING and when SENDING — otherwise the plan sizes one
//    request and the provider receives another.
// =============================================================================================
const NULL_OMITTED_COUNT = 4000;

function withNullOmittedChunks(previewInput) {
  const omitted = Array.from({ length: NULL_OMITTED_COUNT }, (_value, index) => ({
    evidence_ref: `EV-OMIT-${String(index + 1).padStart(5, '0')}`,
    chunk_id: `CHUNK-OMIT-${String(index + 1).padStart(5, '0')}`,
    document_id: 'sintetico-pliego',
    document_version_id: 'sintetico-pliego-v1',
    document_type: 'pliego',
    // The batch-invariant kind: it belongs to no single requirement, so no split can shed it.
    requirement_id: null,
    reason: index % 2 === 0 ? 'budget_exhausted' : 'low_similarity',
  }));
  return {
    ...previewInput,
    document_evidence: { ...previewInput.document_evidence, omitted_chunks: omitted },
  };
}

test('a batch-invariant omitted_chunks list is reduced deterministically per batch, so a run that no split could rescue completes', async () => {
  // A real engine run first, purely to obtain the REAL discovered previewInput/validationContext and
  // the exact argument set the engine hands its orchestrator.
  let captured = null;
  const probeEngine = discoveryEngine(batchAnsweringClient(), {
    checkpointHooks: recordingCheckpointHooks(),
    batchedV3Orchestrator: (args) => { captured = args; return runAgt002BatchedV3Analysis(args); },
  });
  await probeEngine.analyze(analysisContext());

  const previewInput = withNullOmittedChunks(captured.previewInput);
  const governedIds = previewInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id);
  assert.ok(governedIds.length >= 2, 'precondition: the fixture must have more than one requirement, so splitting is even possible');

  // --- precondition: splitting really is powerless here ----------------------------------------
  const lone = projectAgt002IntegralAnalysisBatch({
    previewInput, batch: { batch_index: 0, batch_count: governedIds.length, requirement_ids: governedIds.slice(0, 1) },
  });
  assert.equal(
    lone.document_evidence.omitted_chunks.length, NULL_OMITTED_COUNT,
    'precondition: a lone-requirement batch still carries every null-requirement omission — the split cannot shed them',
  );

  // A cap that the un-reduced request cannot meet at ANY batch size, but that the reduced request
  // fits comfortably.
  const loneTokens = estimateAgt002V3RequestTokens({
    model: MODEL, policy: AGT002_INTEGRAL_V3_POLICY, input: lone, outputSchema: {},
  });
  const maxInputTokens = Math.floor(loneTokens / 2);

  const client = batchAnsweringClient();
  const hooks = recordingCheckpointHooks();
  const envelope = await runAgt002BatchedV3Analysis({
    ...captured, previewInput, client, checkpointHooks: hooks, maxInputTokens,
  });

  assert.equal(envelope.status, 'completed', 'the reduction ladder must rescue a run no split could');
  assert.ok(client.calls.length >= 1);
  for (const [index, call] of client.calls.entries()) {
    const evidence = call.input.document_evidence;
    assert.deepEqual(evidence.omitted_chunks, [], `batch ${index}: the batch-invariant omission list must be summarized away`);
    assert.equal(
      evidence.omitted_chunks_reduction.source_count, NULL_OMITTED_COUNT,
      `batch ${index}: the governed provenance record must preserve how many omissions were summarized`,
    );
    assert.deepEqual(
      Object.keys(evidence.omitted_chunks_reduction.by_reason_counts).sort(), ['budget_exhausted', 'low_similarity'],
      `batch ${index}: the by-reason distribution must survive the summary`,
    );
    assert.ok(
      sentRequestTokens(call) <= maxInputTokens,
      `batch ${index}: planning and sending must agree — what is sent must fit the cap the plan was made against`,
    );
    // Never a citable boundary: an omitted chunk was never in the allowlist and must not appear.
    assert.equal(JSON.stringify(evidence.citation_allowlist).includes('EV-OMIT-'), false, `batch ${index}: an omitted chunk is never citable`);
  }
  assert.equal(hooks.stores.length, client.calls.length, 'one durable checkpoint per batch turn, unchanged');
});
