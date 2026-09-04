import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { estimateAgt002V3RequestTokens } from '../agt002-v3-prompt-budget.js';
import {
  AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION,
  AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS,
  AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE,
  computeAgt002IntegralAnalysisBatchHash,
  planAgt002IntegralAnalysisBatches,
  projectAgt002IntegralAnalysisBatch,
} from '../agt002-integral-analysis-batches.js';

// AGT-002 durable batched analysis — Task 4 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md).
//
// RED phase only. `agt002-integral-analysis-batches.js` does not exist yet; this file specifies its
// minimal public API:
//
//   planAgt002IntegralAnalysisBatches({ previewInput, validationContext, model, policy, outputSchema,
//     maxInputTokens, maxRequirementsPerBatch }) -> { plan, batches }
//
//     Pure, deterministic. `plan` is the safe, persistable metadata (counts/hashes/versions/first-last
//     ids only — never chunk text, never the policy/prompt string, never full requirement id arrays).
//     `batches` is the in-memory assignment (`{ batch_index, batch_count, requirement_ids }[]`) the
//     caller feeds straight into `projectAgt002IntegralAnalysisBatch`.
//
//   projectAgt002IntegralAnalysisBatch({ previewInput, batch }) -> previewInput-shaped object
//
//     Pure. Slices `document_evidence` (requirement_manifest, selected_chunks, citation_allowlist,
//     coverage_manifest.by_requirement, omitted_chunks) to exactly one batch's requirement ids, while
//     every other top-level previewInput section (opportunity, company_dossier, commercial_context,
//     human_evidence, company_evidence_classes, ...) is carried through untouched. Adds a server-owned
//     `document_evidence.integral_analysis_batch` descriptor.
//
//   computeAgt002IntegralAnalysisBatchHash({ plannerVersion, contractVersion, requirementManifestVersion,
//     snapshotHash, inventoryHash, model, maxInputTokens, maxRequirementsPerBatch, batchIndex,
//     requirementIds }) -> lowercase sha256 hex
//
// Fixtures below are realistic-shaped-but-minimal derivations of the real production schemas already
// proven in this repo: document_evidence per agt002-document-retrieval.js's buildAgt002DocumentRetrieval
// return shape (selected_chunks/citation_allowlist/coverage_manifest/omitted_chunks/material_omissions),
// requirement_manifest per agt002-deep-analysis-matrix.js's validateAgt002RequirementManifest shape, and
// validationContext per agt002-integral-analysis-v3.js's normalizeValidationContext / the fixture already
// proven in tests/agt002-integral-analysis-v3.test.mjs. `tender_requirement_inventory` is a deliberate
// minimal stand-in carrying only the identity fields (`snapshot_hash`/`inventory_hash`) this pure planner
// binds into batch identity — not a full validated tender-requirement-inventory.js object.

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
const LARGE_TOKEN_BUDGET = 5_000_000;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

const SNAPSHOT_HASH = sha256Hex('agt002-integral-analysis-batches-fixture-snapshot');
const INVENTORY_HASH = sha256Hex('agt002-integral-analysis-batches-fixture-inventory');

function requirementId(index) {
  return `REQ-${String(index).padStart(3, '0')}`;
}

function buildManifestEntry(index) {
  const id = requirementId(index);
  return {
    requirement_id: id,
    front: 'legal',
    label: `Requisito sintetico ${index}`,
    sources: [{ document_id: 'DOC-1', document_version_id: 'V1', content_hash: sha256Hex('doc-1') }],
    unresolved_sources: [],
  };
}

function buildChunk(index) {
  const id = requirementId(index);
  return {
    evidence_ref: `EV-${id}`,
    chunk_id: `CHUNK-${id}`,
    document_id: 'DOC-1',
    document_version_id: 'V1',
    document_type: 'pliego',
    name: 'Pliego.pdf',
    version: 1,
    content_hash: sha256Hex('doc-1'),
    current: true,
    page: 1,
    section: null,
    chunk_index: index,
    text: `Texto sintetico de evidencia para ${id}.`,
    char_count: 40,
    chunk_hash: sha256Hex(`chunk-${id}`),
    precedence: 'base',
    superseded_by_addendum: false,
    requirement_ids: [id],
  };
}

/**
 * Builds a realistic-minimal { previewInput, validationContext } pair with `requirementCount`
 * governed requirements. `notCoveredIndexes` marks requirements whose evidence was omitted
 * (coverage status `not_covered`, plus a per-requirement omitted_chunks entry). `globalGap` adds
 * one document-level gap (`requirement_id: null`) that must survive in every batch.
 */
