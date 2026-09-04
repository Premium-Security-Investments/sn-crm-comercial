// AGT-002 durable batched analysis — batch/single-turn CRITICAL ESCALATION normalization parity.
//
// Production defect this pins (verification job 4d8b0295-bfdc-4933-80a9-d7754b338109 on merge
// d52fa9a5: durable batched run failed closed with validation_code=v3_escalation_invariant at
// integral_v3_validation, 36 semantic checkpoints reused, persistence_attempts=0 — the batch
// turn never reached persistence):
//
//   The single-turn assembler (assembleAgt002GovernedIntegralAnalysisV3Units) runs
//   normalizeAgt002CriticalEscalationUnit as the OUTERMOST normalization, so the 7.11
//   invariant — "a defined critical condition (not-curable blocker, material legal
//   uncertainty, or critical commercial exposure) demands escalation.required=true", plus
//   the required/level correspondence — is conservatively repaired at the server-owned
//   boundary before validateAgt002IntegralAnalysisV3 ever sees the unit.
//
//   The batch assembler (assembleAgt002IntegralAnalysisV3BatchUnit) was given
//   normalizeAgt002ActionsUnit by PR #178, but NOT normalizeAgt002CriticalEscalationUnit.
//   A batch unit that declares a critical condition while leaving
//   escalation={required:false, level:"none"} therefore reaches the unweakened
//   validateAgt002IntegralAnalysisV3Unit unrepaired and fails closed on
//   v3_escalation_invariant — while the byte-identical unit on the single-turn path is
//   accepted with escalation raised to {required:true, level:"role_review"}.
//
// The fix under test: the batch path must reuse the EXISTING normalizeAgt002CriticalEscalationUnit,
// after governed-field assembly and before the SAME unweakened validateAgt002IntegralAnalysisV3Unit.
// Not a weaker validator, not a new rule — the shared normalizer applies exactly one deterministic
// required/level correspondence: it RAISES escalation for a critical condition (and never drops a
// model-declared required=true), and, in the other direction, resolves the contradictory
// {required:false, <named level>} pair on a NON-critical unit by collapsing the level to "none".
// Both directions are pinned below, on both paths. Neither ever approves human review, invents
// evidence, or rewrites model prose.
//
// Sections (4) and (5) below are the anti-regression half: escalation normalization must not
// launder invalid enums or malformed escalation shapes, and must not become a side door around
// identity, coverage, allowlists, the legal-assessment invariant or the human/abstention gates.
//
// Namespace imports only, matching tests/agt002-batch-action-normalization-parity.test.mjs, so a
// missing export fails as an ordinary diagnostic assert rather than a link-time SyntaxError that
// would abort the file before a single case runs.

import { strict as assert } from 'node:assert';
import * as Agt002PreviewContract from '../agt002-preview-contract.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const {
  validateAgt002PreviewModelOutputV3Batch,
  validateAgt002PreviewModelOutputV3,
  mergeAgt002IntegralAnalysisV3Batches,
} = Agt002PreviewContract;

// ---------------------------------------------------------------------------------------------
// Fixture: the same synthetic governed context shape already proven in
// tests/agt002-batch-action-normalization-parity.test.mjs, split into the same two contiguous
// batches. Here the `actions` arrays are already correctly anchored (basis_unit_id is the
// governed `UNIT-<requirement_id>`), so action normalization is a deliberate no-op and any
// rejection is unambiguously attributable to the escalation gap under test.
//
// Three of the four units carry one of the three DEFINED critical conditions of invariant 7.11,
// each paired with escalation {required:false, level:"none"}:
//
//   REQ-DISCARD-1 — blocking.effect "blocker" + curability "not_curable"
//   REQ-TECH-1    — legal_assessment.status "not_verified" + human_legal_review_required true
//   REQ-FIN-1     — commercial_impact.level "critical"
//
// REQ-HAB-1 is the control: no critical condition, escalation {required:false, level:"none"}
// must survive completely untouched.
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
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
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

const GOVERNED = {
  'REQ-DISCARD-1': { category: 'discard', sequence: 1 },
  'REQ-HAB-1': { category: 'habilitating', sequence: 2 },
  'REQ-TECH-1': { category: 'technical', sequence: 3 },
  'REQ-FIN-1': { category: 'financial_execution', sequence: 4 },
};

