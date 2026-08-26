import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
const briefPath = new URL('../src/tenders/components/TenderDecisionBrief.tsx', import.meta.url);
const panelPath = new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url);
const summaryPath = new URL('../src/tenders/components/TenderGoNoGoDecisionSummary.tsx', import.meta.url);
const typesPath = new URL('../src/tenders/types.ts', import.meta.url);
const stylesPath = new URL('../src/styles.css', import.meta.url);
const mainPath = new URL('../src/main.tsx', import.meta.url);
const experiencePath = new URL('../src/tenders/components/TenderDecisionExperience.tsx', import.meta.url);
const component = readFileSync(componentPath, 'utf8');
const brief = readFileSync(briefPath, 'utf8');
const panel = readFileSync(panelPath, 'utf8');
const summary = readFileSync(summaryPath, 'utf8');
const types = readFileSync(typesPath, 'utf8');
const styles = readFileSync(stylesPath, 'utf8');
const main = readFileSync(mainPath, 'utf8');
const experience = readFileSync(experiencePath, 'utf8');

test('types.ts conserva TenderDecisionReview tipado y opcional en TenderDocumentAnalysis', () => {
  assert.match(types, /export type TenderDecisionReview = \{/);
  const reviewType = types.slice(types.indexOf('export type TenderDecisionReview ='), types.indexOf('export type TenderDocumentAnalysis'));
  for (const field of ['review_findings', 'blockers', 'decision_questions', 'supported', 'preparation', 'not_applicable', 'counts']) {
    assert.match(reviewType, new RegExp(field), `TenderDecisionReview conserva ${field}`);
  }
  const docAnalysis = types.slice(types.indexOf('export type TenderDocumentAnalysis'));
  assert.match(docAnalysis, /decision_review\?:\s*TenderDecisionReview\s*\|\s*null/);
});

test('Análisis sigue reservado para las tarjetas completas de condiciones e impedimentos gobernados', () => {
  assert.match(component, /tenderDecisionConditions\(analysis\??\.decision_review/);
  assert.match(component, /tenderDecisionBlockers\(analysis\??\.decision_review/);
  assert.doesNotMatch(component, /analysis\??\.?decision_review\??\.?\.decision_questions/);
  assert.doesNotMatch(component, /entry\.rationale/);
  assert.match(component, /<QuestionResponseCard question=\{question\} analysisRunId=\{analysis\.run_id\}/);
});

test('el brief consume sólo selectores y se limita a potencial, impedimentos y condiciones compactas', () => {
  assert.match(brief, /tenderDecisionBlockers\(review, questionResponses\)/);
  assert.match(brief, /tenderDecisionConditions\(review, questionResponses\)/);
  assert.match(brief, /Potencial comercial/);
  assert.match(brief, /Impedimentos/);
  assert.match(brief, /Condiciones pendientes/);
  assert.match(brief, /CompactFindingList/);
  assert.doesNotMatch(brief, /TenderFindingEvidence|TenderIntegralAnalysisV3View|tenderDecisionSupportedAspects|tenderDecisionPreparationActions/);
  assert.doesNotMatch(brief, /\.rationale|review\.supported|review\.preparation|review\.not_applicable/);
  assert.doesNotMatch(brief, /QuestionResponseCard|GO recomendado|NO GO recomendado/);
});

test('el brief expone exactamente los CTA de revisión y registro humano, sin seleccionar GO o NO GO', () => {
  assert.match(brief, /openAnchor\('tender-analysis'\)/);
  assert.match(brief, /Revisar \{pendingConditions\.length\} condiciones pendientes/);
  assert.match(brief, /openAnchor\('tender-go-no-go-actions'\)/);
  assert.match(brief, /Registrar decisión humana/);
  assert.doesNotMatch(brief, /tender-decision-register-(go|nogo)|open\(['"](?:go|no_go)|recordTenderGoNoGoDecision/);
});

test('el montaje con flag conserva brief + registro formal adyacentes en fallback y una sola experiencia en main', () => {
  const decisionStart = main.indexOf('id="tender-decision"');
  const experienceMount = main.indexOf('<TenderDecisionExperience', decisionStart);
  assert.ok(decisionStart >= 0 && experienceMount > decisionStart);
  const briefIndex = experience.indexOf('<TenderDecisionBrief');
  const panelIndex = experience.indexOf('<TenderGoNoGoDecisionPanel');
  assert.ok(briefIndex >= 0 && panelIndex > briefIndex);
  const briefTagEnd = experience.indexOf('/>', briefIndex) + 2;
  assert.ok(!experience.slice(briefTagEnd, panelIndex).includes('<Tender'), 'ningún componente se interpone entre el brief y el panel en fallback');
  assert.match(experience, /if \(decisionAxisSurfaceEnabled\)[\s\S]*<TenderDecisionAxisSurface/);
  assert.match(panel, /<TenderGoNoGoDecisionSummary loading=\{loading\} current=\{current\} \/>/);
  assert.match(summary, /Decisión humana vigente/);
  assert.match(summary, /Sin decisión humana registrada/);
  assert.match(summary, /current\.justification/);
  assert.match(summary, /psi_sales_profiles\?\.full_name \|\| current\.decided_by/);
});

test('el puntero compacto del panel deriva sólo de impedimentos y condiciones gobernadas; las advertencias detalladas permanecen en el modal', () => {
  assert.match(panel, /const hasDecisionPending = decisionBlockers\.length \+ pendingConditions\.length > 0;/);
  assert.match(panel, /\{hasDecisionPending && <p className="tender-go-no-go-analysis-pointer">/);
  const pointerStart = panel.indexOf('{hasDecisionPending && <p className="tender-go-no-go-analysis-pointer">');
  const pointerEnd = panel.indexOf('</p>}', pointerStart);
  const pointer = panel.slice(pointerStart, pointerEnd);
  assert.doesNotMatch(pointer, /analysisWarnings/);
  assert.match(panel, /\{analysisWarnings\.length > 0 && <div className="notice" role="alert">/);
});

test('los estilos conservan reglas compactas y responsivas para la superficie de decisión', () => {
  assert.match(styles, /\.tender-decision-review/);
  assert.match(styles, /\.tender-decision-brief-v3/);
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*tender-decision-review/);
});