function buildFixture(requirementCount, { notCoveredIndexes = [], globalGap = false } = {}) {
  const manifestEntries = [];
  const chunks = [];
  const coverageByRequirement = [];
  const contextRequirements = [];
  const evidenceStateManifest = [];
  const omittedChunks = [];

  for (let i = 1; i <= requirementCount; i += 1) {
    const id = requirementId(i);
    manifestEntries.push(buildManifestEntry(i));
    const covered = !notCoveredIndexes.includes(i);
    if (covered) chunks.push(buildChunk(i));
    coverageByRequirement.push({
      requirement_id: id,
      candidates_available: 1,
      chunks_selected: covered ? 1 : 0,
      status: covered ? 'covered' : 'not_covered',
    });
    if (!covered) {
      omittedChunks.push({
        evidence_ref: `EV-${id}-OMITTED`,
        chunk_id: `CHUNK-${id}-OMITTED`,
        document_id: 'DOC-1',
        document_type: 'pliego',
        requirement_id: id,
        reason: 'budget_exhausted',
      });
    }
    contextRequirements.push({ requirement_id: id, category: 'technical' });
    evidenceStateManifest.push({
      requirement_id: id,
      evidence_state: {
        presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'unknown',
      },
      rule_id: 'synthetic_test_fixture',
      provenance: null,
    });
  }

  if (globalGap) {
    omittedChunks.push({
      evidence_ref: null, chunk_id: null, document_id: 'DOC-GAP', document_type: 'anexo', requirement_id: null, reason: 'gap_unavailable',
    });
  }

  const citationAllowlist = [...new Set(chunks.map(chunk => chunk.evidence_ref))].sort();
  const materialOmissions = notCoveredIndexes.length > 0 || globalGap;

  const documentEvidence = {
    snapshot_id: SNAPSHOT_ID,
    budget: {
      max_chunks: 1000, max_chars: 1_000_000, max_tokens: 1_000_000, chunks_used: chunks.length, chars_used: 0, tokens_used: 0,
    },
    selected_chunks: chunks,
    citation_allowlist: citationAllowlist,
    coverage_manifest: {
      by_document: [{
        document_id: 'DOC-1', document_type: 'pliego', chunks_available: requirementCount, chunks_selected: chunks.length, gap: false, covered: chunks.length > 0,
      }],
      by_document_type: [{
        document_type: 'pliego', chunks_available: requirementCount, chunks_selected: chunks.length, covered: chunks.length > 0,
      }],
      by_requirement: coverageByRequirement,
    },
    omitted_chunks: omittedChunks,
    material_omissions: materialOmissions,
    requirement_manifest_version: REQUIREMENT_MANIFEST_VERSION,
    requirement_manifest: manifestEntries,
    // Minimal stand-in for tender-requirement-inventory.js's real closed shape — only the identity
    // fields this pure planner reads (snapshot/inventory hash binding), never a full validated one.
    tender_requirement_inventory: {
      inventory_version: 'tender_requirement_inventory.v1',
      snapshot_id: SNAPSHOT_ID,
      snapshot_hash: SNAPSHOT_HASH,
      inventory_hash: INVENTORY_HASH,
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
      tender_document: citationAllowlist,
      company_evidence: [],
      legal_corpus: [],
      human_evidence: [],
      objective_validation: [],
    },
    materialOmissionsObserved: materialOmissions,
    evidenceStateManifest,
  };

  return { previewInput, validationContext };
}

function reorderKeysDeep(value) {
  if (Array.isArray(value)) return value.map(reorderKeysDeep);
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort().reverse();
    const out = {};
    for (const key of keys) out[key] = reorderKeysDeep(value[key]);
    return out;
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

function planArgs(fixture, overrides = {}) {
  return {
    previewInput: fixture.previewInput,
    validationContext: fixture.validationContext,
    model: MODEL,
    policy: POLICY,
    outputSchema: OUTPUT_SCHEMA,
    maxInputTokens: LARGE_TOKEN_BUDGET,
    maxRequirementsPerBatch: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// (0) Sanity: exported constants have the expected shape.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(typeof AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION, 'string');
  assert.ok(AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION.length > 0);
  assert.equal(AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS, 20);
  assert.equal(typeof AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE, 'string');
  assert.equal(typeof planAgt002IntegralAnalysisBatches, 'function');
  assert.equal(typeof projectAgt002IntegralAnalysisBatch, 'function');
  assert.equal(typeof computeAgt002IntegralAnalysisBatchHash, 'function');
}

// ---------------------------------------------------------------------------------------------
// (1) Deterministic, input-immutable planning: byte-identical plan for logically-identical,
//     differently key-ordered input; neither previewInput nor validationContext is mutated.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(7);
  const planA = planAgt002IntegralAnalysisBatches(planArgs(fixture));
  const reorderedFixture = { previewInput: reorderKeysDeep(fixture.previewInput), validationContext: reorderKeysDeep(fixture.validationContext) };
  const planB = planAgt002IntegralAnalysisBatches(planArgs(reorderedFixture, { outputSchema: reorderKeysDeep(OUTPUT_SCHEMA) }));
  assert.equal(JSON.stringify(planA.plan), JSON.stringify(planB.plan), 'logically identical, differently key-ordered input must yield a byte-identical plan');
  assert.deepEqual(planA.batches, planB.batches);
}
{
  const fixture = buildFixture(8);
  const beforePreview = JSON.stringify(fixture.previewInput);
  const beforeContext = JSON.stringify(fixture.validationContext);
  deepFreeze(fixture.previewInput);
  deepFreeze(fixture.validationContext);
  const { plan, batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture));
  assert.ok(plan && batches, 'planning a frozen, strict-mode-protected input must not throw from an internal mutation attempt');
  assert.equal(JSON.stringify(fixture.previewInput), beforePreview, 'planning must not mutate previewInput');
  assert.equal(JSON.stringify(fixture.validationContext), beforeContext, 'planning must not mutate validationContext');
  const projected = projectAgt002IntegralAnalysisBatch({ previewInput: fixture.previewInput, batch: batches[0] });
  assert.equal(JSON.stringify(fixture.previewInput), beforePreview, 'projection must not mutate previewInput');
  assert.notEqual(projected, fixture.previewInput, 'projection must return a new object, never the same reference');
}

