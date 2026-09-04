// AGT-002 durable batched analysis — Task 5 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md §7).
//
// RED phase only. Specifies the dedicated batch wire contract and its server-side assembly/merge
// machinery, none of which exists yet:
//
//   agt002-preview-contract.js
//     AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS
//       Closed per-unit wire key set for a batch turn: every existing v3 model-fillable unit key
//       EXCEPT unit_id/sequence/category/evidence_state (server-owned, never offered to the model —
//       not merely forced to null, as in the existing single-turn contract, but structurally absent).
//
//     buildAgt002IntegralAnalysisV3BatchOutputJsonSchema(validationContext, batch)
//       Closed JSON Schema for ONE batch's model turn. `batch` is the exact
//       { batch_index, batch_count, requirement_ids, citation_allowlist } descriptor a caller builds
//       from agt002-integral-analysis-batches.js's planned batch plus its projected
//       document_evidence.citation_allowlist. Only `unit_kind: "tender_requirement"` is ever offered
//       (no strategic_consideration branch); `requirement_id` is restricted to `batch.requirement_ids`
//       only (never the full governed manifest); `analysis_units` is length-locked to exactly
//       `batch.requirement_ids.length`.
//
//     validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch })
//       Runtime validator + assembler for one batch's raw model turn. Rejects any of the four
//       server-owned unit keys if present at all, any non-tender_requirement unit, any coverage
//       other than the exact assigned requirement_ids once each in assigned order, and any
//       tender_document evidence_ref outside `batch.citation_allowlist` (company/legal/human/
//       objective-validation refs stay governed by the full, unsliced validationContext.allowlist,
//       matching design §6 "keep company evidence and legal evidence... as governed context").
//       Assembles the server-owned unit_id (deterministic: `UNIT-${requirement_id}`) and the GLOBAL
//       sequence (the requirement's 1-based position in the FULL validationContext.requirementManifest,
//       never a batch-local index), plus governed category/evidence_state, then validates each
//       assembled unit with the extracted, unweakened validateAgt002IntegralAnalysisV3Unit. Returns
//       `{ analysis_units }` — batch-local, fully governed units ready for merge; never a full envelope
//       (no contract_version/coverage at this stage).
//
//     mergeAgt002IntegralAnalysisV3Batches(validatedBatchResults, validationContext)
//       Deterministically concatenates already-validated `{ analysis_units }` batch results, in the
//       exact order given, fails closed on any cross-batch unit_id/requirement_id collision, builds
//       contract_version + the governed coverage block via the EXISTING unchanged
//       buildAgt002GovernedIntegralAnalysisV3Coverage, and runs the EXISTING unchanged
//       validateAgt002IntegralAnalysisV3 over the merged object as the sole final authority.
//
//   agt002-integral-analysis-v3.js
//     validateAgt002IntegralAnalysisV3Unit(unit, validationContext, { allowedRequirementIds } = {})
//       The existing per-unit shape/invariant/governed-evidence-state checks (today private inside
//       validateAgt002IntegralAnalysisV3's per-unit loop), extracted as a reusable public entry point
//       so the batch validator above can reuse it without duplicating a single rule. Byte-identical
//       diagnostics/codes to today. `allowedRequirementIds`, when supplied, additionally restricts
//       which requirement_id a tender_requirement unit may declare (the batch-local allowlist);
//       omitting it preserves today's full-manifest-only behavior unchanged.
//
// Every negative case below asserts on `error?.code` where a dedicated closed diagnostic code is
// specified above, falling back to a message-pattern assertion only where the exact code is
// deliberately left to implementation discretion (documented inline).
//
// Namespace imports only: this lets every assertion below fail with an ordinary, diagnostic
// `assert` failure (missing/undefined export, wrong shape, etc.) instead of a module-link
// SyntaxError that would abort the whole file before a single case runs.

import { strict as assert } from 'node:assert';
import * as Agt002IntegralAnalysisV3 from '../agt002-integral-analysis-v3.js';
import * as Agt002PreviewContract from '../agt002-preview-contract.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION, validateAgt002IntegralAnalysisV3 } = Agt002IntegralAnalysisV3;

