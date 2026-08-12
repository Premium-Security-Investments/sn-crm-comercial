import { strict as assert } from 'node:assert';
import {
  projectAgt002IntegralV3ToV2,
  computeAgt002IntegralV3CriticalOpenCount,
} from '../agt002-v3-compatibility.js';

// ---------------------------------------------------------------------------
// Synthetic fixture covering every projection category: a not-curable blocker, a
// curable blocker with a critical missing evidence item, a legal-uncertain unit, a
// clean strength, a partial weakness, and a strategic consideration pending human
// validation. All synthetic; no real expediente.
// ---------------------------------------------------------------------------

function unit(overrides) {
  return {
    unit_id: 'UNIT-X',
    unit_kind: 'tender_requirement',
    requirement_id: 'REQ-X',
    category: 'technical',
    sequence: 1,
    title: 'Unidad sintética',
    assessment_mode: 'assessed',
    conclusion: { status: 'supported_with_evidence', summary: 'Síntesis sintética.', confidence: 'high' },
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
    evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
    evidence_refs: [{ ref: 'TD-X', source_type: 'tender_document', purpose: 'requirement_basis' }],
    missing_evidence: [],
    commercial_impact: { level: 'low', summary: 'Impacto bajo.', dimension: 'eligibility' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'open', condition: 'Condición sintética.', evidence_required: ['tender_document'] },
    human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    ...overrides,
  };
}