// ---------------------------------------------------------------------------------------------
// (2) Contiguous batch indices from 0, every batch nonempty, max requirement count obeyed,
//     concatenated ids equal the complete governed manifest exactly once in canonical order.
// ---------------------------------------------------------------------------------------------
{
  const requirementCount = 9;
  const maxPerBatch = 4;
  const fixture = buildFixture(requirementCount);
  const { plan, batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: maxPerBatch }));

  assert.equal(batches.length, Math.ceil(requirementCount / maxPerBatch));
  assert.equal(plan.batch_count, batches.length);
  assert.equal(plan.batches.length, batches.length);

  batches.forEach((batch, index) => {
    assert.equal(batch.batch_index, index, 'batch indices must be contiguous from 0');
    assert.equal(plan.batches[index].batch_index, index);
    assert.ok(Array.isArray(batch.requirement_ids) && batch.requirement_ids.length > 0, 'every batch must be nonempty');
    assert.ok(batch.requirement_ids.length <= maxPerBatch, 'the max requirement count per batch must be obeyed');
    assert.equal(batch.batch_count, batches.length);
  });

  const concatenated = batches.flatMap(batch => batch.requirement_ids);
  const expectedIds = fixture.validationContext.requirementManifest.map(entry => entry.requirement_id);
  assert.deepEqual(concatenated, expectedIds, 'concatenated batch ids must equal the complete governed manifest exactly once, in canonical order');
  assert.equal(new Set(concatenated).size, expectedIds.length, 'no requirement id may be duplicated across batches');
}

// ---------------------------------------------------------------------------------------------
// (3) Stable lowercase sha256 request hash per batch, bound to planner/contract versions, frozen
//     snapshot/inventory identities, ordered requirement ids and safe budget parameters; one
//     bound-field mutation changes the identity.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(5);
  const args = planArgs(fixture, { maxRequirementsPerBatch: 3 });
  const { plan, batches } = planAgt002IntegralAnalysisBatches(args);

  batches.forEach((batch, index) => {
    const expectedHash = computeAgt002IntegralAnalysisBatchHash({
      plannerVersion: AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION,
      contractVersion: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
      requirementManifestVersion: fixture.validationContext.requirementManifestVersion,
      snapshotHash: fixture.previewInput.document_evidence.tender_requirement_inventory.snapshot_hash,
      inventoryHash: fixture.previewInput.document_evidence.tender_requirement_inventory.inventory_hash,
      model: args.model,
      maxInputTokens: args.maxInputTokens,
      maxRequirementsPerBatch: args.maxRequirementsPerBatch,
      batchIndex: index,
      requirementIds: batch.requirement_ids,
    });
    assert.match(plan.batches[index].request_hash, /^[0-9a-f]{64}$/, 'request_hash must be a lowercase sha256 hex digest');
    assert.equal(plan.batches[index].request_hash, expectedHash, 'the persisted hash must equal an independent recomputation over the same bound fields');

    const projectedForBatch = projectAgt002IntegralAnalysisBatch({ previewInput: fixture.previewInput, batch });
    const recomputedTokens = estimateAgt002V3RequestTokens({ model: args.model, policy: args.policy, input: projectedForBatch, outputSchema: args.outputSchema });
    assert.equal(plan.batches[index].estimated_input_tokens, recomputedTokens, 'estimated_input_tokens must come from the existing deterministic estimator over the exact batch request');
  });

  const base = {
    plannerVersion: 'p', contractVersion: 'c', requirementManifestVersion: 'r', snapshotHash: 's', inventoryHash: 'i',
    model: 'm', maxInputTokens: 10, maxRequirementsPerBatch: 2, batchIndex: 0, requirementIds: ['A', 'B'],
  };
  const baseHash = computeAgt002IntegralAnalysisBatchHash(base);
  const mutations = [
    { plannerVersion: 'p2' },
    { contractVersion: 'c2' },
    { requirementManifestVersion: 'r2' },
    { snapshotHash: 's2' },
    { inventoryHash: 'i2' },
    { model: 'm2' },
    { maxInputTokens: 11 },
    { maxRequirementsPerBatch: 3 },
    { batchIndex: 1 },
    { requirementIds: ['A', 'C'] },
    { requirementIds: ['B', 'A'] },
  ];
  for (const mutation of mutations) {
    const mutatedHash = computeAgt002IntegralAnalysisBatchHash({ ...base, ...mutation });
    assert.notEqual(mutatedHash, baseHash, `mutating ${Object.keys(mutation)[0]} must change the batch identity`);
  }
  assert.equal(computeAgt002IntegralAnalysisBatchHash({ ...base }), baseHash, 'identical bound fields must reproduce the identical hash');
}