// ---------------------------------------------------------------------------------------------
// Fixture: the same synthetic four-formal-category governed context already proven in
// tests/agt002-integral-analysis-v3.test.mjs (discard / habilitating / technical /
// financial_execution), split into two contiguous batches — A = [DISCARD, HAB], B = [TECH, FIN] —
// matching agt002-integral-analysis-batches.js's contiguous, exactly-once-covered planning
// contract. No strategic_consideration unit here: the batch wire contract never offers one.
// ---------------------------------------------------------------------------------------------

function buildValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [
      { requirement_id: 'REQ-DISCARD-1', category: 'discard' },
      { requirement_id: 'REQ-HAB-1', category: 'habilitating' },
      { requirement_id: 'REQ-TECH-1', category: 'technical' },
      { requirement_id: 'REQ-FIN-1', category: 'financial_execution' },
    ],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: 'legal-corpus-v1',
    allowlist: {
      tender_document: ['TD-DISCARD-1', 'TD-HAB-1', 'TD-TECH-1', 'TD-FIN-1'],
      company_evidence: ['rup', 'rut'],
      legal_corpus: ['LC-1'],
      human_evidence: ['HE-1'],
      objective_validation: ['OV-1'],
    },
    materialOmissionsObserved: false,
    evidenceStateManifest: [
      {
        requirement_id: 'REQ-DISCARD-1',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-HAB-1',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-TECH-1',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable', compliance: 'partially_supported_pending_human_review' },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
      {
        requirement_id: 'REQ-FIN-1',
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
        rule_id: 'synthetic_test_fixture',
        provenance: null,
      },
    ],
  };
}

// Governed values a correctly-assembled unit for `requirementId` must end up with — asserted
// against directly, never re-derived, so a test bug can't quietly agree with a production bug.
const GOVERNED = {
  'REQ-DISCARD-1': { category: 'discard', sequence: 1 },
  'REQ-HAB-1': { category: 'habilitating', sequence: 2 },
  'REQ-TECH-1': { category: 'technical', sequence: 3 },
  'REQ-FIN-1': { category: 'financial_execution', sequence: 4 },
};

