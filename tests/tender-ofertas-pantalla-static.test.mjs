// Ofertas presentadas en pantalla (encargo del 2026-11-07): el registro va donde se cambia el estado de la oferta, los
// indicadores en Licitaciones → Oportunidades y el aviso en Mi día.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('el registro de radicación y resultado va junto al estado de la oferta', () => {
  const main = read('src/main.tsx');
  // En el detalle anterior va después del estado; en Preparar se monta además como offerRecord (2026-11-10).
  assert.ok(main.indexOf('<TenderOfferStatusPanel') < main.lastIndexOf('<TenderOfferRecordPanel'));
  const panel = read('src/tenders/components/TenderOfferRecordPanel.tsx');
  for (const text of ['Registrar como presentada', 'No se presentó', 'Registrar resultado', 'Radicado o RPL', 'expediente incompleto']) assert.ok(panel.includes(text), text);
  assert.doesNotMatch(read('src/tenders/components/TenderOfferStatusPanel.tsx'), /label: 'Registrar presentada'/);
});

test('indicadores en Oportunidades y aviso en Mi día', () => {
  assert.match(read('src/tenders/TenderOpportunitiesView.tsx'), /<TenderOfferIndicatorsPanel request=\{request\} \/>/);
  assert.match(read('src/main.tsx'), /LICITACIONES_VIEW\) && <TenderMyDayOfferReminder/);
  const server = read('server/index.js');
  assert.match(server, /'POST \/api\/tender-offer-submission': \['tenders', ACTIONS\.LICITACIONES_GO_NO_GO_APPROVE\]/);
  assert.equal(server, read('api/[...path].js'));
});

test('Juan, 2026-11-09: indicadores y tablero de procesos van al final de Oportunidades, plegados', () => {
  const view = read('src/tenders/TenderOpportunitiesView.tsx');
  const list = view.indexOf('className="pagination"');
  assert.ok(list > 0 && view.indexOf('<TenderOfferIndicatorsPanel') > list, 'después de la lista y la paginación');
  assert.ok(view.indexOf('<TenderOpenBoardPanel') > list);
  assert.doesNotMatch(read('src/tenders/components/TenderOfferIndicatorsPanel.tsx'), /tender-offer-indicators" open>/);
});

test('Juan, 2026-11-10: en la pestaña Preparar está «Oferta presentada» y no hay atajos sin evidencia', () => {
  const main = read('src/main.tsx');
  const prepare = main.slice(main.indexOf('<TenderPrepareView'), main.indexOf('<TenderPrepareView') + 1200);
  assert.match(prepare, /offerRecord=\{<TenderOfferRecordPanel opportunityId=\{o\.id\}/);
  const workspace = read('src/tenders/workspace/TenderWorkspace.tsx');
  // Juan, 2026-11-10: al final, después de «Documentos que se firman y aprueban», y con el rótulo legible.
  assert.match(workspace, /\{offerRecord && <section className="tw-card tw-offer-record">\{offerRecord\}<\/section>\}/);
  assert.ok(workspace.indexOf('Documentos que se firman y aprueban') < workspace.indexOf('tw-offer-record'));
  assert.match(read('src/styles.css'), /\.tender-offer-record-panel \.eyebrow\{background:#eaf2ff;color:#174ea6\}/);
  const next = workspace.slice(workspace.indexOf('const NEXT_STATUS'), workspace.indexOf('};', workspace.indexOf('const NEXT_STATUS')));
  assert.doesNotMatch(next, /Registrar oferta presentada|Registrar adjudicada|Registrar no adjudicada/);
  assert.match(next, /Marcar lista para presentar/);
});
