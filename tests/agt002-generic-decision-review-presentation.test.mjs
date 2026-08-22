import { strict as assert } from 'node:assert';
import test from 'node:test';

import { presentCurrentTenderAnalysis } from '../tender-analysis-foundation.js';

function genericIntegralAnalysis() {
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      analyzed_requirement_ids: ['legal-collective-life-policy'],
      expected_requirement_ids: ['legal-collective-life-policy'],
      material_omissions: false,
      omission_reasons: [],
    },
    analysis_units: [{
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
    }],
  };
}

function bogotaCurrentAnalysis(overrides = {}) {
  return {
    run_id: 'c6aa9d43-57bb-445f-8cc3-0cc5de255a48',
    opportunity_id: 'e5940854-1c50-4fbb-bea2-f18908993b29',
    snapshot_id: 'b439bd29-b7ed-4887-8afa-9d41377f92f0',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    current: true,
    critical_open_count: 1,
    created_at: '2026-08-22T01:46:17.000Z',
    completed_at: '2026-08-22T01:47:35.000Z',
    result: {
      recommendation: 'pause',
      human_review_required: true,
      integral_analysis: genericIntegralAnalysis(),
    },
    ...overrides,
  };
}

test('presentCurrentTenderAnalysis derives a server-owned decision review for a canonical non-Manizales AGT-002 run', () => {
  const currentAnalysis = bogotaCurrentAnalysis();
  const presented = presentCurrentTenderAnalysis(currentAnalysis);

  assert.ok(presented.decision_review, 'a canonical operational run must expose decision_review without a Manizales-only gate');
  assert.equal(presented.decision_review.opportunity_id, currentAnalysis.opportunity_id);
  assert.equal(presented.decision_review.decision_status, 'pending_human_decision');
  assert.equal(presented.decision_review.human_approval_required, true);
  assert.equal(presented.decision_review.external_communications_allowed, false);
  assert.equal(presented.decision_review.exercise_mode.active, false);
  assert.equal(presented.decision_review.counts.decision_questions, 1);
  assert.equal(presented.decision_review.counts.blockers, 0, 'a model result can never self-confirm a blocker');
  assert.equal(presented.decision_review.recommendation, 'pause');
  assert.equal(presented.decision_review.decision_questions[0].presentation.title, 'Póliza de seguro de vida colectivo');
  assert.match(presented.decision_review.decision_questions[0].presentation.missing, /Original, vigencia, pago y cobertura/);
  assert.match(presented.decision_review.decision_questions[0].presentation.action_required, /Revisar el original/);
  assert.strictEqual(presented.integral_analysis, currentAnalysis.result.integral_analysis, 'the canonical analysis remains untouched');
});

test('presentCurrentTenderAnalysis replaces a forged review with the server-owned generic projection', () => {
  const currentAnalysis = bogotaCurrentAnalysis();
  currentAnalysis.result.decision_review = {
    decision_status: 'approved',
    human_approval_required: false,
    external_communications_allowed: true,
    recommendation: 'advance',
  };

  const review = presentCurrentTenderAnalysis(currentAnalysis).decision_review;
  assert.ok(review);
  assert.equal(review.decision_status, 'pending_human_decision');
  assert.equal(review.human_approval_required, true);
  assert.equal(review.external_communications_allowed, false);
  assert.equal(review.recommendation, 'pause');
});

test('generic decision review fails closed for non-operational or malformed runs', () => {
  const cases = [
    bogotaCurrentAnalysis({ canonical: false }),
    bogotaCurrentAnalysis({ current: false }),
    bogotaCurrentAnalysis({ status: 'failed' }),
    bogotaCurrentAnalysis({ producer: 'HERMES-INTERIM' }),
    bogotaCurrentAnalysis({ method: 'rules' }),
    bogotaCurrentAnalysis({ result: { integral_analysis: null } }),
  ];

  const misaligned = bogotaCurrentAnalysis();
  misaligned.result.integral_analysis.coverage.analyzed_requirement_ids = ['foreign-requirement'];
  cases.push(misaligned);

  for (const currentAnalysis of cases) {
    const presented = presentCurrentTenderAnalysis(currentAnalysis);
    assert.equal(Object.hasOwn(presented, 'decision_review'), false);
  }
});

test('generic decision review never self-confirms a model-reported blocker', () => {
  const currentAnalysis = bogotaCurrentAnalysis();
  const unit = currentAnalysis.result.integral_analysis.analysis_units[0];
  unit.assessment_mode = 'assessed';
  unit.human_validation = { required: false, status: 'not_required', reason: 'No requiere validación adicional.' };
  unit.missing_evidence = [];
  unit.closure = { status: 'evidence_satisfied', condition: 'Evidencia reunida.', evidence_required: [] };
  unit.blocking = { effect: 'blocker', curability: 'not_curable', reason: 'El resultado del modelo reporta un impedimento potencial.' };

  const review = presentCurrentTenderAnalysis(currentAnalysis).decision_review;
  assert.equal(review.counts.blockers, 0);
  assert.equal(review.counts.decision_questions, 1);
  assert.equal(review.decision_status, 'pending_human_decision');
});

test('generic decision review is additive, frozen and does not mutate the canonical result', () => {
  const currentAnalysis = bogotaCurrentAnalysis();
  const before = JSON.parse(JSON.stringify(currentAnalysis.result.integral_analysis));
  Object.freeze(currentAnalysis.result);
  Object.freeze(currentAnalysis);

  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.deepEqual(currentAnalysis.result.integral_analysis, before);
  assert.strictEqual(presented.integral_analysis, currentAnalysis.result.integral_analysis);
  assert.ok(Object.isFrozen(presented.decision_review));
  assert.ok(Object.isFrozen(presented.decision_review.decision_questions));
  assert.ok(Object.isFrozen(presented.decision_review.decision_questions[0].presentation));
});
