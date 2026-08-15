import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(component, /\{hasIntegralV3 && analysis && <section className="tender-v3-questions"/, 'V3 debe conservar una sección específica de dudas.');
assert.match(component, /<h3 id="tender-v3-questions-title">Dudas por resolver<\/h3>/, 'La sección V3 debe tener un título claro.');
assert.match(component, /questions\.map\(question => <QuestionResponseCard/, 'Las dudas V3 deben conservar el formulario trazable de respuesta.');
assert.match(component, /analysisRunId=\{analysis\.run_id\}/, 'Las respuestas deben quedar vinculadas al run V3 vigente.');
assert.match(component, /questions\.length \? `\$\{questions\.length\} pendiente\(s\)` : 'Sin pendientes'/, 'La UI debe mostrar el número de dudas pendientes.');
assert.match(component, /Sin dudas abiertas registradas/, 'V3 debe conservar un estado vacío honesto.');
assert.match(styles, /\.tender-v3-questions\{/, 'La sección de dudas V3 debe tener estilos propios.');

const reviewPanel = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';
const integralIndex = reviewPanel.indexOf('<TenderIntegralAnalysisV3View analysis={analysis} />');
const controlsIndex = reviewPanel.indexOf('<TenderAnalysisSection analysis={analysis}');
assert.ok(integralIndex >= 0 && controlsIndex > integralIndex, 'Las dudas y controles deben aparecer después del análisis V3; V2 permanece porque la vista integral retorna null.');

console.log('AGT-002 V3 open questions visibility checks passed');
