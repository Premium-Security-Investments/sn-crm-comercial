// Ofertas presentadas en pantalla (encargo del 2026-11-07): el registro va donde se cambia el estado de la oferta, los
// indicadores en Licitaciones → Oportunidades y el aviso en Mi día.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('el registro de radicación y resultado va junto al estado de la oferta', () => {
  const main = read('src/main.tsx');
  assert.ok(main.indexOf('<TenderOfferStatusPanel') < main.indexOf('<TenderOfferRecordPanel'));
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