// ---------------------------------------------------------------------------------------------
// (4) Projection contains only that batch's requirements and filters all dependent
//     chunks/allowlists/coverage to the batch, while preserving required global context and
//     deterministic ordering.
// ---------------------------------------------------------------------------------------------
{
  const requirementCount = 6;
  const fixture = buildFixture(requirementCount);
  const { batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: 3 }));
  const batch = batches[0];
  const { previewInput } = fixture;
  const projected = projectAgt002IntegralAnalysisBatch({ previewInput, batch });

  assert.deepEqual(
    projected.document_evidence.requirement_manifest.map(entry => entry.requirement_id),
    batch.requirement_ids,
    'the projected requirement_manifest must contain exactly and only the batch ids, in order',
  );

  const retainedChunkRequirementIds = new Set(projected.document_evidence.selected_chunks.flatMap(chunk => chunk.requirement_ids));
  for (const id of retainedChunkRequirementIds) {
    assert.ok(batch.requirement_ids.includes(id), 'no retained chunk may reference a requirement outside the batch after rewriting');
  }
  assert.equal(projected.document_evidence.selected_chunks.length, batch.requirement_ids.length, 'only chunks intersecting the batch survive');

  assert.deepEqual(
    projected.document_evidence.citation_allowlist,
    [...new Set(projected.document_evidence.selected_chunks.map(chunk => chunk.evidence_ref))].sort(),
    'citation_allowlist must be derived from retained evidence refs',
  );

  assert.deepEqual(
    projected.document_evidence.coverage_manifest.by_requirement.map(entry => entry.requirement_id),
    batch.requirement_ids,
    'coverage_manifest.by_requirement must be sliced to the batch ids, in order',
  );

  // Preserved global context: unrelated top-level previewInput sections are carried through untouched.
  assert.equal(projected.opportunity, previewInput.opportunity);
  assert.equal(projected.company_dossier, previewInput.company_dossier);
  assert.equal(projected.commercial_context, previewInput.commercial_context);
  assert.equal(projected.human_evidence, previewInput.human_evidence);
  assert.equal(projected.company_evidence_classes, previewInput.company_evidence_classes);
  assert.equal(projected.schema_version, previewInput.schema_version);
  assert.equal(projected.snapshot_id, previewInput.snapshot_id);

  // Deterministic ordering: two independent projections of the same batch are byte-identical.
  const projectedAgain = projectAgt002IntegralAnalysisBatch({ previewInput, batch });
  assert.equal(JSON.stringify(projected), JSON.stringify(projectedAgain));

  // Server-owned batch descriptor stating the slice boundary.
  assert.deepEqual(projected.document_evidence.integral_analysis_batch, {
    batch_index: batch.batch_index,
    batch_count: batch.batch_count,
    requirement_ids: batch.requirement_ids,
  });
}

// ---------------------------------------------------------------------------------------------
// (5) Global gaps remain explicit and are not silently dropped; batch projection exposes only
//     safely required global gap context according to the existing contract.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(6, { globalGap: true });
  const { previewInput } = fixture;
  const { batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: 3 }));

  const globalGapEntries = previewInput.document_evidence.omitted_chunks.filter(entry => entry.requirement_id === null);
  assert.ok(globalGapEntries.length > 0, 'fixture must actually carry a global document gap');

  for (const batch of batches) {
    const projected = projectAgt002IntegralAnalysisBatch({ previewInput, batch });
    const projectedGlobalGaps = projected.document_evidence.omitted_chunks.filter(entry => entry.requirement_id === null);
    assert.deepEqual(projectedGlobalGaps, globalGapEntries, 'every batch projection must carry the exact same global document gaps, unmodified');
    for (const entry of projected.document_evidence.omitted_chunks) {
      assert.ok(
        entry.requirement_id === null || batch.requirement_ids.includes(entry.requirement_id),
        'omitted_chunks in a batch projection may only be global gaps or entries for that batch\'s own requirements',
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// (6) Material omissions/coverage gaps remain visible and fail closed; no batch projection can
//     claim full coverage when governed evidence is omitted, even for a batch with no local gap.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(6, { notCoveredIndexes: [5], globalGap: false });
  const { previewInput } = fixture;
  assert.equal(previewInput.document_evidence.material_omissions, true, 'fixture must actually carry a material omission');

  const { batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: 2 }));
  const batchWithGap = batches.find(batch => batch.requirement_ids.includes(requirementId(5)));
  const batchWithoutLocalGap = batches.find(batch => !batch.requirement_ids.includes(requirementId(5)));
  assert.ok(batchWithGap && batchWithoutLocalGap, 'fixture/maxRequirementsPerBatch must split the not_covered requirement into its own distinct batch');

  const projectedWithGap = projectAgt002IntegralAnalysisBatch({ previewInput, batch: batchWithGap });
  assert.equal(projectedWithGap.document_evidence.material_omissions, true, 'material_omissions must never be cleared for the batch that owns the gap');
  const localEntry = projectedWithGap.document_evidence.coverage_manifest.by_requirement.find(entry => entry.requirement_id === requirementId(5));
  assert.equal(localEntry.status, 'not_covered', 'a not_covered requirement must remain visibly not_covered, never rewritten as covered');

  const projectedWithoutLocalGap = projectAgt002IntegralAnalysisBatch({ previewInput, batch: batchWithoutLocalGap });
  assert.equal(
    projectedWithoutLocalGap.document_evidence.material_omissions,
    true,
    'the global material-omission flag must survive even for a batch with no local gap, so no batch can claim full coverage the run as a whole did not have',
  );
}

