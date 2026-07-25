import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/statusLabels.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const {
  tenderDecisionLabel,
  tenderDocumentStatusLabel,
  tenderOfferStatusLabel,
  tenderStatusTone,
} = await import(moduleUrl);

assert.equal(tenderOfferStatusLabel('pendiente_decision'), 'Decisión pendiente');
assert.equal(tenderOfferStatusLabel('en_preparacion'), 'En preparación');
assert.equal(tenderOfferStatusLabel('lista_para_presentar'), 'Lista para presentar');
assert.equal(tenderOfferStatusLabel('presentada'), 'Presentada');
assert.equal(tenderOfferStatusLabel('adjudicada'), 'Adjudicada');
assert.equal(tenderOfferStatusLabel('no_adjudicada'), 'No adjudicada');
assert.equal(tenderOfferStatusLabel('cerrada_no_go'), 'Cerrada por NO GO');
assert.equal(tenderStatusTone('cerrada_no_go'), 'danger', 'NO GO nunca puede heredar el tono positivo de GO');
assert.equal(tenderStatusTone('no_adjudicada'), 'danger');
assert.equal(tenderStatusTone('Medio-Alto'), 'danger');
assert.equal(tenderStatusTone('adjudicada'), 'success');
assert.equal(tenderStatusTone('Riesgo pendiente'), 'warning');
assert.equal(tenderDocumentStatusLabel('documentos_cargados'), 'Documentos cargados');
assert.equal(tenderDocumentStatusLabel('analisis_generado'), 'Análisis generado');
assert.equal(tenderDocumentStatusLabel('fallo_importacion'), 'Falló la actualización documental');
assert.equal(tenderDocumentStatusLabel('pendiente_documentos'), 'Documentos pendientes');
assert.equal(tenderDecisionLabel('go'), 'GO');
assert.equal(tenderDecisionLabel('no_go'), 'NO GO');
assert.equal(tenderDecisionLabel(null), 'Decisión pendiente');
assert.equal(tenderStatusTone('estado_desconocido'), 'neutral');

console.log('tender human status labels passed');