const BATCH_A = Object.freeze({
  batch_index: 0, batch_count: 2, requirement_ids: ['REQ-DISCARD-1', 'REQ-HAB-1'], citation_allowlist: ['TD-DISCARD-1', 'TD-HAB-1'],
});
const BATCH_B = Object.freeze({
  batch_index: 1, batch_count: 2, requirement_ids: ['REQ-TECH-1', 'REQ-FIN-1'], citation_allowlist: ['TD-TECH-1', 'TD-FIN-1'],
});

const ALL_REQUIREMENT_IDS = ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1'];

// Which units carry a defined critical condition, and by which of the three routes — asserted
// literally below so a production bug cannot quietly agree with a test bug.
const CRITICAL_CONDITION_BY_REQUIREMENT = {
  'REQ-DISCARD-1': 'not_curable_blocker',
  'REQ-HAB-1': null,
  'REQ-TECH-1': 'material_legal_uncertainty',
  'REQ-FIN-1': 'critical_commercial_exposure',
};

function buildBatchWireUnit(requirementId) {
  const byId = {
    'REQ-DISCARD-1': {
      requirement_id: 'REQ-DISCARD-1',
      unit_kind: 'tender_requirement',
      title: 'Causal de descarte evidenciada',
      assessment_mode: 'assessed',
      conclusion: { status: 'gap_evidenced', summary: 'El pliego evidencia una causal de descarte que no admite subsanación.', confidence: 'high' },
      blocking: { effect: 'blocker', curability: 'not_curable', reason: 'Causal de rechazo no subsanable según el pliego revisado.' },
      evidence_refs: [{ ref: 'TD-DISCARD-1', source_type: 'tender_document', purpose: 'gap_basis' }],
      missing_evidence: [],
      commercial_impact: { level: 'high', summary: 'Compromete la elegibilidad de la oferta.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico para esta causal.', human_legal_review_required: false },
      actions: [
        { action_id: 'ACT-DISCARD-1', action_type: 'human_decision', summary: 'Decidir si se desiste del proceso ante la causal no subsanable.', basis_unit_id: 'UNIT-REQ-DISCARD-1', suggested_role: 'authorized_human', priority: 'critical', external_side_effect: false },
      ],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona autorizada confirma el efecto de la causal de descarte.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar la causal de descarte no subsanable.' },
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
      legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Alcance jurídico de la exigencia técnica no verificado; requiere revisión humana.', human_legal_review_required: true },
      actions: [
        { action_id: 'ACT-TECH-1', action_type: 'verify_validity', summary: 'Verificar vigencia del documento técnico presentado.', basis_unit_id: 'UNIT-REQ-TECH-1', suggested_role: 'technical', priority: 'medium', external_side_effect: false },
      ],
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
      commercial_impact: { level: 'critical', summary: 'La brecha financiera compromete críticamente la capacidad de ejecución.', dimension: 'financial_exposure' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico específico.', human_legal_review_required: false },
      actions: [
        { action_id: 'ACT-FIN-1', action_type: 'remediate_gap', summary: 'Subsanar brecha financiera evidenciada antes del cierre.', basis_unit_id: 'UNIT-REQ-FIN-1', suggested_role: 'financial', priority: 'high', external_side_effect: false },
      ],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'open', condition: 'Evidencia de subsanación de la brecha financiera presentada y revisada.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar subsanación de la brecha financiera.' },
    },
  };
  const unit = byId[requirementId];
  if (!unit) throw new Error(`fixture bug: no batch wire unit for ${requirementId}`);
  return structuredClone(unit);
}

function buildBatchTurn(requirementIds) {
  return { integral_analysis: { analysis_units: requirementIds.map(buildBatchWireUnit) } };
}

// The equivalent SINGLE-TURN turn: the model owns unit_id/sequence there and must leave
// category/evidence_state null. Every other field — escalation included — is byte-identical to
// the batch wire unit, which is exactly what makes the two paths comparable.
function buildSingleTurn(requirementIds) {
  return {
    integral_analysis: {
      analysis_units: requirementIds.map((requirementId) => ({
        ...buildBatchWireUnit(requirementId),
        unit_id: `UNIT-${requirementId}`,
        sequence: GOVERNED[requirementId].sequence,
        category: null,
        evidence_state: null,
      })),
    },
  };
}

