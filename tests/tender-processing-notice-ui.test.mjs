import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(main, /processingSupersededByAnalysis/, 'La UI debe reconocer un job terminal superado por un análisis vigente.');
assert.match(main, /analysis\?\.status\s*===\s*['"]completed['"]/, 'Sólo un análisis completado puede ocultar el aviso anterior.');
assert.match(main, /analysis\.current\s*===\s*true/, 'El análisis debe estar marcado explícitamente como vigente.');
assert.match(main, /processingStatus\.snapshot_id\s*===\s*analysis\.snapshot_id/, 'El análisis debe corresponder al mismo snapshot del job.');
assert.match(main, /!processingActive/, 'Un procesamiento realmente activo nunca debe ocultarse.');
assert.match(main, /processingVisible[\s\S]{0,240}!processingSupersededByAnalysis/, 'La visibilidad debe excluir jobs terminales ya superados.');

const noticeStart = main.indexOf('{processingVisible && processingStatus');
const noticeEnd = main.indexOf('<TenderDocumentSection', noticeStart);
assert.ok(noticeStart >= 0 && noticeEnd > noticeStart, 'Debe existir el aviso de procesamiento.');
const notice = main.slice(noticeStart, noticeEnd);
assert.match(notice, /<details[^>]*tender-processing-technical/, 'Paso e identificadores deben quedar en un detalle técnico cerrado.');
assert.match(notice, /<summary>Detalles técnicos del procesamiento<\/summary>/, 'El detalle debe tener un rótulo comprensible.');
assert.doesNotMatch(notice, /<details[^>]*tender-processing-technical[^>]*\bopen\b/, 'Los detalles técnicos deben iniciar cerrados.');
assert.match(notice, /processingStatus\.current_step/, 'El paso técnico se conserva para auditoría.');
assert.match(notice, /processingStatus\.snapshot_id/, 'El snapshot se conserva para auditoría.');
assert.match(notice, /processingStatus\.analysis_run_id/, 'El run de análisis se conserva para auditoría.');

console.log('tender processing notice UI checks passed');