// ---------------------------------------------------------------------------------------------
// (7) A singleton-too-large requirement fails before any provider call with a closed
//     deterministic planner error/code and only safe budget counts — no prompt/source/raw text.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(4);
  assert.throws(
    () => planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxInputTokens: 1, maxRequirementsPerBatch: AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS })),
    (error) => {
      assert.equal(error.code, AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE, 'the failure must carry the closed, deterministic singleton-too-large code');
      const { report } = error;
      assert.ok(report && typeof report === 'object' && !Array.isArray(report), 'the error must carry a sanitized report object');
      const allowedReportKeys = new Set(['requirement_id', 'max_input_tokens', 'estimated_input_tokens']);
      for (const key of Object.keys(report)) {
        assert.ok(allowedReportKeys.has(key), `report must only carry safe budget counts/ids, got unexpected key "${key}"`);
      }
      assert.equal(typeof report.requirement_id, 'string');
      assert.equal(typeof report.max_input_tokens, 'number');
      assert.equal(typeof report.estimated_input_tokens, 'number');
      const serializedReport = JSON.stringify(report);
      assert.ok(!serializedReport.includes('Texto sintetico'), 'report must never leak raw chunk/source text');
      assert.ok(!serializedReport.includes(POLICY), 'report must never leak the raw prompt/policy text');
      assert.doesNotMatch(serializedReport, /credential|password|api_key|secret/i, 'report must never leak credential-shaped content');
      return true;
    },
  );
}

// ---------------------------------------------------------------------------------------------
// (8) Plan metadata stores safe counts/hashes/versions only — no raw source text, prompt,
//     credentials, provider response, verbose error, or document body.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(5);
  const { plan } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: 2 }));

  const serializedPlan = JSON.stringify(plan);
  assert.ok(!serializedPlan.includes('Texto sintetico'), 'plan metadata must never carry raw chunk/source text');
  assert.ok(!serializedPlan.includes(POLICY), 'plan metadata must never carry the raw prompt/policy text');
  assert.doesNotMatch(serializedPlan, /credential|password|api_key|secret/i, 'plan metadata must never carry credential-shaped content');

  const expectedPlanKeys = [
    'planner_version', 'contract_version', 'requirement_manifest_version', 'snapshot_id', 'snapshot_hash',
    'inventory_hash', 'model', 'max_input_tokens', 'max_requirements_per_batch', 'requirement_count',
    'batch_count', 'batches',
  ];
  assert.deepEqual(Object.keys(plan).sort(), [...expectedPlanKeys].sort(), 'plan must expose exactly the closed set of safe metadata keys');
  assert.equal(plan.planner_version, AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION);
  assert.equal(plan.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);
  assert.equal(plan.requirement_manifest_version, REQUIREMENT_MANIFEST_VERSION);
  assert.equal(plan.snapshot_id, SNAPSHOT_ID);
  assert.equal(plan.snapshot_hash, SNAPSHOT_HASH);
  assert.equal(plan.inventory_hash, INVENTORY_HASH);
  assert.equal(plan.requirement_count, 5);
  assert.equal(plan.batch_count, plan.batches.length);

  const expectedBatchEntryKeys = [
    'batch_index', 'batch_count', 'requirement_count', 'first_requirement_id', 'last_requirement_id', 'request_hash', 'estimated_input_tokens',
  ];
  for (const entry of plan.batches) {
    assert.deepEqual(Object.keys(entry).sort(), [...expectedBatchEntryKeys].sort(), 'each plan batch entry must expose exactly the closed set of safe fields — never the full requirement id list, never chunk text');
    assert.match(entry.request_hash, /^[0-9a-f]{64}$/);
    assert.equal(typeof entry.estimated_input_tokens, 'number');
    assert.equal(typeof entry.first_requirement_id, 'string');
    assert.equal(typeof entry.last_requirement_id, 'string');
  }
}

