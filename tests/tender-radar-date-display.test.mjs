// Contrato de presentación del Radar para el badge "Cierre": fija, contra TenderRadarView.tsx,
// que la fecha límite se muestre en la zona horaria local sin desplazarse un día por el huso UTC.
// Esta prueba monta el componente real (esbuild + jsdom), no HTML copiado a mano.
import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.TZ = 'America/Bogota';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const TenderRadarView = await loadReactComponent('src/tenders/TenderRadarView.tsx', 'TenderRadarView');

async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

function makeRadarRequest(payload) {
  return async path => {
    if (path === '/api/tenders') return payload;
    if (path === '/api/tender-search-profiles') return [];
    throw new Error(`ruta no esperada en la prueba: ${path}`);
  };
}

function mountRadar(payload) {
  const request = makeRadarRequest(payload);
  const view = mountWithJsdom(TenderRadarView, {
    data: {}, refresh: async () => {}, request, navigate: () => {}, moduleNavigation: null,
  });
  return view;
}

function badgeTexts(article) {
  return [...article.querySelectorAll('.badge')].map(node => node.textContent.trim());
}

const TENDER_ROW = {
  id: 'tender-fecha', source: 'SECOP II', section: 'hacer', entity: 'Entidad Fecha', title: 'Proceso de prueba de fecha',
  deadline: '2026-10-23', value: 0, score: 0, reasons: [], risks: [],
};

const PAYLOAD = {
  generatedAt: '2026-10-01T00:00:00.000Z', source: 'supabase',
  totals: { all: 1, hacer: 1, revisar: 0, prioridadBaja: 0, highValue: 0, urgent: 0 },
  tenders: [TENDER_ROW],
};

test('la tarjeta muestra la fecha de cierre en la zona horaria local, sin desplazarse un día', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const article = [...view.container.querySelectorAll('.tender-card')]
      .find(node => node.textContent.includes('Entidad Fecha'));
    if (!article) throw new Error('no existe una tarjeta para la entidad "Entidad Fecha"');
    const badges = badgeTexts(article);
    assert.ok(badges.includes('Cierre: 23/10/2026'), `debe mostrarse exactamente "Cierre: 23/10/2026", badges: ${JSON.stringify(badges)}`);
    assert.ok(!badges.includes('Cierre: 22/10/2026'), 'no debe mostrarse "Cierre: 22/10/2026" (desplazamiento por UTC)');
  } finally {
    await view.unmount();
  }
});

console.log('tender radar date display contract loaded');
