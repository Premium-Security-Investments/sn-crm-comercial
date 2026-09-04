// AGT-002 — closed staging for the LOCAL, pre-provider-call frontiers between the last successful
// semantic-discovery bridge turn and the analysis bridge call: discovered-input assembly and
// integral validation-context construction. Prompt budgeting (agt002-preview-engine.js's runOnceV3)
// and beforeProviderCall/lease renewal already had closed stages/codes of their own before this file
// existed (AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE and the AGT002_LEASE_LOST_CODES-based check in
// classifyEnginePhase, respectively) — this file covers the two frontiers that did not.
//
// WHY THIS MATTERS: the real Procuraduria reanalysis proves only stage=unexpected,
// bridge_response_received latched true, and persistence_attempts=0 after 18 successful discovery
// turns. It does NOT prove which local frontier actually failed — a lost preview lease is one
// hypothesis (see tests/agt002-post-bridge-lease-stage-classification.test.mjs), but an untagged
// throw from EITHER of the two local assembly steps this file covers would have produced the exact
// same observable signature, because before this fix neither carried a `.stage` and both fell
// through to the engine's generic catch, which preserves only `.code`. Closing this gap means a
// future run in this window is attributed to envelope_build/AGT002_ENVELOPE_INVALID/invalid_output
// deterministically, regardless of what the discovery-turn bridge telemetry looks like — never to
// 'unexpected'/provider_error by falling back to the telemetry heuristic.
//
// No real provider, network, secret, Supabase or tender/company content anywhere below — every
// fixture is synthetic and structural.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import { assembleTenderSemanticManifest, buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import {
  AGT002_POST_BRIDGE_ERROR_CODES,
  AGT002_POST_BRIDGE_STAGES,
  runAgt002PostBridgeAnalysis,
} from '../agt002-post-bridge-observability.js';
import { createAgt002ReanalysisExecutor } from '../agt002-reanalysis-executor.js';

const hash = value => createHash('sha256').update(value).digest('hex');

function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

function baseEngineOptions(overrides = {}) {
  return {
    client: { run: async () => { throw new Error('client.run must not be reached: a local pre-provider-call frontier must fail before the analysis turn is ever issued'); } },
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Discovered-input assembly: the real engine, the real buildAgt002PreviewInput /
// validateTenderSemanticManifest — a structurally invalid discovery result (the discovery turn
// itself "succeeded", but its semantic manifest cannot be re-validated against this snapshot's own
// inventory) must fail BEFORE any provider call, tagged ENVELOPE, never surfacing as the engine's
// generic stage-less SAFE_UNAVAILABLE.
// ---------------------------------------------------------------------------------------------
{
  const observability = spyObservability();
  const engine = createAgt002PreviewEngine(baseEngineOptions({
    observability,
    // The discovery turn itself resolves normally (no rejection at all): the failure is entirely
    // local, downstream of a "successful" bridge turn — exactly the shape that used to collapse
    // into 'unexpected'.
    semanticDiscoveryProvider: async () => ({
      semanticManifest: { semantic_manifest_version: 'not-a-real-version', requirements: 'not-an-array' },
      categoryOverrides: {},
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  }));

  await assert.rejects(
    () => engine.analyze({ snapshotId: '00000000-0000-4000-8000-0000000000e1', documents: [] }),
    (error) => {
      assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.',
        'the public message contract stays exactly the fixed SAFE_INVALID string');
      assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE,
        'REGRESSION: before this fix, a local discovered-input assembly failure carried no stage at all');
      return true;
    },
  );

  assert.equal(observability.records.length, 1, 'exactly one output_rejected event, never zero');
  const { eventType, fields } = observability.records[0];
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE);
  assert.equal(fields.validation_code, 'v4_discovered_input_assembly_failed');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes('not-a-real-version'), 'no raw manifest content may leak into the observability event');
}

