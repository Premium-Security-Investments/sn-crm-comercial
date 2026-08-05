import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Regression: a technical banner with raw counts/step/ids used to render above
// TenderAnalysisSection's own "Análisis pendiente" placeholder, duplicating the same
// durable-status information. main.tsx must no longer render that banner at all — the
// durable signal is consolidated inside TenderAnalysisSection as a single body message.
for (const forbidden of [
  'tender-processing-technical',
  'Detalles técnicos del procesamiento',
  'Detectados {',
  'procesados {',
  'pendientes {',
  'importados {',
  'sin cambios {',
  'fallidos {',
  'Paso técnico:',
  'Snapshot persistido:',
  'Análisis persistido:',
  'Procesando documentos en segundo plano',
]) {
  assert.doesNotMatch(main, new RegExp(escapeRegExp(forbidden)), `main.tsx no debe volver a mostrar: ${forbidden}`);
}
for (const forbidden of ['tender-processing-technical', 'Detalles técnicos del procesamiento']) {
  assert.doesNotMatch(analysisSection, new RegExp(escapeRegExp(forbidden)), `TenderAnalysisSection no debe reintroducir el detalle técnico: ${forbidden}`);
}

const start = main.indexOf('function TenderDocumentReviewPanel(');
const end = main.indexOf('\nfunction TenderOfferPreparationPanel(', start);
assert.ok(start >= 0 && end > start, 'Debe existir TenderDocumentReviewPanel');
const coordinator = main.slice(start, end);

assert.doesNotMatch(coordinator, /processingVisible/, 'La visibilidad ya no debe calcularse por separado en el coordinador; la decide la señal única de TenderAnalysisSection.');
assert.doesNotMatch(coordinator, /isTenderProcessingSuperseded/, 'La supersesión debe consolidarse dentro de la señal derivada, no evaluarse por separado en el coordinador.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?processingStatus=\{processingStatus\}/, 'El estado durable debe llegar a TenderAnalysisSection aunque analysis sea null.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?onRetryProcessing=\{/, 'El reintento debe delegarse a la señal única de TenderAnalysisSection.');

// TenderAnalysisSection now owns the single derived signal.
assert.match(analysisSection, /deriveTenderProcessingPresentation\(processingStatus/, 'La sección de análisis debe consolidar el estado durable con la función pura derivada.');
assert.match(analysisSection, /processingPresentation\.visible/, 'La sección debe decidir la visibilidad a partir de la señal única.');
assert.match(analysisSection, /processingPresentation\.showRetry/, 'La sección debe controlar el botón Reintentar desde la señal única.');
assert.match(analysisSection, /processingPresentation\.primaryAction/, 'La sección debe deshabilitar/ocultar la acción de Vig-IA a partir de la señal única.');
assert.doesNotMatch(analysisSection, /processingStatus(\?)?\.counts/, 'La sección de análisis no debe leer conteos internos del job.');
assert.doesNotMatch(analysisSection, /processingStatus(\?)?\.failed_items/, 'La sección de análisis no debe listar ítems fallidos técnicos.');
assert.doesNotMatch(analysisSection, /processingStatus(\?)?\.current_step/, 'La sección de análisis no debe exponer el paso técnico.');
assert.doesNotMatch(analysisSection, /processingStatus(\?)?\.snapshot_id/, 'La sección de análisis no debe exponer el snapshot técnico.');
assert.match(
  analysisSection,
  /const state = !hasDocuments \? 'Pendiente' : failed \? 'Análisis fallido' : stale \? 'Análisis desactualizado' : !analysis \? 'Pendiente' : 'Análisis vigente'/,
  'El encabezado debe usar una etiqueta corta y no duplicar literalmente Sin documentos/Análisis pendiente del bloque corporal.',
);

console.log('tender processing notice UI checks passed');
