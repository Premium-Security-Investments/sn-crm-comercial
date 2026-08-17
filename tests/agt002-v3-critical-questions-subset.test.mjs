import { strict as assert } from 'node:assert';
import { projectAgt002IntegralV3ToV2, computeAgt002IntegralV3CriticalOpenCount } from '../agt002-v3-compatibility.js';

// Phase 9 (T8/E): the v2 projection must expose `critical_questions` as a DERIVED SUBSET of the
// full `questions` list — a material-exception shortlist that never hides or replaces the complete
// question surface. In a fully-abstained governed run (every unit human_validation_required with no
// critical signal) the shortlist is honestly empty while `questions` still carries one entry per
// requirement. Pure projection test — no production, network or DB.

function makeUnit(overrides = {}) {
  const base = {
    unit_id: 'UNIT-X',
    unit_kind: 'tender_requirement',
    requirement_id: 'req-x',
    category: 'habilitating',
    sequence: 1,
    title: 'Requisito',
    assessment_mode: 'abstained',
    conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación.' },
    evidence_state: { presence: 'unknown', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown' },
    evidence_refs: [],
    missing_evidence: [],
    commercial_impact: { level: 'unknown', summary: 'No determinado.', dimension: 'unknown' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Pendiente.' },
  };
  return { ...base, ...overrides };
}

function coverageFor(units) {
  const ids = units.map(u => u.requirement_id);
  return {
    manifest_version: 'v1', expected_requirement_ids: ids, analyzed_requirement_ids: ids,
    material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'c1',
    company_evidence_class_ids: [], legal_corpus_version_id: null,
  };
}

// -----------------------------------------------------------------------------
// Mixed run: one critical-open question, one ordinary abstained question, one strength.
// -----------------------------------------------------------------------------
{
  const units = [
    makeUnit({
      unit_id: 'UNIT-CRIT', requirement_id: 'req-crit',
      missing_evidence: [{ missing_id: 'M1', evidence_class_id: null, needed_source_type: 'company_evidence', reason: 'Falta constancia.', critical: true }],
    }),
    makeUnit({ unit_id: 'UNIT-ABSTAIN', requirement_id: 'req-abstain' }),
    makeUnit({
      unit_id: 'UNIT-STRONG', requirement_id: 'req-strong', category: 'technical', assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Respaldado.', confidence: 'high' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
      commercial_impact: { level: 'low', summary: 'Bajo.', dimension: 'competitiveness' },
    }),
  ];
  const projection = projectAgt002IntegralV3ToV2({ coverage: coverageFor(units), analysis_units: units });

  const questionIds = projection.questions.map(q => q.id);
  const criticalIds = projection.critical_questions.map(q => q.id);

  // The full list is intact: both question units appear, the strength does not.
  assert.deepEqual(questionIds.sort(), ['UNIT-ABSTAIN::question', 'UNIT-CRIT::question'].sort());
  // The subset carries only the critical-open unit.
  assert.deepEqual(criticalIds, ['UNIT-CRIT::question']);

  // critical_questions is EXACTLY questions.filter(critical) — same objects, real subset.
  assert.deepEqual(projection.critical_questions, projection.questions.filter(q => q.critical === true));
  for (const critical of projection.critical_questions) {
    assert.ok(questionIds.includes(critical.id), 'every critical question must remain in the full questions list');
    assert.equal(critical.critical, true);
  }
  // The subset never exceeds the full list, and the full list is not truncated to the subset.
  assert.ok(projection.critical_questions.length < projection.questions.length);
  assert.equal(projection.critical_questions.length, computeAgt002IntegralV3CriticalOpenCount({ analysis_units: units }));
}

// -----------------------------------------------------------------------------
// Fully-abstained governed run: questions one-per-requirement, critical subset honestly empty.
// -----------------------------------------------------------------------------
{
  const units = [
    makeUnit({ unit_id: 'UNIT-1', requirement_id: 'req-1' }),
    makeUnit({ unit_id: 'UNIT-2', requirement_id: 'req-2' }),
    makeUnit({ unit_id: 'UNIT-3', requirement_id: 'req-3' }),
  ];
  const projection = projectAgt002IntegralV3ToV2({ coverage: coverageFor(units), analysis_units: units });

  assert.equal(projection.questions.length, units.length, 'every abstained requirement stays visible as a question');
  assert.deepEqual(projection.critical_questions, [], 'no material exception ⇒ honestly empty critical subset, full list preserved');
}

console.log('agt002-v3-critical-questions-subset: OK');