// ---------------------------------------------------------------------------------------------
// 1b. Integral validation-context construction: the real engine, the real
// buildIntegralV3ValidationContext / deriveAgt002IntegralCategoryManifest — a discovered
// requirement filed under the 'legal' front (which has no direct front->category mapping and is
// neither of the two closed legal ids) with no governed categoryOverrides entry for it must fail
// BEFORE any provider call, tagged ENVELOPE with validation_code
// v4_validation_context_construction_failed — never surfacing as the engine's generic
// stage-less SAFE_UNAVAILABLE. This is a hypothetical malformed-discovery scenario constructed to
// exercise the real failure path, not a claim about the historical Procuraduria incident's cause.
// ---------------------------------------------------------------------------------------------
{
  const snapshotId = '00000000-0000-4000-8000-0000000000f1';
  const opportunityId = '00000000-0000-4000-8000-0000000000f2';
  const text = [
    'REQUISITOS TÉCNICOS',
    'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  ].join('\n');
  const documents = [{
    document_id: 'doc-validation-context', document_version_id: 'doc-validation-context-v1',
    opportunity_id: opportunityId, snapshot_id: null, document_type: 'pliego', name: 'Pliego.pdf',
    version: 1, content_hash: hash(text), current: true, extracted_text: text,
  }];
  const inventory = buildAgt002TenderRequirementInventory({ snapshotId, documents, documentGaps: [] });
  const structural = buildTenderSemanticManifest({ inventory, documents });
  const technical = structural.requirements.find(requirement => requirement.front === 'technical');
  assert.ok(technical, 'sanity: the fixture must resolve at least one real obligation to relabel');

  // The governed model-proposal path (tender-semantic-discovery.js's own assembler): a discovered
  // requirement anchored to the exact same real citations, but filed under 'legal' instead of
  // 'technical' — a front with no direct category mapping in agt002-integral-category-manifest.js.
  const legalManifest = assembleTenderSemanticManifest({
    inventory, documents, origin: 'model_proposal',
    proposalHash: hash('propuesta-modelo:validation-context-construction-failure'),
    requirements: [{
      kind: technical.kind,
      label: technical.label,
      front: 'legal',
      front_evidence: { ...technical.front_evidence },
      citations: technical.citations.map(citation => ({ ...citation })),
    }],
  });

  const observability = spyObservability();
  const engine = createAgt002PreviewEngine(baseEngineOptions({
    observability,
    // No governed categoryOverrides entry exists for the discovered legal requirement above, so
    // deriveAgt002IntegralCategoryManifest fails closed instead of fabricating a category.
    semanticDiscoveryProvider: async () => ({
      semanticManifest: legalManifest,
      categoryOverrides: {},
      usage: { input_tokens: 6, output_tokens: 3 },
    }),
  }));

  await assert.rejects(
    () => engine.analyze({
      snapshotId, documents, documentGaps: [], deepAnalysis: {},
      contextV2Sections: {
        ...buildAgt002OpportunityContextV2({
          opportunity: { id: opportunityId, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-24T00:00:00.000Z' },
          tender: { id: 'tender-validation-context', title: 'Proceso sintético', entity: 'Entidad sintética', source: 'SECOP II', updated_at: '2026-08-24T00:00:00.000Z' },
        }),
        company_dossier: buildAgt002CompanyDossier({
          profile: { legal_name: 'Seguridad Sintética Ltda.', updated_at: '2026-08-24T00:00:00.000Z' },
          documents: [],
        }),
      },
    }),
    (error) => {
      assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.',
        'the public message contract stays exactly the fixed SAFE_INVALID string');
      assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE,
        'REGRESSION: before this fix, a local validation-context construction failure carried no stage at all');
      return true;
    },
  );

  assert.equal(observability.records.length, 1, 'exactly one output_rejected event, never zero — no provider call was ever attempted');
  const { eventType, fields } = observability.records[0];
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE);
  assert.equal(fields.validation_code, 'v4_validation_context_construction_failed');

  const serialized = JSON.stringify(observability.records);
  assert.ok(!serialized.includes(technical.label), 'no raw obligation label may leak into the observability event');
  assert.ok(!serialized.includes('Residencia de datos'), 'no raw document text may leak into the observability event');

  // Fed through the same post-bridge/queue boundary as every other closed frontier: SAFE_INVALID +
  // ENVELOPE reaches the queue as invalid_output, never provider_error, and no run is fabricated.
  const database = {
    calls: [],
    rpc(name, args) {
      database.calls.push({ name, args });
      return Promise.resolve({ data: name === 'psi_append_agt002_analysis_attempt' ? { id: 'attempt-validation-context-1' } : true, error: null });
    },
  };
  const outcomeRecords = [];
  const postBridgeResult = await runAgt002PostBridgeAnalysis(database, {
    opportunityId, tenderId: '00000000-0000-4000-8000-0000000000f3', snapshotId,
    contextVersionId: '00000000-0000-4000-8000-0000000000f4', attemptKey: 'attempt-validation-context-1',
    correlationId: '00000000-0000-4000-8000-0000000000f5', claimId: null, idempotencyKey: null,
    canonicalOnly: true, requireTenderRequirementInventory: false,
  }, {
    engine: { analyze: async () => { throw Object.assign(new Error('AGT-002 Preview no produjo una respuesta válida.'), { stage: AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE }); } },
    observability: { record: (event, eventFields) => { outcomeRecords.push({ event, fields: eventFields }); } },
    analysisContext: { documents: [] },
    bridgeTelemetry: { invocationStarted: true, responseReceived: true, invocationCount: 18, responseCount: 18 },
    integralContractV3: true,
  });
  assert.equal(postBridgeResult.status, 'unavailable');
  assert.equal(postBridgeResult.analysis_run_id, null, 'no run may be fabricated for an analysis turn that never happened');
  assert.equal(postBridgeResult.error_code, AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID);
  assert.notEqual(postBridgeResult.error_code, AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR);
  const outcome = outcomeRecords.find(record => record.event === 'reanalysis_post_bridge_outcome');
  assert.ok(outcome, 'exactly one outcome event is still emitted');
  assert.equal(outcome.fields.stage, AGT002_POST_BRIDGE_STAGES.ENVELOPE_BUILD);

  const executor = createAgt002ReanalysisExecutor({
    environment: {},
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'preview-lease-validation-context-1' }),
    releasePreviewClaim: async () => {},
    countDailyRuns: async () => 0,
    createRuntime: () => ({ analyze() {}, manifestScope: null }),
    runPostBridgeAnalysis: async () => postBridgeResult,
    createCorrelationId: () => 'correlation-validation-context-1',
    observability: { record() {} },
  });
  const queueResult = await executor({ kind: 'db' }, {
    jobId: 'job-validation-context-1', leaseId: 'lease-validation-context-1', opportunityId, tenderId: 'tender-1',
    snapshotId, contextVersionId: 'context-1', idempotencyKey: 'key-validation-context-1', requestedBy: 'actor-1',
    frozenEngineInput: {
      schema_version: 1,
      engine_identity: { model: 'model-1', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2 },
      analysis_flags: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
      analysis_context: { opportunity: { id: opportunityId }, documents: [], snapshotId, canonicalOnly: true },
      legal_corpus_context: null,
      integral_v3_governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
      manizales_manifest_source: null,
    },
  });
  assert.equal(queueResult.error_code, 'invalid_output', 'a local pre-provider-call validation-context failure must reach the queue as invalid_output, never provider_error');
}

