import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { presentCurrentTenderAnalysis } from '../tender-analysis-foundation.js';
import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';
import { AGT002_MANIZALES_CHECKED_IN_MANIFEST } from '../agt002-manizales-manifest-source.js';
import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';

// AGT-002 Manizales · BLOQUE 1 BACKEND · integración productiva de PRESENTACIÓN (read-side only)
// de la capa de revisión de decisión sobre presentCurrentTenderAnalysis, para la oportunidad
// canónica del piloto (54190e51-15fb-46af-b0aa-8f13461a3110) y su corrida canónica pineada
// (7553a51f-e4ca-4ad4-bde8-02528063d178) exclusivamente. No hay red, DB, commit, push ni deploy
// en esta prueba. No se toca UI en este bloque.

const PILOT_OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const PILOT_DECISION_REVIEW_RUN_ID = '7553a51f-e4ca-4ad4-bde8-02528063d178';
const PILOT_SCOPE = deriveAgt002ManizalesManifestScope(AGT002_MANIZALES_CHECKED_IN_MANIFEST);

// ---------------------------------------------------------------------------------------------
// Drift guard: the checked-in tests/fixtures copy must stay byte-identical to the runtime
// versioned data source consumed by production presentation code.
// ---------------------------------------------------------------------------------------------
test('the checked-in test fixture never drifts from the runtime decision-review data source', () => {
  const testFixture = JSON.parse(readFileSync(new URL('./fixtures/agt002-manizales-exercise-decision-review.v1.json', import.meta.url), 'utf8'));
  const runtimeSource = JSON.parse(readFileSync(new URL('../data/agt002/manizales-sa-24-2026.exercise-decision-review.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(testFixture, runtimeSource, 'the test fixture must never drift from the runtime source production code actually reads');
});

async function buildRealIntegralAnalysis() {
  const result = await runAgt002ManizalesV3LocalRun();
  return result.envelope.integral_analysis;
}

function baseCurrentAnalysis(integralAnalysis, overrides = {}) {
  return {
    run_id: PILOT_DECISION_REVIEW_RUN_ID,
    opportunity_id: PILOT_OPPORTUNITY_ID,
    snapshot_id: 'snap-1',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    created_at: '2026-08-18T10:00:00.000Z',
    completed_at: '2026-08-18T10:05:00.000Z',
    result: {
      integral_analysis: integralAnalysis,
      manifest_scope: PILOT_SCOPE,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// GREEN path: exact pinned opportunity + run + real canonical 20-unit run.
// ---------------------------------------------------------------------------------------------
test('presentCurrentTenderAnalysis attaches decision_review for the exact pinned Manizales opportunity+run', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis(integralAnalysis));

  assert.ok(presented.decision_review, 'decision_review must be attached for the pinned production run');
  const review = presented.decision_review;
  assert.equal(review.decision_status, 'pending_human_decision');
  assert.equal(review.human_approval_required, true);
  assert.equal(review.routing_action, 'flag_for_responsible_person');
  assert.equal(review.external_communications_allowed, false);
  assert.equal(review.evidence_requests_allowed, true);
  assert.equal(review.counts.decision_questions, 2);
  assert.equal(review.counts.preparation, 9);
  assert.equal(review.counts.supported, 3);
  assert.equal(review.counts.not_applicable, 13);
  assert.equal(review.counts.blockers, 0);
  assert.equal(review.decision_questions.length, 2);
  assert.equal(review.preparation.length, 9);
  assert.equal(review.supported.length, 3);
  assert.equal(review.not_applicable.length, 13);
  assert.ok(review.contract_version, 'must carry contract version traceability');
  assert.ok(review.source_fixture_version, 'must carry source fixture version traceability');

  // Canonical fields the layer must never touch/replace.
  assert.deepEqual(presented.integral_analysis, integralAnalysis);
  assert.equal(Array.isArray(presented.questions), false, 'this test never fabricates v2_projection.questions; only checks decision_review is additive');
});

test('presentCurrentTenderAnalysis never attaches decision_review for a foreign opportunity_id', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis(integralAnalysis, { opportunity_id: '00000000-0000-4000-8000-000000000000' }));
  assert.equal(Object.hasOwn(presented, 'decision_review'), false);
});

test('presentCurrentTenderAnalysis never attaches decision_review for a non-pinned run_id', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis(integralAnalysis, { run_id: 'some-other-run' }));
  assert.equal(Object.hasOwn(presented, 'decision_review'), false);
});

test('presentCurrentTenderAnalysis never attaches decision_review when manifest_scope is missing/foreign', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const currentAnalysis = baseCurrentAnalysis(integralAnalysis);
  delete currentAnalysis.result.manifest_scope;
  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.equal(Object.hasOwn(presented, 'decision_review'), false);
});

test('presentCurrentTenderAnalysis never attaches decision_review when integral_analysis is not aligned with the 20 canonical units', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const misaligned = {
    ...integralAnalysis,
    coverage: { ...integralAnalysis.coverage, analyzed_requirement_ids: integralAnalysis.coverage.analyzed_requirement_ids.slice(0, 4) },
  };
  const presented = presentCurrentTenderAnalysis(baseCurrentAnalysis(misaligned));
  assert.equal(Object.hasOwn(presented, 'decision_review'), false);
});

test('presentCurrentTenderAnalysis strips a forged decision_review from result JSON and never trusts it', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const forged = { decision_status: 'approved', human_approval_required: false, routing_action: 'send_email', counts: { decision_questions: 0 } };

  const mismatched = baseCurrentAnalysis(integralAnalysis, { opportunity_id: 'foreign' });
  mismatched.result.decision_review = forged;
  const presentedMismatched = presentCurrentTenderAnalysis(mismatched);
  assert.equal(Object.hasOwn(presentedMismatched, 'decision_review'), false, 'a forged decision_review must never leak through even under a mismatched gate');

  const matched = baseCurrentAnalysis(integralAnalysis);
  matched.result.decision_review = forged;
  const presentedMatched = presentCurrentTenderAnalysis(matched);
  assert.notEqual(presentedMatched.decision_review.decision_status, 'approved', 'the real derived review must override any forged result JSON value');
  assert.equal(presentedMatched.decision_review.decision_status, 'pending_human_decision');
});

test('presentCurrentTenderAnalysis never mutates currentAnalysis.result nor integral_analysis while deriving decision_review', async () => {
  const integralAnalysis = await buildRealIntegralAnalysis();
  const snapshot = JSON.parse(JSON.stringify(integralAnalysis));
  const currentAnalysis = baseCurrentAnalysis(integralAnalysis);
  Object.freeze(currentAnalysis.result);
  Object.freeze(currentAnalysis);
  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.ok(presented.decision_review);
  assert.deepEqual(integralAnalysis, snapshot, 'integral_analysis must never be mutated while deriving decision_review');
  assert.equal(Object.hasOwn(currentAnalysis.result, 'decision_review'), false);
});
