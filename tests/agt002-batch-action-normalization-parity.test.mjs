// AGT-002 durable batched analysis — batch/single-turn ACTION normalization parity.
//
// Production defect this pins (four durable_batched_v1 runs over one reused Procuraduría
// workset; last closed rejection recorded validation_code=v3_action_invariant inside
// validateAgt002PreviewModelOutputV3Batch):
//
//   The single-turn assembler (assembleAgt002GovernedIntegralAnalysisV3Units) runs
//   normalizeAgt002ActionsUnit *after* the unit has its unit_id, so the four
//   v3_action_invariant trigger conditions the model provably cannot govern —
//   basis_unit_id != containing unit_id, duplicate action_id inside one unit,
//   action_type "human_decision" with a role other than "authorized_human", and
//   external_side_effect != false — are conservatively repaired at the server-owned
//   boundary before validateAgt002IntegralAnalysisV3 ever sees them.
//
//   The batch assembler (assembleAgt002IntegralAnalysisV3BatchUnit) builds the four
//   server-owned fields (unit_id/sequence/category/evidence_state) and then hands the unit
//   straight to validateAgt002IntegralAnalysisV3Unit with NO action normalization at all.
//   basis_unit_id is the sharpest case: the batch wire contract removes `unit_id` from the
//   unit schema entirely (AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS), so the deterministic
//   `UNIT-<requirement_id>` value the invariant demands is *structurally invisible* to the
//   model on a batch turn. Any unit carrying a non-empty `actions` array is therefore a
//   deterministic coin flip, and every batch run of a workset with actionable requirements
//   fails closed on v3_action_invariant.
//
// The fix under test: the batch path must reuse the EXISTING normalizeAgt002ActionsUnit,
// after governed-field assembly and before the SAME unweakened
// validateAgt002IntegralAnalysisV3Unit. Not a weaker validator, not a new rule.
//
// Sections (4) and (5) below are the anti-regression half: normalization must repair only
// those four server-governable relationships and must NOT launder invalid enums, malformed
// action shapes, forged server-owned fields, foreign requirement ids, off-allowlist
// citations, strategic units or the material-omission abstention gate.
//
// Namespace imports only, matching tests/agt002-integral-analysis-batch-contract.test.mjs,
// so a missing export fails as an ordinary diagnostic assert rather than a link-time
// SyntaxError that would abort the file before a single case runs.

import { strict as assert } from 'node:assert';
import * as Agt002PreviewContract from '../agt002-preview-contract.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';

const {
  validateAgt002PreviewModelOutputV3Batch,
  validateAgt002PreviewModelOutputV3,
  mergeAgt002IntegralAnalysisV3Batches,
} = Agt002PreviewContract;

// ---------------------------------------------------------------------------------------------
// Fixture: the same synthetic governed context already proven in
// tests/agt002-integral-analysis-batch-contract.test.mjs, split into the same two contiguous
// batches. Only the `actions` arrays differ — they carry the exact defects a real model
// produces on a batch turn.
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

// The action defects, per requirement — each one is a relationship the model provably cannot
// govern on a batch turn, and each one is exactly what normalizeAgt002ActionsUnit already
// repairs on the single-turn path today.
//
//   REQ-TECH-1 — basis_unit_id cites the only id the batch wire ever showed the model
//                (`requirement_id`); the governed unit_id is `UNIT-REQ-TECH-1`.
//   REQ-FIN-1  — (a) two actions reusing one action_id, (b) a `human_decision` action routed
//                to `financial` instead of the mandatory `authorized_human`, and
//                (c) `external_side_effect: true` asserted by the model, which the AI
//                envelope may never carry.
const DEFECTIVE_ACTIONS = {
  'REQ-DISCARD-1': [],
  'REQ-HAB-1': [],
  'REQ-TECH-1': [
    { action_id: 'ACT-TECH-1', action_type: 'verify_validity', summary: 'Verificar vigencia del documento técnico presentado.', basis_unit_id: 'REQ-TECH-1', suggested_role: 'technical', priority: 'medium', external_side_effect: false },
  ],
  'REQ-FIN-1': [
    { action_id: 'ACT-FIN-1', action_type: 'remediate_gap', summary: 'Subsanar brecha financiera evidenciada antes del cierre.', basis_unit_id: 'REQ-FIN-1', suggested_role: 'financial', priority: 'high', external_side_effect: true },
    { action_id: 'ACT-FIN-1', action_type: 'human_decision', summary: 'Decidir si se continúa con la oferta pese a la brecha financiera.', basis_unit_id: 'REQ-FIN-1', suggested_role: 'financial', priority: 'high', external_side_effect: false },
  ],
};

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
      actions: [],
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
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito aplicable.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica identificada.' },
      closure: { status: 'open', condition: 'Evidencia de subsanación de la brecha financiera presentada y revisada.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar subsanación de la brecha financiera.' },
    },
  };
  const unit = byId[requirementId];
  if (!unit) throw new Error(`fixture bug: no batch wire unit for ${requirementId}`);
  const copy = structuredClone(unit);
  copy.actions = structuredClone(DEFECTIVE_ACTIONS[requirementId]);
  return copy;
}

