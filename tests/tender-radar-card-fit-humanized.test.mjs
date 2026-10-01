// Contrato de presentación del Radar para el badge "Encaje" gobernado por tender-fit-v1.
// Fija, contra TenderRadarView.tsx + radarUtils.ts (tenderFitBadgeLabel / tenderFitReasonDetails),
// el comportamiento de la tarjeta del Radar:
//   (1) la tarjeta no debe mostrar el score legado (`tender.score`) ni el texto "Score N".
//   (2) la tarjeta debe mostrar únicamente la banda humanizada ("Encaje alto" / "Encaje medio" /
//       "Encaje por validar" / "Encaje bajo"), sin ningún score numérico de `fit` ni el slug
//       crudo (`por_validar`) — para las cuatro bandas, e incluso cuando `tender.fit` está
//       ausente (fallback seguro sin score).
//   (3) las razones visibles deben venir de `tender.fit.reasons` y `tender.fit.data_gaps`, nunca
//       del `tender.reasons` legado — cubriendo un encaje normal (razón) y una brecha `por_validar`
//       (data gap).
//   (4) como máximo se muestran dos detalles de razón/brecha por tarjeta, y en `por_validar` las
//       brechas críticas se muestran antes que las no críticas.
// No se cambian filtros, orden, backend, API, esquema, persistencia, migraciones ni despliegue.
// Esta prueba monta el componente real (esbuild + jsdom), no HTML copiado a mano.
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
  const view = mountWithJsdom(TenderRadarView, {
    data: {}, refresh: async () => {}, request, navigate: () => {}, moduleNavigation: null,
  });
  return view;
}

function badgeTexts(article) {
  return [...article.querySelectorAll('.badge')].map(node => node.textContent.trim());
}

function findCardByEntity(view, entity) {
  const article = [...view.container.querySelectorAll('.tender-card')]
    .find(node => node.textContent.includes(entity));
  if (!article) throw new Error(`no existe una tarjeta para la entidad "${entity}"`);
  return article;
}

// Los detalles de encaje se pintan en un <small class="muted">; los riesgos legados usan otro
// <small class="muted"> aparte ("Riesgos: ..."), así que hay que distinguirlos explícitamente.
function fitDetailsText(article) {
  const node = [...article.querySelectorAll('small.muted')].find(item => !item.textContent.startsWith('Riesgos:'));
  return node ? node.textContent.trim() : '';
}

const ALTO_REASON_DETAIL = 'Servicio de vigilancia física detectado en el objeto contractual';
const POR_VALIDAR_GAP_DETAIL = 'No se reportó el valor del contrato; el encaje queda pendiente de validar';
const MEDIO_REASON_DETAIL = 'Servicio de aseo detectado con evidencia parcial en el objeto contractual';
const BAJO_REASON_DETAIL = 'Objeto contractual fuera del alcance habitual de la operación';
const NO_FIT_FALLBACK_DETAIL = 'Sin datos de encaje: no fue posible calcular el fit del proceso';

const CAP_REASON_HIGH_DETAIL = 'Razón de mayor puntaje: control de acceso perimetral';
const CAP_REASON_MID_DETAIL = 'Razón de puntaje medio: monitoreo CCTV adicional';
const CAP_REASON_LOW_DETAIL = 'Razón de menor puntaje: no debe verse en la tarjeta';

const CAP_GAP_CRITICAL_DETAIL = 'Brecha crítica: no se reportó el objeto contractual';
const CAP_GAP_NONCRITICAL_FIRST_DETAIL = 'Brecha no crítica listada primero en el arreglo de origen';
const CAP_GAP_NONCRITICAL_THIRD_DETAIL = 'Brecha no crítica que no debe verse en la tarjeta';

const ALTO_ROW = {
  id: 'tender-alfa', source: 'SECOP II', section: 'hacer', entity: 'Entidad Alfa', title: 'Servicio de vigilancia',
  value: 950000000, score: 97, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ALFA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 61, band: 'alto', confidence: 'alta', participation_hint: 'directa',
    reasons: [{ axis: 'servicio', points: 50, code: 'servicio_fisico', detail: ALTO_REASON_DETAIL, source: 'title' }],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

const POR_VALIDAR_ROW = {
  id: 'tender-beta', source: 'SECOP II', section: 'revisar', entity: 'Entidad Beta', title: 'Servicio de CCTV',
  value: 0, score: 88, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_BETA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 40, band: 'por_validar', confidence: 'baja', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 40, code: 'servicio_electronico', detail: 'Servicio de CCTV detectado en el objeto contractual', source: 'title' }],
    data_gaps: [{ gap_id: 'valor_no_reportado', field: 'value', severity: 'critical', detail: POR_VALIDAR_GAP_DETAIL, source: 'value' }],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

const NO_FIT_ROW = {
  id: 'tender-gamma', source: 'SECOP II', section: 'hacer', entity: 'Entidad Gamma', title: 'Proceso sin evaluación de encaje',
  value: 10000000, score: 55, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_GAMMA'], risks: [],
  // sin `fit`: simula un registro todavía no evaluado por tender-fit-v1.
};

