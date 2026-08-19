import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Fail-closed fallback: without a governed decision_review, V3 technical findings stay in traceability
// and are never promoted to answerable executive alerts.
assert.match(component, /\{hasIntegralV3 && analysis && !analysis\.decision_review && <section className="tender-v3-questions tender-executive-pending"/, 'V3 debe mostrar una proyección ejecutiva pendiente cuando no hay decision_review.');
assert.match(component, /Radar ejecutivo pendiente de clasificación/, 'Debe explicar que falta clasificar materialidad.');
const pendingPanel = component.slice(component.indexOf('tender-executive-pending'), component.indexOf('{hasIntegralV3 && analysis && analysis.decision_review'));
assert.match(pendingPanel, /hallazgos técnicos/);
assert.match(pendingPanel, /no se presentan como alertas materiales/i);
assert.doesNotMatch(pendingPanel, /questions\.map\(question => <QuestionResponseCard/, 'Los hallazgos técnicos sin materialidad no deben convertirse en preguntas respondibles.');
assert.match(styles, /\.tender-v3-questions\{/, 'La sección ejecutiva V3 debe conservar estilos propios.');

// When decision_review IS present, the same V3 slot renders the dedicated decision-review panel
// instead — never the raw 20-question section.
assert.match(component, /\{hasIntegralV3 && analysis && analysis\.decision_review && <ExecutiveDecisionReviewPanel/, 'Con decision_review, V3 debe renderizar el panel ejecutivo en lugar de las 20 dudas.');

const reviewPanel = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';
const integralIndex = reviewPanel.indexOf('<TenderIntegralAnalysisV3View analysis={analysis} />');
const controlsIndex = reviewPanel.indexOf('<TenderAnalysisSection analysis={analysis}');
assert.ok(controlsIndex >= 0 && integralIndex > controlsIndex, 'La lectura ejecutiva debe aparecer antes del análisis técnico V3 subordinado.');
assert.match(reviewPanel, /Ver análisis técnico y trazabilidad por requisito/);

console.log('AGT-002 V3 open questions visibility checks passed');
