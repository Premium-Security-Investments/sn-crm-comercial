// Radar Corte 3 (mitad UI) — "Cambios desde la corrida anterior" en TenderRadarView.
//
// RED deliberado: TenderRadarView todavía no carga /api/tenders/radar-runs/delta ni renderiza esta
// sección. Fija, contra TenderRadarView.tsx + api.ts + types.ts:
//   (1) el delta se carga automáticamente al entrar al Radar, sin bloquear la lista si falla;
//   (2) la sección "Cambios desde la corrida anterior" aparece después del estado de la última
//       corrida y antes de la lista de licitaciones;
//   (3) cifras seleccionables por categoría con conteos reales (new/deadline_changed/fit_changed/
//       expired) vía `[data-radar-delta-category="<categoría>"]`, más "Mostrar todos" vía
//       `[data-radar-delta-show-all]`;
//   (4) elegir una categoría aplica una vista temporal que filtra las tarjetas; "Mostrar todos" la
//       limpia;
//   (5) las tarjetas afectadas muestran su etiqueta discreta exacta (Nuevo/Cierre modificado/Encaje
//       actualizado/Vencido desde la última corrida); los eventos de fuente (recuperada/degradada)
//       quedan sólo en el resumen, nunca como etiqueta de tarjeta;
//   (6) sin corrida anterior persistida (baseline_available:false) no se ofrece ninguna categoría
//       seleccionable y la lista sigue visible con normalidad.
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const TenderRadarView = await loadReactComponent('src/tenders/TenderRadarView.tsx', 'TenderRadarView');

async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

const RADAR_PAYLOAD = {
  generatedAt: '2026-10-01T08:00:00.000Z', source: 'supabase',
  totals: { all: 5, hacer: 5, revisar: 0, prioridadBaja: 0, highValue: 0, urgent: 0 },
  tenders: [
    { id: 'tender-new', stable_key: 'tender-new', source: 'SECOP II', section: 'hacer', entity: 'Entidad Nueva', title: 'Obra pública nueva', value: 1, score: 1, reasons: [], risks: [] },
    { id: 'tender-deadline', stable_key: 'tender-deadline', source: 'SECOP II', section: 'hacer', entity: 'Entidad Cierre', title: 'Servicio con cierre movido', value: 1, score: 1, reasons: [], risks: [] },
    { id: 'tender-fit', stable_key: 'tender-fit', source: 'SECOP II', section: 'hacer', entity: 'Entidad Encaje', title: 'Servicio con encaje recalculado', value: 1, score: 1, reasons: [], risks: [] },
    { id: 'tender-expired', stable_key: 'tender-expired', source: 'SECOP II', section: 'hacer', entity: 'Entidad Vencida', title: 'Proceso que venció', value: 1, score: 1, reasons: [], risks: [] },
    { id: 'tender-plain', stable_key: 'tender-plain', source: 'SECOP II', section: 'hacer', entity: 'Entidad Sin Cambios', title: 'Proceso sin novedades', value: 1, score: 1, reasons: [], risks: [] },
  ],
};

const RUN_DELTA = {
  run: { run_id: 'run-2', finished_at: '2026-10-01T08:00:00.000Z', status: 'complete' },
  previous_run: { run_id: 'run-1', finished_at: '2026-09-30T08:00:00.000Z', status: 'complete' },
  baseline_available: true,
  counts: { new: 1, deadline_changed: 1, fit_changed: 1, expired: 1, source_recovered: 1, source_degraded: 1 },
  changes: [
    { category: 'new', stable_key: 'tender-new', source: 'SECOP II', title: 'Obra pública nueva', label: 'Nuevo' },
    { category: 'deadline_changed', stable_key: 'tender-deadline', source: 'SECOP II', before: '2026-10-10', after: '2026-10-20', label: 'Cierre modificado' },
    { category: 'fit_changed', stable_key: 'tender-fit', source: 'SECOP II', before: 'bajo', after: 'alto', reason: 'coincide objeto', label: 'Encaje actualizado' },
    { category: 'expired', stable_key: 'tender-expired', source: 'SECOP II', deadline: '2026-09-25', still_listed: true, label: 'Vencido desde la última corrida' },
    { category: 'source_recovered', source: 'SECOP II', label: 'Fuente recuperada' },
    { category: 'source_degraded', source: 'TVEC', label: 'Fuente degradada' },
  ],
};

const NO_BASELINE_DELTA = {
  run: RUN_DELTA.run, previous_run: null, baseline_available: false,
  counts: { new: 0, deadline_changed: 0, fit_changed: 0, expired: 0, source_recovered: 0, source_degraded: 0 },
  changes: [],
};

