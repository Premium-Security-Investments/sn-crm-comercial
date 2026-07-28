import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { isCriticalTenderDocument } from '../tender-critical-documents.js';

// Bucaramanga LPR (opportunity 08e33365, job 374195eb): all 5 documents that
// failed import were recorded with critical=false because discoverDocuments()
// only ever flagged a document critical when its name matched 'pliego'. Every
// one of these 5 names is critical under the task's own taxonomy (pliego /
// estudios previos, anexo técnico o financiero, experiencia/habilitantes,
// matriz de riesgos, minuta, adendas, cronograma/cierre) and must fail-closed.
const mustBeCritical = [
  'minuta.pdf',
  'estudios del sector.pdf',
  'Concepto Tecnico espacio publico.pdf',
  '01. Requerimiento Técnico.pdf',
  'Pliego de condiciones.pdf',
  'Estudios previos.pdf',
  'Anexo Técnico 1.pdf',
  'Anexo financiero.xlsx',
  'Certificado de experiencia.pdf',
  'Requisitos habilitantes.pdf',
  'Matriz de riesgos.xlsx',
  'Adenda No 1.pdf',
  'Cronograma del proceso.pdf',
];

for (const name of mustBeCritical) {
  assert.equal(isCriticalTenderDocument(name), true, `"${name}" debe clasificarse como documento crítico`);
}

for (const name of ['Formato unico de propuesta.docx', 'Fotografias del predio.zip', 'Certificado de camara de comercio.pdf']) {
  assert.equal(isCriticalTenderDocument(name), false, `"${name}" no debería marcarse crítico por defecto`);
}

assert.equal(isCriticalTenderDocument(''), false);
assert.equal(isCriticalTenderDocument(undefined), false);

for (const path of ['../server/index.js', '../api/[...path].js']) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(source, /import \{ isCriticalTenderDocument \} from '\.\.\/tender-critical-documents\.js';/);
  assert.match(source, /critical: isCriticalTenderDocument\(name\)/, `${path} debe usar el clasificador compartido, no solo 'pliego'`);
}

console.log('tender critical documents contract passed');
