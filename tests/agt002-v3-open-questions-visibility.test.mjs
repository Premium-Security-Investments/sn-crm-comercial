import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Fail-closed fallback: without a governed decision_review, V3 technical findings stay in traceability
// and are never promoted to answerable executive alerts.
assert.match(component, /\{hasIntegralV3 && !decisionSurfaceElsewhere && analysis && !analysis\.decision_review && <section className="tender-v3-questions tender-executive-pending"/, 'Sin superficie autoritativa, V3 debe mostrar una proyección ejecutiva pendiente cuando no hay decision_review.');
assert.match(component, /Radar ejecutivo pendiente de clasificación|Clasificación ejecutiva no disponible/, 'Debe explicar que falta clasificar materialidad.');
const pendingPanel = component.slice(component.indexOf('{hasIntegralV3 && !decisionSurfaceElsewhere && analysis && !analysis.decision_review'), component.indexOf('{hasIntegralV3 && !decisionSurfaceElsewhere && analysis && analysis.decision_review'));
assert.match(pendingPanel, /hallazgos técnicos/);
assert.match(pendingPanel, /no se presentan como alertas materiales/i);
assert.doesNotMatch(pendingPanel, /questions\.map\(question => <QuestionResponseCard/, 'Los hallazgos técnicos sin materialidad no deben convertirse en preguntas respondibles.');
assert.match(styles, /\.tender-v3-questions\{/, 'La sección ejecutiva V3 debe conservar estilos propios.');

// When decision_review IS present, the same V3 slot renders the dedicated decision-review panel
// instead — never the raw 20-question section.
assert.match(component, /\{hasIntegralV3 && !decisionSurfaceElsewhere && analysis && analysis\.decision_review && <section className="tender-v3-questions"/, 'Sin superficie autoritativa, V3 debe renderizar las condiciones materiales cuando existe decision_review.');

// El panel se delimita por su propia declaración y su cierre a nivel superior (`\n}\n`), no por el
// nombre del componente que venga después: renombrar o reordenar el componente siguiente no puede
// convertir este contrato en un falso negativo silencioso.
const panelStart = main.indexOf('function TenderDocumentReviewPanel');
assert.ok(panelStart >= 0, 'main debe declarar TenderDocumentReviewPanel.');
const panelEnd = main.indexOf('\n}\n', panelStart);
assert.ok(panelEnd > panelStart, 'TenderDocumentReviewPanel debe cerrar a nivel superior.');
const reviewPanel = main.slice(panelStart, panelEnd);
assert.match(reviewPanel, /<TenderAnalysisSection analysis=\{analysis}/, 'El panel debe montar la lectura ejecutiva.');
// El respaldo técnico V3 es subordinado a la lectura ejecutiva y nunca puede precederla. Tras el
// rediseño de resultados de decisión (2026-08-30) dejó de montarse en main.tsx —lo exigen
// tests/tender-decision-front-render.test.mjs y tests/agt002-historical-technical-backup.test.mjs—,
// así que la comprobación admite las dos formas válidas (ausente, o presente después) y sigue
// fallando si alguna vez vuelve a montarse antes.
const executiveIndex = reviewPanel.indexOf('<TenderAnalysisSection analysis={analysis}');
const technicalIndex = reviewPanel.indexOf('<TenderIntegralAnalysisV3View');
assert.ok(technicalIndex === -1 || technicalIndex > executiveIndex, 'La lectura ejecutiva debe aparecer antes del respaldo técnico V3 subordinado.');
// El acordeón exterior «Ver respaldo técnico del análisis» fue eliminado por ese mismo rediseño:
// el panel no puede reintroducir una segunda lectura técnica duplicada.
assert.doesNotMatch(reviewPanel, /Ver respaldo técnico del análisis/, 'El panel no debe reintroducir el acordeón técnico duplicado.');

console.log('AGT-002 V3 open questions visibility checks passed');