// ---------------------------------------------------------------------------------------------
// (9) Invalid/duplicate/missing governed ids, malformed chunks/coverage/allowlists, and
//     over/under projection fail closed.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(4);
  const { previewInput, validationContext } = fixture;

  // Duplicate requirement_id in the governed validationContext manifest.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput,
    validationContext: { ...validationContext, requirementManifest: [...validationContext.requirementManifest, validationContext.requirementManifest[0]] },
  })), 'a duplicate governed requirement id must fail closed');

  // document_evidence.requirement_manifest order/set does not match validationContext.requirementManifest.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: {
      ...previewInput,
      document_evidence: { ...previewInput.document_evidence, requirement_manifest: [...previewInput.document_evidence.requirement_manifest].reverse() },
    },
    validationContext,
  })), 'a governed requirement-manifest order mismatch between previewInput and validationContext must fail closed');

  // A governed id present in validationContext but never declared by document_evidence.requirement_manifest.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput,
    validationContext: { ...validationContext, requirementManifest: [...validationContext.requirementManifest, { requirement_id: 'REQ-GHOST', category: 'technical' }] },
  })), 'a governed id missing from document_evidence.requirement_manifest must fail closed');

  // Malformed selected_chunks: requirement_ids is not an array.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: {
      ...previewInput,
      document_evidence: {
        ...previewInput.document_evidence,
        selected_chunks: previewInput.document_evidence.selected_chunks.map((chunk, index) => (index === 0 ? { ...chunk, requirement_ids: null } : chunk)),
      },
    },
    validationContext,
  })), 'a malformed chunk requirement_ids field must fail closed');

  // Malformed coverage_manifest: by_requirement missing an entry for a governed id.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: {
      ...previewInput,
      document_evidence: {
        ...previewInput.document_evidence,
        coverage_manifest: { ...previewInput.document_evidence.coverage_manifest, by_requirement: previewInput.document_evidence.coverage_manifest.by_requirement.slice(1) },
      },
    },
    validationContext,
  })), 'a coverage_manifest.by_requirement missing a governed id must fail closed');

  // Malformed citation_allowlist: not an array.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: { ...previewInput, document_evidence: { ...previewInput.document_evidence, citation_allowlist: null } },
    validationContext,
  })), 'a malformed citation_allowlist must fail closed');

  // Over-projection: a batch requesting a requirement_id outside the governed manifest.
  assert.throws(() => projectAgt002IntegralAnalysisBatch({
    previewInput, batch: { batch_index: 0, batch_count: 1, requirement_ids: [requirementId(1), 'REQ-GHOST'] },
  }), 'projecting a batch with an ungoverned requirement id must fail closed');

  // Over-projection: a duplicate id inside one batch.
  assert.throws(() => projectAgt002IntegralAnalysisBatch({
    previewInput, batch: { batch_index: 0, batch_count: 1, requirement_ids: [requirementId(1), requirementId(1)] },
  }), 'projecting a batch with a duplicated requirement id must fail closed');

  // Under-projection: an empty batch is never a valid slice.
  assert.throws(() => projectAgt002IntegralAnalysisBatch({
    previewInput, batch: { batch_index: 0, batch_count: 1, requirement_ids: [] },
  }), 'projecting an empty batch must fail closed');
}

// ---------------------------------------------------------------------------------------------
// (10) Requirement-count boundary tests — exact max, max+1, and zero — prove deterministic
//      splitting and a closed result consistent with the engine's existing manifest contract.
// ---------------------------------------------------------------------------------------------
{
  const maxPerBatch = AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS;

  // Exactly the max: fits in exactly one batch.
  {
    const fixture = buildFixture(maxPerBatch);
    const { batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: maxPerBatch }));
    assert.equal(batches.length, 1, 'exactly max requirements must fit in exactly one batch');
    assert.equal(batches[0].requirement_ids.length, maxPerBatch);
  }

  // Max + 1: deterministically splits into exactly two batches (max, then 1).
  {
    const fixture = buildFixture(maxPerBatch + 1);
    const { batches } = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxRequirementsPerBatch: maxPerBatch }));
    assert.equal(batches.length, 2, 'max + 1 requirements must deterministically split into exactly two batches');
    assert.equal(batches[0].requirement_ids.length, maxPerBatch);
    assert.equal(batches[1].requirement_ids.length, 1);
    assert.deepEqual(
      [...batches[0].requirement_ids, ...batches[1].requirement_ids],
      fixture.validationContext.requirementManifest.map(entry => entry.requirement_id),
    );
  }

  // Zero requirements: the governed manifest can never legitimately be empty (the same invariant
  // agt002-deep-analysis-matrix.js's validateAgt002RequirementManifest already enforces for
  // document_evidence.requirement_manifest), so the planner must fail closed rather than silently
  // return an empty plan.
  {
    const fixture = buildFixture(1);
    const emptyPreviewInput = { ...fixture.previewInput, document_evidence: { ...fixture.previewInput.document_evidence, requirement_manifest: [] } };
    const emptyValidationContext = { ...fixture.validationContext, requirementManifest: [] };
    assert.throws(
      () => planAgt002IntegralAnalysisBatches(planArgs({ previewInput: emptyPreviewInput, validationContext: emptyValidationContext })),
      'zero governed requirements must fail closed, consistent with the existing requirement-manifest contract',
    );
  }
}

