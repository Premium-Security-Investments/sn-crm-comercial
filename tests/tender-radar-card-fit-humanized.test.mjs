// Contrato de presentación del Radar para el badge "Encaje" gobernado por tender-fit-v2.
// Fija, contra TenderRadarView.tsx + radarUtils.ts (tenderFitBadgeLabel / tenderFitReasonDetails),
// el comportamiento de la tarjeta del Radar:
//   (1) la tarjeta no debe mostrar el score legado (`tender.score`) ni el texto "Score N".
//   (2) la tarjeta debe mostrar únicamente la banda humanizada ("Encaje alto" / "Encaje medio" /
//       "Encaje por validar" / "Encaje bajo"), sin ningún score numérico de `fit` ni el slug
//       crudo (`por_validar`) — para las cuatro bandas, e incluso cuando `tender.fit` está
//       ausente (fallback seguro sin score). Tampoco debe exponerse ninguna etiqueta cruda de
//       prioridad (p.ej. `impact_priority` o su número) en el texto visible de la tarjeta.
//   (3) las razones visibles deben venir de `tender.fit.reasons` y `tender.fit.data_gaps`, nunca
//       del `tender.reasons` legado — cubriendo un encaje normal (razón) y una brecha `por_validar`
//       (data gap).
//   (4) como máximo se muestran dos detalles de razón/brecha por tarjeta, ordenados por
//       `impact_priority` ascendente (no por puntaje ni por severidad), y las filas legadas sin
//       `impact_priority` se muestran después de las priorizadas, preservando su orden original.
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

const CAP_REASON_FIRST_DETAIL = 'Razón de mayor prioridad de impacto: plazo insuficiente';
const CAP_REASON_SECOND_DETAIL = 'Razón de segunda prioridad de impacto: servicio ambiguo';
const CAP_REASON_LEGACY_DETAIL = 'Razón legada sin impact_priority, con el mayor puntaje del arreglo: no debe verse en la tarjeta';

const CAP_GAP_FIRST_DETAIL = 'Brecha de mayor prioridad de impacto: plazo';
const CAP_GAP_SECOND_DETAIL = 'Brecha de segunda prioridad de impacto: valor';
const CAP_GAP_LEGACY_DETAIL = 'Brecha legada sin impact_priority: no debe verse en la tarjeta';

const ALTO_ROW = {
  id: 'tender-alfa', source: 'SECOP II', section: 'hacer', entity: 'Entidad Alfa', title: 'Servicio de vigilancia',
  value: 950000000, score: 97, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ALFA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v2', score: 61, band: 'alto', confidence: 'alta', participation_hint: 'directa',
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
    policy_version: 'tender-fit-v2', score: 40, band: 'por_validar', confidence: 'baja', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 40, code: 'servicio_electronico', detail: 'Servicio de CCTV detectado en el objeto contractual', source: 'title' }],
    data_gaps: [{ gap_id: 'valor_no_reportado', field: 'value', severity: 'critical', detail: POR_VALIDAR_GAP_DETAIL, source: 'value' }],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

const NO_FIT_ROW = {
  id: 'tender-gamma', source: 'SECOP II', section: 'hacer', entity: 'Entidad Gamma', title: 'Proceso sin evaluación de encaje',
  value: 10000000, score: 55, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_GAMMA'], risks: [],
  // sin `fit`: simula un registro todavía no evaluado por tender-fit-v2.
};

const MEDIO_ROW = {
  id: 'tender-delta', source: 'SECOP II', section: 'revisar', entity: 'Entidad Delta', title: 'Servicio de aseo',
  value: 120000000, score: 70, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_DELTA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v2', score: 45, band: 'medio', confidence: 'media', participation_hint: 'alianza_probable',
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
    policy_version: 'tender-fit-v2', score: 13, band: 'bajo', confidence: 'alta', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 5, code: 'fuera_de_alcance', detail: BAJO_REASON_DETAIL, source: 'title' }],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

