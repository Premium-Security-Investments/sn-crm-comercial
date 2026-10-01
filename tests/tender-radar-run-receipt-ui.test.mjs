// Radar Corte 2 (mitad UI) — recibo de corrida del Radar en TenderRadarView.
// Fija, contra TenderRadarView.tsx + radarUtils.ts + api.ts + types.ts:
//   (1) latest + history se cargan al entrar al Radar y la lista de licitaciones nunca se bloquea
//       si el recibo falla al cargar.
//   (2) resumen humano visible: hora, estado en español, fuentes exitosas/intentadas, registros
//       leídos y candidatos encontrados.
//   (3) partial/failed muestran una alerta clara con el absence_notice exacto del servidor.
//   (4) "Cobertura de fuentes" expandible: estado, páginas/ciclos, registros, candidatos y error
//       saneado por fuente.
//   (5) historial expandible de hasta 10 corridas, newest-first, con hora/estado/X-Y fuentes.
//   (6) nunca se ofrece un control de reintento: sólo texto humano sobre una nueva sincronización
//       autorizada, y nunca se llama a ninguna ruta de reintento.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildSync } from 'esbuild';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const TenderRadarView = await loadReactComponent('src/tenders/TenderRadarView.tsx', 'TenderRadarView');

const radarUtilsBundle = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const radarUtilsUrl = `data:text/javascript;base64,${Buffer.from(radarUtilsBundle.outputFiles[0].contents).toString('base64')}`;
const {
  tenderRadarRunReceiptTimeLabel,
  tenderRadarRunReceiptStatusLabel,
  tenderRadarRunReceiptCoverageRatio,
} = await import(radarUtilsUrl);

function runHistoryLiText(receipt) {
  return `${tenderRadarRunReceiptTimeLabel(receipt.finished_at)} · ${tenderRadarRunReceiptStatusLabel(receipt.status)} · ${tenderRadarRunReceiptCoverageRatio(receipt)} fuentes`;
}

async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

const ABSENCE_NOTICE = 'Corrida parcial o fallida: la ausencia de candidatos de una fuente que no terminó no puede interpretarse como cierre, remoción o descarte. Sólo significa que esa fuente no fue leída (o no terminó de leerse) en esta corrida.';

const RADAR_PAYLOAD = {
  generatedAt: '2026-09-30T13:00:05.000Z', source: 'supabase',
  totals: { all: 1, hacer: 1, revisar: 0, prioridadBaja: 0, highValue: 0, urgent: 0 },
  tenders: [{
    id: 'tender-1', source: 'SECOP II', section: 'hacer', entity: 'Entidad Radar',
    title: 'Servicio de vigilancia', value: 100000000, score: 80, reasons: [], risks: [],
  }],
};

const COMPLETE_RECEIPT = {
  schema_version: 'agt002-radar-run-receipt-v1', run_id: 'run-complete-1',
  started_at: '2026-09-30T12:59:50.000Z', finished_at: '2026-09-30T13:00:05.000Z', status: 'complete',
  sources_attempted: ['SECOP II'], sources_succeeded: ['SECOP II'], sources_failed: [],
  sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 3, records_read: 120, candidates_found: 8, error: null }],
  totals: { pages_read: 3, records_read: 120, candidates_found: 8 },
  fatal_error: null, absence_notice: null,
};

const PARTIAL_RECEIPT = {
  schema_version: 'agt002-radar-run-receipt-v1', run_id: 'run-partial-1',
  started_at: '2026-09-30T12:58:00.000Z', finished_at: '2026-09-30T13:00:05.000Z', status: 'partial',
  sources_attempted: ['SECOP II', 'TVEC'], sources_succeeded: ['SECOP II'], sources_failed: ['TVEC'],
  sources: [
    { name: 'SECOP II', attempted: true, succeeded: true, pages_read: 3, records_read: 120, candidates_found: 8, error: null },
    { name: 'TVEC', attempted: true, succeeded: false, pages_read: 1, records_read: 0, candidates_found: 0, error: 'TVEC respondió 503' },
  ],
  totals: { pages_read: 4, records_read: 120, candidates_found: 8 },
  fatal_error: null, absence_notice: ABSENCE_NOTICE,
};