// ---------------------------------------------------------------------------------------------
// 2. Queue-boundary classification: both discovered-input assembly and integral
// validation-context construction share the identical ENVELOPE stage-tagging code path in
// agt002-preview-engine.js (same catch shape, same `safe(SAFE_INVALID, { stage: ENVELOPE })`), so
// this classification-layer proof covers both frontiers identically: the exact ENVELOPE-tagged
// error either one now produces is classified deterministically to envelope_build ->
// AGT002_ENVELOPE_INVALID -> the queue's invalid_output, even when the discovery-turn bridge
// telemetry is fully latched (invocationCount === responseCount, responseReceived === true) —
// proving it is NOT relying on the bridge-telemetry heuristic that misattributed the real run.
// ---------------------------------------------------------------------------------------------
{
  const telemetryAfterDiscovery = { invocationStarted: true, responseReceived: true, invocationCount: 18, responseCount: 18 };
  const database = {
    calls: [],
    rpc(name, args) {
      database.calls.push({ name, args });
      return Promise.resolve({ data: name === 'psi_append_agt002_analysis_attempt' ? { id: 'attempt-1' } : true, error: null });
    },
  };

  const outcomeRecords = [];
  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: '00000000-0000-4000-8000-000000000031',
    tenderId: '00000000-0000-4000-8000-000000000032',
    snapshotId: '00000000-0000-4000-8000-000000000033',
    contextVersionId: '00000000-0000-4000-8000-000000000034',
    attemptKey: 'attempt-discovered-frontier-1',
    correlationId: '00000000-0000-4000-8000-000000000035',
    claimId: null,
    idempotencyKey: null,
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    // Exactly what the real engine now produces for EITHER new frontier (see block 1 above).
    engine: { analyze: async () => { throw Object.assign(new Error('AGT-002 Preview no produjo una respuesta válida.'), { stage: AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE }); } },
    observability: { record: (event, fields) => { outcomeRecords.push({ event, fields }); } },
    analysisContext: { documents: [] },
    bridgeTelemetry: telemetryAfterDiscovery,
    integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(
    result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID,
    'REGRESSION: an untagged version of this failure used to collapse to AGT002_UNEXPECTED_ERROR once discovery had latched responseReceived',
  );
  assert.notEqual(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.PROVIDER_ERROR);
  assert.notEqual(result.error_code, AGT002_POST_BRIDGE_ERROR_CODES.UNEXPECTED_ERROR);

  const outcome = outcomeRecords.find(record => record.event === 'reanalysis_post_bridge_outcome');
  assert.ok(outcome, 'exactly one outcome event is still emitted');
  assert.equal(
    outcome.fields.stage, AGT002_POST_BRIDGE_STAGES.ENVELOPE_BUILD,
    'the durable/observable stage must be the closed envelope_build frontier, not unexpected',
  );

  const executor = createAgt002ReanalysisExecutor({
    environment: {},
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'preview-lease-discovered-1' }),
    releasePreviewClaim: async () => {},
    countDailyRuns: async () => 0,
    createRuntime: () => ({ analyze() {}, manifestScope: null }),
    runPostBridgeAnalysis: async () => ({ status: 'unavailable', analysis_run_id: null, error_code: AGT002_POST_BRIDGE_ERROR_CODES.ENVELOPE_INVALID }),
    createCorrelationId: () => 'correlation-discovered-1',
    observability: { record() {} },
  });
  const job = {
    jobId: 'job-discovered-1', leaseId: 'lease-discovered-1', opportunityId: 'opp-1', tenderId: 'tender-1',
    snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-discovered-1', requestedBy: 'actor-1',
    frozenEngineInput: {
      schema_version: 1,
      engine_identity: { model: 'model-1', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2 },
      analysis_flags: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
      analysis_context: { opportunity: { id: 'opp-1' }, documents: [], snapshotId: 'snapshot-1', canonicalOnly: true },
      legal_corpus_context: null,
      integral_v3_governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
      manizales_manifest_source: null,
    },
  };
  const queueResult = await executor({ kind: 'db' }, job);
  assert.equal(
    queueResult.error_code, 'invalid_output',
    'a local pre-provider-call assembly/validation failure must reach the queue as invalid_output, never provider_error',
  );
  assert.notEqual(queueResult.error_code, 'provider_error');
}

