// RED — contrato aprobado de producto para el rediseño compacto de "Oportunidades" (2026-09-29).
// Fija, contra la implementación actual, el comportamiento que todavía falta:
//   (1) el control segmentado compacto debe respetar 44px mínimos de alto táctil (hoy declara 40px).
//   (2) la vista inicial debe ser "Por decidir", no "Todas".
//   (3) "Todas" agrupa Por decidir → En curso → Cerradas (sin descartar filas), y cada fila
//       muestra su etapa, con "Cerrada" en menor énfasis (tono neutral) para las cerradas.
//   (4) la tarjeta compacta debe mostrar cierre + días restantes, encaje determinístico junto a
//       la prioridad, y la siguiente acción con su responsable y vencimiento.
//   (5) razones y riesgos del Radar se conservan; el score legado sólo aparece marcado como
//       trazabilidad y nunca sustituye al encaje/prioridad que gobiernan la decisión.
//   (6) el detalle extenso (recomendación, checklist, pendientes humanos, SharePoint) deja de
//       dominar la lista: vive sólo en el expediente ("Abrir expediente").
// Migración 088 y vocabulario RPC quedan intactos: todo lo de abajo es agregación/presentación en
// cliente. Estas pruebas montan el componente real (esbuild + jsdom), no HTML copiado a mano.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { act } from 'react';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const compact = value => value.replace(/\s+/g, '');
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function loadModule(relativePath) {
  const bundle = buildSync({
    entryPoints: [new URL(relativePath, import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
}

const { formatDateOnly } = await loadModule('../src/dateOnly.ts');

const opportunitiesViewSource = read('src/tenders/TenderOpportunitiesView.tsx');
const styles = compact(read('src/styles.css'));

const TenderOpportunitiesView = await loadReactComponent(
  'src/tenders/TenderOpportunitiesView.tsx',
  'TenderOpportunitiesView',
);

function dateOnlyDaysFromToday(days) {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

function makeOpportunitiesRequest(rows) {
  const calls = [];
  const fn = async (path, options) => {
    calls.push(path);
    if (path.startsWith('/api/tender-opportunities')) return rows;
    throw new Error(`ruta no esperada en la prueba: ${options?.method || 'GET'} ${path}`);
  };
  fn.calls = calls;
  return fn;
}

async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

function metadataMap(article) {
  const map = {};
  article.querySelectorAll('dl > div').forEach(div => {
    const dt = div.querySelector('dt');
    const dd = div.querySelector('dd');
    if (dt && dd) map[dt.textContent.trim()] = dd;
  });
  return map;
}

async function clickByText(view, text) {
  const button = [...view.container.querySelectorAll('.opportunity-primary-filters button')]
    .find(candidate => candidate.textContent.trim() === text);
  if (!button) throw new Error(`no existe un botón de filtro con texto "${text}"`);
  await act(async () => { button.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true })); });
}

function mountOpportunities(rows) {
  const request = makeOpportunitiesRequest(rows);
  const view = mountWithJsdom(TenderOpportunitiesView, { request, navigate: () => {}, moduleNavigation: null });
  return { view, request };
}

// --- (1) 44px táctiles mínimos en el control segmentado compacto ---

test('1 — los botones del control segmentado compacto respetan 44px mínimos de alto táctil', () => {
  assert.match(
    styles,
    /\.opportunity-primary-filtersbutton\{[^}]*min-height:44px/,
    'los botones de Todas/Por decidir/En curso deben declarar min-height:44px (hoy declaran 40px)',
  );
});

// --- (1b) el control es realmente segmentado: ancho intrínseco, alineado a la izquierda ---

test('1b — el control segmentado tiene ancho intrínseco y se alinea a la izquierda, no a todo el ancho', () => {
  assert.match(
    styles,
    /\.opportunity-primary-filters\{[^}]*width:max-content/,
    'el contenedor debe declarar width:max-content para no ocupar todo el ancho disponible',
  );
  assert.match(
    styles,
    /\.opportunity-primary-filters\{[^}]*max-width:100%/,
    'el contenedor debe declarar max-width:100% para no desbordar en pantallas angostas',
  );
  assert.match(
    styles,
    /\.opportunity-primary-filters\{[^}]*align-self:flex-start/,
    'el contenedor debe declarar align-self:flex-start para alinearse a la izquierda',
  );
  assert.doesNotMatch(
    styles,
    /\.opportunity-primary-filtersbutton\{[^}]*flex:1/,
    'los botones del segmentado no deben declarar flex:1 (no deben repartirse el ancho del contenedor)',
  );
});

test('1c — el control segmentado no vuelve a expandirse a todo el ancho en móvil', () => {
  assert.doesNotMatch(
    styles,
    /\.opportunity-primary-filters\{[^}]*(?<!-)width:100%/,
    'no debe existir la regla obsoleta .opportunity-primary-filters{width:100%} (max-width:100% sí está permitido)',
  );
  assert.doesNotMatch(
    styles,
    /\.opportunity-primary-filtersbutton\{[^}]*flex:11auto/,
    'no debe existir la regla obsoleta .opportunity-primary-filtersbutton{flex:1 1 auto}',
  );
});

// --- (2) vista inicial "Por decidir" ---

test('2 — la vista inicial es "Por decidir", no "Todas"', async () => {
  assert.match(
    opportunitiesViewSource,
    /useState<TenderOpportunityPrimaryFilter>\('por_decidir'\)/,
    'el estado inicial del filtro primario debe ser por_decidir',
  );
  const { view, request } = mountOpportunities([]);
  try {
    await settle(view);
    assert.equal(request.calls.length, 1, 'debe hacer exactamente una carga inicial');
    assert.match(request.calls[0], /filter=por_decidir/, 'la primera carga debe pedir el filtro Por decidir, no Todas');

    const buttons = [...view.container.querySelectorAll('.opportunity-primary-filters button')];
    const pressed = buttons.filter(button => button.getAttribute('aria-pressed') === 'true').map(button => button.textContent.trim());
    assert.deepEqual(pressed, ['Por decidir'], 'sólo "Por decidir" debe iniciar presionado');
  } finally {
    await view.unmount();
  }
});

// --- (3) "Todas" agrupa Por decidir → En curso → Cerradas; etapa visible; Cerrada en menor énfasis ---

const GROUPING_ROWS = [
  { opportunity_id: 'closed-1', entity: 'Entidad Cerrada Uno', title: 'Proceso cerrado uno', decision: 'no_go', tender_offer_status: 'cerrada_no_go' },
  { opportunity_id: 'pending-1', entity: 'Entidad Pendiente Uno', title: 'Proceso pendiente uno', decision: null, tender_offer_status: 'pendiente_decision' },
  { opportunity_id: 'active-1', entity: 'Entidad Activa Uno', title: 'Proceso activo uno', decision: 'go', tender_offer_status: 'en_preparacion' },
  { opportunity_id: 'closed-2', entity: 'Entidad Cerrada Dos', title: 'Proceso cerrado dos', decision: 'go', tender_offer_status: 'adjudicada' },
  { opportunity_id: 'pending-2', entity: 'Entidad Pendiente Dos', title: 'Proceso pendiente dos', decision: null, tender_offer_status: 'pendiente_decision' },
];

test('3 — "Todas" agrupa Por decidir, luego En curso, luego Cerradas, sin descartar filas', async () => {
  const { view } = mountOpportunities(GROUPING_ROWS);
  try {
    await settle(view);
    await clickByText(view, 'Todas');
    await settle(view);
    const entities = [...view.container.querySelectorAll('.tracking-row h3')].map(node => node.textContent.trim());
    assert.deepEqual(entities, [
      'Entidad Pendiente Uno', 'Entidad Pendiente Dos',
      'Entidad Activa Uno',
      'Entidad Cerrada Uno', 'Entidad Cerrada Dos',
    ], 'el orden visual debe agrupar por_decidir, en_curso y cerradas, preservando el orden relativo dentro de cada grupo');
  } finally {
    await view.unmount();
  }
});

test('3 — cada fila muestra su etapa; las cerradas llevan la etiqueta "Cerrada" en menor énfasis', async () => {
  const { view } = mountOpportunities(GROUPING_ROWS);
  try {
    await settle(view);
    await clickByText(view, 'Todas');
    await settle(view);
    const articles = [...view.container.querySelectorAll('.tracking-row')];
    const byEntity = Object.fromEntries(articles.map(article => [article.querySelector('h3').textContent.trim(), article]));

    const expectedStage = {
      'Entidad Pendiente Uno': 'Por decidir',
      'Entidad Pendiente Dos': 'Por decidir',
      'Entidad Activa Uno': 'En curso',
      'Entidad Cerrada Uno': 'Cerrada',
      'Entidad Cerrada Dos': 'Cerrada',
    };
    for (const [entity, stageLabel] of Object.entries(expectedStage)) {
      const map = metadataMap(byEntity[entity]);
      assert.ok(map['Etapa'], `${entity} debe mostrar un dato de Etapa`);
      assert.equal(map['Etapa'].textContent.trim(), stageLabel, `${entity} debe mostrar la etapa ${stageLabel}`);
    }
    for (const entity of ['Entidad Cerrada Uno', 'Entidad Cerrada Dos']) {
      const badge = metadataMap(byEntity[entity])['Etapa'].querySelector('.badge');
      assert.ok(badge, `${entity} debe mostrar su etapa como badge`);
      assert.equal(badge.className, 'badge badge-neutral', `${entity} debe mostrar "Cerrada" en menor énfasis (tono neutral)`);
    }
  } finally {
    await view.unmount();
  }
});

// --- (4) tarjeta compacta: cierre+días restantes, encaje+prioridad, siguiente acción con
// responsable y vencimiento ---

const CLOSE_IN_12_DAYS = dateOnlyDaysFromToday(12);
const DUE_IN_5_DAYS = dateOnlyDaysFromToday(5);

const FULL_ROW = {
  opportunity_id: 'opp-active-1',
  entity: 'Alcaldía de Prueba',
  title: 'Suministro de dotación de seguridad',
  ref: 'REF-2026-001',
  url: 'https://www.contratos.gov.co/proceso/REF-2026-001',
  offer_value: 950000000,
  expected_close_date: CLOSE_IN_12_DAYS,
  owner_name: 'Laura Gómez',
  decision: 'go',
  decided_by_name: 'Laura Gómez',
  decided_at: '2026-09-10T12:00:00.000Z',
  tender_offer_status: 'en_preparacion',
  section: 'prioridad_baja',
  document_import_status: 'analisis_generado',
  document_count: 6,
  missing_document_count: 0,
  recommendation: 'GO recomendado por el sistema',
  checklist_progress: { auto_generated: 3, total: 8 },
  preparation_status: 'en_preparacion',
  human_pending_count: 2,
  sharepoint_status: 'creada',
  sharepoint_url: 'https://sharepoint.example.com/carpeta',
  tracking_blocker: null,
  last_updated_at: '2026-09-20T09:00:00.000Z',
  tracking_due_at: DUE_IN_5_DAYS,
  risk: 'Riesgo pendiente',
  reasons: ['Alta afinidad sectorial', 'Cliente recurrente'],
  risks: ['Plazo de entrega ajustado'],
  score: 95,
  fit: {
    policy_version: 'v1', score: 12, band: 'bajo', confidence: 'alta',
    participation_hint: 'directa', reasons: [], data_gaps: [],
    feedback: { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' },
    evaluated_at: '2026-09-01T00:00:00.000Z',
  },
};

test('4 — el cierre muestra los días restantes calculados de forma determinista', async () => {
  const { view } = mountOpportunities([FULL_ROW]);
  try {
    await settle(view);
    const map = metadataMap(view.container.querySelector('.tracking-row'));
    assert.ok(map['Cierre'], 'debe existir el dato de Cierre');
    assert.match(map['Cierre'].textContent, new RegExp(escapeRegExp(formatDateOnly(CLOSE_IN_12_DAYS))), 'debe conservar la fecha formateada de cierre');
    assert.match(map['Cierre'].textContent, /vence en 12 días/, 'debe mostrar los días restantes hasta el cierre');
  } finally {
    await view.unmount();
  }
});

test('4 — sin fecha de cierre no debe inventarse un conteo de días restantes', async () => {
  const { view } = mountOpportunities([{ ...FULL_ROW, expected_close_date: null }]);
  try {
    await settle(view);
    const map = metadataMap(view.container.querySelector('.tracking-row'));
    assert.equal(map['Cierre'].textContent.trim(), 'Cierre por definir');
  } finally {
    await view.unmount();
  }
});

test('4 — muestra el encaje determinístico junto a la prioridad, sin que el score legado los sustituya', async () => {
  const { view } = mountOpportunities([FULL_ROW]);
  try {
    await settle(view);
    const map = metadataMap(view.container.querySelector('.tracking-row'));
    assert.ok(map['Encaje'], 'debe existir un dato de Encaje derivado de dossier.fit');
    assert.equal(map['Encaje'].textContent.trim(), 'bajo', 'el encaje debe reflejar dossier.fit.band, no el score legado (95, que sería "alto")');
    assert.equal(map['Prioridad'].textContent.trim(), 'Baja', 'la prioridad debe seguir viniendo de section, no del score legado');
  } finally {
    await view.unmount();
  }
});

test('4 — la siguiente acción se acompaña de responsable y vencimiento', async () => {
  const { view } = mountOpportunities([FULL_ROW]);
  try {
    await settle(view);
    const map = metadataMap(view.container.querySelector('.tracking-row'));
    const dd = map['Siguiente acción'];
    assert.ok(dd, 'debe existir el dato de Siguiente acción');
    assert.match(dd.textContent, /Laura Gómez/, 'debe indicar el responsable de la siguiente acción');
    assert.match(dd.textContent, new RegExp(`Vence.*${escapeRegExp(formatDateOnly(DUE_IN_5_DAYS))}`), 'debe indicar el vencimiento de la siguiente acción');
  } finally {
    await view.unmount();
  }
});

// --- (5) razones y riesgos del Radar se conservan; score legado sólo como trazabilidad ---

test('5 — conserva razones y riesgos del Radar; el score legado se marca como trazabilidad, nunca autoridad', async () => {
  const { view } = mountOpportunities([FULL_ROW]);
  try {
    await settle(view);
    const article = view.container.querySelector('.tracking-row');
    assert.match(article.textContent, /Alta afinidad sectorial/, 'debe conservar las razones del Radar');
    assert.match(article.textContent, /Cliente recurrente/, 'debe conservar las razones del Radar');
    assert.match(article.textContent, /Riesgos:\s*Plazo de entrega ajustado/, 'debe conservar los riesgos del Radar');
    assert.match(article.textContent, /Score histórico \(solo trazabilidad\): 95/, 'el score legado debe mostrarse marcado explícitamente como trazabilidad, no como autoridad');
  } finally {
    await view.unmount();
  }
});

// --- (6) el detalle extenso deja de dominar la lista compacta ---

test('6 — la lista compacta ya no muestra recomendación, checklist, pendientes humanos ni SharePoint', async () => {
  const { view } = mountOpportunities([FULL_ROW]);
  try {
    await settle(view);
    const map = metadataMap(view.container.querySelector('.tracking-row'));
    for (const retired of ['Recomendación del sistema', 'Checklist', 'Preparación', 'Pendientes humanos', 'SharePoint / OneDrive', 'Documentos']) {
      assert.equal(map[retired], undefined, `la lista compacta no debe seguir mostrando "${retired}"; ese detalle vive en el expediente`);
    }
  } finally {
    await view.unmount();
  }
});

console.log('tender opportunities compact redesign RED contract loaded');