const FAILED_RECEIPT = {
  schema_version: 'agt002-radar-run-receipt-v1', run_id: 'run-failed-1',
  started_at: '2026-09-29T12:58:00.000Z', finished_at: '2026-09-29T13:00:05.000Z', status: 'failed',
  sources_attempted: ['SECOP II', 'TVEC'], sources_succeeded: [], sources_failed: ['SECOP II', 'TVEC'],
  sources: [
    { name: 'SECOP II', attempted: true, succeeded: false, pages_read: 1, records_read: 0, candidates_found: 0, error: 'SECOP II respondió 500' },
    { name: 'TVEC', attempted: true, succeeded: false, pages_read: 1, records_read: 0, candidates_found: 0, error: 'TVEC respondió 503' },
  ],
  totals: { pages_read: 2, records_read: 0, candidates_found: 0 },
  fatal_error: null, absence_notice: ABSENCE_NOTICE,
};

function makeRequest({ receipt = COMPLETE_RECEIPT, history = [COMPLETE_RECEIPT], receiptsFail = false, calls = [] } = {}) {
  return async path => {
    calls.push(path);
    if (path === '/api/tenders') return RADAR_PAYLOAD;
    if (path === '/api/tender-search-profiles') return [];
    if (path === '/api/tenders/radar-runs/latest') {
      if (receiptsFail) throw new Error('fallo de red simulado');
      return { run_receipt: receipt };
    }
    if (path.startsWith('/api/tenders/radar-runs/history')) {
      if (receiptsFail) throw new Error('fallo de red simulado');
      return { run_receipts: history };
    }
    throw new Error(`ruta no esperada en la prueba: ${path}`);
  };
}

function mountRadar(options) {
  const calls = [];
  const request = makeRequest({ ...options, calls });
  const view = mountWithJsdom(TenderRadarView, {
    data: {}, refresh: async () => {}, request, navigate: () => {}, moduleNavigation: null,
  });
  return { ...view, calls };
}

function expandAll(view) {
  for (const node of view.container.querySelectorAll('details')) node.setAttribute('open', '');
}