// ---------------------------------------------------------------------------------------------
// (11) No final batch descriptor may claim a fit that only held for the planner's PROVISIONAL
//      candidate-fitting projection. The sizing loop tests every candidate slice as if it were
//      `{ batch_index: 0, batch_count: 1 }`, but the persisted plan/batch descriptor
//      (`document_evidence.integral_analysis_batch`) is later rebuilt with the REAL batch_index and
//      the REAL shared batch_count — extra serialized digits the provisional candidate never paid
//      for. A large governed frontier with `maxRequirementsPerBatch: 1` forces every batch to be a
//      singleton with a 3-digit shared batch_count and multi-digit batch indices, so this gap is
//      exercised deterministically rather than by chance. The threshold is derived, not guessed:
//      it is exactly the provisional estimate for the one requirement whose content is largest
//      (longest unpadded numeral, so its singleton trial is the tightest-fitting one, guaranteeing
//      every other singleton's provisional trial still fits under it) — so the ONLY way any
//      resulting batch can still exceed it is the real batch_index/batch_count bytes this planner
//      omits from its fitting check.
// ---------------------------------------------------------------------------------------------
{
  const requirementCount = 100;
  const maxRequirementsPerBatch = 1;
  const fixture = buildFixture(requirementCount);

  // Requirement 100 has the longest unpadded manifest label (`Requisito sintetico 100`) and chunk
  // `chunk_index` (100) of the whole frontier, so its provisional {batch_index:0,batch_count:1}
  // singleton trial is the largest such trial in the set — a safe (tight) upper bound to cap every
  // other singleton's provisional trial by.
  const targetRequirementId = requirementId(requirementCount);
  const provisionalBatch = { batch_index: 0, batch_count: 1, requirement_ids: [targetRequirementId] };
  const provisionalInput = projectAgt002IntegralAnalysisBatch({ previewInput: fixture.previewInput, batch: provisionalBatch });
  const provisionalTokens = estimateAgt002V3RequestTokens({ model: MODEL, policy: POLICY, input: provisionalInput, outputSchema: OUTPUT_SCHEMA });

  // The real final descriptor for that same requirement, once it is known to be the last of 100
  // singleton batches: batch_index 99 (2 digits, was "0") and batch_count 100 (3 digits, was "1").
  const finalBatch = { batch_index: requirementCount - 1, batch_count: requirementCount, requirement_ids: [targetRequirementId] };
  const finalInput = projectAgt002IntegralAnalysisBatch({ previewInput: fixture.previewInput, batch: finalBatch });
  const finalTokens = estimateAgt002V3RequestTokens({ model: MODEL, policy: POLICY, input: finalInput, outputSchema: OUTPUT_SCHEMA });

  assert.ok(
    finalTokens > provisionalTokens,
    'fixture sanity: the real batch_index/batch_count serialization must cost strictly more estimated tokens than the provisional {batch_index:0,batch_count:1} candidate the planner actually fits against',
  );

  // A tight cap: exactly the provisional estimate for the largest singleton. Every singleton's
  // provisional candidate-fitting trial therefore fits (<= threshold), so the sizing loop commits to
  // 100 singleton batches without ever shrinking below 1 or throwing early.
  const threshold = provisionalTokens;

  let planResult = null;
  let planError = null;
  try {
    planResult = planAgt002IntegralAnalysisBatches(planArgs(fixture, { maxInputTokens: threshold, maxRequirementsPerBatch }));
  } catch (error) {
    planError = error;
  }

  if (planError) {
    assert.equal(
      planError.code,
      AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE,
      'if a real singleton cannot fit once its true batch_index/batch_count bytes are counted, the planner must fail with the existing closed singleton-too-large code — never return an over-budget batch and never throw an unrelated error',
    );
  } else {
    assert.equal(planResult.batches.length, requirementCount, 'maxRequirementsPerBatch: 1 over a governed frontier of 100 must plan exactly 100 singleton batches');
    for (const batchEntry of planResult.plan.batches) {
      assert.ok(
        batchEntry.estimated_input_tokens <= planResult.plan.max_input_tokens,
        `final batch ${batchEntry.batch_index} of ${batchEntry.batch_count} has estimated_input_tokens ${batchEntry.estimated_input_tokens}, exceeding plan.max_input_tokens ${planResult.plan.max_input_tokens} — the planner only ever verified a provisional {batch_index:0,batch_count:1} projection, not the real, larger, final descriptor it persisted`,
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// (12) coverage_manifest.by_requirement is a 1:1 map onto the governed frontier — never a
//      multiset (a duplicate entry for one governed requirement_id) and never a superset (an entry
//      naming a requirement_id outside the governed manifest). Both must fail closed.
// ---------------------------------------------------------------------------------------------
{
  const fixture = buildFixture(4);
  const { previewInput, validationContext } = fixture;
  const baseByRequirement = previewInput.document_evidence.coverage_manifest.by_requirement;

  // Duplicate entry for a governed requirement_id already present.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: {
      ...previewInput,
      document_evidence: {
        ...previewInput.document_evidence,
        coverage_manifest: { ...previewInput.document_evidence.coverage_manifest, by_requirement: [...baseByRequirement, baseByRequirement[0]] },
      },
    },
    validationContext,
  })), 'a duplicate coverage_manifest.by_requirement entry for the same governed requirement_id must fail closed');

  // Entry naming a requirement_id outside the governed manifest.
  assert.throws(() => planAgt002IntegralAnalysisBatches(planArgs({
    previewInput: {
      ...previewInput,
      document_evidence: {
        ...previewInput.document_evidence,
        coverage_manifest: {
          ...previewInput.document_evidence.coverage_manifest,
          by_requirement: [...baseByRequirement, { requirement_id: 'REQ-GHOST', candidates_available: 1, chunks_selected: 0, status: 'not_covered' }],
        },
      },
    },
    validationContext,
  })), 'a coverage_manifest.by_requirement entry naming a non-governed requirement_id must fail closed');
}