// The exact model-fillable wire shape for one batch unit — every field the model owns, none of
// the four server-owned ones (unit_id/sequence/category/evidence_state).
function buildBatchWireUnit(requirementId) {
  const byId = {
    'REQ-DISCARD-1': {
      requirement_id: 'REQ-DISCARD-1',
      unit_kind: 'tender_requirement',
      title: 'Verificación de causal de descarte',
      assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Sin causal de rechazo evidenciada en el pliego revisado.', confidence: 'high' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto bloqueante evidenciado.' },
      evidence_refs: [{ ref: 'TD-DISCARD-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [],
      commercial_impact: { level: 'low', summary: 'Sin impacto comercial adverso evidenciado.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico para esta causal.', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona autorizada confirma ausencia de causal de rechazo.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar ausencia de causal de descarte.' },
    },
    'REQ-HAB-1': {
      requirement_id: 'REQ-HAB-1',
      unit_kind: 'tender_requirement',
      title: 'Licencia habilitante',
      assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Evidencia vigente sustenta el requisito habilitante.', confidence: 'medium' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Requisito habilitante sustentado.' },
      evidence_refs: [
        { ref: 'TD-HAB-1', source_type: 'tender_document', purpose: 'requirement_basis' },
        { ref: 'rup', source_type: 'company_evidence', purpose: 'company_capacity' },
      ],
      missing_evidence: [],
      commercial_impact: { level: 'medium', summary: 'Habilita la participación en el proceso.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'evidence_satisfied', condition: 'Evidencia vigente y revisada sustenta el requisito habilitante.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar habilitación definitiva.' },
    },
    'REQ-TECH-1': {
      requirement_id: 'REQ-TECH-1',
      unit_kind: 'tender_requirement',
      title: 'Vigencia de documento técnico',
      assessment_mode: 'assessed',
      conclusion: { status: 'partially_supported', summary: 'Vigencia del documento técnico no verificable con la evidencia disponible.', confidence: 'medium' },
      blocking: { effect: 'conditional', curability: 'curable', reason: 'Requiere verificar vigencia del documento técnico.' },
      evidence_refs: [{ ref: 'TD-TECH-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [{ missing_id: 'MISS-TECH-1', evidence_class_id: null, needed_source_type: 'tender_document', reason: 'Falta constancia de vigencia del documento técnico.', critical: false }],
      commercial_impact: { level: 'medium', summary: 'Riesgo de competitividad si no se verifica la vigencia.', dimension: 'competitiveness' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.', human_legal_review_required: false },
      actions: [{ action_id: 'ACT-TECH-1', action_type: 'verify_validity', summary: 'Verificar vigencia del documento técnico presentado.', basis_unit_id: 'UNIT-REQ-TECH-1', suggested_role: 'technical', priority: 'medium', external_side_effect: false }],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'open', condition: 'Verificación de vigencia documental completada.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar vigencia del documento técnico.' },
    },
    'REQ-FIN-1': {
      requirement_id: 'REQ-FIN-1',
      unit_kind: 'tender_requirement',
      title: 'Brecha financiera evidenciada',
      assessment_mode: 'assessed',
      conclusion: { status: 'gap_evidenced', summary: 'Brecha financiera evidenciada frente al requisito del pliego.', confidence: 'high' },
      blocking: { effect: 'blocker', curability: 'curable', reason: 'Brecha financiera evidenciada en el pliego.' },
      evidence_refs: [{ ref: 'TD-FIN-1', source_type: 'tender_document', purpose: 'gap_basis' }],
      missing_evidence: [],
      commercial_impact: { level: 'high', summary: 'Brecha financiera afecta la capacidad de ejecución.', dimension: 'financial_exposure' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.', human_legal_review_required: false },
      actions: [{ action_id: 'ACT-FIN-1', action_type: 'remediate_gap', summary: 'Subsanar brecha financiera evidenciada antes del cierre.', basis_unit_id: 'UNIT-REQ-FIN-1', suggested_role: 'financial', priority: 'high', external_side_effect: false }],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'open', condition: 'Evidencia de subsanación de la brecha financiera presentada y revisada.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar subsanación de la brecha financiera.' },
    },
  };
  const unit = byId[requirementId];
  if (!unit) throw new Error(`fixture bug: no batch wire unit for ${requirementId}`);
  // Defensive copy so no test can accidentally mutate the shared template across cases.
  return JSON.parse(JSON.stringify(unit));
}

function buildBatchTurn(requirementIds) {
  return { integral_analysis: { analysis_units: requirementIds.map(buildBatchWireUnit) } };
}

const BATCH_A = Object.freeze({
  batch_index: 0, batch_count: 2, requirement_ids: ['REQ-DISCARD-1', 'REQ-HAB-1'], citation_allowlist: ['TD-DISCARD-1', 'TD-HAB-1'],
});
const BATCH_B = Object.freeze({
  batch_index: 1, batch_count: 2, requirement_ids: ['REQ-TECH-1', 'REQ-FIN-1'], citation_allowlist: ['TD-TECH-1', 'TD-FIN-1'],
});

function expectBatchRejects(requirementIds, mutate, matcher, message) {
  const validationContext = buildValidationContext();
  const batch = { batch_index: 0, batch_count: 1, requirement_ids: requirementIds, citation_allowlist: requirementIds.map(id => GOVERNED_TD_REF[id]) };
  const value = buildBatchTurn(requirementIds);
  mutate(value, batch, validationContext);
  assert.throws(
    () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch }),
    matcher,
    message,
  );
}

const GOVERNED_TD_REF = { 'REQ-DISCARD-1': 'TD-DISCARD-1', 'REQ-HAB-1': 'TD-HAB-1', 'REQ-TECH-1': 'TD-TECH-1', 'REQ-FIN-1': 'TD-FIN-1' };

// ---------------------------------------------------------------------------------------------
// (0) Sanity: the new production API actually exists as functions/arrays, with diagnostic
//     failures naming exactly what's missing rather than a bare TypeError.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(typeof Agt002IntegralAnalysisV3.validateAgt002IntegralAnalysisV3Unit, 'function', 'agt002-integral-analysis-v3.js must export validateAgt002IntegralAnalysisV3Unit(unit, validationContext, { allowedRequirementIds })');
  assert.equal(typeof Agt002PreviewContract.buildAgt002IntegralAnalysisV3BatchOutputJsonSchema, 'function', 'agt002-preview-contract.js must export buildAgt002IntegralAnalysisV3BatchOutputJsonSchema(validationContext, batch)');
  assert.equal(typeof Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch, 'function', 'agt002-preview-contract.js must export validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch })');
  assert.equal(typeof Agt002PreviewContract.mergeAgt002IntegralAnalysisV3Batches, 'function', 'agt002-preview-contract.js must export mergeAgt002IntegralAnalysisV3Batches(validatedBatchResults, validationContext)');
  assert.ok(Array.isArray(Agt002PreviewContract.AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS), 'agt002-preview-contract.js must export AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS as an array');
}

// ---------------------------------------------------------------------------------------------
// (1) Wire schema shape: closed, recursively-closed-for-Structured-Outputs, batch-local-only.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const schema = Agt002PreviewContract.buildAgt002IntegralAnalysisV3BatchOutputJsonSchema(validationContext, BATCH_A);

  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['integral_analysis']);
  assert.deepEqual(Object.keys(schema.properties), ['integral_analysis'], 'top-level contract_version/coverage must never be offered on a batch turn');

  const integralAnalysisSchema = schema.properties.integral_analysis;
  assert.equal(integralAnalysisSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(integralAnalysisSchema.properties), ['analysis_units']);

  const unitsSchema = integralAnalysisSchema.properties.analysis_units;
  assert.equal(unitsSchema.type, 'array');
  assert.equal(unitsSchema.minItems, BATCH_A.requirement_ids.length, 'a batch turn must offer exactly one slot per assigned requirement — never fewer');
  assert.equal(unitsSchema.maxItems, BATCH_A.requirement_ids.length, 'a batch turn must offer exactly one slot per assigned requirement — never more');

  const unitSchema = unitsSchema.items;
  assert.equal(unitSchema.additionalProperties, false);
  const unitKeys = Object.keys(unitSchema.properties).sort();
  for (const excluded of ['unit_id', 'sequence', 'category', 'evidence_state']) {
    assert.ok(!unitKeys.includes(excluded), `batch unit wire schema must never offer server-owned "${excluded}"`);
  }
  assert.deepEqual(unitKeys, [...Agt002PreviewContract.AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS].sort());

  // unit_kind is fixed to tender_requirement only — no strategic_consideration branch exists to pick.
  const unitKindSchema = unitSchema.properties.unit_kind;
  assert.ok(
    unitKindSchema.const === 'tender_requirement' || (Array.isArray(unitKindSchema.enum) && unitKindSchema.enum.length === 1 && unitKindSchema.enum[0] === 'tender_requirement'),
    'unit_kind must be pinned to exactly "tender_requirement" on the batch wire',
  );

  // requirement_id is restricted to THIS batch's assigned ids, never the full governed manifest.
  const requirementIdSchema = unitSchema.properties.requirement_id;
  assert.deepEqual([...requirementIdSchema.enum].sort(), [...BATCH_A.requirement_ids].sort());

  function assertRecursivelyClosed(node, path = '$') {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path} must set additionalProperties=false`);
      assert.ok(node.properties && typeof node.properties === 'object', `${path} must declare properties`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every property`);
      for (const [key, child] of Object.entries(node.properties)) assertRecursivelyClosed(child, `${path}.properties.${key}`);
    }
    if (node.type === 'array') assertRecursivelyClosed(node.items, `${path}.items`);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach((branch, index) => assertRecursivelyClosed(branch, `${path}.anyOf[${index}]`));
  }
  assertRecursivelyClosed(schema);
}