// Tres razones a propósito desordenadas y con puntaje invertido respecto a la prioridad: fija que
// el orden mostrado depende de `impact_priority` ascendente (no del puntaje ni del orden de
// cálculo), y que la razón legada sin `impact_priority` —aunque tenga el mayor puntaje del
// arreglo— se trata como la de menor prioridad y queda oculta.
const REASON_CAP_ROW = {
  id: 'tender-zeta', source: 'SECOP II', section: 'revisar', entity: 'Entidad Zeta', title: 'Servicio de vigilancia con CCTV',
  value: 500000000, score: 90, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ZETA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v2', score: 55, band: 'alto', confidence: 'alta', participation_hint: 'directa',
    reasons: [
      { axis: 'valor', points: 99, code: 'valor_legado_alto_puntaje', detail: CAP_REASON_LEGACY_DETAIL, source: 'value' },
      { axis: 'tiempo', points: 0, code: 'plazo_insuficiente', detail: CAP_REASON_FIRST_DETAIL, source: 'deadline_at', impact_priority: 0 },
      { axis: 'servicio', points: 5, code: 'servicio_ambiguo', detail: CAP_REASON_SECOND_DETAIL, source: 'title', impact_priority: 1 },
    ],
    data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-20T00:00:00.000Z',
  },
};

// Brechas a propósito desordenadas: la de mayor prioridad va al final del arreglo de origen para
// probar que el orden mostrado depende de `impact_priority` ascendente y no del orden de llegada,
// y que la brecha legada sin `impact_priority` queda oculta (va después de las priorizadas).
const GAP_CAP_ROW = {
  id: 'tender-eta', source: 'SECOP II', section: 'hacer', entity: 'Entidad Eta', title: 'Servicio de CCTV sin objeto claro',
  value: 0, score: 33, reasons: ['RAZON_LEGADA_NO_DEBE_VERSE_ETA'], risks: [],
  fit: {
    policy_version: 'tender-fit-v2', score: 35, band: 'por_validar', confidence: 'baja', participation_hint: 'por_definir',
    reasons: [{ axis: 'servicio', points: 35, code: 'servicio_electronico', detail: 'Servicio de CCTV detectado en el objeto contractual', source: 'title' }],
    data_gaps: [
      { gap_id: 'legado', field: 'city', severity: 'critical', detail: CAP_GAP_LEGACY_DETAIL, source: 'city' },
      { gap_id: 'segunda', field: 'value', severity: 'critical', detail: CAP_GAP_SECOND_DETAIL, source: 'value', impact_priority: 1 },
      { gap_id: 'primera', field: 'deadline_at', severity: 'critical', detail: CAP_GAP_FIRST_DETAIL, source: 'deadline_at', impact_priority: 0 },
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

test('se muestran como máximo dos razones, ordenadas por impact_priority ascendente (no por puntaje), y la legada queda oculta', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Zeta');
    const details = fitDetailsText(card);
    assert.match(details, new RegExp(CAP_REASON_FIRST_DETAIL), 'debe mostrarse la razón de mayor prioridad de impacto');
    assert.match(details, new RegExp(CAP_REASON_SECOND_DETAIL), 'debe mostrarse la razón de segunda prioridad de impacto');
    assert.doesNotMatch(card.textContent, new RegExp(CAP_REASON_LEGACY_DETAIL), 'la razón legada sin impact_priority no debe aparecer en la tarjeta, pese a tener el mayor puntaje');
    assert.ok(
      details.indexOf(CAP_REASON_FIRST_DETAIL) < details.indexOf(CAP_REASON_SECOND_DETAIL),
      'la razón de mayor prioridad de impacto (impact_priority menor) debe mostrarse antes que la de segunda prioridad',
    );
    assert.doesNotMatch(details, /impact_priority/i, 'no debe exponerse el nombre crudo del campo impact_priority en el texto visible');
  } finally {
    await view.unmount();
  }
});

test('en por_validar se muestran como máximo dos brechas, ordenadas por impact_priority ascendente, y la legada queda oculta', async () => {
  const view = mountRadar(PAYLOAD);
  try {
    await settle(view);
    const card = findCardByEntity(view, 'Entidad Eta');
    const details = fitDetailsText(card);
    assert.match(details, new RegExp(CAP_GAP_FIRST_DETAIL), 'debe mostrarse la brecha de mayor prioridad de impacto');
    assert.match(details, new RegExp(CAP_GAP_SECOND_DETAIL), 'debe mostrarse la brecha de segunda prioridad de impacto');
    assert.doesNotMatch(card.textContent, new RegExp(CAP_GAP_LEGACY_DETAIL), 'la brecha legada sin impact_priority no debe aparecer en la tarjeta');
    assert.ok(
      details.indexOf(CAP_GAP_FIRST_DETAIL) < details.indexOf(CAP_GAP_SECOND_DETAIL),
      'la brecha de mayor prioridad de impacto debe mostrarse antes que la de segunda prioridad, aunque en el arreglo de origen venga después',
    );
  } finally {
    await view.unmount();
  }
});

console.log('tender radar card fit humanized presentation contract loaded');
