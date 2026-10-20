// Juan, 2026-10-20: en Cali quedaron vigentes a la vez el proyecto y el definitivo de los mismos documentos (estudios
// previos, presupuesto, matriz, cronograma…), del mismo portafolio SECOP II y sin aviso nuevo; Vig-IA leyó cifras que se
// contradicen ($9.582 vs $8.590 millones). Fija: la versión "Definitivo/Definitiva" de la misma familia retira a la
// vieja aunque sea de un tipo protegido; adendas, respuestas, avisos, resoluciones y CDP nunca; con duda no se archiva;
// y "Actualizar documentos" aplica el plan cuando el portafolio trae cargas de más de un día.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planObsoleteTenderDocuments, planSamePortfolioObsoleteTenderDocuments } from '../tender-document-obsolescence.js';

const CALI_OLD = [
  '2. Requerimiento a la Necesidad.pdf', '4. Estudios Previos.pdf', '5. Anexo 1  Analisis del sector.pdf', '5.1. Presupuesto Oficial.pdf',
  '6. Proyecto de Pliego de Condiciones.pdf', '7. Anexo 2  Cronograma.pdf', '9. Anexo 4  Matriz de riesgos.pdf',
  '16. Formato 6  Certificacion personal minimo requerido  vigilantes.docx', '17. Formato 7  Certificacion parque automotor.docx',
  '32. Formulario 1 Formulario de Presupuesto Oficial (Oferta economica).xlsx', 'Aviso de Convocatoria.pdf', '10. Anexo 5  Minuta del Contrato.pdf',
];
const CALI_NEW = [
  '1. Requerimiento a la Necesidad Definitivo.pdf', '2. Estudios Previos Definitivo.pdf', '3. Pliego de Condiciones Definitivo.pdf',
  '4. Anexo 1 - Analisis del Sector Definitivo.pdf', '4.1. Presupuesto Oficial Definitivo.xlsx', '5. Anexo 4 Matriz de riesgos Definitiva.pdf',
  '7. Formulario 1 Oferta economica Definitivo.xlsx', '8. Formato 6 Certificacion personal minimo requerido vigilantes Definitivo.docx',
  'Anexo 2 Cronograma Definitivo.xlsx', 'RESOLUCION 05330 - ACTO APERTURA.pdf',
];

test('Cali: cada documento con versión definitiva pasa a historial; el resto sigue vigente', () => {
  const plan = planObsoleteTenderDocuments({ currentNames: CALI_OLD, incomingNames: CALI_NEW });
  const archived = Object.fromEntries(plan.archive.map(item => [item.name, item.replacedBy]));
  assert.deepEqual(Object.keys(archived).sort(), [
    '16. Formato 6  Certificacion personal minimo requerido  vigilantes.docx', '2. Requerimiento a la Necesidad.pdf', '4. Estudios Previos.pdf',
    '5. Anexo 1  Analisis del sector.pdf', '5.1. Presupuesto Oficial.pdf', '6. Proyecto de Pliego de Condiciones.pdf',
    '7. Anexo 2  Cronograma.pdf', '9. Anexo 4  Matriz de riesgos.pdf',
  ].sort());
  assert.equal(archived['4. Estudios Previos.pdf'], '2. Estudios Previos Definitivo.pdf');
  assert.equal(archived['5.1. Presupuesto Oficial.pdf'], '4.1. Presupuesto Oficial Definitivo.xlsx');
  for (const kept of ['Aviso de Convocatoria.pdf', '10. Anexo 5  Minuta del Contrato.pdf', '17. Formato 7  Certificacion parque automotor.docx']) {
    assert.ok(!archived[kept], `${kept} no tiene versión definitiva: sigue vigente`);
  }
  // Con duda (familia distinta) no se archiva: queda como aviso.
  assert.ok(!archived['32. Formulario 1 Formulario de Presupuesto Oficial (Oferta economica).xlsx']);
  assert.ok(plan.doubts.some(item => item.name.startsWith('32. Formulario 1')));
});

test('adendas, respuestas, avisos, resoluciones y CDP nunca se retiran por una versión "definitiva"', () => {
  const plan = planObsoleteTenderDocuments({
    currentNames: ['Adenda 1 Cronograma.pdf', 'Respuestas a observaciones al proyecto de pliego.pdf', 'Aviso de convocatoria.pdf', 'Resolucion de apertura.pdf', 'CDP 9826 Fiscalia.pdf'],
    incomingNames: ['Adenda 1 Cronograma Definitiva.pdf', 'Respuestas a observaciones al proyecto de pliego definitivo.pdf', 'Aviso de convocatoria definitivo.pdf', 'Resolucion de apertura definitiva.pdf', 'CDP 9826 Fiscalia definitivo.pdf'],
  });
  assert.deepEqual(plan.archive, []);
});

test('un documento ya definitivo no se retira por otro definitivo, y una familia de una palabra no basta', () => {
  assert.deepEqual(planObsoleteTenderDocuments({ currentNames: ['2. Estudios Previos Definitivo.pdf'], incomingNames: ['Estudios Previos Definitivo v2.pdf'] }).archive.filter(item => item.reason === 'version_definitiva'), []);
  assert.deepEqual(planObsoleteTenderDocuments({ currentNames: ['Anexo.pdf'], incomingNames: ['Anexo Definitivo.pdf'] }).archive, []);
});

test('mismo portafolio: los del último día de carga son los que llegan; con un solo día no se decide nada', () => {
  const docs = [...CALI_OLD.map(name => ({ name, loadedAt: '2026-09-28T00:00:00.000' })), ...CALI_NEW.map(name => ({ name, loadedAt: '2026-10-15T19:00:00.000' }))];
  const plan = planSamePortfolioObsoleteTenderDocuments(docs);
  assert.equal(plan.archive.length, 8);
  assert.deepEqual(plan.incomingNames.sort(), [...CALI_NEW].sort());
  // Fiscalía: los 18 documentos del 27-sep, un solo día.
  const single = planSamePortfolioObsoleteTenderDocuments(CALI_OLD.map(name => ({ name, loadedAt: '2026-09-27T19:00:00.000' })));
  assert.deepEqual(single, { archive: [], doubts: [], incomingNames: [] });
});

test('"Actualizar documentos" aplica el plan sólo tras una descarga completa y sólo a lo que el plan marca', () => {
  const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const start = server.indexOf('async function importOfficialTenderDocuments(');
  const body = server.slice(start, server.indexOf('\nasync function ', start + 10));
  assert.match(body, /if \(!phaseChange\) samePortfolioPlan = planSamePortfolioObsoleteTenderDocuments\(docs\.map\(doc => \(\{ name: cleanFileName\(doc\.nombre_archivo\), loadedAt: doc\.fecha_carga \}\)\)\);/);
  assert.match(body, /if \(samePortfolioPlan\?\.archive\.length && !refreshResults\.some\(result => result\?\.status === 'failed'\)\) \{\s*await requireTenderDocumentRetirement\(database\);/);
  assert.match(body, /keepNames: \[\.\.\.new Set\(\(currentSecop \|\| \[\]\)\.map\(row => row\.name\)\)\]\.filter\(name => !superseded\.has\(secopDocumentNameKey\(name\)\)\)/);
  const retireAt = body.indexOf('samePortfolioRetired = await retireSupersededOfficialTenderDocuments');
  const snapshotAt = body.indexOf('registerTenderDocumentSnapshot(database');
  assert.ok(retireAt > 0 && snapshotAt > retireAt, 'el retiro va antes de la foto del expediente');
});