// ---------------------------------------------------------------------------------------------
// (13) document_evidence.omitted_chunks entries are structurally validated and fail closed: a
//      non-plain-object entry, an entry lacking requirement_id, an entry with a malformed
//      non-string/non-null requirement_id, or an entry naming a requirement_id outside the
//      governed manifest must all reject the plan/projection rather than being silently filtered
//      out of every batch (the current filter-only implementation drops such entries instead of
//      rejecting them, which is exactly the gap this section proves). Valid global omissions
//      (requirement_id: null) and valid governed-id omissions must keep planning/projecting
//      cleanly (see also sections (5)/(6)).
// ---------------------------------------------------------------------------------------------
{
  const baseFixture = buildFixture(6, { notCoveredIndexes: [5], globalGap: true });
  const { previewInput: basePreviewInput, validationContext } = baseFixture;
  const validOmittedChunks = basePreviewInput.document_evidence.omitted_chunks;
  assert.ok(validOmittedChunks.some(entry => entry.requirement_id === null), 'fixture sanity: a valid global gap entry (requirement_id: null) exists');
  assert.ok(validOmittedChunks.some(entry => entry.requirement_id === requirementId(5)), 'fixture sanity: a valid governed-id entry exists');

  // Sanity: the baseline fixture (before any malformed entry is added) plans and projects cleanly,
  // so any failure asserted below is caused by the malformed entry under test, not fixture setup.
  {
    const { batches } = planAgt002IntegralAnalysisBatches(planArgs(baseFixture, { maxRequirementsPerBatch: 3 }));
    assert.ok(batches.length > 1, 'fixture sanity: more than one batch must exist so an offending entry can be projected against a batch that never references it');
    for (const batch of batches) {
      assert.ok(
        projectAgt002IntegralAnalysisBatch({ previewInput: basePreviewInput, batch }),
        'baseline fixture (before adding a malformed omitted_chunks entry) must plan/project cleanly',
      );
    }
  }

  function assertFailsClosed(extraEntry, description) {
    const previewInput = {
      ...basePreviewInput,
      document_evidence: {
        ...basePreviewInput.document_evidence,
        omitted_chunks: [...validOmittedChunks, extraEntry],
      },
    };

    assert.throws(
      () => planAgt002IntegralAnalysisBatches(planArgs({ previewInput, validationContext })),
      `${description} must fail closed in planAgt002IntegralAnalysisBatches`,
    );

    // Direct projection, independent of the planner: use a batch whose requirement_ids never
    // include the offending entry's id, so a "not in this batch, filter it out" implementation
    // would otherwise let projection succeed and silently drop the entry instead of rejecting it.
    assert.throws(
      () => projectAgt002IntegralAnalysisBatch({
        previewInput, batch: { batch_index: 0, batch_count: 2, requirement_ids: [requirementId(1)] },
      }),
      `${description} must fail closed in projectAgt002IntegralAnalysisBatch, even for a batch that never references the offending entry's requirement_id`,
    );
  }

  // (a) Non-plain-object entries.
  assertFailsClosed('not-an-object', 'a string omitted_chunks entry');
  assertFailsClosed(42, 'a numeric omitted_chunks entry');
  assertFailsClosed(true, 'a boolean omitted_chunks entry');
  assertFailsClosed(null, 'a null omitted_chunks entry');
  assertFailsClosed(['REQ-001'], 'an array omitted_chunks entry');

  // (b) Plain object entries lacking requirement_id entirely.
  assertFailsClosed(
    { evidence_ref: 'EV-MISSING', chunk_id: 'CHUNK-MISSING', document_id: 'DOC-1', document_type: 'pliego', reason: 'budget_exhausted' },
    'an omitted_chunks entry missing requirement_id',
  );

  // (c) Malformed non-string/non-null requirement_id.
  assertFailsClosed(
    { evidence_ref: 'EV-BAD-ID', chunk_id: 'CHUNK-BAD-ID', document_id: 'DOC-1', document_type: 'pliego', requirement_id: 42, reason: 'budget_exhausted' },
    'an omitted_chunks entry with a numeric requirement_id',
  );
  assertFailsClosed(
    { evidence_ref: 'EV-BAD-ID-2', chunk_id: 'CHUNK-BAD-ID-2', document_id: 'DOC-1', document_type: 'pliego', requirement_id: { requirement_id: requirementId(1) }, reason: 'budget_exhausted' },
    'an omitted_chunks entry with an object requirement_id',
  );
  assertFailsClosed(
    { evidence_ref: 'EV-BAD-ID-3', chunk_id: 'CHUNK-BAD-ID-3', document_id: 'DOC-1', document_type: 'pliego', requirement_id: [requirementId(1)], reason: 'budget_exhausted' },
    'an omitted_chunks entry with an array requirement_id',
  );

  // (d) requirement_id naming a requirement outside the governed manifest.
  assertFailsClosed(
    { evidence_ref: 'EV-GHOST', chunk_id: 'CHUNK-GHOST', document_id: 'DOC-1', document_type: 'pliego', requirement_id: 'REQ-GHOST', reason: 'budget_exhausted' },
    'an omitted_chunks entry referencing a requirement_id outside the governed manifest',
  );
}