// ---------------------------------------------------------------------------------------------
// (2) Happy path + deterministic server-owned assembly (unit_id, GLOBAL sequence, category,
//     evidence_state) — batch B starts at global position 3, proving sequence is never a
//     batch-local 1..N restart.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const resultA = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A },
  );
  assert.deepEqual(Object.keys(resultA), ['analysis_units'], 'a batch result must never carry contract_version/coverage — those are assembled once, only at merge');
  assert.equal(resultA.analysis_units.length, 2);

  const resultB = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B },
  );
  assert.equal(resultB.analysis_units.length, 2);

  for (const unit of [...resultA.analysis_units, ...resultB.analysis_units]) {
    const governed = GOVERNED[unit.requirement_id];
    assert.equal(unit.unit_id, `UNIT-${unit.requirement_id}`, 'unit_id must be the deterministic server-owned UNIT-<requirement_id> construction');
    assert.equal(unit.sequence, governed.sequence, 'sequence must be the requirement\'s GLOBAL position in the full governed manifest, never a batch-local index');
    assert.equal(unit.category, governed.category, 'category must come from the governed requirement manifest, never the model');
  }
  // Batch B's own first unit (REQ-TECH-1) must carry global sequence 3, not the batch-local 1 —
  // the single strongest possible proof that sequencing is never re-based per batch.
  assert.equal(resultB.analysis_units[0].sequence, 3);
  assert.equal(resultB.analysis_units[1].sequence, 4);

  const governedEvidenceStateByRequirementId = new Map(validationContext.evidenceStateManifest.map(entry => [entry.requirement_id, entry.evidence_state]));
  for (const unit of resultA.analysis_units) {
    assert.deepEqual(unit.evidence_state, governedEvidenceStateByRequirementId.get(unit.requirement_id), 'evidence_state must come from the governed map, never the model (which never even offered it on the wire)');
  }
}