test('corrida completa: resumen humano visible, sin alerta de ausencia y sin control de reintento', async () => {
  const view = mountRadar({ receipt: COMPLETE_RECEIPT, history: [COMPLETE_RECEIPT] });
  try {
    await settle(view);
    expandAll(view);
    const text = view.container.textContent;
    assert.match(text, /Completa/, 'debe mostrarse el estado en español');
    assert.match(text, /1\/1/, 'debe mostrarse la razón de fuentes exitosas\\/intentadas');
    assert.match(text, /120/, 'debe mostrarse el total de registros leídos');
    assert.match(text, /8/, 'debe mostrarse el total de candidatos encontrados');
    assert.doesNotMatch(text, new RegExp(ABSENCE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'una corrida completa no debe mostrar la alerta de ausencia');
    assert.equal([...view.container.querySelectorAll('button')].some(button => /reintentar/i.test(button.textContent)), false, 'no debe existir ningún botón de reintento');

    // el radar sigue mostrando la lista de licitaciones con normalidad
    assert.match(text, /Entidad Radar/);
  } finally {
    await view.unmount();
  }
});

for (const [label, receipt] of [['parcial', PARTIAL_RECEIPT], ['fallida', FAILED_RECEIPT]]) {
  test(`corrida ${label}: muestra la alerta de ausencia exacta y el aviso de nueva sincronización autorizada por fuente fallida, sin reintento`, async () => {
    const view = mountRadar({ receipt, history: [receipt] });
    try {
      await settle(view);
      expandAll(view);
      const text = view.container.textContent;
      assert.match(text, new RegExp(ABSENCE_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'debe mostrarse el absence_notice exacto del servidor');
      assert.match(text, /TVEC respondió 503/, 'debe mostrarse el error saneado de la fuente fallida');
      assert.match(text, /nueva sincronización autorizada/i, 'debe mostrarse el aviso humano de que sólo una nueva sincronización autorizada puede reintentarlo');
      assert.equal([...view.container.querySelectorAll('button')].some(button => /reintentar/i.test(button.textContent)), false, 'no debe existir ningún botón de reintento');
      assert.equal(view.calls.some(path => /retry|reintent/i.test(path)), false, 'nunca debe llamarse a ninguna ruta de reintento');
    } finally {
      await view.unmount();
    }
  });
}

test('cobertura de fuentes expandible muestra estado, páginas/ciclos, registros y candidatos por fuente', async () => {
  const view = mountRadar({ receipt: PARTIAL_RECEIPT, history: [PARTIAL_RECEIPT] });
  try {
    await settle(view);
    const sourcesDetails = [...view.container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent.includes('Cobertura de fuentes'));
    assert.ok(sourcesDetails, 'debe existir la sección expandible "Cobertura de fuentes"');
    sourcesDetails.setAttribute('open', '');
    const text = sourcesDetails.textContent;
    assert.match(text, /SECOP II/);
    assert.match(text, /Exitosa/);
    assert.match(text, /TVEC/);
    assert.match(text, /Fallida/);
    assert.match(text, /Páginas\/ciclos/i);
  } finally {
    await view.unmount();
  }
});

test('sin recibo (null) y sin historial: no bloquea la lista de licitaciones', async () => {
  const view = mountRadar({ receipt: null, history: [] });
  try {
    await settle(view);
    const text = view.container.textContent;
    assert.match(text, /Entidad Radar/, 'la lista de licitaciones debe seguir visible');
    assert.match(text, /Aún no hay corridas registradas/i);
  } finally {
    await view.unmount();
  }
});

test('si falla la carga del recibo, la lista de licitaciones no se bloquea', async () => {
  const view = mountRadar({ receiptsFail: true });
  try {
    await settle(view);
    const text = view.container.textContent;
    assert.match(text, /Entidad Radar/, 'la lista de licitaciones debe cargar aunque el recibo falle');
    assert.match(text, /No fue posible cargar el estado de la última corrida/i);
  } finally {
    await view.unmount();
  }
});

test('historial expandible: hasta 10 corridas, newest-first, con hora/estado/X de Y fuentes', async () => {
  const history = Array.from({ length: 11 }, (_, index) => ({
    ...COMPLETE_RECEIPT,
    run_id: `run-${index}`,
    started_at: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
    finished_at: `2026-09-${String(index + 1).padStart(2, '0')}T12:05:00.000Z`,
  }));
  // Deliberadamente desordenado para forzar que la UI misma garantice newest-first.
  const shuffled = [history[3], history[0], history[10], ...history.slice(1, 3), ...history.slice(4, 10)];
  const view = mountRadar({ receipt: COMPLETE_RECEIPT, history: shuffled });
  try {
    await settle(view);
    const historyDetails = [...view.container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent.includes('Historial de corridas'));
    assert.ok(historyDetails, 'debe existir la sección expandible "Historial de corridas"');
    historyDetails.setAttribute('open', '');
    const items = [...historyDetails.querySelectorAll('li')];
    assert.equal(items.length, 10, 'nunca debe mostrarse más de 10 corridas aunque el llamador envíe más');
    const newest = history[10]; // started_at más reciente (día 11)
    const oldest = history[0]; // started_at más antiguo (día 1, run_id "run-0"): debe quedar fuera del tope de 10
    assert.equal(items[0].textContent, runHistoryLiText(newest), 'la corrida más reciente debe listarse primero');
    assert.ok(!items.some(item => item.textContent === runHistoryLiText(oldest)), 'la corrida más antigua debe quedar fuera del tope de 10');
  } finally {
    await view.unmount();
  }
});

console.log('tender radar run receipt UI contract loaded');
