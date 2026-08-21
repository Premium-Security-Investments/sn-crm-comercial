import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';

import { presentCurrentTenderAnalysis } from '../tender-analysis-foundation.js';
import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';
import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';
import { AGT002_MANIZALES_CHECKED_IN_MANIFEST } from '../agt002-manizales-manifest-source.js';

// AGT-002 Task 2 · pure selectors over the governed decision_review projection, generic across
// fixture sizes (never hardcoding the pilot's 25/20/5/2 shape). No I/O, no mutation.

const surfacePath = new URL('../src/tenders/tenderDecisionSurface.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [surfacePath], bundle: true, platform: 'node', format: 'esm', write: false });
const surfaceUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  latestQuestionResponse,
  conditionState,
  tenderDecisionConditions,
  tenderDecisionBlockers,
  tenderDecisionSupportedAspects,
  tenderDecisionPreparationActions,
} = await import(surfaceUrl);

const PILOT_OPPORTUNITY_ID = '54190e51-15fb-46af-b0aa-8f13461a3110';
const PILOT_DECISION_REVIEW_RUN_ID = '7553a51f-e4ca-4ad4-bde8-02528063d178';
const PILOT_SCOPE = deriveAgt002ManizalesManifestScope(AGT002_MANIZALES_CHECKED_IN_MANIFEST);

async function buildPilotDecisionReview() {
  const result = await runAgt002ManizalesV3LocalRun();
  const integralAnalysis = result.envelope.integral_analysis;
  const currentAnalysis = {
    run_id: PILOT_DECISION_REVIEW_RUN_ID,
    opportunity_id: PILOT_OPPORTUNITY_ID,
    snapshot_id: 'snap-1',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    result: { integral_analysis: integralAnalysis, manifest_scope: PILOT_SCOPE },
  };
  const presented = presentCurrentTenderAnalysis(currentAnalysis);
  assert.ok(presented.decision_review, 'pilot decision_review must be attached for this fixed opportunity+run');
  return presented.decision_review;
}