// ---------------------------------------------------------------------------------------------
// (3) Server-owned fields are rejected outright if a (malformed/adversarial) turn carries them
//     at all — defense in depth beyond the wire schema's additionalProperties:false, matching
//     the existing single-turn pattern (assembleAgt002GovernedIntegralAnalysisV3Units already
//     independently re-checks category/evidence_state even though the wire schema also does).
// ---------------------------------------------------------------------------------------------
{
  const cases = [
    ['unit_id', unit => { unit.unit_id = 'UNIT-FORGED'; }],
    ['sequence', unit => { unit.sequence = 1; }],
    ['category', unit => { unit.category = 'discard'; }],
    ['evidence_state', unit => { unit.evidence_state = { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' }; }],
  ];
  for (const [field, mutate] of cases) {
    expectBatchRejects(['REQ-DISCARD-1'], (value) => { mutate(value.integral_analysis.analysis_units[0]); }, /./, `a model-supplied "${field}" must be rejected, not silently accepted or overwritten`);
  }
}

// Top-level governed metadata smuggled onto a batch turn is rejected exactly like it already is
// on the existing single-turn contract.
{
  expectBatchRejects(['REQ-DISCARD-1'], (value) => { value.contract_version = AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION; }, /contract_version|integral_analysis/i);
  expectBatchRejects(['REQ-DISCARD-1'], (value) => {
    value.integral_analysis.coverage = { manifest_version: 'x', expected_requirement_ids: [], analyzed_requirement_ids: [], material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'x', company_evidence_class_ids: [], legal_corpus_version_id: null };
  }, /coverage|analysis_units/i);
}

// ---------------------------------------------------------------------------------------------
// (4) Every strategic/global unit is rejected — the batch wire never accepts
//     strategic_consideration, regardless of how well-formed it otherwise is.
// ---------------------------------------------------------------------------------------------
{
  expectBatchRejects(['REQ-DISCARD-1'], (value) => {
    value.integral_analysis.analysis_units[0] = {
      requirement_id: null,
      unit_kind: 'strategic_consideration',
      title: 'Consideración estratégica sintética',
      assessment_mode: 'assessed',
      conclusion: { status: 'human_validation_required', summary: 'x', confidence: 'medium' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'x' },
      evidence_refs: [{ ref: 'HE-1', source_type: 'human_evidence', purpose: 'commercial_context' }],
      missing_evidence: [],
      commercial_impact: { level: 'medium', summary: 'x', dimension: 'strategic_fit' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'x', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'x' },
      escalation: { required: false, level: 'none', reason: 'x' },
      closure: { status: 'human_confirmation_required', condition: 'x', evidence_required: ['human_evidence'] },
      human_validation: { required: true, status: 'pending', reason: 'x' },
    };
  }, /strategic_consideration|unit_kind|tender_requirement/i, 'strategic_consideration must never be accepted on a batch turn');
}

// ---------------------------------------------------------------------------------------------
// (5) Exact local coverage: every assigned requirement_id, once each, in the assigned order.
//     Missing / duplicate / reordered / foreign-id-smuggled-in must all be rejected.
// ---------------------------------------------------------------------------------------------
{
  // Missing: only one of the two assigned requirements is present.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(['REQ-DISCARD-1']);
    assert.throws(
      () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
      /coverage|cobertura/i,
    );
  }
  // Duplicate: the same requirement twice, the other omitted.
  {
    const validationContext = buildValidationContext();
    const value = { integral_analysis: { analysis_units: [buildBatchWireUnit('REQ-DISCARD-1'), buildBatchWireUnit('REQ-DISCARD-1')] } };
    assert.throws(
      () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
      /coverage|cobertura|duplicad/i,
    );
  }
  // Reordered: both assigned requirements present, but out of the batch's assigned order.
  {
    const validationContext = buildValidationContext();
    const value = { integral_analysis: { analysis_units: [buildBatchWireUnit('REQ-HAB-1'), buildBatchWireUnit('REQ-DISCARD-1')] } };
    assert.throws(
      () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
      /coverage|cobertura|orden|order/i,
    );
  }
  // Foreign id: a requirement that is real and globally allowlisted, but not assigned to THIS batch.
  {
    const validationContext = buildValidationContext();
    const value = { integral_analysis: { analysis_units: [buildBatchWireUnit('REQ-DISCARD-1'), buildBatchWireUnit('REQ-TECH-1')] } };
    assert.throws(
      () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
      /coverage|cobertura|requirement_id/i,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// (6) Evidence references outside the batch citation allowlist: a tender_document ref that IS
//     globally allowlisted (so it would pass the existing full-document check) but was NOT
//     retained by THIS batch's projection must still be rejected. A company_evidence ref stays
//     governed by the full, unsliced allowlist and must still be accepted.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const value = buildBatchTurn(BATCH_A.requirement_ids);
  // TD-FIN-1 is real and globally allowlisted, but belongs to batch B's citation_allowlist, not A's.
  value.integral_analysis.analysis_units[0].evidence_refs = [{ ref: 'TD-FIN-1', source_type: 'tender_document', purpose: 'requirement_basis' }];
  assert.throws(
    () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
    /citation_allowlist|allowlist/i,
  );

  // Positive control: the HAB unit's company_evidence ref ("rup") is NOT in either batch's
  // citation_allowlist (that allowlist is tender_document-only, per design §6) and must still
  // validate — proving the batch citation allowlist narrows only tender_document, never company/
  // legal/human/objective-validation evidence.
  const okValue = buildBatchTurn(BATCH_A.requirement_ids);
  const okResult = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(okValue, { validationContext, batch: BATCH_A });
  assert.ok(okResult.analysis_units.find(unit => unit.requirement_id === 'REQ-HAB-1').evidence_refs.some(ref => ref.ref === 'rup'));
}

// ---------------------------------------------------------------------------------------------
// (7) Omission/abstention violation: when the governed context observed material omissions, a
//     batch turn that still presents an assessed (non-abstained) unit must be rejected — this is
//     the existing full-document invariant (validateMaterialOmissionsInvariant), now also caught
//     as early as per-batch validation rather than only surfacing later at merge time.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  validationContext.materialOmissionsObserved = true;
  const value = buildBatchTurn(BATCH_A.requirement_ids); // both units are "assessed", not abstained
  assert.throws(
    () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
    /abstained|abstenci|material_omissions|omisi/i,
  );
}

// ---------------------------------------------------------------------------------------------
// (8) Deterministic merge of multiple validated batches into the unchanged full V3 envelope,
//     then the existing full validator runs over it unchanged and accepts it.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const resultA = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  const resultB = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B });

  const merged = Agt002PreviewContract.mergeAgt002IntegralAnalysisV3Batches([resultA, resultB], validationContext);

  assert.equal(merged.contract_version, AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION);
  assert.deepEqual(merged.coverage.expected_requirement_ids, ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1']);
  assert.deepEqual(merged.coverage.analyzed_requirement_ids, ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1']);
  assert.equal(merged.analysis_units.length, 4);
  assert.deepEqual(merged.analysis_units.map(unit => unit.requirement_id), ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1']);
  assert.deepEqual(merged.analysis_units.map(unit => unit.sequence), [1, 2, 3, 4]);

  // "then run the existing full V3 validator unchanged": calling it again directly, independently
  // of the merge function's own internal call, must be idempotent and produce an equivalent result
  // — proving mergeAgt002IntegralAnalysisV3Batches's authority is genuinely the SAME unchanged
  // validateAgt002IntegralAnalysisV3, not a parallel/weaker reimplementation of its checks.
  const reValidated = validateAgt002IntegralAnalysisV3(merged, validationContext);
  assert.deepEqual(reValidated, merged);
}

// ---------------------------------------------------------------------------------------------
// (9) Cross-batch id collision: two batches whose (adversarial/buggy) descriptors overlap on a
//     requirement must be rejected at merge time even though each batch, in isolation, satisfies
//     its own local coverage check.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const overlappingBatchB = Object.freeze({
    batch_index: 1, batch_count: 2, requirement_ids: ['REQ-TECH-1', 'REQ-HAB-1'], citation_allowlist: ['TD-TECH-1', 'TD-HAB-1'],
  });

  const resultA = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  // Batch B' is locally well-formed on its own (exact coverage of ITS OWN assigned ids) — the
  // defect is only visible once merged against batch A.
  const resultBPrime = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(overlappingBatchB.requirement_ids), { validationContext, batch: overlappingBatchB });

  assert.throws(
    () => Agt002PreviewContract.mergeAgt002IntegralAnalysisV3Batches([resultA, resultBPrime], validationContext),
    /requirement_id|unit_id|duplicad|coverage|cobertura/i,
    'a cross-batch requirement_id collision (REQ-HAB-1 appears in both batches; REQ-FIN-1 in neither) must be rejected at merge time',
  );
}

// ---------------------------------------------------------------------------------------------
// (10) The full validator remains at least as strict as before, and the existing single-turn
//      (non-batch) contract is not weakened by this addition. The unchanged single-turn path
//      does not simply reject an incomplete turn: it autoassembles governed abstention units
//      for any requirement_id missing from the model's turn (see
//      normalizeAgt002TenderUnitsToManifestOrder / buildAgt002GovernedAbstentionUnit in
//      agt002-preview-contract.js). A batch-shaped partial turn (only 2 of 4 governed ids) is
//      still rejected by the unchanged single-turn validator — not for missing coverage, but
//      because REQ-TECH-1/REQ-FIN-1's material governed evidence_state (non-"unknown"
//      compliance) conflicts with the synthesized abstention's empty evidence_refs, tripping
//      the same governed evidence-state invariant the full validator has always enforced. This
//      proves the two entry points are additive, not a replacement of one by the other.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const partialSingleTurn = {
    integral_analysis: {
      analysis_units: BATCH_A.requirement_ids.map((id) => {
        const wire = buildBatchWireUnit(id);
        return {
          ...wire,
          unit_id: `UNIT-${id}`,
          sequence: GOVERNED[id].sequence,
          category: null,
          evidence_state: null,
        };
      }),
    },
  };
  assert.throws(
    () => Agt002PreviewContract.validateAgt002PreviewModelOutputV3(partialSingleTurn, validationContext),
    error => error?.code === 'v3_evidence_state_invariant',
    'the existing single-turn contract must still autoassemble governed abstentions for the requirement_ids missing from the turn, and reject them once those abstentions conflict with material governed evidence — batching must never weaken it',
  );
}

