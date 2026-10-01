// Radar Corte 1 — presentación de continuidad de fase en la tarjeta del Radar.
// Fija, contra TenderRadarView.tsx + radarUtils.ts (tenderPhaseContinuityLabel):
//   (1) con más de una fase conocida, la tarjeta muestra "N fases activas" y las etiquetas de fase.
//   (2) con una sola fase conocida (o ninguna), la tarjeta no muestra ningún aviso de continuidad.
//   (3) cuando la identidad sucesora es ambigua (`identity_review_required`), la tarjeta no ofrece
//       el botón normal "Convertir en oportunidad" y en su lugar muestra "Identidad por validar".
import { strict as assert } from 'node:assert';
import test from 'node:test';

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
  return mountWithJsdom(TenderRadarView, {
    data: {}, refresh: async () => {}, request, navigate: () => {}, moduleNavigation: null,
  });
}

function findCardByEntity(view, entity) {
  const article = [...view.container.querySelectorAll('.tender-card')]
    .find(node => node.textContent.includes(entity));
  if (!article) throw new Error(`no existe una tarjeta para la entidad "${entity}"`);
  return article;
}

const TWO_PHASES_ROW = {
  id: 'tender-continuidad', source: 'SECOP II', section: 'hacer', entity: 'Entidad Continuidad',
  title: 'Servicio de vigilancia', value: 500000000, score: 90, reasons: [], risks: [],
  internal_status: 'convertida_oportunidad', converted_opportunity_id: '11111111-1111-4111-8111-111111111111',
  known_phases: ['Presentación de observaciones', 'Presentación de oferta'],
};

const ONE_PHASE_ROW = {
  id: 'tender-fase-unica', source: 'SECOP II', section: 'hacer', entity: 'Entidad Fase Unica',
  title: 'Servicio de aseo', value: 50000000, score: 60, reasons: [], risks: [],
  known_phases: ['Presentación de oferta'],
};

const NO_PHASES_ROW = {
  id: 'tender-sin-fases', source: 'SECOP II', section: 'hacer', entity: 'Entidad Sin Fases',
  title: 'Suministro de papelería', value: 8000000, score: 20, reasons: [], risks: [],
};

const IDENTITY_REVIEW_ROW = {
  id: 'tender-identidad-dudosa', source: 'SECOP II', section: 'hacer', entity: 'Entidad Identidad Dudosa',
  title: 'Servicio de vigilancia con fases ambiguas', value: 300000000, score: 70, reasons: [], risks: [],
  internal_status: 'nueva', identity_review_required: true,
};

const PAYLOAD = {
  generatedAt: '2026-09-28T00:00:00.000Z', source: 'supabase',
  totals: { all: 4, hacer: 4, revisar: 0, prioridadBaja: 0, highValue: 0, urgent: 0 },
  tenders: [TWO_PHASES_ROW, ONE_PHASE_ROW, NO_PHASES_ROW, IDENTITY_REVIEW_ROW],
};

test('con más de una fase conocida, la tarjeta muestra el recuento de fases activas y sus etiquetas', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Continuidad');
    assert.match(card.textContent, /2 fases activas/, 'debe mostrarse el recuento humano de fases activas');
    assert.match(card.textContent, /Presentación de observaciones/, 'debe mostrarse la etiqueta de la fase histórica');
    assert.match(card.textContent, /Presentación de oferta/, 'debe mostrarse la etiqueta de la fase vigente');
  } finally {
    await view.unmount();
  }
});

test('con una sola fase conocida, no se muestra ningún aviso de continuidad', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Fase Unica');
    assert.doesNotMatch(card.textContent, /fases activas/, 'una sola fase no amerita el aviso de continuidad');
  } finally {
    await view.unmount();
  }
});

test('sin known_phases, no se muestra ningún aviso de continuidad', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Sin Fases');
    assert.doesNotMatch(card.textContent, /fases activas/, 'sin datos de fase no debe inventarse ningún aviso');
  } finally {
    await view.unmount();
  }
});

test('con identidad sucesora ambigua, la tarjeta bloquea la conversión normal y muestra "Identidad por validar"', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Identidad Dudosa');
    assert.match(card.textContent, /Identidad por validar/, 'debe mostrarse el aviso de identidad por validar fuera del flujo normal');
    const convertButton = [...card.querySelectorAll('button')].find(button => button.textContent.includes('Convertir en oportunidad'));
    assert.equal(convertButton, undefined, 'no debe ofrecerse el botón normal de conversión mientras la identidad esté por validar');
  } finally {
    await view.unmount();
  }
});

console.log('tender radar phase continuity UI contract loaded');