function findUnit(units, requirementId) {
  const unit = units.find(entry => entry.requirement_id === requirementId);
  assert.ok(unit, `expected an assembled unit for ${requirementId}`);
  return unit;
}

// The governed escalation outcome both paths must converge on, restated independently of the
// production normalizer so a bug there cannot satisfy this by construction.
function assertEscalationGoverned(unit) {
  const unitId = unit.unit_id;
  const { escalation, blocking, legal_assessment: legal, commercial_impact: impact } = unit;
  const critical = (blocking.effect === 'blocker' && blocking.curability === 'not_curable')
    || (legal.status === 'not_verified' && legal.human_legal_review_required === true)
    || impact.level === 'critical';
  if (critical) {
    assert.equal(escalation.required, true, `${unitId}: a defined critical condition demands escalation.required=true`);
    assert.notEqual(escalation.level, 'none', `${unitId}: escalation.required=true demands a level other than "none"`);
  }
  if (escalation.required === false) {
    assert.equal(escalation.level, 'none', `${unitId}: escalation.required=false demands level "none"`);
  }
}

// ---------------------------------------------------------------------------------------------
// (1) RED: the batch path must accept the same critical-condition units the single-turn path
//     already normalizes. Today it throws v3_escalation_invariant on the first one.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();

  const resultA = validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A },
  );

  // REQ-DISCARD-1 — not-curable blocker.
  const discard = findUnit(resultA.analysis_units, 'REQ-DISCARD-1');
  assert.equal(discard.unit_id, 'UNIT-REQ-DISCARD-1');
  assert.equal(discard.escalation.required, true, 'a not-curable blocker must raise escalation.required server-side');
  assert.equal(discard.escalation.level, 'role_review', 'an escalation raised from level "none" must land on the minimum named level');
  assert.equal(
    discard.escalation.reason,
    buildBatchWireUnit('REQ-DISCARD-1').escalation.reason,
    'escalation.reason is model-owned prose and must never be rewritten by normalization',
  );
  assertEscalationGoverned(discard);

  // REQ-HAB-1 — the control: no critical condition, so the unit is untouched.
  const hab = findUnit(resultA.analysis_units, 'REQ-HAB-1');
  assert.deepEqual(
    hab.escalation,
    buildBatchWireUnit('REQ-HAB-1').escalation,
    'a unit with no critical condition must keep the escalation the model declared, byte for byte',
  );
  assertEscalationGoverned(hab);

  const resultB = validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B },
  );

  // REQ-TECH-1 — material legal uncertainty (the production-observed shape:
  // legal_assessment.status "not_verified" + human_legal_review_required true).
  const tech = findUnit(resultB.analysis_units, 'REQ-TECH-1');
  assert.equal(tech.escalation.required, true, 'material legal uncertainty must raise escalation.required server-side');
  assert.equal(tech.escalation.level, 'role_review');
  assertEscalationGoverned(tech);

  // REQ-FIN-1 — critical commercial exposure.
  const fin = findUnit(resultB.analysis_units, 'REQ-FIN-1');
  assert.equal(fin.escalation.required, true, 'critical commercial exposure must raise escalation.required server-side');
  assert.equal(fin.escalation.level, 'role_review');
  assertEscalationGoverned(fin);

  // Normalization is scoped strictly to `escalation`: every other field the model owns must
  // survive byte-identical. In particular it may never approve the pending human review, never
  // downgrade the human_validation gate, and never touch evidence.
  for (const unit of [discard, hab, tech, fin]) {
    const wire = buildBatchWireUnit(unit.requirement_id);
    assert.deepEqual(unit.legal_assessment, wire.legal_assessment, `${unit.unit_id}: legal_assessment must be untouched by escalation normalization`);
    assert.deepEqual(unit.human_validation, wire.human_validation, `${unit.unit_id}: human_validation must be untouched by escalation normalization`);
    assert.deepEqual(unit.evidence_refs, wire.evidence_refs, `${unit.unit_id}: evidence_refs must be untouched by escalation normalization`);
    assert.deepEqual(unit.missing_evidence, wire.missing_evidence, `${unit.unit_id}: missing_evidence must be untouched by escalation normalization`);
    assert.deepEqual(unit.actions, wire.actions, `${unit.unit_id}: already-anchored actions must be untouched`);
    assert.deepEqual(unit.blocking, wire.blocking, `${unit.unit_id}: blocking must be untouched by escalation normalization`);
    assert.deepEqual(unit.commercial_impact, wire.commercial_impact, `${unit.unit_id}: commercial_impact must be untouched by escalation normalization`);
    assert.deepEqual(unit.conclusion, wire.conclusion, `${unit.unit_id}: conclusion must be untouched by escalation normalization`);
    assert.deepEqual(unit.closure, wire.closure, `${unit.unit_id}: closure must be untouched by escalation normalization`);
    assert.equal(unit.human_validation.required, true);
    assert.equal(unit.human_validation.status, 'pending');
  }
  assert.equal(tech.legal_assessment.human_legal_review_required, true, 'escalation normalization must never approve a pending human legal review');
}