function buildFixtureUnits() {
  return [
    unit({
      unit_id: 'UNIT-DISCARD', requirement_id: 'REQ-DISCARD', category: 'discard', sequence: 1,
      conclusion: { status: 'supported_with_evidence', summary: 'Sin causal de descarte.', confidence: 'high' },
      commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
    }),
    unit({
      unit_id: 'UNIT-NOTCURABLE', requirement_id: 'REQ-NOTCURABLE', category: 'habilitating', sequence: 2,
      conclusion: { status: 'gap_evidenced', summary: 'Brecha no subsanable evidenciada.', confidence: 'high' },
      blocking: { effect: 'blocker', curability: 'not_curable', reason: 'Requisito no subsanable.' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
      evidence_refs: [{ ref: 'TD-NOTCURABLE', source_type: 'tender_document', purpose: 'gap_basis' }],
      commercial_impact: { level: 'critical', summary: 'Impide participación.', dimension: 'eligibility' },
      escalation: { required: true, level: 'management', reason: 'Bloqueo no subsanable.' },
      actions: [{
        action_id: 'ACT-NOTCURABLE', action_type: 'human_decision', summary: 'Persona autorizada decide continuidad.',
        basis_unit_id: 'UNIT-NOTCURABLE', suggested_role: 'authorized_human', priority: 'critical', external_side_effect: false,
      }],
      closure: { status: 'human_confirmation_required', condition: 'Decisión humana registrada.', evidence_required: ['tender_document'] },
    }),
    unit({
      unit_id: 'UNIT-CURABLE', requirement_id: 'REQ-CURABLE', category: 'technical', sequence: 3,
      conclusion: { status: 'partially_supported', summary: 'Falta constancia de vigencia técnica.', confidence: 'medium' },
      blocking: { effect: 'blocker', curability: 'curable', reason: 'Requiere subsanación.' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'unknown', applicability: 'applicable', compliance: 'partially_supported_pending_human_review' },
      missing_evidence: [{ missing_id: 'MISS-1', evidence_class_id: null, needed_source_type: 'tender_document', reason: 'Falta constancia.', critical: true }],
      commercial_impact: { level: 'high', summary: 'Riesgo de competitividad.', dimension: 'competitiveness' },
      actions: [{
        action_id: 'ACT-CURABLE', action_type: 'obtain_evidence', summary: 'Solicitar constancia de vigencia técnica.',
        basis_unit_id: 'UNIT-CURABLE', suggested_role: 'technical', priority: 'high', external_side_effect: false,
      }],
    }),
    unit({
      unit_id: 'UNIT-LEGAL', requirement_id: 'REQ-LEGAL', category: 'financial_execution', sequence: 4,
      conclusion: { status: 'human_validation_required', summary: 'Fundamento jurídico no verificado.', confidence: 'medium' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'unknown' },
      legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Requiere revisión jurídica.', human_legal_review_required: true },
      commercial_impact: { level: 'medium', summary: 'Exposición contractual moderada.', dimension: 'financial_exposure' },
      escalation: { required: true, level: 'role_review', reason: 'Incertidumbre jurídica.' },
      actions: [{
        action_id: 'ACT-LEGAL', action_type: 'human_decision', summary: 'Validar fundamento jurídico con abogado.',
        basis_unit_id: 'UNIT-LEGAL', suggested_role: 'authorized_human', priority: 'medium', external_side_effect: false,
      }],
    }),
    unit({
      unit_id: 'UNIT-STRAT', unit_kind: 'strategic_consideration', requirement_id: null, category: 'strategic', sequence: 5,
      conclusion: { status: 'human_validation_required', summary: 'Consideración estratégica sujeta a validación.', confidence: 'medium' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'not_applicable', applicability: 'applicable', compliance: 'unknown' },
      evidence_refs: [{ ref: 'HE-1', source_type: 'human_evidence', purpose: 'commercial_context' }],
      commercial_impact: { level: 'medium', summary: 'Mejora posicionamiento.', dimension: 'strategic_fit' },
      actions: [{
        action_id: 'ACT-STRAT', action_type: 'human_decision', summary: 'Validar encaje estratégico.',
        basis_unit_id: 'UNIT-STRAT', suggested_role: 'authorized_human', priority: 'low', external_side_effect: false,
      }],
    }),
  ];
}

function buildFixtureCoverage(units) {
  return {
    manifest_version: 'agt002-deep-analysis-v1',
    expected_requirement_ids: units.filter(u => u.unit_kind === 'tender_requirement').map(u => u.requirement_id),
    analyzed_requirement_ids: units.filter(u => u.unit_kind === 'tender_requirement').map(u => u.requirement_id),
    material_omissions: false,
    omission_reasons: [],
    company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
    company_evidence_class_ids: [],
    legal_corpus_version_id: 'legal-corpus-v1',
  };
}

function buildFixture() {
  const analysis_units = buildFixtureUnits();
  return { contract_version: 'agt002-integral-analysis-v3', coverage: buildFixtureCoverage(analysis_units), analysis_units };
}

function run() {
  const fixture = buildFixture();
  const projection = projectAgt002IntegralV3ToV2(fixture);

  // ---------------------------------------------------------------------
  // Exact derivation of the v2-shaped fields.
  // ---------------------------------------------------------------------
  assert.equal(typeof projection.recommendation, 'string');
  assert.equal(projection.recommendation, 'do_not_advance', 'un blocker no subsanable exige do_not_advance');
  assert.equal(typeof projection.summary, 'string');
  assert.ok(projection.summary.length > 0);
  assert.equal(projection.human_review_required, true);
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    assert.ok(Array.isArray(projection[field]), `${field} debe ser arreglo`);
  }

  // Blockers: both the not-curable and the curable blocker unit.
  const blockerIds = projection.blockers.map(item => item.id);
  assert.ok(blockerIds.includes('UNIT-NOTCURABLE::blocker'));
  assert.ok(blockerIds.includes('UNIT-CURABLE::blocker'));

  // Strengths: only the clean discard unit (low impact, fully supported, no unknown axis).
  assert.deepEqual(projection.strengths.map(item => item.id), ['UNIT-DISCARD::strength']);

  // Weaknesses: partially_supported / high-or-critical impact units.
  const weaknessIds = projection.weaknesses.map(item => item.id);
  assert.ok(weaknessIds.includes('UNIT-CURABLE::weakness'));
  assert.ok(weaknessIds.includes('UNIT-NOTCURABLE::weakness'));

  // Questions: critical missing evidence, legal uncertainty and strategic validation.
  const questionIds = projection.questions.map(item => item.id);
  assert.ok(questionIds.includes('UNIT-CURABLE::question'));
  assert.ok(questionIds.includes('UNIT-LEGAL::question'));
  assert.ok(questionIds.includes('UNIT-STRAT::question'));

  // Unverified: legal-uncertain unit.
  assert.ok(projection.unverified.map(item => item.id).includes('UNIT-LEGAL::unverified'));

  // ---------------------------------------------------------------------
  // One critical question per counted critical unit; critical_open_count matches.
  // ---------------------------------------------------------------------
  const criticalQuestionCount = projection.questions.filter(item => item.critical).length;
  const criticalOpenCount = computeAgt002IntegralV3CriticalOpenCount(fixture);
  assert.equal(criticalQuestionCount, criticalOpenCount);
  assert.ok(criticalOpenCount >= 3, 'UNIT-NOTCURABLE, UNIT-CURABLE y UNIT-LEGAL deben contar como críticas');

  // ---------------------------------------------------------------------
  // next_action copied from a validated action whose basis_unit_id identifies its unit.
  // Highest-priority stage: not-curable blocker / critical escalation.
  // ---------------------------------------------------------------------
  assert.equal(projection.next_action, 'Persona autorizada decide continuidad.');

  // ---------------------------------------------------------------------
  // No new evidence references: every evidence_ref in the projection already existed
  // on its source unit's v3 evidence_refs.
  // ---------------------------------------------------------------------
  const unitsById = new Map(fixture.analysis_units.map(u => [u.unit_id, u]));
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    for (const finding of projection[field]) {
      const [sourceUnitId] = finding.id.split('::');
      const sourceUnit = unitsById.get(sourceUnitId);
      const allowedRefs = new Set(sourceUnit.evidence_refs.map(ref => ref.ref));
      for (const ref of finding.evidence_refs) {
        assert.ok(allowedRefs.has(ref), `${finding.id} introduce una referencia no presente en la unidad de origen: ${ref}`);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Determinism: same input twice, and irrelevant top-level key reordering, produce the
  // exact same output.
  // ---------------------------------------------------------------------
  const again = projectAgt002IntegralV3ToV2(buildFixture());
  assert.deepEqual(again, projection);

  const reordered = { analysis_units: fixture.analysis_units, contract_version: fixture.contract_version, coverage: fixture.coverage };
  assert.deepEqual(projectAgt002IntegralV3ToV2(reordered), projection);

  // ---------------------------------------------------------------------
  // Model-supplied legacy keys never leak into the projection: even if the object handed
  // to the projector carries a stray legacy field, only real v3 fields are ever read.
  // ---------------------------------------------------------------------
  const withLeakedLegacyKey = { ...fixture, recommendation: 'advance', next_action: 'texto inventado por el modelo' };
  const leakedProjection = projectAgt002IntegralV3ToV2(withLeakedLegacyKey);
  assert.equal(leakedProjection.recommendation, 'do_not_advance', 'no debe confiar en recommendation inyectada');
  assert.notEqual(leakedProjection.next_action, 'texto inventado por el modelo');

  // ---------------------------------------------------------------------
  // advance is impossible with material omissions, even absent any blocker.
  // ---------------------------------------------------------------------
  {
    const cleanUnits = [unit({ unit_id: 'UNIT-CLEAN', requirement_id: 'REQ-CLEAN', category: 'discard', sequence: 1 })];
    const cleanCoverage = buildFixtureCoverage(cleanUnits);
    const cleanFixture = { contract_version: 'agt002-integral-analysis-v3', coverage: cleanCoverage, analysis_units: cleanUnits };
    assert.equal(projectAgt002IntegralV3ToV2(cleanFixture).recommendation, 'advance');

    const omittedFixture = { ...cleanFixture, coverage: { ...cleanCoverage, material_omissions: true } };
    assert.notEqual(projectAgt002IntegralV3ToV2(omittedFixture).recommendation, 'advance');
  }

  console.log('agt002-v3-compatibility deterministic projection passed');
}

run();
