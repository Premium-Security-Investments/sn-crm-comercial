// RED (TDD) — AGT-002 durable batched analysis: the planner must size the request that is ACTUALLY
// SENT, not a shape the provider never receives.
//
// THE DEFECT THIS PINS (the mechanism behind the real incident)
//   runAgt002BatchedV3Analysis plans with the FULL governed input, whose `document_evidence` still
//   carries the two per-source-unit audit ledgers (`tender_requirement_inventory`,
//   `tender_semantic_manifest`). Its own executeBatch then strips both — it sends
//   projectAgt002DiscoveredModelInput(projected batch), replacing them with one small server-derived
//   `semantic_frontier_summary` — but planAgt002IntegralAnalysisBatches estimated the UN-stripped
//   shape. On a discovered frontier with thousands of source units those ledgers dominate the
//   estimate and are IDENTICAL in every batch, so:
//     - no split can ever bring a batch under the cap,
//     - the fixed-point repair pass keeps halving batches, re-serializing the whole ledger for every
//       candidate batch on every iteration (the observed ~560 s of CPU),
//     - and it finally fails closed with "a single requirement exceeds the input token budget",
//       which surfaces as AGT002_BATCHED_V3_PLAN_INCOHERENT — with no integral checkpoint, no
//       persistence and no provider call ever made.
//
// The fix is a caller-supplied `projectRequestInput`: the planner measures each candidate batch
// exactly as the caller will send it. Omitted, the planner keeps its current identity behaviour.
//
// Fixture shape is the one already proven in tests/agt002-integral-analysis-batches.test.mjs,
// extended with the two large audit ledgers a discovered frontier really carries. Nothing here is
// real tender content; no provider, network, database or secret is touched.
//
// Run: node tests/agt002-integral-analysis-batch-request-sizing.test.mjs
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';

import { estimateAgt002V3RequestTokens } from '../agt002-v3-prompt-budget.js';
import {
  AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE,
  planAgt002IntegralAnalysisBatches,
  projectAgt002IntegralAnalysisBatch,
} from '../agt002-integral-analysis-batches.js';
import { projectAgt002DiscoveredModelInput } from '../agt002-preview-engine.js';

const MODEL = 'synthetic-batch-model';
const POLICY = 'Politica sintetica de prueba para el planificador de lotes de analisis integral.';
const OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['integral_analysis'],
  properties: {
    integral_analysis: {
      type: 'object', additionalProperties: false, required: ['analysis_units'],
      properties: { analysis_units: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object' } } },
    },
  },
});

const SNAPSHOT_ID = 'SNAP-0001';
const REQUIREMENT_MANIFEST_VERSION = 'agt002-deep-analysis-v1';
const COMPANY_EVIDENCE_MANIFEST_VERSION = 'agt002-company-evidence-classes-v1';
const REQUIREMENT_COUNT = 12;
// The asymmetry that caused the incident: a handful of governed requirements against thousands of
// source units, every one of which lives in both ledgers.
const SOURCE_UNIT_COUNT = 2000;

const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const SNAPSHOT_HASH = sha256Hex('agt002-batch-request-sizing-snapshot');
const INVENTORY_HASH = sha256Hex('agt002-batch-request-sizing-inventory');

const requirementId = index => `REQ-${String(index).padStart(3, '0')}`;

