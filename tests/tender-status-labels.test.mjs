import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';
import { readFileSync } from 'node:fs';

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
  tenderPreparationStatusLabel,
  tenderSharePointStatusLabel,
  tenderStatusTone,
} = await import(moduleUrl);
const uiBundle = buildSync({
  entryPoints: [new URL('../src/tenders/tenderUiState.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(uiBundle.outputFiles[0].contents).toString('base64')}`);

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
assert.equal(tenderPreparationStatusLabel('preparacion_oferta'), 'Preparación de oferta');
assert.equal(tenderSharePointStatusLabel('pendiente_configurar_integracion'), 'Integración pendiente de configuración');
assert.equal(tenderPreparationStatusLabel('raw_nuevo'), 'Estado no reconocido');

assert.equal(ui.safePublicTenderSourceUrl('https://www.secop.gov.co/proceso/1'), 'https://www.secop.gov.co/proceso/1');
for (const unsafe of ['javascript:alert(1)', 'http://secop.gov.co/proceso', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.2/x', 'https://user:pass@secop.gov.co/x', 'https://secop.gov.co:8443/x', 'https://[::]/x', 'https://[::ffff:127.0.0.1]/x', 'https://[fe90::1]/x']) {
  assert.equal(ui.safePublicTenderSourceUrl(unsafe), null, `Debe rechazar ${unsafe}`);
}
assert.equal(ui.safePublicTenderSourceUrl('https://[2606:4700:4700::1111]/x'), 'https://[2606:4700:4700::1111]/x');
const mainSource = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(mainSource, /tenderSharePointStatusLabel\(authorizedPreparation\.sharepoint_folder\?\.status\)/, 'El detalle debe humanizar el estado SharePoint.');
assert.match(mainSource, /resolveTenderSourceUrl\(authorizedPreparation\?\.sharepoint_folder\?\.url\)/, 'El detalle debe validar la URL de la carpeta antes de enlazarla.');
assert.doesNotMatch(mainSource, /href=\{authorizedPreparation\.sharepoint_folder\.url\}/, 'El detalle no debe enlazar directamente una URL de SharePoint sin validar.');
let active = new Set();
active = ui.beginTenderRefresh(active, 'A');
active = ui.beginTenderRefresh(active, 'B');
assert.deepEqual([...active].sort(), ['A', 'B']);
active = ui.finishTenderRefresh(active, 'A');
assert.deepEqual([...active], ['B'], 'Finalizar A no debe borrar el busy de B.');

console.log('tender human status labels passed');
