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
const briefPath = new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url);
const questionCardPath = new URL('../src/tenders/components/TenderQuestionResponseCard.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const component = readFileSync(componentPath, 'utf8');
const brief = readFileSync(briefPath, 'utf8');
const questionCard = readFileSync(questionCardPath, 'utf8');
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
// An unclassified V3 run stays technical: no raw question is promoted to a material alert.
// ---------------------------------------------------------------------------------------------
test('an unclassified V3 run renders a pending executive projection instead of 20 answerable questions', () => {
  assert.match(component, /\{hasIntegralV3 && analysis && !analysis\.decision_review && <section className="tender-v3-questions tender-executive-pending"/);
  const start = component.indexOf('tender-executive-pending');
  const end = component.indexOf('{hasIntegralV3 && analysis && analysis.decision_review');
  const pending = component.slice(start, end);
  assert.match(pending, /Clasificación ejecutiva no disponible/);
  assert.doesNotMatch(pending, /QuestionResponseCard/, 'the raw technical questions must not become answerable material alerts');
  assert.doesNotMatch(pending, /no se identificaron impedimentos/i);
});

// ---------------------------------------------------------------------------------------------
// The decision brief renders only decision_questions (2), never analysis.questions.
// ---------------------------------------------------------------------------------------------
test('a dedicated decision-review panel renders only when decision_review is present', () => {
  assert.match(component, /\{hasIntegralV3 && analysis && analysis\.decision_review && <section className="tender-v3-questions"/, 'the analysis section must gate material questions on decision_review');
  assert.match(component, /Condiciones pendientes de validar/);
});

function panelSource() {
  assert.match(brief, /export function TenderDecisionBrief/, 'TenderDecisionBrief must be defined');
  return brief;
}

test('the decision-review panel uses only decision_review.decision_questions, never analysis.questions', () => {
  const panel = panelSource();
  assert.match(component, /decision_review\?\.decision_questions/, 'must derive its question list from decision_review.decision_questions only');
  assert.doesNotMatch(component.slice(component.indexOf('hasIntegralV3 && analysis && analysis.decision_review')), /\bquestions\.map\(question => <QuestionResponseCard\b/, 'must never reuse the legacy 20-question mapping');
  assert.match(panel, /tenderBriefPriorityItems/);
});

test('the decision-review panel keeps stable ids and links answers to analysis.run_id/question_id', () => {
  assert.match(component, /id:\s*entry\.id/, 'must key each decision question by its stable fixture id');
  assert.match(component, /<QuestionResponseCard question=\{question\} analysisRunId=\{analysis\.run_id\}/, 'must reuse the governed human-answer form in Análisis');
  assert.match(component, /responses=\{questionResponses\.filter\(item => item\.question_id === question\.id\)\}/, 'must link existing human answers by the stable question id');
  assert.doesNotMatch(brief, /QuestionResponseCard/, 'the brief must not duplicate the answer form');
});

test('the decision brief presents independent axes without engine counters as the primary message', () => {
  const panel = panelSource();
  assert.match(panel, /Brief de decisión/, 'must present one executive decision surface');
  assert.match(panel, /Potencial comercial/);
  assert.match(panel, /Impedimentos/);
  assert.match(panel, /Incertidumbre/);
  assert.match(panel, /Validar primero/);
  assert.doesNotMatch(panel, /tender-executive-summary/, 'must not use the KPI counter grid as the primary message');
  assert.doesNotMatch(panel, /decisionReview\.counts|review\.counts/, 'must not render engine counts as the primary message');
  assert.doesNotMatch(panel, /GO recomendado|NO GO recomendado/, 'must not phrase the agent posture as GO/NO GO');
  assert.doesNotMatch(panel, /Por qué vale la pena considerarla/, 'supported must not be labeled as commercial reasons');
});

test('the decision-review panel explicitly states AGT-002 sends no emails, can request clarifications/support within SIIO, and does not decide GO/NO-GO', () => {
  const panel = panelSource();
  assert.match(panel, /no env[ií]a correos/i, 'must state AGT-002 never sends emails');
  assert.doesNotMatch(panel, /no solicita soportes/i, 'must never claim AGT-002 cannot request support — it can, within SIIO');
  assert.match(panel, /solicitar aclaraciones? o soportes dentro de SIIO/i, 'must state AGT-002 can request clarifications/support within SIIO');
  assert.match(panel, /encargada (responde|puede responder)[\s\S]{0,80}(adjunt|SIIO)/i, 'must state the responsible person answers/attaches evidence there');
  assert.match(panel, /no decide GO \/ NO GO/i, 'must state AGT-002 never decides GO/NO-GO');
});

test('the question response form still allows the responsible person to attach optional support files within SIIO', () => {
  assert.match(questionCard, /Archivos de soporte \(opcional\)/, 'the attachment control must remain available for evidence attached within SIIO');
});

test('preparation notes render as a collapsed effort summary, never as an answerable QuestionResponseCard', () => {
  const panel = panelSource();
  assert.match(panel, /Trámites preparables/);
  assert.match(panel, /tenderBriefEffortSummary\(review\.preparation\)/);
  assert.doesNotMatch(panel, /QuestionResponseCard/, 'preparation items must never be answerable via QuestionResponseCard');
  assert.match(panel, /no son impedimentos materiales/i, 'must explicitly separate preparation actions from material impediments');
});

test('supported findings render as capacity evidence, not as the commercial-potential headline', () => {
  const panel = panelSource();
  assert.match(panel, /Evidencia de capacidad revisada/);
  assert.match(panel, /review\.supported\.map/);
  const capacityStart = panel.indexOf('Evidencia de capacidad revisada');
  assert.ok(capacityStart > panel.indexOf('<details'), 'capacity evidence must live behind a collapsed details, not as the primary commercial reason');
});

test('the 13 not_applicable findings, plus version/status traceability, render only inside the collapsed trace section', () => {
  const panel = panelSource();
  const start = panel.indexOf('Trazabilidad completa');
  assert.ok(start >= 0, 'traceability must exist');
  const blockStart = panel.lastIndexOf('<details', start);
  const end = panel.indexOf('</details>', start);
  assert.ok(blockStart >= 0 && end > start, 'traceability must be inside its own collapsible details/summary');
  const traceBlock = panel.slice(blockStart, end);
  assert.match(traceBlock, /review\.not_applicable\.map/);
  assert.match(traceBlock, /review\.contract_version/, 'trace must surface the contract version');
  assert.match(traceBlock, /review\.decision_status/, 'trace must surface the decision status');
  assert.doesNotMatch(panel.slice(0, blockStart), /review\.not_applicable\.map/, 'not_applicable must never render outside the collapsed trace section');
});

test('blockers render clearly when present, even though the pinned review has none today', () => {
  const panel = panelSource();
  assert.match(panel, /review\.blockers\.length/, 'must surface blockers as an independent axis');
  assert.match(panel, /kind === 'impediment'/);
});

test('the brief links the reading to human courses and the optional technical drill-down', () => {
  const panel = panelSource();
  assert.match(panel, /Validar primero/);
  assert.match(panel, /Continuar — ir al registro humano/);
  assert.match(panel, /No continuar — ir al registro humano/);
  assert.match(panel, /Ver análisis técnico completo/);
  assert.match(panel, /tender-technical-analysis/);
  assert.match(panel, /Validar primero no registra una decisión/);
});

// ---------------------------------------------------------------------------------------------
// Styles: minimal, accessible, responsive — no broad redesign.
// ---------------------------------------------------------------------------------------------
test('styles.css has minimal, responsive rules for the decision-review panel', () => {
  assert.match(styles, /\.tender-decision-review/);
  assert.match(styles, /\.tender-decision-brief-v3/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*tender-decision-review/, 'must be covered by a narrow responsive breakpoint');
});