// ---------------------------------------------------------------------------------------------
// 3. Unknown/absent post-bridge codes still fail closed to invalid_output at the queue boundary —
// re-checked here alongside the discovered-frontier coverage above (already exhaustively proven in
// tests/agt002-post-bridge-lease-stage-classification.test.mjs's own catalog-mapping test).
// ---------------------------------------------------------------------------------------------
{
  const executor = createAgt002ReanalysisExecutor({
    environment: {},
    claimPreviewRun: async () => ({ status: 'claimed', claim_id: 'preview-lease-discovered-2' }),
    releasePreviewClaim: async () => {},
    countDailyRuns: async () => 0,
    createRuntime: () => ({ analyze() {}, manifestScope: null }),
    runPostBridgeAnalysis: async () => ({ status: 'unavailable', analysis_run_id: null, error_code: 'AGT002_SOMETHING_FROM_THE_FUTURE' }),
    createCorrelationId: () => 'correlation-discovered-2',
    observability: { record() {} },
  });
  const job = {
    jobId: 'job-discovered-2', leaseId: 'lease-discovered-2', opportunityId: 'opp-1', tenderId: 'tender-1',
    snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-discovered-2', requestedBy: 'actor-1',
    frozenEngineInput: {
      schema_version: 1,
      engine_identity: { model: 'model-1', policy_version: 'policy-1', timeout_ms: 165000, daily_max_runs: 20, max_concurrent: 2 },
      analysis_flags: { AGT002_CANONICAL_ONLY: true, AGT002_CONTEXT_V2: true, AGT002_DOCUMENT_RETRIEVAL: true, AGT002_LEGAL_CORPUS: false, AGT002_INTEGRAL_CONTRACT_V3: true },
      analysis_context: { opportunity: { id: 'opp-1' }, documents: [], snapshotId: 'snapshot-1', canonicalOnly: true },
      legal_corpus_context: null,
      integral_v3_governance: { companyEvidenceRegistryEntries: [], categoryOverrides: {}, evidenceClassLinkByRequirementId: {}, governanceProvenance: {} },
      manizales_manifest_source: null,
    },
  };
  const result = await executor({ kind: 'db' }, job);
  assert.equal(result.error_code, 'invalid_output', 'an unmapped code must never be blamed on the provider');
}

console.log('tests/agt002-post-bridge-discovered-frontier-stage-classification.test.mjs OK');