const MEDIO_ROW = {
  id: 'tender-delta', source: 'SECOP II', section: 'revisar', entity: 'Entidad Delta', title: 'Servicio de aseo',
  value: 120000000, score: 70, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_DELTA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 45, band: 'medio', confidence: 'media', participation_hint: 'alianza_probable',
    reasons: [{ axis: 'servicio', points: 30, code: 'servicio_aseo', detail: MEDIO_REASON_DETAIL, source: 'title' }],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

const BAJO_ROW = {
  id: 'tender-epsilon', source: 'SECOP II', section: 'hacer', entity: 'Entidad Epsilon', title: 'Suministro de papelería',
  value: 8000000, score: 20, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_EPSILON'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 13, band: 'bajo', confidence: 'alta', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 5, code: 'fuera_de_alcance', detail: BAJO_REASON_DETAIL, source: 'title' }],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

// Tres razones a propósito desordenadas por puntaje: fija que sólo se muestran las dos de mayor
// puntaje (ordenadas por puntaje descendente) y que la de menor puntaje queda oculta.
const REASON_CAP_ROW = {
  id: 'tender-zeta', source: 'SECOP II', section: 'revisar', entity: 'Entidad Zeta', title: 'Servicio de vigilancia con CCTV',
  value: 500000000, score: 90, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ZETA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 55, band: 'alto', confidence: 'alta', participation_hint: 'directa',
    reasons: [
      { axis: 'servicio', points: 30, code: 'servicio_cctv', detail: CAP_REASON_MID_DETAIL, source: 'title' },
      { axis: 'servicio', points: 50, code: 'servicio_perimetral', detail: CAP_REASON_HIGH_DETAIL, source: 'title' },
      { axis: 'servicio', points: 10, code: 'servicio_menor', detail: CAP_REASON_LOW_DETAIL, source: 'title' },
    ],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

// Brechas a propósito desordenadas: la crítica va en el medio del arreglo de origen para probar
// que el orden mostrado depende de la severidad y no del orden de llegada, y que sólo se
// muestran dos (la tercera, no crítica, queda oculta).
const GAP_CAP_ROW = {
  id: 'tender-eta', source: 'SECOP II', section: 'hacer', entity: 'Entidad Eta', title: 'Servicio de CCTV sin objeto claro',
  value: 0, score: 33, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ETA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v1', score: 35, band: 'por_validar', confidence: 'baja', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 35, code: 'servicio_electronico', detail: 'Servicio de CCTV detectado en el objeto contractual', source: 'title' }],
    data_gaps: [
      { gap_id: 'no_critica_primero', field: 'city', severity: 'noncritical', detail: CAP_GAP_NONCRITICAL_FIRST_DETAIL, source: 'city' },
      { gap_id: 'critica', field: 'object', severity: 'critical', detail: CAP_GAP_CRITICAL_DETAIL, source: 'object' },
      { gap_id: 'no_critica_tercera', field: 'value', severity: 'noncritical', detail: CAP_GAP_NONCRITICAL_THIRD_DETAIL, source: 'value' },
    ],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

const PAYLOAD = {
  generatedAt: '2026-09-20T00:00:00.000Z', source: 'supabase',
  totals: { all: 7, hacer: 4, revisar: 3, prioridadBaja: 0, highValue: 0, urgent: 0 },
  tenders: [ALTO_ROW, POR_VALIDAR_ROW, NO_FIT_ROW, MEDIO_ROW, BAJO_ROW, REASON_CAP_ROW, GAP_CAP_ROW],
};

test('la tarjeta no muestra el score legado ni el texto "Score N"', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    for (const entity of ['Entidad Alfa', 'Entidad Beta']) {
      const text = findCardByEntity(view, entity).textContent;
      assert.doesNotMatch(text, /\bScore\b/i, `${entity}: no debe aparecer la palabra "Score"`);
    }
    assert.doesNotMatch(findCardByEntity(view, 'Entidad Alfa').textContent, /\b97\b/, 'no debe mostrarse el score legado 97 (Entidad Alfa)');
    assert.doesNotMatch(findCardByEntity(view, 'Entidad Beta').textContent, /\b88\b/, 'no debe mostrarse el score legado 88 (Entidad Beta)');
  } finally {
    await view.unmount();
  }
});

test('la tarjeta muestra únicamente el encaje humanizado, sin ningún score numérico de fit, para las cuatro bandas', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const altoCard = findCardByEntity(view, 'Entidad Alfa');
    const porValidarCard = findCardByEntity(view, 'Entidad Beta');
    const medioCard = findCardByEntity(view, 'Entidad Delta');
    const bajoCard = findCardByEntity(view, 'Entidad Epsilon');

    assert.ok(badgeTexts(altoCard).includes('Encaje alto'), 'debe existir un badge con el texto exacto "Encaje alto"');
    assert.ok(badgeTexts(porValidarCard).includes('Encaje por validar'), 'debe existir un badge con el texto exacto "Encaje por validar"');
    assert.ok(badgeTexts(medioCard).includes('Encaje medio'), 'debe existir un badge con el texto exacto "Encaje medio"');
    assert.ok(badgeTexts(bajoCard).includes('Encaje bajo'), 'debe existir un badge con el texto exacto "Encaje bajo"');

    assert.doesNotMatch(altoCard.textContent, /\b61\b/, 'no debe mostrarse el score numérico de fit (61, Entidad Alfa)');
    assert.doesNotMatch(porValidarCard.textContent, /\b40\b/, 'no debe mostrarse el score numérico de fit (40, Entidad Beta)');
    assert.doesNotMatch(medioCard.textContent, /\b45\b/, 'no debe mostrarse el score numérico de fit (45, Entidad Delta)');
    assert.doesNotMatch(bajoCard.textContent, /\b13\b/, 'no debe mostrarse el score numérico de fit (13, Entidad Epsilon)');
    assert.doesNotMatch(porValidarCard.textContent, /por_validar/, 'la banda no debe mostrarse con el slug crudo "por_validar"');
  } finally {
    await view.unmount();
  }
});