function buildFixture() {
  const manifestEntries = [];
  const chunks = [];
  const coverageByRequirement = [];
  const contextRequirements = [];
  const evidenceStateManifest = [];

  for (let i = 1; i <= REQUIREMENT_COUNT; i += 1) {
    const id = requirementId(i);
    manifestEntries.push({
      requirement_id: id,
      front: 'legal',
      label: `Requisito sintetico ${i}`,
      sources: [{ document_id: 'DOC-1', document_version_id: 'V1', content_hash: sha256Hex('doc-1') }],
      unresolved_sources: [],
    });
    chunks.push({
      evidence_ref: `EV-${id}`, chunk_id: `CHUNK-${id}`, document_id: 'DOC-1', document_version_id: 'V1',
      document_type: 'pliego', name: 'Pliego.pdf', version: 1, content_hash: sha256Hex('doc-1'), current: true,
      page: 1, section: null, chunk_index: i, text: `Texto sintetico de evidencia para ${id}.`, char_count: 40,
      chunk_hash: sha256Hex(`chunk-${id}`), precedence: 'base', superseded_by_addendum: false, requirement_ids: [id],
    });
    coverageByRequirement.push({ requirement_id: id, candidates_available: 1, chunks_selected: 1, status: 'covered' });
    contextRequirements.push({ requirement_id: id, category: 'technical' });
    evidenceStateManifest.push({
      requirement_id: id,
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'unknown' },
      rule_id: 'synthetic_test_fixture',
      provenance: null,
    });
  }

  // The two per-source-unit audit ledgers: identical in every batch projection, and the dominant
  // term of an un-projected estimate.
  const sourceUnits = Array.from({ length: SOURCE_UNIT_COUNT }, (_value, index) => ({
    source_unit_id: `SU-${String(index + 1).padStart(5, '0')}`,
    document_id: 'DOC-1',
    document_version_id: 'V1',
    unit_hash: sha256Hex(`su-${index + 1}`),
    text: `Anotacion ${String(index + 1).padStart(5, '0')} el interesado debera observar el reglamento aplicable sin excepcion alguna.`,
  }));

  const documentEvidence = {
    snapshot_id: SNAPSHOT_ID,
    budget: { max_chunks: 1000, max_chars: 1_000_000, max_tokens: 1_000_000, chunks_used: chunks.length, chars_used: 0, tokens_used: 0 },
    selected_chunks: chunks,
    citation_allowlist: [...new Set(chunks.map(chunk => chunk.evidence_ref))].sort(),
    coverage_manifest: {
      by_document: [{ document_id: 'DOC-1', document_type: 'pliego', chunks_available: REQUIREMENT_COUNT, chunks_selected: chunks.length, gap: false, covered: true }],
      by_document_type: [{ document_type: 'pliego', chunks_available: REQUIREMENT_COUNT, chunks_selected: chunks.length, covered: true }],
      by_requirement: coverageByRequirement,
    },
    omitted_chunks: [],
    material_omissions: false,
    requirement_manifest_version: REQUIREMENT_MANIFEST_VERSION,
    requirement_manifest: manifestEntries,
    tender_requirement_inventory: {
      inventory_version: 'tender_requirement_inventory.v1',
      snapshot_id: SNAPSHOT_ID,
      snapshot_hash: SNAPSHOT_HASH,
      inventory_hash: INVENTORY_HASH,
      coverage_ledger: { analyzable_count: SOURCE_UNIT_COUNT, total_source_units: SOURCE_UNIT_COUNT },
      source_units: sourceUnits,
    },
    tender_semantic_manifest: {
      semantic_manifest_version: 'tender_semantic_manifest.v1',
      coverage_ledger: { total_source_units: SOURCE_UNIT_COUNT, excluded_count: 0, unresolved_count: SOURCE_UNIT_COUNT - REQUIREMENT_COUNT },
      discovery_coverage: { status: 'partial', requirement_count: REQUIREMENT_COUNT },
      analyzed_coverage: { status: 'incomplete' },
      decision_ready: false,
      requirements: manifestEntries.map(entry => ({ requirement_id: entry.requirement_id, label: entry.label })),
      unresolved: sourceUnits.slice(REQUIREMENT_COUNT).map(unit => ({
        source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash, reason: 'no_derivable_subject', text: unit.text,
      })),
    },
  };

  const previewInput = {
    schema_version: '1.0',
    snapshot_id: SNAPSHOT_ID,
    context_version: 'ctx-1',
    opportunity: { id: 'opp-1', title: 'Vigilancia sintetica' },
    company_dossier: { profile: { legal_name: 'Proveedor Sintetico Ltda.' }, documents: [] },
    commercial_context: {},
    human_evidence: [],
    objective_validations: { extracted_values: [] },
    document_evidence: documentEvidence,
    company_evidence_classes: { manifest_version: COMPANY_EVIDENCE_MANIFEST_VERSION, classes: [] },
  };

  const validationContext = {
    requirementManifestVersion: REQUIREMENT_MANIFEST_VERSION,
    requirementManifest: contextRequirements,
    companyEvidenceManifestVersion: COMPANY_EVIDENCE_MANIFEST_VERSION,
    companyEvidenceClassIds: [],
    legalCorpusVersionId: null,
    allowlist: {
      tender_document: documentEvidence.citation_allowlist,
      company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [],
    },
    materialOmissionsObserved: false,
    evidenceStateManifest,
  };

  return { previewInput, validationContext };
}

