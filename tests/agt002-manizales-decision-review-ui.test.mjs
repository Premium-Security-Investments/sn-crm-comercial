import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// AGT-002 Manizales · BLOQUE 2 UI · TenderAnalysisSection debe usar decision_review (2 preguntas)
// en lugar de analysis.questions (20) cuando el backend fail-closed lo adjunta, y conservar
// exactamente el comportamiento legado ('Dudas por resolver' con las 20 questions) cuando no
// existe. Pruebas estáticas (regex sobre fuente) porque el repo no tiene infraestructura de
// render de componentes (patrón ya usado por tests/agt002-v3-open-questions-visibility.test.mjs y
// tests/agt002-manizales-unresolved-visibility.test.mjs). No hay red, DB, commit, push ni deploy.

const componentPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const component = readFileSync(componentPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');

// ---------------------------------------------------------------------------------------------
// Types: precise, closed shape for decision_review, carried as optional on TenderDocumentAnalysis.
// ---------------------------------------------------------------------------------------------
test('types.ts declares a precise TenderDecisionReview type and carries it optionally on TenderDocumentAnalysis', () => {
  assert.match(types, /export type TenderDecisionReview = \{/);
  const reviewType = types.slice(types.indexOf('export type TenderDecisionReview ='), types.indexOf('export type TenderDocumentAnalysis'));
  for (const field of [
    'decision_status', 'decision_ready', 'human_approval_required', 'routing_action',
    'external_communications_allowed', 'evidence_requests_allowed', 'contract_version',
    'source_fixture_version', 'review_findings', 'exercise_mode', 'recommendation',
    'blockers', 'decision_questions', 'supported', 'preparation', 'not_applicable', 'counts',
  ]) {
    assert.match(reviewType, new RegExp(field), `TenderDecisionReview must carry ${field}`);
  }
  const docAnalysis = types.slice(types.indexOf('export type TenderDocumentAnalysis'));
  assert.match(docAnalysis, /decision_review\?:\s*TenderDecisionReview\s*\|\s*null/, 'TenderDocumentAnalysis must carry the optional decision_review');
});

// ---------------------------------------------------------------------------------------------
// The legacy 20-question section is now gated on the absence of decision_review.
// ---------------------------------------------------------------------------------------------
test('the legacy 20-question "Dudas por resolver" section only renders when decision_review is absent', () => {
  assert.match(component, /\{hasIntegralV3 && analysis && !analysis\.decision_review && <section className="tender-v3-questions"/, 'the legacy section must be gated on the absence of decision_review');
  assert.match(component, /<h3 id="tender-v3-questions-title">Dudas por resolver<\/h3>/, 'legacy section title must be unchanged');
  assert.match(component, /questions\.map\(question => <QuestionResponseCard key=\{question\.id\} question=\{question\} analysisRunId=\{analysis\.run_id\}/, 'legacy section must still map the full analysis.questions (20)');
});

// ---------------------------------------------------------------------------------------------
// The new decision-review panel renders only decision_questions (2), never analysis.questions.
// ---------------------------------------------------------------------------------------------
test('a dedicated decision-review panel renders only when decision_review is present', () => {
  assert.match(component, /\{hasIntegralV3 && analysis && analysis\.decision_review && <ManizalesDecisionReviewPanel/, 'the decision-review panel must be gated on the presence of decision_review');
});

function panelSource() {
  const start = component.indexOf('function ManizalesDecisionReviewPanel');
  assert.ok(start >= 0, 'ManizalesDecisionReviewPanel must be defined');
  const end = component.indexOf('\nexport function TenderAnalysisSection');
  assert.ok(end > start, 'ManizalesDecisionReviewPanel must be defined before the exported section component');
  return component.slice(start, end);
}

test('the decision-review panel uses only decision_review.decision_questions, never analysis.questions', () => {
  const panel = panelSource();
  assert.match(panel, /decisionReview\.decision_questions\.map\(normalizeDecisionQuestion\)/, 'must derive its question list from decision_review.decision_questions only');
  assert.doesNotMatch(panel, /\banalysis\.questions\b/, 'must never read the raw 20-question analysis.questions array');
  assert.doesNotMatch(panel, /\bquestions\.map\(question => <QuestionResponseCard\b/, 'must never reuse the legacy 20-question mapping');
});

test('the decision-review panel keeps stable ids and links answers to analysis.run_id/question_id', () => {
  // normalizeDecisionQuestion is defined once, above the panel component, and keys each
  // decision question by the review's own stable fixture id (never a positional/index id).
  assert.match(component, /function normalizeDecisionQuestion\([\s\S]*?id:\s*entry\.id/, 'must key each decision question by its stable fixture id');
  const panel = panelSource();
  assert.match(panel, /decisionReview\.decision_questions\.map\(normalizeDecisionQuestion\)/, 'the panel must use the stable-id normalizer, not an ad hoc/positional mapping');
  assert.match(panel, /<QuestionResponseCard question=\{question\} analysisRunId=\{analysisRunId\}/, 'must reuse the governed human-answer form');
  assert.match(panel, /responses=\{questionResponses\.filter\(item => item\.question_id === question\.id\)\}/, 'must link existing human answers by the stable question id');
});

test('the decision-review panel heading and count reflect exactly the 2 decision_questions', () => {
  const panel = panelSource();
  assert.match(panel, /Decisiones de la encargada/, 'must have the required heading');
  assert.match(panel, /\{decisionQuestions\.length\} pendiente\(s\)/, 'must show the live pending count (2 for the pinned run)');
});

test('the decision-review panel explicitly states AGT-002 sends no emails, requests no evidence, and does not decide GO/NO-GO', () => {
  const panel = panelSource();
  assert.match(panel, /no env[ií]a correos/i);
  assert.match(panel, /no solicita soportes/i);
  assert.match(panel, /no decide GO \/ NO GO/i);
});

test('preparation notes (9) render inside a secondary details/summary, never as an answerable QuestionResponseCard', () => {
  const panel = panelSource();
  const start = panel.indexOf('<details className="tender-decision-review-preparation">');
  const end = panel.indexOf('</details>', start);
  assert.ok(start >= 0 && end > start, 'preparation must be inside its own collapsible details/summary');
  const preparationBlock = panel.slice(start, end);
  assert.match(preparationBlock, /Notas de preparaci[oó]n \(\{decisionReview\.preparation\.length\}\)/);
  assert.match(preparationBlock, /decisionReview\.preparation\.map/);
  assert.doesNotMatch(preparationBlock, /QuestionResponseCard/, 'preparation items must never be answerable via QuestionResponseCard');
  assert.match(preparationBlock, /no son decisiones cr[ií]ticas/i, 'must explicitly avoid describing preparation notes as critical decisions');
});

test('a visible summary of the 3 supported aspects renders outside any collapsed section', () => {
  const panel = panelSource();
  const traceStart = panel.indexOf('<details className="tender-decision-review-trace">');
  const supportedIndex = panel.indexOf('decisionReview.supported.length} aspecto');
  assert.ok(supportedIndex >= 0, 'a visible supported-count summary must exist');
  assert.ok(supportedIndex < traceStart, 'the supported summary must render before/outside the collapsed traceability section, not buried inside it');
});

test('the 13 not_applicable findings, plus version/status traceability, render only inside the collapsed trace section', () => {
  const panel = panelSource();
  const start = panel.indexOf('<details className="tender-decision-review-trace">');
  const end = panel.indexOf('</details>', start);
  assert.ok(start >= 0 && end > start, 'traceability must be inside its own collapsible details/summary');
  const traceBlock = panel.slice(start, end);
  assert.match(traceBlock, /decisionReview\.not_applicable\.map/);
  assert.match(traceBlock, /decisionReview\.contract_version/, 'trace must surface the contract version');
  assert.match(traceBlock, /decisionReview\.decision_status/, 'trace must surface the decision status');
  assert.doesNotMatch(panel.slice(0, start), /decisionReview\.not_applicable\.map/, 'not_applicable must never render outside the collapsed trace section');
});

test('blockers render clearly when present, even though the pinned review has none today', () => {
  const panel = panelSource();
  assert.match(panel, /decisionReview\.blockers\.length > 0 &&/, 'must conditionally render a visible blocker callout when blockers exist');
  assert.match(panel, /decisionReview\.blockers\.map/);
});

// ---------------------------------------------------------------------------------------------
// Styles: minimal, accessible, responsive — no broad redesign.
// ---------------------------------------------------------------------------------------------
test('styles.css has minimal, responsive rules for the decision-review panel', () => {
  assert.match(styles, /\.tender-decision-review/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*tender-decision-review/, 'must be covered by a narrow responsive breakpoint');
});