test('la tarjeta con tender.fit ausente muestra "Encaje por validar" y la explicación segura de fallback, sin score numérico', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const noFitCard = findCardByEntity(view, 'Entidad Gamma');
    assert.ok(badgeTexts(noFitCard).includes('Encaje por validar'), 'sin fit debe humanizarse como "Encaje por validar"');
    assert.equal(fitDetailsText(noFitCard), NO_FIT_FALLBACK_DETAIL, 'debe mostrarse el texto exacto de fallback seguro');
    assert.doesNotMatch(noFitCard.textContent, /\b55\b/, 'no debe mostrarse el score legado (55, Entidad Gamma)');
    assert.doesNotMatch(noFitCard.textContent, /\bScore\b/i, 'no debe aparecer la palabra "Score"');
    assert.doesNotMatch(noFitCard.textContent, /por_validar/, 'la banda no debe mostrarse con el slug crudo "por_validar"');
  } finally {
    await view.unmount();
  }
});

test('las razones visibles vienen de fit.reasons/data_gaps, nunca del reasons legado', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const altoCard = findCardByEntity(view, 'Entidad Alfa');
    const porValidarCard = findCardByEntity(view, 'Entidad Beta');
    assert.doesNotMatch(altoCard.textContent, /RAZON_LEGADA_NO_DEBE_VERSE_ALFA/, 'no debe mostrarse el reasons legado de Entidad Alfa');
    assert.match(altoCard.textContent, new RegExp(ALTO_REASON_DETAIL), 'debe mostrarse la razón de fit.reasons para un encaje normal (alto)');
    assert.doesNotMatch(porValidarCard.textContent, /RAZON_LEGADA_NO_DEBE_VERSE_BETA/, 'no debe mostrarse el reasons legado de Entidad Beta');
    assert.match(porValidarCard.textContent, new RegExp(POR_VALIDAR_GAP_DETAIL), 'debe mostrarse la brecha de fit.data_gaps para por_validar');
  } finally {
    await view.unmount();
  }
});

test('se muestran como máximo dos razones, ordenadas por puntaje descendente, y la tercera queda oculta', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Zeta');
    const details = fitDetailsText(card);
    assert.match(details, new RegExp(CAP_REASON_HIGH_DETAIL), 'debe mostrarse la razón de mayor puntaje');
    assert.match(details, new RegExp(CAP_REASON_MID_DETAIL), 'debe mostrarse la razón de puntaje medio');
    assert.doesNotMatch(card.textContent, new RegExp(CAP_REASON_LOW_DETAIL), 'la tercera razón (menor puntaje) no debe aparecer en la tarjeta');
    assert.ok(
      details.indexOf(CAP_REASON_HIGH_DETAIL) < details.indexOf(CAP_REASON_MID_DETAIL),
      'la razón de mayor puntaje debe mostrarse antes que la de puntaje medio',
    );
  } finally {
    await view.unmount();
  }
});

test('en por_validar se muestran como máximo dos brechas, las críticas antes que las no críticas, y la tercera queda oculta', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Eta');
    const details = fitDetailsText(card);
    assert.match(details, new RegExp(CAP_GAP_CRITICAL_DETAIL), 'debe mostrarse la brecha crítica');
    assert.match(details, new RegExp(CAP_GAP_NONCRITICAL_FIRST_DETAIL), 'debe mostrarse la primera brecha no crítica');
    assert.doesNotMatch(card.textContent, new RegExp(CAP_GAP_NONCRITICAL_THIRD_DETAIL), 'la tercera brecha (no crítica) no debe aparecer en la tarjeta');
    assert.ok(
      details.indexOf(CAP_GAP_CRITICAL_DETAIL) < details.indexOf(CAP_GAP_NONCRITICAL_FIRST_DETAIL),
      'la brecha crítica debe mostrarse antes que la no crítica, aunque en el arreglo de origen venga después',
    );
  } finally {
    await view.unmount();
  }
});

console.log('tender radar card fit humanized presentation contract loaded');