const { previewInput, validationContext } = buildFixture();
const allRequirementIds = previewInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id);

const estimate = input => estimateAgt002V3RequestTokens({ model: MODEL, policy: POLICY, input, outputSchema: OUTPUT_SCHEMA });

const singleBatchProjection = projectAgt002IntegralAnalysisBatch({
  previewInput, batch: { batch_index: 0, batch_count: 1, requirement_ids: allRequirementIds },
});
// What the planner measures today…
const TOKENS_WITH_LEDGERS = estimate(singleBatchProjection);
// …versus what executeBatch actually sends.
const TOKENS_AS_SENT = estimate(projectAgt002DiscoveredModelInput(singleBatchProjection));

// Fixture sanity: without it a later assertion could pass against a degenerate ledger.
assert.ok(
  TOKENS_AS_SENT * 4 < TOKENS_WITH_LEDGERS,
  'fixture sanity: the two audit ledgers must dominate the un-projected estimate, as they do on a real expediente',
);

// A cap that comfortably fits the request the provider really receives (every requirement in ONE
// batch) but not the ledger-inflated shape the planner used to measure.
const MAX_INPUT_TOKENS = TOKENS_AS_SENT + Math.floor((TOKENS_WITH_LEDGERS - TOKENS_AS_SENT) / 2);
assert.ok(MAX_INPUT_TOKENS > TOKENS_AS_SENT && MAX_INPUT_TOKENS < TOKENS_WITH_LEDGERS, 'fixture sanity: the cap must separate the two shapes');

const basePlanArgs = {
  previewInput,
  validationContext,
  model: MODEL,
  policy: POLICY,
  outputSchema: OUTPUT_SCHEMA,
  maxInputTokens: MAX_INPUT_TOKENS,
  maxRequirementsPerBatch: REQUIREMENT_COUNT,
};

// =============================================================================================
// 1. THE INCIDENT MECHANISM, pinned: measuring the un-projected shape makes every batch — down to a
//    lone requirement — "too large", so planning fails closed before any provider call. This is the
//    behaviour the durable_batched_v1 run hit; it is preserved for callers that do not project.
// =============================================================================================
{
  assert.throws(
    () => planAgt002IntegralAnalysisBatches(basePlanArgs),
    error => {
      assert.equal(error.code, AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE);
      assert.equal(error.report.max_input_tokens, MAX_INPUT_TOKENS);
      assert.ok(error.report.estimated_input_tokens > MAX_INPUT_TOKENS);
      return true;
    },
    'without a projection the ledger-inflated estimate must be what fails the plan closed',
  );
}

// =============================================================================================
// 2. THE FIX: planning against the request as it will be sent succeeds, keeps every requirement in
//    the batches it actually fits, and never invents a batch the provider could not accept.
// =============================================================================================
{
  const { plan, batches } = planAgt002IntegralAnalysisBatches({
    ...basePlanArgs,
    projectRequestInput: projectAgt002DiscoveredModelInput,
  });

  assert.equal(plan.batch_count, 1, 'the whole frontier fits one real request, so it must not be split at all');
  assert.equal(plan.requirement_count, REQUIREMENT_COUNT);
  assert.deepEqual(batches[0].requirement_ids, allRequirementIds, 'no requirement may be dropped, duplicated or reordered');
  assert.equal(plan.max_input_tokens, MAX_INPUT_TOKENS, 'the plan still records the cap it was planned against');

  // Every recorded estimate is the estimate of the EXACT request that batch's turn will send.
  for (const [index, planBatch] of plan.batches.entries()) {
    const projected = projectAgt002IntegralAnalysisBatch({ previewInput, batch: batches[index] });
    assert.equal(
      planBatch.estimated_input_tokens, estimate(projectAgt002DiscoveredModelInput(projected)),
      `batch ${index}: the plan's estimate must be the size of the request actually sent`,
    );
    assert.ok(planBatch.estimated_input_tokens <= MAX_INPUT_TOKENS, `batch ${index} must fit the configured cap`);
  }
}

