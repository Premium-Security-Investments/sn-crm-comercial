import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const documentPath = new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url);
const analysisPath = new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url);
assert.equal(existsSync(documentPath), true, 'Debe existir TenderDocumentSection.');
assert.equal(existsSync(analysisPath), true, 'Debe existir TenderAnalysisSection.');

const documents = read('src/tenders/components/TenderDocumentSection.tsx');
const analysis = read('src/tenders/components/TenderAnalysisSection.tsx');
const main = read('src/main.tsx');
const styles = read('src/styles.css');
const detail = main.match(/function OpportunityDetail[\s\S]*?\n}\nconst tenderDocumentTypeOptions/)?.[0] || '';
const coordinator = main.match(/function TenderDocumentReviewPanel[\s\S]*?\n}\nfunction TenderOfferPreparationPanel/)?.[0] || '';

for (const text of ['Actualizar documentos', 'Cargar complementarios', 'Buscar documentos', 'Tipo de documento', 'Última actualización', 'nuevos', 'actualizados', 'sin cambios', 'fallidos']) assert.match(documents, new RegExp(text, 'i'), `Documentos debe incluir ${text}.`);
assert.match(documents, /<details/);
assert.match(documents, /documentsByType|groupedDocuments/);
assert.doesNotMatch(documents, /<details[^>]*\sopen(?:=|>)/, 'Listado/uploader deben iniciar cerrados.');

for (const state of ['Análisis pendiente', 'Análisis desactualizado', 'Análisis fallido', 'Sin documentos']) assert.match(analysis, new RegExp(state));
for (const label of ['Analizar', 'Actualizar', 'Volver a analizar']) assert.match(analysis, new RegExp(`${label} con \\$\\{VIGIA_VISIBLE_NAMES\\.tenders\\}`));
assert.doesNotMatch(analysis, /Generar análisis preliminar|Actualizar análisis/, 'No debe reaparecer una acción determinística equivalente a Vig-IA.');
assert.match(analysis, /tenderAnalysisMethodLabel\(analysis\.producer\)/);
assert.doesNotMatch(analysis, /id="tender-analysis"/, 'El componente interno no debe duplicar el ancla de Análisis.');
assert.equal((main.match(/id="tender-analysis"/g) || []).length, 1, 'El coordinador debe declarar una sola ancla de Análisis.');
assert.doesNotMatch(main, /analysis\s*&&\s*<TenderAnalysisSection/, 'La sección de análisis siempre debe renderizarse.');
assert.match(main, /<TenderDocumentSection/);
assert.match(main, /<TenderAnalysisSection/);
const documentsIndex = coordinator.indexOf('<TenderDocumentSection');
const analysisIndex = coordinator.indexOf('<TenderAnalysisSection');
const reviewIndex = detail.indexOf('<TenderDocumentReviewPanel');
const decisionIndex = detail.indexOf('id="tender-decision"');
assert.ok(documentsIndex >= 0 && analysisIndex > documentsIndex && reviewIndex >= 0 && decisionIndex > reviewIndex, 'El orden debe ser Documentos → Análisis → GO/NO GO.');
assert.match(main, /onAnalysisChanged\?\.\(data\.analysis \|\| null\)/);
assert.match(coordinator, /analysisStatus/, 'El coordinador debe mantener feedback propio para la acción Vig-IA.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?statusText=\{analysisStatus\.message\}/, 'El feedback de Vig-IA debe llegar al bloque de análisis, no quedar oculto en Documentos.');
assert.match(coordinator, /<TenderAnalysisSection[\s\S]*?statusTone=\{analysisStatus\.tone\}/, 'El bloque debe recibir el tono accesible del feedback Vig-IA.');
assert.match(analysis, /statusText\s*&&[\s\S]*role=\{statusTone === 'error' \? 'alert' : 'status'\}/, 'El bloque Vig-IA debe anunciar progreso y errores de forma accesible.');
assert.doesNotMatch(main, /Importando documentos oficiales desde SECOP\/ESU y generando análisis/, 'Actualizar documentos no debe prometer ni disparar análisis.');
assert.match(styles, /\.tender-document-section/);
assert.match(styles, /\.tender-analysis-section/);

console.log('tender guided workspace UI passed');