// ---------------------------------------------------------------------------------------------
// (2) Parity with the single-turn path: the identical units, through
//     validateAgt002PreviewModelOutputV3, already validate today — that is the reference
//     behavior the batch path is required to match, and it is asserted here (not assumed) so
//     this file also fails if the single-turn normalization is ever weakened.
// ---------------------------------------------------------------------------------------------
{
  const singleTurn = validateAgt002PreviewModelOutputV3(buildSingleTurn(ALL_REQUIREMENT_IDS), buildValidationContext());
  for (const unit of singleTurn.analysis_units) assertEscalationGoverned(unit);

  const validationContext = buildValidationContext();
  const resultA = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  const resultB = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B });
  const merged = mergeAgt002IntegralAnalysisV3Batches([resultA, resultB], validationContext);

  assert.deepEqual(merged.analysis_units.map(unit => unit.requirement_id), ALL_REQUIREMENT_IDS);
  for (const requirementId of ALL_REQUIREMENT_IDS) {
    assert.deepEqual(
      findUnit(merged.analysis_units, requirementId).escalation,
      findUnit(singleTurn.analysis_units, requirementId).escalation,
      `batch and single-turn must produce identical governed escalation for ${requirementId}`,
    );
  }

  // The three critical routes are all genuinely exercised — this pins the fixture itself, so a
  // future edit cannot silently turn a critical unit into a non-critical one and leave the test
  // passing vacuously.
  for (const [requirementId, route] of Object.entries(CRITICAL_CONDITION_BY_REQUIREMENT)) {
    const unit = findUnit(merged.analysis_units, requirementId);
    assert.equal(
      unit.escalation.required,
      route !== null,
      `fixture drift: ${requirementId} is expected to carry critical route "${route}"`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// (3) The merged batch envelope still passes the unchanged full validator end to end — the
//     normalization happens at the server-owned boundary, so the sole final authority
//     (validateAgt002IntegralAnalysisV3, invoked inside mergeAgt002IntegralAnalysisV3Batches)
//     accepts it without any rule being relaxed for it.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const resultA = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  const resultB = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B });
  const merged = mergeAgt002IntegralAnalysisV3Batches([resultA, resultB], validationContext);

  assert.deepEqual(merged.analysis_units.map(unit => unit.sequence), [1, 2, 3, 4]);
  for (const unit of merged.analysis_units) {
    assert.equal(unit.category, GOVERNED[unit.requirement_id].category);
    assertEscalationGoverned(unit);
  }
}

// ---------------------------------------------------------------------------------------------
// (4) Anti-laundering: an invalid escalation enum or a malformed escalation shape is NOT
//     normalized. These are model errors with no governed correct answer, and they must still
//     fail closed — normalization only ever fills the ONE governed value ("none" is not a legal
//     level for a required escalation, and the minimum named level is role_review). The enum
//     cases are asserted on REQ-TECH-1, whose escalation IS required, so the level the model
//     supplied is the one that must reach the validator untouched; the non-required case is
//     governed by the required/level correspondence pinned at the end of this section.
// ---------------------------------------------------------------------------------------------
{
  function expectBatchRejects(mutateUnit, matcher, message) {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    mutateUnit(findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1'));
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      matcher,
      message,
    );
  }

  // An invalid level on a critical unit: normalization raises `required`, but it has no basis to
  // invent a level, so the bogus enum reaches the unchanged validator and is rejected.
  expectBatchRejects(unit => { unit.escalation.level = 'escalar_ya'; }, /level/i, 'an invalid escalation.level enum must never be normalized away');
  expectBatchRejects(unit => { unit.escalation.level = 'ROLE_REVIEW'; }, /level/i, 'escalation.level enums are exact and must never be case-normalized');
  expectBatchRejects(unit => { delete unit.escalation.reason; }, /escalation|claves|keys/i, 'a missing escalation key must never be filled in by normalization');
  expectBatchRejects(unit => { unit.escalation.escalate_now = true; }, /escalation|claves|keys/i, 'an extra escalation key must never be accepted');
  expectBatchRejects(unit => { unit.escalation.reason = 42; }, /reason/i, 'a non-string escalation.reason must never be coerced');
  expectBatchRejects(unit => { unit.escalation = null; }, /escalation/i, 'a null escalation object must never be synthesized by normalization');

  // The `required` field is a boolean contract, not a truthiness contract: a string is never
  // read as an escalation the model asked for. On a critical unit the governed condition still
  // raises it — the repair comes from the governed condition, never from the model's malformed
  // value — and the two paths must agree exactly.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').escalation.required = 'true';
    const result = validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B });
    const tech = findUnit(result.analysis_units, 'REQ-TECH-1');
    assert.equal(tech.escalation.required, true);
    assert.equal(typeof tech.escalation.required, 'boolean', 'escalation.required must end up a real boolean, never a truthy string');

    const singleTurnValue = buildSingleTurn(ALL_REQUIREMENT_IDS);
    findUnit(singleTurnValue.integral_analysis.analysis_units, 'REQ-TECH-1').escalation.required = 'true';
    const singleResult = validateAgt002PreviewModelOutputV3(singleTurnValue, buildValidationContext());
    assert.deepEqual(
      tech.escalation,
      findUnit(singleResult.analysis_units, 'REQ-TECH-1').escalation,
      'batch and single-turn must handle a malformed escalation.required identically',
    );
  }

  // Direction of the repair, half one: a model-declared escalation is never DROPPED. A unit that
  // declares required=true keeps it — even with no critical condition at all — and a level of
  // "none" is lifted to the minimum named level rather than the escalation being discarded.
  // Both paths must agree.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_A.requirement_ids);
    const hab = findUnit(value.integral_analysis.analysis_units, 'REQ-HAB-1');
    hab.escalation = { required: true, level: 'none', reason: 'El responsable pidió revisión aunque no hay condición crítica.' };
    const result = validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A });
    const normalizedHab = findUnit(result.analysis_units, 'REQ-HAB-1');
    assert.equal(normalizedHab.escalation.required, true, 'a model-declared escalation must never be dropped');
    assert.equal(normalizedHab.escalation.level, 'role_review');

    const singleTurnValue = buildSingleTurn(ALL_REQUIREMENT_IDS);
    findUnit(singleTurnValue.integral_analysis.analysis_units, 'REQ-HAB-1').escalation = { required: true, level: 'none', reason: 'El responsable pidió revisión aunque no hay condición crítica.' };
    const singleResult = validateAgt002PreviewModelOutputV3(singleTurnValue, buildValidationContext());
    assert.deepEqual(normalizedHab.escalation, findUnit(singleResult.analysis_units, 'REQ-HAB-1').escalation);
  }

  // A named level the model chose itself is never downgraded to role_review on a critical unit —
  // normalization fills the missing value, it does not overwrite a present one.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    findUnit(value.integral_analysis.analysis_units, 'REQ-FIN-1').escalation = { required: false, level: 'committee', reason: 'Exposición crítica evidenciada.' };
    const result = validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B });
    const fin = findUnit(result.analysis_units, 'REQ-FIN-1');
    assert.equal(fin.escalation.required, true);
    assert.equal(fin.escalation.level, 'committee', 'a named level the model chose must be preserved, not downgraded');

    const singleTurnValue = buildSingleTurn(ALL_REQUIREMENT_IDS);
    findUnit(singleTurnValue.integral_analysis.analysis_units, 'REQ-FIN-1').escalation = { required: false, level: 'committee', reason: 'Exposición crítica evidenciada.' };
    const singleResult = validateAgt002PreviewModelOutputV3(singleTurnValue, buildValidationContext());
    assert.deepEqual(fin.escalation, findUnit(singleResult.analysis_units, 'REQ-FIN-1').escalation);
  }

  // Direction of the repair, half two — the NON-CRITICAL case, pinned here so nobody reads the
  // shared normalizer as a monotonic "only ever raises" transform. The byte-identical escalation
  // of the previous case ({required:false, level:"committee"}) on a unit with NO critical
  // condition and no model-declared required=true resolves the OTHER way: invariant 7.11 forbids
  // required=false with a named level, and the only value consistent with the required=false the
  // model itself declared is level "none", so the named level is LOWERED. This is long-standing
  // single-turn semantics; the fix's whole claim is that the batch path now matches it exactly,
  // so the parity assertion below is the point of the case, not decoration.
  {
    const nonCriticalContradiction = { required: false, level: 'committee', reason: 'Sin condición crítica identificada.' };

    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_A.requirement_ids);
    const wireHab = findUnit(value.integral_analysis.analysis_units, 'REQ-HAB-1');
    // Fixture guard: the case is only meaningful while REQ-HAB-1 carries none of the three
    // critical routes, so a future fixture edit cannot turn this into the raise case above.
    assert.equal(CRITICAL_CONDITION_BY_REQUIREMENT['REQ-HAB-1'], null);
    assert.notEqual(wireHab.blocking.curability, 'not_curable');
    assert.notEqual(wireHab.legal_assessment.status, 'not_verified');
    assert.notEqual(wireHab.commercial_impact.level, 'critical');
    wireHab.escalation = { ...nonCriticalContradiction };

    const result = validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A });
    const hab = findUnit(result.analysis_units, 'REQ-HAB-1');
    assert.equal(hab.escalation.required, false, 'no critical condition: the model-declared required=false must stand, never be raised');
    assert.equal(hab.escalation.level, 'none', 'required=false demands level "none": an unrequired named level is lowered, not preserved');
    assert.equal(hab.escalation.reason, nonCriticalContradiction.reason, 'reason is model-owned prose even when the level is lowered');
    assertEscalationGoverned(hab);

    const singleTurnValue = buildSingleTurn(ALL_REQUIREMENT_IDS);
    findUnit(singleTurnValue.integral_analysis.analysis_units, 'REQ-HAB-1').escalation = { ...nonCriticalContradiction };
    const singleResult = validateAgt002PreviewModelOutputV3(singleTurnValue, buildValidationContext());
    assert.deepEqual(
      hab.escalation,
      findUnit(singleResult.analysis_units, 'REQ-HAB-1').escalation,
      'batch and single-turn must resolve a non-critical {required:false, named level} contradiction identically',
    );

    // Lowering is scoped to `escalation` exactly like raising is: the rest of the unit, and in
    // particular the human_validation gate, is untouched.
    assert.deepEqual(hab.human_validation, buildBatchWireUnit('REQ-HAB-1').human_validation);
    assert.deepEqual(hab.legal_assessment, buildBatchWireUnit('REQ-HAB-1').legal_assessment);
  }
}