// =============================================================================================
// 3. The projection is sizing-only: it never reaches the projected batch a caller executes, and the
//    planner still refuses a batch whose REAL request does not fit (no validation is relaxed).
// =============================================================================================
{
  const tinyCap = Math.max(1, Math.floor(TOKENS_AS_SENT / (REQUIREMENT_COUNT * 4)));
  assert.throws(
    () => planAgt002IntegralAnalysisBatches({
      ...basePlanArgs, maxInputTokens: tinyCap, projectRequestInput: projectAgt002DiscoveredModelInput,
    }),
    error => error.code === AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE,
    'a request that genuinely does not fit, even projected, must still fail closed before any provider call',
  );
}

// =============================================================================================
// 4. Omitted, the planner is byte-identical to before: the estimate is the un-projected one.
// =============================================================================================
{
  const largeCap = TOKENS_WITH_LEDGERS * 4;
  const { plan } = planAgt002IntegralAnalysisBatches({ ...basePlanArgs, maxInputTokens: largeCap });
  assert.equal(plan.batch_count, 1);
  assert.equal(
    plan.batches[0].estimated_input_tokens, TOKENS_WITH_LEDGERS,
    'with no projection supplied the planner must keep measuring exactly what it measured before',
  );
}

// =============================================================================================
// 5. A non-function projection is a configuration defect: fail closed, never silently ignored.
// =============================================================================================
{
  for (const invalid of [null, 'projectAgt002DiscoveredModelInput', 42, {}]) {
    assert.throws(
      () => planAgt002IntegralAnalysisBatches({ ...basePlanArgs, projectRequestInput: invalid }),
      /projectRequestInput/,
      `projectRequestInput=${JSON.stringify(invalid)} must be rejected`,
    );
  }
}

// =============================================================================================
// 6. A projection that returns something un-estimable is ALSO a configuration defect, and the
//    dangerous direction: `estimateAgt002V3RequestTokens` with a null/undefined/non-object `input`
//    under-counts, so a silently-ignored bad return would plan an oversized request as if it fit —
//    the exact opposite of what this parameter exists for. It must fail closed, and it must do so
//    with the planner's own message, before any batch is emitted.
// =============================================================================================
{
  for (const badReturn of [null, undefined, 'not-an-object', 42, [], true]) {
    assert.throws(
      () => planAgt002IntegralAnalysisBatches({ ...basePlanArgs, projectRequestInput: () => badReturn }),
      /projectRequestInput debe devolver un objeto/,
      `a projection returning ${JSON.stringify(badReturn) ?? 'undefined'} must be rejected, never estimated`,
    );
  }

  // Fail closed even when the bad return would otherwise "fit": a projection that under-counts is
  // never allowed to produce a plan, however comfortable the cap looks.
  assert.throws(
    () => planAgt002IntegralAnalysisBatches({
      ...basePlanArgs, maxInputTokens: TOKENS_WITH_LEDGERS * 4, projectRequestInput: () => undefined,
    }),
    /projectRequestInput debe devolver un objeto/,
    'an under-counting projection must not slip through just because the cap is generous',
  );

  // A well-formed projection that is not the discovered one still works: the guard checks the
  // SHAPE of the return, never the identity of the function.
  const { plan: identityPlan } = planAgt002IntegralAnalysisBatches({
    ...basePlanArgs, maxInputTokens: TOKENS_WITH_LEDGERS * 4, projectRequestInput: input => input,
  });
  assert.equal(identityPlan.batches[0].estimated_input_tokens, TOKENS_WITH_LEDGERS);
}

console.log('agt002-integral-analysis-batch-request-sizing: OK');