function makeRequest({ delta = RUN_DELTA, deltaFails = false, deltaFailsFromCall = null, calls = [] } = {}) {
  let deltaCallCount = 0;
  return async path => {
    calls.push(path);
    if (path === '/api/tenders') return RADAR_PAYLOAD;
    if (path === '/api/tender-search-profiles') return [];
    if (path === '/api/tenders/radar-runs/latest') return { run_receipt: null };
    if (path.startsWith('/api/tenders/radar-runs/history')) return { run_receipts: [] };
    if (path === '/api/tender-refresh') return RADAR_PAYLOAD;
    if (path === '/api/tenders/radar-runs/delta') {
      deltaCallCount += 1;
      if (deltaFails || (deltaFailsFromCall !== null && deltaCallCount >= deltaFailsFromCall)) throw new Error('fallo de red simulado');
      return { delta };
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

test('el resumen de cambios se carga automáticamente al entrar al Radar', async () => {
  const view = mountRadar();
  try {
    await settle(view);
    assert.ok(view.calls.includes('/api/tenders/radar-runs/delta'), 'debe solicitarse el delta de la corrida al cargar el Radar');
  } finally {
    await view.unmount();
  }
});

test('"Cambios desde la corrida anterior" aparece después del estado de corrida y antes de la lista', async () => {
  const view = mountRadar();
  try {
    await settle(view);
    const html = view.container.innerHTML;
    const receiptIdx = html.indexOf('Estado de la última corrida');
    const deltaIdx = html.indexOf('Cambios desde la corrida anterior');
    const listIdx = html.indexOf('tender-cards');
    assert.notEqual(receiptIdx, -1, 'debe existir el bloque de estado de la última corrida');
    assert.notEqual(deltaIdx, -1, 'debe existir la sección "Cambios desde la corrida anterior"');
    assert.notEqual(listIdx, -1, 'debe existir la lista de licitaciones');
    assert.ok(receiptIdx < deltaIdx, 'el resumen de cambios debe ir después del estado de la última corrida');
    assert.ok(deltaIdx < listIdx, 'el resumen de cambios debe ir antes de la lista de licitaciones');
  } finally {
    await view.unmount();
  }
});

test('muestra cifras seleccionables por categoría con conteos reales y el control "Mostrar todos"', async () => {
  const view = mountRadar();
  try {
    await settle(view);
    for (const category of ['new', 'deadline_changed', 'fit_changed', 'expired']) {
      const button = view.container.querySelector(`[data-radar-delta-category="${category}"]`);
      assert.ok(button, `debe existir un control seleccionable para la categoría "${category}"`);
      assert.match(button.textContent, /1/, `el control de "${category}" debe mostrar su conteo real`);
    }
    const showAll = view.container.querySelector('[data-radar-delta-show-all]');
    assert.ok(showAll, 'debe existir el control "Mostrar todos"');
    assert.match(showAll.textContent, /Mostrar todos/i);
  } finally {
    await view.unmount();
  }
});

test('seleccionar una categoría aplica una vista temporal que filtra las tarjetas; "Mostrar todos" la limpia', async () => {
  const view = mountRadar();
  try {
    await settle(view);
    const fullText = view.container.textContent;
    assert.match(fullText, /Entidad Nueva/);
    assert.match(fullText, /Entidad Cierre/);
    assert.match(fullText, /Entidad Sin Cambios/);

    await view.click('[data-radar-delta-category="new"]');
    await settle(view);
    const filteredText = view.container.textContent;
    assert.match(filteredText, /Entidad Nueva/, 'el proceso nuevo debe seguir visible bajo la vista temporal "Nuevo"');
    assert.doesNotMatch(filteredText, /Entidad Cierre/, 'la vista temporal "Nuevo" debe excluir procesos de otras categorías');
    assert.doesNotMatch(filteredText, /Entidad Sin Cambios/, 'un proceso sin cambios no pertenece a ninguna vista temporal');

    await view.click('[data-radar-delta-show-all]');
    await settle(view);
    const restoredText = view.container.textContent;
    assert.match(restoredText, /Entidad Cierre/, '"Mostrar todos" debe limpiar la vista temporal');
    assert.match(restoredText, /Entidad Sin Cambios/);
  } finally {
    await view.unmount();
  }
});

test('las tarjetas afectadas muestran su etiqueta discreta exacta; los eventos de fuente quedan sólo en el resumen', async () => {
  const view = mountRadar();
  try {
    await settle(view);
    const newCard = view.container.querySelector('#tender-tender-new');
    const deadlineCard = view.container.querySelector('#tender-tender-deadline');
    const fitCard = view.container.querySelector('#tender-tender-fit');
    const expiredCard = view.container.querySelector('#tender-tender-expired');
    const plainCard = view.container.querySelector('#tender-tender-plain');
    assert.ok(newCard && deadlineCard && fitCard && expiredCard && plainCard, 'las cinco tarjetas deben estar presentes');

    assert.match(newCard.textContent, /Nuevo/);
    assert.match(deadlineCard.textContent, /Cierre modificado/);
    assert.match(fitCard.textContent, /Encaje actualizado/);
    assert.match(expiredCard.textContent, /Vencido desde la última corrida/);
    assert.doesNotMatch(plainCard.textContent, /Nuevo|Cierre modificado|Encaje actualizado|Vencido desde la última corrida/, 'un proceso sin cambios no debe llevar ninguna etiqueta de delta');

    for (const card of [newCard, deadlineCard, fitCard, expiredCard, plainCard]) {
      assert.doesNotMatch(card.textContent, /Fuente recuperada|Fuente degradada/, 'los eventos de fuente nunca deben aparecer como etiqueta de una tarjeta');
    }
    assert.match(view.container.textContent, /Fuente recuperada/, 'el evento de fuente recuperada debe aparecer en el resumen');
    assert.match(view.container.textContent, /Fuente degradada/, 'el evento de fuente degradada debe aparecer en el resumen');
  } finally {
    await view.unmount();
  }
});

test('sin corrida anterior persistida: no se ofrece ninguna categoría seleccionable y la lista no se bloquea', async () => {
  const view = mountRadar({ delta: NO_BASELINE_DELTA });
  try {
    await settle(view);
    const text = view.container.textContent;
    assert.match(text, /Entidad Nueva/, 'la lista de licitaciones debe seguir visible');
    const buttons = [...view.container.querySelectorAll('[data-radar-delta-category]')];
    assert.equal(buttons.length, 0, 'sin corrida anterior persistida no debe ofrecerse ninguna categoría seleccionable');
  } finally {
    await view.unmount();
  }
});

test('sin ninguna corrida persistida todavía (delta null): no aparece ninguna categoría ni etiqueta falsa, la lista sigue visible', async () => {
  const view = mountRadar({ delta: null });
  try {
    await settle(view);
    const text = view.container.textContent;
    assert.match(text, /Entidad Nueva/, 'la lista de licitaciones debe seguir visible aunque no exista ninguna corrida persistida');
    const buttons = [...view.container.querySelectorAll('[data-radar-delta-category]')];
    assert.equal(buttons.length, 0, 'con delta null no debe ofrecerse ninguna categoría seleccionable');
    for (const label of ['Nuevo', 'Cierre modificado', 'Encaje actualizado', 'Vencido desde la última corrida', 'Fuente recuperada', 'Fuente degradada']) {
      assert.equal(text.includes(label), false, `con delta null no debe aparecer la etiqueta "${label}" sobre ningún proceso`);
    }
  } finally {
    await view.unmount();
  }
});

test('si falla la carga del resumen de cambios, la lista de licitaciones no se bloquea', async () => {
  const view = mountRadar({ deltaFails: true });
  try {
    await settle(view);
    const text = view.container.textContent;
    assert.match(text, /Entidad Nueva/, 'la lista debe cargar aunque el resumen de cambios falle');
  } finally {
    await view.unmount();
  }
});

test('si la resincronización falla al recargar el delta: se limpia la vista temporal seleccionada, la lista completa sigue visible y aparece un estado de error explícito', async () => {
  const view = mountRadar({ deltaFailsFromCall: 2 });
  try {
    await settle(view);

    await view.click('[data-radar-delta-category="new"]');
    await settle(view);
    const filteredText = view.container.textContent;
    assert.match(filteredText, /Entidad Nueva/, 'la vista temporal "Nuevo" debe quedar activa antes de resincronizar');
    assert.doesNotMatch(filteredText, /Entidad Cierre/, 'la vista temporal "Nuevo" debe excluir otras categorías antes de resincronizar');

    await view.click('.row-actions button:last-child');
    await settle(view);

    const text = view.container.textContent;
    assert.match(text, /Entidad Nueva/, 'la lista completa debe seguir visible tras el fallo de la resincronización');
    assert.match(text, /Entidad Cierre/, 'la selección temporal debe limpiarse y volver a mostrar todas las categorías');
    assert.match(text, /Entidad Sin Cambios/, 'la selección temporal debe limpiarse y volver a mostrar los procesos sin cambios');

    const activeCategoryButtons = view.container.querySelectorAll('[data-radar-delta-category].badge-active');
    assert.equal(activeCategoryButtons.length, 0, 'ninguna categoría debe seguir marcada como seleccionada tras el fallo de la resincronización');

    assert.doesNotMatch(text, /Aún no hay datos de cambios entre corridas\./, 'el fallo de la resincronización no debe mostrarse como si nunca hubiera existido un delta');
    const deltaSection = view.container.querySelector('.tender-radar-run-delta');
    assert.ok(deltaSection, 'debe existir la sección de cambios entre corridas');
    assert.match(deltaSection.textContent, /error|no fue posible|fallo/i, 'debe mostrarse un estado de error explícito sobre el fallo al recargar el delta');
  } finally {
    await view.unmount();
  }
});

console.log('tender radar run delta UI contract (Corte 3) loaded — expected to fail until the summary section exists');
