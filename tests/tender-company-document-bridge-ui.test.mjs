// Cómo se LEE el puente ficha de empresa → expediente: el orden es la decisión de producto, así que se prueba sin
// renderizar (selectores puros de `companyDocumentBridgeView.ts`), y el panel se renderiza para comprobar su estado
// inicial y su contrato con el backend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const view = await import(`data:text/javascript;base64,${Buffer.from(buildSync({
  entryPoints: [new URL('../src/tenders/companyDocumentBridgeView.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
}).outputFiles[0].contents).toString('base64')}`);

const row = (key, state, kind, label = key) => ({ key, state, kind, label });

test('lo que puede costar la oferta va arriba; lo listo, al final', () => {
  const sorted = view.sortTenderCompanyDocumentRows([
    row('rce', 'listo_al_cierre', 'tramite'),
    row('experiencia', 'sin_archivo', 'hecho_inscrito'),
    row('rup', 'vigencia_por_confirmar', 'mixto'),
    row('camara', 'vencido', 'tramite'),
    row('bancaria', 'sin_archivo', 'tramite'),
  ]).map(item => item.key);
  assert.deepEqual(sorted, ['camara', 'experiencia', 'bancaria', 'rup', 'rce']);
});

test('dentro del mismo estado, el hecho inscrito va antes que el trámite', () => {
  const sorted = view.sortTenderCompanyDocumentRows([
    row('armas', 'vence_antes_del_cierre', 'tramite', 'Listado de armas'),
    row('licencia', 'vence_antes_del_cierre', 'hecho_inscrito', 'Licencia SuperVigilancia'),
  ]).map(item => item.key);
  assert.deepEqual(sorted, ['licencia', 'armas']);
  // Y el orden no depende de cómo vinieron las filas.
  assert.deepEqual(view.sortTenderCompanyDocumentRows([
    row('licencia', 'vence_antes_del_cierre', 'hecho_inscrito', 'Licencia SuperVigilancia'),
    row('armas', 'vence_antes_del_cierre', 'tramite', 'Listado de armas'),
  ]).map(item => item.key), ['licencia', 'armas']);
});

test('cada estado tiene etiqueta en español y un tono; lo vencido y lo que no alcanza, en alerta', () => {
  for (const state of view.TENDER_COMPANY_DOCUMENT_STATE_ORDER) {
    assert.ok(view.TENDER_COMPANY_DOCUMENT_STATE_LABELS[state], `falta la etiqueta de ${state}`);
    assert.ok(view.tenderCompanyDocumentStateTone(state));
  }
  assert.equal(view.TENDER_COMPANY_DOCUMENT_STATE_ORDER.length, Object.keys(view.TENDER_COMPANY_DOCUMENT_STATE_LABELS).length);
  assert.equal(view.tenderCompanyDocumentStateTone('vencido'), 'tender-fit-bajo');
  assert.equal(view.tenderCompanyDocumentStateTone('vence_antes_del_cierre'), 'tender-fit-bajo');
  assert.equal(view.tenderCompanyDocumentStateTone('listo_al_cierre'), 'tender-fit-alto');
});

const TenderCompanyDocumentBridgePanel = await loadReactComponent('src/tenders/components/TenderCompanyDocumentBridgePanel.tsx', 'TenderCompanyDocumentBridgePanel');

test('el panel arranca leyendo y no pide nada hasta tener respuesta', () => {
  const calls = [];
  const html = renderReactComponent(TenderCompanyDocumentBridgePanel, {
    opportunityId: '6ca7043f-ec54-4938-8674-1696403123bd',
    request: async path => { calls.push(path); return {}; },
  });
  assert.match(html, /Cruzando los documentos de la empresa con el cierre/);
  assert.match(html, /aria-busy="true"/);
  // El render estático no corre efectos: la lectura ocurre en el navegador, no al montar en el servidor.
  assert.deepEqual(calls, []);
});

test('el panel lee la ruta de sólo lectura del puente, con la oportunidad en la consulta', () => {
  const source = buildSync({
    entryPoints: [new URL('../src/tenders/api.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
  }).outputFiles[0].text;
  assert.match(source, /\/api\/tender-dossier-company-documents\?id=/);
  assert.doesNotMatch(source, /tender-dossier-company-documents[^`]*method/, 'el puente nunca escribe');
});