function buildBatchTurn(requirementIds) {
  return { integral_analysis: { analysis_units: requirementIds.map(buildBatchWireUnit) } };
}

// The equivalent SINGLE-TURN turn: the model owns unit_id/sequence there and must leave
// category/evidence_state null. The action defects are byte-identical to the batch ones,
// except that basis_unit_id points at the model's own (equally wrong) id — the single-turn
// analogue of "the model cited something other than the containing unit_id".
function buildSingleTurn(requirementIds) {
  return {
    integral_analysis: {
      analysis_units: requirementIds.map((requirementId) => {
        const wire = buildBatchWireUnit(requirementId);
        return {
          ...wire,
          unit_id: `UNIT-${requirementId}`,
          sequence: GOVERNED[requirementId].sequence,
          category: null,
          evidence_state: null,
        };
      }),
    },
  };
}

function findUnit(units, requirementId) {
  const unit = units.find(entry => entry.requirement_id === requirementId);
  assert.ok(unit, `expected an assembled unit for ${requirementId}`);
  return unit;
}

// The governed action outcome both paths must converge on, asserted literally so a
// production bug cannot quietly agree with a test bug.
function assertActionsGoverned(unit) {
  const { unit_id: unitId, actions } = unit;
  const seen = new Set();
  for (const action of actions) {
    assert.equal(action.basis_unit_id, unitId, `${unitId}: every action must be re-anchored to the containing governed unit_id`);
    assert.equal(action.external_side_effect, false, `${unitId}: the AI envelope may never carry external_side_effect=true`);
    if (action.action_type === 'human_decision') {
      assert.equal(action.suggested_role, 'authorized_human', `${unitId}: a human_decision action must stay routed to authorized_human`);
    }
    assert.ok(!seen.has(action.action_id), `${unitId}: action_id "${action.action_id}" must be unique inside the unit`);
    seen.add(action.action_id);
  }
}

// ---------------------------------------------------------------------------------------------
// (1) RED: the batch path must accept the same action defects the single-turn path already
//     normalizes. Today it throws v3_action_invariant on basis_unit_id alone.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const resultB = validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B },
  );

  const tech = findUnit(resultB.analysis_units, 'REQ-TECH-1');
  assert.equal(tech.unit_id, 'UNIT-REQ-TECH-1');
  assert.equal(tech.actions.length, 1, 'normalization must never add or drop an action');
  assert.equal(tech.actions[0].basis_unit_id, 'UNIT-REQ-TECH-1', 'a batch turn never sees unit_id, so basis_unit_id must be re-anchored server-side');
  assertActionsGoverned(tech);

  const fin = findUnit(resultB.analysis_units, 'REQ-FIN-1');
  assert.equal(fin.actions.length, 2, 'normalization must never add or drop an action');
  assert.notEqual(fin.actions[0].action_id, fin.actions[1].action_id, 'a duplicate action_id must be deterministically disambiguated, not collapsed');
  assert.equal(fin.actions[0].external_side_effect, false);
  assert.equal(fin.actions[1].suggested_role, 'authorized_human');
  assertActionsGoverned(fin);

  // Normalization repairs only the four server-governed relationships. Every other field the
  // model actually owns must survive byte-identical — it must never rewrite the substance of
  // an action (its type, priority or summary), only its anchoring.
  const modelFin = DEFECTIVE_ACTIONS['REQ-FIN-1'];
  fin.actions.forEach((action, index) => {
    assert.equal(action.action_type, modelFin[index].action_type, 'action_type is model-owned and must never be rewritten');
    assert.equal(action.priority, modelFin[index].priority, 'priority is model-owned and must never be rewritten');
    assert.equal(action.summary, modelFin[index].summary, 'summary is model-owned and must never be rewritten');
  });
  // The non-human_decision action keeps the role the model chose — the role override is
  // scoped strictly to human_decision, never a blanket rewrite.
  assert.equal(fin.actions[0].suggested_role, 'financial', 'suggested_role must only be overridden for human_decision actions');

  // Units with no actions are untouched.
  const resultA = validateAgt002PreviewModelOutputV3Batch(
    buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A },
  );
  for (const unit of resultA.analysis_units) assert.deepEqual(unit.actions, []);
}

// ---------------------------------------------------------------------------------------------
// (2) Parity with the single-turn path: the identical defects, through
//     validateAgt002PreviewModelOutputV3, already validate today — that is the reference
//     behavior the batch path is required to match, and it is asserted here (not assumed) so
//     this file also fails if the single-turn normalization is ever weakened.
// ---------------------------------------------------------------------------------------------
{
  const validationContext = buildValidationContext();
  const allIds = ['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1'];
  const singleTurn = validateAgt002PreviewModelOutputV3(buildSingleTurn(allIds), validationContext);

  for (const unit of singleTurn.analysis_units) assertActionsGoverned(unit);
  assert.equal(findUnit(singleTurn.analysis_units, 'REQ-TECH-1').actions[0].basis_unit_id, 'UNIT-REQ-TECH-1');

  // Same defects, same governed context, routed through the batch path and merged: the
  // resulting `actions` arrays must be deep-equal to the single-turn ones, unit for unit.
  const resultA = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_A.requirement_ids), { validationContext, batch: BATCH_A });
  const resultB = validateAgt002PreviewModelOutputV3Batch(buildBatchTurn(BATCH_B.requirement_ids), { validationContext, batch: BATCH_B });
  const merged = mergeAgt002IntegralAnalysisV3Batches([resultA, resultB], validationContext);

  assert.deepEqual(merged.analysis_units.map(unit => unit.requirement_id), allIds);
  for (const requirementId of allIds) {
    assert.deepEqual(
      findUnit(merged.analysis_units, requirementId).actions,
      findUnit(singleTurn.analysis_units, requirementId).actions,
      `batch and single-turn must produce identical governed actions for ${requirementId}`,
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
    assertActionsGoverned(unit);
  }
}