// A second, differently-sized fixture (never the pilot's own counts) proving the selectors are
// generic: no bucket-length assumption baked into the implementation.
function buildSecondReview() {
  return {
    decision_questions: [
      {
        id: 'second::question-a',
        requirement_id: 'req-a',
        label: 'Segunda condición A',
        reviewed_status: 'decision_question',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        presentation: { title: 'Validar condición A', missing: 'Falta soporte A.', action_required: 'Solicitar soporte A.' },
      },
      {
        id: 'second::question-b',
        requirement_id: 'req-b',
        label: 'Segunda condición B',
        reviewed_status: 'decision_question',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        // presentation intentionally missing — must still appear with the governed fallback card.
      },
      {
        id: 'second::question-c',
        requirement_id: 'req-c',
        label: 'Segunda condición C',
        reviewed_status: 'decision_question',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        presentation: { title: 'Validar condición C', missing: 'Falta soporte C.', action_required: 'Solicitar soporte C.' },
      },
    ],
    blockers: [
      {
        id: 'second::blocker-a',
        requirement_id: 'req-blocker-a',
        label: 'Segundo bloqueador A',
        reviewed_status: 'blocker',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        curability: 'not_curable',
        evidence_refs: [],
        presentation: { title: 'Impedimento A', summary: 'Resumen del impedimento A.', action_required: 'Gestionar impedimento A.' },
      },
    ],
    supported: [
      {
        id: 'second::supported-a',
        requirement_id: 'req-supported-a',
        label: 'Segundo aspecto favorable A',
        reviewed_status: 'supported',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        presentation: { title: 'Aspecto favorable A', summary: 'Resumen del aspecto favorable A.' },
      },
    ],
    preparation: [
      {
        id: 'second::preparation-a',
        requirement_id: 'req-preparation-a',
        label: 'Segunda acción de preparación A',
        reviewed_status: 'preparation',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        presentation: { title: 'Preparar A', action_required: 'Completar trámite A.' },
      },
      {
        id: 'second::preparation-b',
        requirement_id: 'req-preparation-b',
        label: 'Segunda acción de preparación B',
        reviewed_status: 'preparation',
        rationale: 'NOTA INTERNA: nunca debe aparecer en la proyección frontal.',
        evidence_refs: [],
        presentation: { title: 'Preparar B', action_required: 'Completar trámite B.' },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// latestQuestionResponse()
// ---------------------------------------------------------------------------------------------
test('latestQuestionResponse filters by question_id and picks the max responded_at from an unordered array, without mutating it', () => {
  const responses = [
    { question_id: 'q1', status: 'resolved', response: 'r1-old', responded_at: '2026-08-10T10:00:00.000Z' },
    { question_id: 'q2', status: 'resolved', response: 'other-question', responded_at: '2026-08-19T10:00:00.000Z' },
    { question_id: 'q1', status: 'resolved', response: 'r1-newest', responded_at: '2026-08-18T09:00:00.000Z' },
    { question_id: 'q1', status: 'pending', response: 'r1-middle', responded_at: '2026-08-15T09:00:00.000Z' },
  ];
  const snapshot = responses.map(item => ({ ...item }));

  const latest = latestQuestionResponse(responses, 'q1');
  assert.equal(latest.response, 'r1-newest');
  assert.deepEqual(responses, snapshot, 'latestQuestionResponse must never mutate the input array');
});

test('latestQuestionResponse returns null when no response matches the question_id', () => {
  const responses = [{ question_id: 'other', status: 'resolved', response: 'x', responded_at: '2026-08-10T10:00:00.000Z' }];
  assert.equal(latestQuestionResponse(responses, 'missing'), null);
  assert.equal(latestQuestionResponse([], 'missing'), null);
});

// ---------------------------------------------------------------------------------------------
// The visible state contract is closed at compile time, not merely exercised at runtime.
// ---------------------------------------------------------------------------------------------
test('TenderDecisionConditionState is an exported closed union used by cards and conditionState', () => {
  const source = readFileSync(surfacePath, 'utf8');
  assert.match(source, /export type TenderDecisionConditionState\s*=\s*[\s\S]*?'Pendiente de validación'[\s\S]*?'Validación registrada'[\s\S]*?'No aplica'[\s\S]*?;/);
  assert.match(source, /state:\s*TenderDecisionConditionState\s*\|\s*null/);
  assert.match(source, /conditionState\([\s\S]*?\):\s*TenderDecisionConditionState\s*\{/);
});

// ---------------------------------------------------------------------------------------------
// conditionState() — exactly three visible states
// ---------------------------------------------------------------------------------------------
test('conditionState surfaces exactly the three governed visible states', () => {
  assert.equal(conditionState({ status: 'resolved' }), 'Validación registrada');
  assert.equal(conditionState({ status: 'not_applicable' }), 'No aplica');
  assert.equal(conditionState({ status: 'pending' }), 'Pendiente de validación');
  assert.equal(conditionState(null), 'Pendiente de validación');
  assert.equal(conditionState(undefined), 'Pendiente de validación');
});

// ---------------------------------------------------------------------------------------------
// tenderDecisionConditions() / tenderDecisionBlockers() — preserve every governed entry
// ---------------------------------------------------------------------------------------------
test('tenderDecisionConditions preserves every governed decision_question entry, matched to responses by finding.id/question_id', () => {
  const review = buildSecondReview();
  const responses = [
    { question_id: 'second::question-a', status: 'resolved', response: 'ok', responded_at: '2026-08-19T10:00:00.000Z' },
    { question_id: 'second::question-c', status: 'not_applicable', response: 'na', responded_at: '2026-08-19T10:00:00.000Z' },
  ];
  const cards = tenderDecisionConditions(review, responses);
  assert.equal(cards.length, review.decision_questions.length, 'every governed decision_question entry must survive the projection');

  const cardA = cards.find(card => card.key === 'second::question-a');
  assert.equal(cardA.persistence.questionText, 'Segunda condición A', 'la etiqueta original queda encapsulada sólo para persistencia');
  assert.equal(cardA.title, 'Validar condición A');
  assert.equal(cardA.state, 'Validación registrada');
  assert.equal(cardA.missing, 'Falta soporte A.');
  assert.equal(cardA.actionRequired, 'Solicitar soporte A.');

  const cardC = cards.find(card => card.key === 'second::question-c');
  assert.equal(cardC.state, 'No aplica');
});

test('a decision_question without presentation still appears, using the exact governed fallback card', () => {
  const review = buildSecondReview();
  const cards = tenderDecisionConditions(review, []);
  const cardB = cards.find(card => card.key === 'second::question-b');
  assert.ok(cardB, 'the entry without presentation must still be present, never dropped');
  assert.equal(cardB.title, 'Clasificación ejecutiva no disponible');
  assert.equal(cardB.state, 'Pendiente de validación');
  assert.equal(cardB.missing, 'Revisar el respaldo técnico gobernado de esta condición.');
  assert.equal(cardB.actionRequired, 'Completar la presentación humana antes de cerrar la validación.');
});

test('tenderDecisionBlockers preserves every governed blocker entry, matched to responses by finding.id/question_id', () => {
  const review = buildSecondReview();
  const responses = [{ question_id: 'second::blocker-a', status: 'resolved', response: 'ok', responded_at: '2026-08-19T10:00:00.000Z' }];
  const cards = tenderDecisionBlockers(review, responses);
  assert.equal(cards.length, review.blockers.length);
  assert.equal(cards[0].title, 'Impedimento A');
  assert.equal(cards[0].state, 'Validación registrada');
  assert.equal(cards[0].summary, 'Resumen del impedimento A.');
  assert.equal(cards[0].actionRequired, 'Gestionar impedimento A.');
});

// ---------------------------------------------------------------------------------------------
// supported (favorable aspects) and preparation (actions) projections
// ---------------------------------------------------------------------------------------------
test('tenderDecisionSupportedAspects and tenderDecisionPreparationActions project every governed entry from presentation', () => {
  const review = buildSecondReview();
  const supportedCards = tenderDecisionSupportedAspects(review);
  assert.equal(supportedCards.length, review.supported.length);
  assert.equal(supportedCards[0].title, 'Aspecto favorable A');
  assert.equal(supportedCards[0].summary, 'Resumen del aspecto favorable A.');

  const preparationCards = tenderDecisionPreparationActions(review);
  assert.equal(preparationCards.length, review.preparation.length);
  assert.deepEqual(preparationCards.map(card => card.title), ['Preparar A', 'Preparar B']);
  assert.deepEqual(preparationCards.map(card => card.actionRequired), ['Completar trámite A.', 'Completar trámite B.']);
});

// ---------------------------------------------------------------------------------------------
// The frontal projection must never leak rationale, printed IDs, slugs or technical tokens.
// ---------------------------------------------------------------------------------------------
test('the frontal projection never carries rationale, printed ids/requirement_ids or technical tokens', () => {
  const review = buildSecondReview();
  const responses = [];
  const allCards = [
    ...tenderDecisionConditions(review, responses),
    ...tenderDecisionBlockers(review, responses),
    ...tenderDecisionSupportedAspects(review),
    ...tenderDecisionPreparationActions(review),
  ];
  for (const card of allCards) {
    assert.equal(Object.hasOwn(card, 'rationale'), false, 'rationale must never appear in the frontal projection');
    assert.equal(Object.hasOwn(card, 'requirement_id'), false, 'requirement_id must never be a visible field');
    assert.equal(Object.hasOwn(card, 'id'), false, 'the internal id must live only as `key`, never as a printed `id` field');
    // `key` legitimately carries the internal id for React key/navigation — every OTHER string
    // field is the actual frontal text and must never leak rationale, requirement_id slugs or ids.
    const { key: _key, persistence: _persistence, ...visibleFields } = card;
    const values = Object.values(visibleFields).filter(value => typeof value === 'string');
    for (const value of values) {
      assert.doesNotMatch(value, /NOTA INTERNA/, 'rationale text must never leak into the frontal projection');
      assert.doesNotMatch(value, /^req-[a-z-]+$/, 'a printed requirement_id slug must never be used as visible text');
      assert.doesNotMatch(value, /^second::/, 'the internal id must never be used as visible text');
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Pilot fixture, exercised through the real production derivation, generic (no hardcoded counts).
// ---------------------------------------------------------------------------------------------
test('the pilot decision_review projects through the same generic selectors with no bucket-size assumptions', async () => {
  const review = await buildPilotDecisionReview();
  const responses = [];

  const conditions = tenderDecisionConditions(review, responses);
  const blockers = tenderDecisionBlockers(review, responses);
  const supportedCards = tenderDecisionSupportedAspects(review);
  const preparationCards = tenderDecisionPreparationActions(review);

  assert.equal(conditions.length, review.decision_questions.length);
  assert.equal(blockers.length, review.blockers.length);
  assert.equal(supportedCards.length, review.supported.length);
  assert.equal(preparationCards.length, review.preparation.length);

  for (const card of [...conditions, ...blockers, ...supportedCards, ...preparationCards]) {
    assert.equal(Object.hasOwn(card, 'rationale'), false);
    assert.ok(card.title, 'every card must carry a human title');
  }
});

// ---------------------------------------------------------------------------------------------
// The pilot's own bucket sizes (25 atomized entries, 20 canonical units, 5 phases, 2 decision
// questions) must never be baked into the selector implementation as magic constants.
// ---------------------------------------------------------------------------------------------
test('the selector implementation never hardcodes the pilot bucket-size literals 25/20/5/2', () => {
  const source = readFileSync(surfacePath, 'utf8');
  const withoutComments = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const literal of ['25', '20', '5', '2']) {
    const pattern = new RegExp(`(?<![\\w.])${literal}(?![\\w.])`);
    assert.doesNotMatch(withoutComments, pattern, `tenderDecisionSurface.ts must not hardcode the pilot literal ${literal}`);
  }
});