// Regression spot-checks: the extraction required to share unit validation between the full
// single-turn path and the new batch path must not have weakened the full validator itself.
// These re-run two representative existing negative cases from
// tests/agt002-integral-analysis-v3.test.mjs directly against the unchanged public entry point.
{
  const validationContext = buildValidationContext();
  const resultA = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  const resultB = Agt002PreviewContract.validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B });
  const merged = Agt002PreviewContract.mergeAgt002IntegralAnalysisV3Batches([resultA, resultB], validationContext);

  // Duplicate unit_id must still be rejected by the unchanged full validator.
  {
    const broken = structuredClone(merged);
    broken.analysis_units[1] = { ...broken.analysis_units[1], unit_id: broken.analysis_units[0].unit_id };
    assert.throws(() => validateAgt002IntegralAnalysisV3(broken, validationContext), /unit_id/i);
  }
  // Non-ascending sequence must still be rejected by the unchanged full validator.
  {
    const broken = structuredClone(merged);
    broken.analysis_units[1] = { ...broken.analysis_units[1], sequence: broken.analysis_units[0].sequence };
    assert.throws(() => validateAgt002IntegralAnalysisV3(broken, validationContext), /sequence|secuencia/i);
  }
}

console.log('agt002-integral-analysis-batch-contract passed');
