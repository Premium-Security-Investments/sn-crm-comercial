import { strict as assert } from 'node:assert';
import test from 'node:test';

import { deriveAgt002GenericDecisionReview } from '../agt002-generic-decision-review.js';

// LOCK de invariantes §4 de la spec 2026-08-25-agt002-analisis-para-decidir: la vía genérica
// preserva requirement_id/evidence_refs sin transformar, nunca auto-crea un blocker confirmado y
// nunca acepta materialidad/eje inyectados por el modelo. Este test NO cambia comportamiento: si
// falla contra el código real, aplica el GREEN mínimo en el módulo antes de continuar (plan B1).

function unitFixture(overrides = {}) {
  return {
    unit_id: 'unit-legal-collective-life-policy-1',
    requirement_id: 'legal-collective-life-policy',
    sequence: 1,
    unit_kind: 'tender_requirement',
    category: 'habilitating',
    title: 'Póliza de seguro de vida colectivo',
    assessment_mode: 'abstained',
    conclusion: {
      status: 'insufficient_evidence',
      confidence: 'unavailable',
      summary: 'La póliza debe revisarse antes de determinar cumplimiento.',
    },
    blocking: {
      effect: 'undetermined',
      curability: 'undetermined',
      reason: 'La aplicabilidad y el cumplimiento no están verificados.',
    },
    evidence_refs: [{
      source_type: 'tender_document',
      ref: 'evidence:chunk:doc-1:p1:s1:c0',
      purpose: 'requirement_basis',
    }],
    missing_evidence: [{
      missing_id: 'missing-life-policy-original-review',
      needed_source_type: 'company_evidence',
      evidence_class_id: 'collective_life_policy',
      reason: 'Original, vigencia, pago y cobertura revisados por una persona autorizada.',
      critical: true,
    }],
    actions: [{
      action_id: 'action-review-life-policy',
      action_type: 'verify_validity',
      summary: 'Revisar el original de la póliza, su vigencia, pago y cobertura.',
      priority: 'critical',
      suggested_role: 'legal',
      basis_unit_id: 'unit-legal-collective-life-policy-1',
      external_side_effect: false,
    }],
    human_validation: {
      required: true,
      status: 'pending',
      reason: 'La evidencia empresarial está pendiente de revisión humana.',
    },
    closure: {
      status: 'open',
      condition: 'Revisión humana satisfactoria de presencia, vigencia y cumplimiento.',
      evidence_required: ['Original de la póliza colectiva'],
    },
    commercial_impact: {
      level: 'high',
      dimension: 'eligibility',
      summary: 'La falta de verificación puede impedir acreditar un habilitante legal.',
    },
    ...overrides,
  };
}

function integralAnalysisWithUnit(unit) {
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      analyzed_requirement_ids: [unit.requirement_id],
      expected_requirement_ids: [unit.requirement_id],
      material_omissions: false,
      omission_reasons: [],
    },
    analysis_units: [unit],
  };
}

function currentAnalysisFixture() {
  return {
    run_id: 'c6aa9d43-57bb-445f-8cc3-0cc5de255a48',
    opportunity_id: 'e5940854-1c50-4fbb-bea2-f18908993b29',
    snapshot_id: 'b439bd29-b7ed-4887-8afa-9d41377f92f0',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    current: true,
  };
}

test('(a) el finding conserva requirement_id verbatim', () => {
  const unit = unitFixture();
  const review = deriveAgt002GenericDecisionReview(currentAnalysisFixture(), { integral_analysis: integralAnalysisWithUnit(unit) });
  assert.ok(review);
  const finding = review.decision_questions[0];
  assert.equal(finding.requirement_id, unit.requirement_id);
});

test('(b) evidence_refs es exactamente [{type:"manifest_requirement", requirement_id}] y está congelado', () => {
  const unit = unitFixture();
  const review = deriveAgt002GenericDecisionReview(currentAnalysisFixture(), { integral_analysis: integralAnalysisWithUnit(unit) });
  const finding = review.decision_questions[0];
  assert.deepEqual(finding.evidence_refs, [{ type: 'manifest_requirement', requirement_id: unit.requirement_id }]);
  assert.ok(Object.isFrozen(finding.evidence_refs));
});

test('(c) blocking.effect === "blocker" nunca llena el bucket blocker confirmado', () => {
  const unit = unitFixture({
    assessment_mode: 'assessed',
    blocking: { effect: 'blocker', curability: 'not_curable', reason: 'El modelo reporta un impedimento potencial.' },
  });
  const review = deriveAgt002GenericDecisionReview(currentAnalysisFixture(), { integral_analysis: integralAnalysisWithUnit(unit) });
  assert.equal(review.blockers.length, 0);
  assert.equal(review.counts.blockers, 0);
  assert.equal(review.decision_questions.length, 1);
});

test('(d) material_impediment_category/axis inyectados por el modelo no aparecen en el finding', () => {
  const unit = unitFixture({ material_impediment_category: 'capacidad_financiera_insuficiente', axis: 'legal' });
  const review = deriveAgt002GenericDecisionReview(currentAnalysisFixture(), { integral_analysis: integralAnalysisWithUnit(unit) });
  const finding = review.decision_questions[0];
  assert.equal(Object.hasOwn(finding, 'material_impediment_category'), false);
  assert.equal(Object.hasOwn(finding, 'axis'), false);
});