// ---------------------------------------------------------------------------------------------
// (4) Anti-laundering: an invalid enum or a malformed action shape is NOT normalized. These
//     are model errors with no governed correct answer, and they must still fail closed.
// ---------------------------------------------------------------------------------------------
{
  function expectBatchRejects(mutateAction, matcher, message) {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    mutateAction(findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').actions[0]);
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      matcher,
      message,
    );
  }

  expectBatchRejects(action => { action.action_type = 'ejecutar_pago'; }, /action_type/i, 'an invalid action_type enum must never be normalized away');
  expectBatchRejects(action => { action.priority = 'urgentísimo'; }, /priority/i, 'an invalid priority enum must never be normalized away');
  expectBatchRejects(action => { action.suggested_role = 'hacker'; }, /suggested_role/i, 'an invalid suggested_role enum must never be normalized away on a non-human_decision action');
  expectBatchRejects(action => { delete action.summary; }, /summary|actions/i, 'a missing action key must never be filled in by normalization');
  expectBatchRejects(action => { action.execute_now = true; }, /actions|claves|keys/i, 'an extra action key must never be accepted');
  expectBatchRejects(action => { action.action_id = 42; }, /action_id/i, 'a non-string action_id must never be coerced');
  expectBatchRejects(action => { action.summary = 123; }, /summary/i, 'a non-string action summary must never be coerced');

  // Boundary of the role override, stated exactly. For action_type "human_decision" there is
  // exactly ONE permitted role, so the server pins it unconditionally — whatever the model
  // said, valid enum or not, is discarded rather than rescued. That is a governed pin, not
  // laundering: it can only ever tighten routing toward `authorized_human`, and it is
  // byte-identical to what the single-turn path already does. The genuinely ungoverned case —
  // an invalid role on a NON-human_decision action, where several roles are legitimate and the
  // server has no basis to pick one — is asserted above as a hard rejection.
  {
    for (const rogueRole of ['authorized_human_x', 'commercial']) {
      const validationContext = buildValidationContext();
      const value = buildBatchTurn(BATCH_B.requirement_ids);
      const action = findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').actions[0];
      action.action_type = 'human_decision';
      action.suggested_role = rogueRole;

      const result = validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B });
      assert.equal(
        findUnit(result.analysis_units, 'REQ-TECH-1').actions[0].suggested_role,
        'authorized_human',
        `a human_decision action must be pinned to authorized_human, never left as "${rogueRole}"`,
      );

      // Parity: the single-turn path pins it the same way, so this is not a batch-only rule.
      const singleTurnValue = buildSingleTurn(['REQ-DISCARD-1', 'REQ-HAB-1', 'REQ-TECH-1', 'REQ-FIN-1']);
      const singleAction = findUnit(singleTurnValue.integral_analysis.analysis_units, 'REQ-TECH-1').actions[0];
      singleAction.action_type = 'human_decision';
      singleAction.suggested_role = rogueRole;
      const singleResult = validateAgt002PreviewModelOutputV3(singleTurnValue, buildValidationContext());
      assert.equal(findUnit(singleResult.analysis_units, 'REQ-TECH-1').actions[0].suggested_role, 'authorized_human');
    }
  }
}

// ---------------------------------------------------------------------------------------------
// (5) Anti-relaxation: everything the batch validator already fails closed on must keep
//     failing closed, with actions present on the turn. Action normalization must not become
//     a side door around identity, coverage, allowlists or the human/abstention gates.
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

  // A foreign requirement id (real and globally governed, but not assigned to this batch)
  // stays rejected — normalization anchors basis_unit_id, it never widens the local id set.
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
      'the material-omission abstention gate must stay closed regardless of action normalization',
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

  // Human validation / closure gates are untouched by action normalization: a unit that
  // drops its human_validation requirement is still rejected.
  {
    const validationContext = buildValidationContext();
    const value = buildBatchTurn(BATCH_B.requirement_ids);
    findUnit(value.integral_analysis.analysis_units, 'REQ-TECH-1').human_validation = { required: false, status: 'pending', reason: 'x' };
    assert.throws(
      () => validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch: BATCH_B }),
      /human_validation|validaci/i,
      'action normalization must never relax the human validation gate',
    );
  }
}

console.log('agt002-batch-action-normalization-parity passed');