// ---------------------------------------------------------------------------------------------
// (5) Anti-relaxation: everything the batch validator already fails closed on must keep failing
//     closed, with critical conditions present on the turn. Escalation normalization must not
//     become a side door around identity, coverage, allowlists, the legal-assessment invariant
//     or the human/abstention gates.
// ---------------------------------------------------------------------------------------------
{
  // Forged server-owned fields on the wire stay rejected outright.
  for (const [field, mutate] of [
    ['unit_id', unit => { unit.unit_id = 'UNIT-FORGED'; }],
    ['sequence', unit => { unit.sequence = 1; }],
    ['category', unit => { unit.category = 'discard'; }],
    ['evidence_state', unit => { unit.evidence_state = { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' }; }],
  ]) {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    mutate(value.integral_analysis.analysis_units[0]);
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      error => error?.code === 'v3_batch_unit_shape_mismatch',
      `a model-supplied "${field}" must still be rejected, never overwritten by the assembler`,
    );
  }

  // A foreign requirement id (real and globally governed, but not assigned to this batch) stays
  // rejected — escalation normalization never widens the local id set.
  {
    const validationContext = buildValidationContext();
    const value = { integral_analysis: { analysis_units: [buildBatchWireUnit('REQ-TECH-1'), buildBatchWireUnit('REQ-DISCARD-1')] } };
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      /coverage|cobertura|requirement_id/i,
      'a requirement_id outside this batch must stay rejected',
    );
  }

  // An off-allowlist tender_document citation stays rejected.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').evidence_refs = [{ ref: 'TD-DISCARD-1', source_type: 'tender_document', purpose: 'requirement_basis' }];
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      /allowlist|citation/i,
      'a tender_document ref outside this batch citation_allowlist must stay rejected',
    );
  }

  // The material-omission abstention gate stays closed.
  {
    const validationContext = buildValidationContext();
    validationContext.materialOmissionsObserved = true;
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B }),
      error => error?.code === 'v3_material_omissions_abstention_required',
      'the material-omission abstention gate must stay closed regardless of escalation normalization',
    );
  }

  // A strategic_consideration unit stays rejected on a batch turn.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    value.integral_analysis.analysis_units[0].unit_kind = 'strategic_consideration';
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      error => error?.code === 'v3_batch_unit_kind_invariant',
      'strategic_consideration must stay rejected on a batch turn',
    );
  }

  // Raising escalation is never a substitute for the human validation gate: a unit that drops
  // its human_validation requirement is still rejected, critical condition or not.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').human_validation = { required: false, status: 'pending', reason: 'x' };
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      /human_validation|validaci/i,
      'escalation normalization must never relax the human validation gate',
    );
  }

  // A not-curable blocker with no allowlisted pliego/legal support stays rejected: escalation is
  // raised from the declared condition, but the condition itself still has to be evidenced.
  //
  // The replacement ref is deliberately a VALID, allowlisted `gap_basis` (human_evidence "HE-1"),
  // not an arbitrary one: REQ-DISCARD-1 concludes `gap_evidenced`, so stripping the gap_basis
  // would trip the earlier gap/basis check (v3_evidence_abstention_invariant) and the case would
  // never reach invariant 7.3 at all. With the gap_basis intact the ONLY thing missing is the
  // tender_document/legal_corpus support a `not_curable` curability demands — asserted by exact
  // code and message below, so a future reordering that made this pass for the wrong reason
  // fails here instead of quietly matching a loose regex.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_A.requirement_ids);
    const discard = findUnit(value.integral_analysis.analysis_units, 'REQ-DISCARD-1');
    assert.equal(discard.blocking.effect, 'blocker', 'fixture drift: this case needs a not-curable blocker');
    assert.equal(discard.blocking.curability, 'not_curable', 'fixture drift: this case needs a not-curable blocker');
    assert.equal(discard.conclusion.status, 'gap_evidenced', 'fixture drift: this case needs the gap_basis obligation in play');
    discard.evidence_refs = [{ ref: 'HE-1', source_type: 'human_evidence', purpose: 'gap_basis' }];
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_A }),
      (error) => {
        assert.equal(
          error?.code,
          'v3_blocking_action_invariant',
          `expected the not-curable support invariant (7.3), got ${error?.code}: ${error?.message}`,
        );
        assert.match(error.message, /not_curable/, 'the rejection must be about curability, not about the gap_basis ref');
        assert.match(error.message, /pliego|jur[íi]dic/i, 'the rejection must name the pliego/legal support that is missing');
        assert.doesNotMatch(error.message, /gap_basis/, 'the gap_basis obligation is satisfied here and must not be what fires');
        return true;
      },
      'escalation normalization must never manufacture the evidence a critical condition requires',
    );
  }
}

console.log('agt002-batch-escalation-normalization-parity passed');
