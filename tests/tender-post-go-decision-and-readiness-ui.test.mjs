// Regresión de producción (oportunidad "Cali", posterior a GO). Tres defectos observados en
// pantalla y un invariante ya desplegado que no puede romperse:
//   1) TenderGoNoGoDecisionPanel mostraba "GO registrado" y, aun así, seguía ofreciendo
//      "Registrar GO" y "Registrar NO GO": permitía duplicar la decisión vigente.
//   2) TenderOfferStatusPanel ofrecía "Marcar lista para presentar" habilitado con pendientes
//      requeridos en el expediente; sólo la migración 042 lo rechazaba en el servidor.
//   3) TenderDossierWorkspacePanel confiaba en el `offerStatus` opcional/desactualizado del
//      bootstrap y devolvía null justo después de GO, aunque /api/tender-offer-status ya
//      respondía en_preparacion.
//   4) La barra exterior del eje de decisión no puede recuperar Mesa de ayuda antes de GO ni
//      introducir una segunda CTA primaria.
//   5) Tras mutar el expediente, "Marcar lista para presentar" seguía leyendo una disponibilidad
//      vieja: el expediente no avisaba al contenedor y el gate sólo se refrescaba al recargar la
//      página. El aviso es exclusivo de mutaciones confirmadas (las cargas iniciales no avisan) y
//      no se introduce ningún sondeo.
//   6) El aviso se canalizó por una revisión propia de disponibilidad que viaja como prop y nunca
//      como key: refresca el gate canónico SIN remontar los paneles, así que la nota interna de
//      preparación y los borradores del expediente/Mesa Vig-IA sobreviven a cada mutación.
// Las aserciones se hacen sobre el DOM real que React monta (jsdom), no sobre el texto fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { act, createElement, useState } from 'react';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const TenderGoNoGoDecisionPanel = await loadReactComponent(
  'src/tenders/components/TenderGoNoGoDecisionPanel.tsx',
  'TenderGoNoGoDecisionPanel',
);
const TenderOfferStatusPanel = await loadReactComponent(
  'src/tenders/components/TenderOfferStatusPanel.tsx',
  'TenderOfferStatusPanel',
);
const TenderDossierWorkspacePanel = await loadReactComponent(
  'src/tenders/components/TenderDossierWorkspacePanel.tsx',
  'TenderDossierWorkspacePanel',
);
const TenderDossierChecklist = await loadReactComponent(
  'src/tenders/components/TenderDossierChecklist.tsx',
  'TenderDossierChecklist',
);

const AUTHORIZED_PROFILE = { id: 'profile-1', full_name: 'Dirección de Licitaciones', role: 'director', active: true, identity_type: 'human', permissions: ['licitaciones'] };

// Enruta por prefijo + método y registra cada llamada, para poder afirmar tanto lo que la UI
// pide como lo que decide NO pedir (p. ej. no consultar el expediente antes de GO).
function makeRequest(routes) {
  const calls = [];
  const request = async (path, options) => {
    const method = options?.method || 'GET';
    calls.push(`${method} ${path}`);
    for (const route of routes) {
      if (path.startsWith(route.path) && (route.method || 'GET') === method) {
        return typeof route.reply === 'function' ? route.reply(path, options) : route.reply;
      }
    }
    throw new Error(`ruta no esperada en la prueba: ${method} ${path}`);
  };
  return { request, calls };
}

// El montaje encadena cargas dependientes (estado de oferta → expediente); varias vueltas de
// microtareas dejan el árbol en su estado final sin temporizadores artificiales.
async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

// El click en el checklist dispara `void attachEvidence(item)`: la resolución de la promesa no
// está sincronizada con ningún número fijo de `flush()`. En lugar de adivinar cuántas vueltas de
// microtareas hacen falta, se reintenta hasta que el predicado observable se cumple o se agota el
// límite, momento en el que falla con un mensaje claro en vez de una aserción confusa más abajo.
async function waitUntil(view, predicate, { turns = 50, label = 'la condición esperada' } = {}) {
  for (let index = 0; index < turns; index += 1) {
    if (predicate()) return;
    await view.flush();
  }
  if (!predicate()) throw new Error(`tiempo de espera agotado sin cumplirse: ${label}`);
}

const buttonsIn = node => [...node.querySelectorAll('button')];
const labelsIn = node => buttonsIn(node).map(button => button.textContent.trim());
const buttonByText = (node, text) => buttonsIn(node).find(button => button.textContent.trim() === text);

async function clickNode(view, node) {
  await act(async () => { node.dispatchEvent(new view.window.MouseEvent('click', { bubbles: true })); });
}

function decision(kind) {
  return {
    id: `decision-${kind}`,
    opportunity_id: 'opportunity-cali',
    tender_id: 'tender-cali',
    decision: kind,
    analysis_interaction_id: null,
    analysis_run_id: 'run-current',
    justification: 'Decisión registrada por la persona autorizada.',
    decided_by: 'profile-1',
    decided_at: '2026-09-01T15:00:00.000Z',
    supersedes_decision_id: null,
    psi_sales_profiles: { full_name: 'Dirección de Licitaciones' },
  };
}

function mountDecisionPanel(current) {
  const { request, calls } = makeRequest([
    { path: '/api/tender-go-no-go-decision', reply: { decision: current, history: current ? [current] : [], preparation: null } },
  ]);
  const view = mountWithJsdom(TenderGoNoGoDecisionPanel, {
    opportunityId: 'opportunity-cali',
    opportunityName: 'Cali',
    analysis: null,
    currentProfile: AUTHORIZED_PROFILE,
    request,
    questionResponses: [],
    onChanged: () => {},
  });
  return { view, calls };
}

// --- 1) La decisión vigente no puede volver a registrarse; la reversión es única y explícita ---

test('1 — con GO vigente el panel no ofrece "Registrar GO" y expone exactamente una reversión a NO GO', async () => {
  const { view } = mountDecisionPanel(decision('go'));
  try {
    await settle(view);
    assert.ok(view.container.textContent.includes('GO registrado'), 'la decisión vigente debe seguir siendo visible');
    const actions = view.container.querySelector('#tender-go-no-go-actions');
    assert.ok(actions, 'la persona autorizada debe conservar su bloque de acciones');
    assert.deepEqual(
      labelsIn(actions),
      ['Cambiar la decisión a NO GO'],
      'con GO vigente sólo puede existir la reversión auditable a NO GO, nunca un segundo "Registrar GO"',
    );
    assert.equal(view.container.querySelector('#tender-decision-register-go'), null, 'no puede quedar el control que duplica la decisión vigente');
  } finally {
    await view.unmount();
  }
});

test('1 — con NO GO vigente el panel expone exactamente una reversión a GO', async () => {
  const { view } = mountDecisionPanel(decision('no_go'));
  try {
    await settle(view);
    assert.ok(view.container.textContent.includes('NO GO registrado'));
    const actions = view.container.querySelector('#tender-go-no-go-actions');
    assert.deepEqual(
      labelsIn(actions),
      ['Cambiar la decisión a GO'],
      'con NO GO vigente sólo puede existir la reversión auditable a GO',
    );
    assert.equal(view.container.querySelector('#tender-decision-register-nogo'), null);
  } finally {
    await view.unmount();
  }
});

test('1 — sin decisión vigente se conservan las dos acciones iniciales GO y NO GO', async () => {
  const { view } = mountDecisionPanel(null);
  try {
    await settle(view);
    const actions = view.container.querySelector('#tender-go-no-go-actions');
    assert.deepEqual(labelsIn(actions), ['Registrar GO', 'Registrar NO GO']);
    assert.ok(view.container.querySelector('#tender-decision-register-go'));
    assert.ok(view.container.querySelector('#tender-decision-register-nogo'));
  } finally {
    await view.unmount();
  }
});

test('1 — la reversión abre la confirmación auditable de la decisión contraria, no de la vigente', async () => {
  const { view } = mountDecisionPanel(decision('go'));
  try {
    await settle(view);
    const reversal = buttonByText(view.container.querySelector('#tender-go-no-go-actions'), 'Cambiar la decisión a NO GO');
    await clickNode(view, reversal);
    await settle(view);
    const dialog = view.container.querySelector('[role="dialog"]');
    assert.ok(dialog, 'la reversión debe seguir pidiendo confirmación explícita');
    assert.ok(/NO GO/.test(dialog.textContent), 'la confirmación debe describir la decisión contraria');
    assert.ok(
      /supersede|sustituy|historial/i.test(dialog.textContent),
      'la confirmación debe declarar que la decisión vigente queda superseded y auditable, no borrada',
    );
  } finally {
    await view.unmount();
  }
});

// --- 2) "Marcar lista para presentar" sólo existe si el expediente canónico lo permite ---

const NOT_READY_WORKSPACE = {
  opportunity_id: 'opportunity-cali',
  checklist: [],
  artifacts: [],
  readiness: {
    ready: false,
    pending_required_items: [{ item_key: 'poliza', title: 'Póliza de seriedad' }],
    blocking_items: [],
    active_blockers: [],
    unapproved_artifacts: [{ artifact_key: 'propuesta', title: 'Propuesta económica' }],
  },
  can_mark_ready: false,
  workbench_enabled: false,
};
const READY_WORKSPACE = {
  ...NOT_READY_WORKSPACE,
  readiness: { ready: true, pending_required_items: [], blocking_items: [], active_blockers: [], unapproved_artifacts: [] },
  can_mark_ready: true,
};

function mountOfferStatusPanel(workspaceReplies, { status = 'en_preparacion' } = {}) {
  const replies = [...workspaceReplies];
  const { request, calls } = makeRequest([
    { path: '/api/tender-offer-status', reply: { status, history: [] } },
    { path: '/api/tender-dossier-workspace', reply: () => {
      const next = replies.length > 1 ? replies.shift() : replies[0];
      return typeof next === 'function' ? next() : next;
    } },
    { path: '/api/tender-offer-status', method: 'POST', reply: () => { throw new Error('la transición no debía intentarse'); } },
  ]);
  const view = mountWithJsdom(TenderOfferStatusPanel, {
    opportunityId: 'opportunity-cali',
    opportunityName: 'Cali',
    currentProfile: AUTHORIZED_PROFILE,
    request,
    onChanged: () => {},
  });
  return { view, calls };
}

test('2 — en_preparacion consulta el expediente canónico y deja "Marcar lista para presentar" inhabilitado con pendientes', async () => {
  const { view, calls } = mountOfferStatusPanel([NOT_READY_WORKSPACE]);
  try {
    await settle(view);
    assert.ok(
      calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')),
      'en en_preparacion la disponibilidad debe leerse del expediente canónico, no inferirse',
    );
    const button = buttonByText(view.container, 'Marcar lista para presentar');
    assert.ok(button, 'la acción sigue siendo visible para explicar por qué no está disponible');
    assert.equal(button.disabled, true, 'no puede ofrecerse una transición que la base rechazará');
    assert.match(
      view.container.textContent,
      /requisitos|evidencia|pendientes/i,
      'debe explicar concisamente que faltan ítems requeridos o evidencia',
    );
  } finally {
    await view.unmount();
  }
});

test('2 — con can_mark_ready true la acción queda disponible', async () => {
  const { view } = mountOfferStatusPanel([READY_WORKSPACE]);
  try {
    await settle(view);
    const button = buttonByText(view.container, 'Marcar lista para presentar');
    assert.ok(button);
    assert.equal(button.disabled, false, 'un expediente canónicamente listo sí habilita la transición');
  } finally {
    await view.unmount();
  }
});

test('2 — un fallo al leer el expediente falla cerrado: la transición nunca se ofrece', async () => {
  const { view } = mountOfferStatusPanel([() => { throw new Error('expediente no disponible'); }]);
  try {
    await settle(view);
    const button = buttonByText(view.container, 'Marcar lista para presentar');
    assert.ok(button);
    assert.equal(button.disabled, true, 'sin lectura canónica la UI no puede prometer la transición');
  } finally {
    await view.unmount();
  }
});

test('2 — la disponibilidad se revalida al abrir: una UI obsoleta no abre la confirmación', async () => {
  // Primera lectura lista (UI habilita), segunda lectura ya no lista (otro actor abrió un pendiente).
  const { view, calls } = mountOfferStatusPanel([READY_WORKSPACE, NOT_READY_WORKSPACE]);
  try {
    await settle(view);
    const button = buttonByText(view.container, 'Marcar lista para presentar');
    assert.equal(button.disabled, false, 'la primera lectura sí habilitaba la acción');
    const workspaceCallsBefore = calls.filter(call => call.startsWith('GET /api/tender-dossier-workspace')).length;
    await clickNode(view, button);
    await settle(view);
    assert.ok(
      calls.filter(call => call.startsWith('GET /api/tender-dossier-workspace')).length > workspaceCallsBefore,
      'abrir la transición debe revalidar la disponibilidad canónica',
    );
    assert.equal(
      view.container.querySelector('[role="dialog"]'),
      null,
      'una disponibilidad vencida no puede abrir la confirmación de transición',
    );
    assert.equal(calls.some(call => call.startsWith('POST /api/tender-offer-status')), false, 'nunca debe enviarse la transición');
    assert.equal(buttonByText(view.container, 'Marcar lista para presentar').disabled, true, 'tras revalidar, la acción queda inhabilitada');
  } finally {
    await view.unmount();
  }
});

test('2 — fuera de en_preparacion no se consulta el expediente ni se condiciona la transición', async () => {
  const { view, calls } = mountOfferStatusPanel([READY_WORKSPACE], { status: 'presentada' });
  try {
    await settle(view);
    assert.equal(
      calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')),
      false,
      'el gate de expediente sólo aplica a la transición a lista_para_presentar',
    );
    assert.equal(buttonByText(view.container, 'Registrar adjudicada').disabled, false);
  } finally {
    await view.unmount();
  }
});

// --- 3) El expediente resuelve su propio estado canónico de oferta ---

const DOSSIER_WORKSPACE = {
  opportunity_id: 'opportunity-cali',
  checklist: [],
  artifacts: [],
  readiness: { ready: false, pending_required_items: [{ item_key: 'poliza', title: 'Póliza de seriedad' }], blocking_items: [], active_blockers: [], unapproved_artifacts: [] },
  can_mark_ready: false,
  workbench_enabled: false,
};

function mountDossierPanel(offerStatusReply, props = {}) {
  const { request, calls } = makeRequest([
    { path: '/api/tender-offer-status', reply: offerStatusReply },
    { path: '/api/tender-dossier-workspace', reply: DOSSIER_WORKSPACE },
  ]);
  // Por defecto sin `offerStatus`: el bootstrap ya no es fuente de verdad para este panel.
  const view = mountWithJsdom(TenderDossierWorkspacePanel, {
    opportunityId: 'opportunity-cali',
    request,
    profiles: [],
    canApprove: true,
    ...props,
  });
  return { view, calls };
}

test('3 — sin offerStatus del bootstrap el panel resuelve en_preparacion y monta el expediente', async () => {
  const { view, calls } = mountDossierPanel({ status: 'en_preparacion', history: [] });
  try {
    await settle(view);
    assert.ok(
      calls.some(call => call.startsWith('GET /api/tender-offer-status')),
      'el panel debe resolver el estado canónico por su cuenta',
    );
    assert.ok(view.container.querySelector('#tender-dossier'), 'justo después de GO el expediente debe montarse');
    assert.ok(calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')));
  } finally {
    await view.unmount();
  }
});

test('3 — pendiente_decision y cerrada_no_go siguen devolviendo null sin consultar el expediente', async () => {
  for (const status of ['pendiente_decision', 'cerrada_no_go']) {
    const { view, calls } = mountDossierPanel({ status, history: [] });
    try {
      await settle(view);
      assert.equal(view.container.innerHTML, '', `${status} no puede renderizar expediente`);
      assert.equal(calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')), false, `${status} no debe pedir el expediente`);
    } finally {
      await view.unmount();
    }
  }
});

test('3 — un fallo de /api/tender-offer-status falla cerrado (null), sin cargar el expediente', async () => {
  const { view, calls } = mountDossierPanel(() => { throw new Error('estado de oferta no disponible'); });
  try {
    await settle(view);
    assert.equal(view.container.innerHTML, '', 'ante un error de API el panel debe fallar cerrado');
    assert.equal(calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')), false);
  } finally {
    await view.unmount();
  }
});

test('3 — un offerStatus desactualizado del bootstrap no puede ocultar un expediente activo', async () => {
  // Exactamente el caso de producción: el listado todavía dice pendiente_decision cuando el GO
  // ya está registrado y /api/tender-offer-status responde en_preparacion.
  const { view } = mountDossierPanel({ status: 'en_preparacion', history: [] }, { offerStatus: 'pendiente_decision' });
  try {
    await settle(view);
    assert.ok(view.container.querySelector('#tender-dossier'), 'la fuente de verdad es la API, no la pista del bootstrap');
  } finally {
    await view.unmount();
  }
});

test('3 — un offerStatus optimista del bootstrap tampoco puede abrir un expediente cerrado', async () => {
  const { view, calls } = mountDossierPanel({ status: 'cerrada_no_go', history: [] }, { offerStatus: 'en_preparacion' });
  try {
    await settle(view);
    assert.equal(view.container.innerHTML, '', 'la pista del bootstrap no puede sobrepasar el estado canónico');
    assert.equal(calls.some(call => call.startsWith('GET /api/tender-dossier-workspace')), false);
  } finally {
    await view.unmount();
  }
});

test('3 — un estado post-GO avanzado también monta el expediente', async () => {
  const { view } = mountDossierPanel({ status: 'lista_para_presentar', history: [] });
  try {
    await settle(view);
    assert.ok(view.container.querySelector('#tender-dossier'));
  } finally {
    await view.unmount();
  }
});

// --- 4) La barra exterior del eje de decisión conserva su regla desplegada ---

test('4 — el panel formal no reintroduce Mesa de ayuda ni una segunda CTA primaria en la barra exterior', () => {
  const panel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
  const surface = readFileSync(new URL('../src/tenders/components/TenderDecisionAxisSurface.tsx', import.meta.url), 'utf8');
  assert.equal(/Mesa de ayuda/.test(panel), false, 'el control formal nunca es una entrada a Mesa de ayuda');
  assert.equal(/brief de decisión/i.test(panel), false, 'el producto no expone briefs de decisión');
  const bar = surface.match(/<div className="tender-decision-axis-final-bar">[\s\S]*?<\/div>/)?.[0] || '';
  assert.ok(bar, 'debe seguir existiendo la barra final del eje de decisión');
  // Sólo cuentan los controles reales (`>texto<`), no la mención del comentario que documenta la regla.
  assert.equal(
    (bar.match(/>Abrir Mesa de ayuda</g) || []).length,
    1,
    'Mesa de ayuda debe existir exactamente una vez como control en la barra exterior',
  );
  assert.match(bar, /primaryCta\.id === 'open_help_desk' && <button[^>]*>Abrir Mesa de ayuda<\/button>/, 'sólo post-GO puede ofrecer Mesa de ayuda');
  assert.equal(/Registrar GO|Registrar NO GO|Cambiar la decisión a/.test(bar), false, 'la barra exterior no puede duplicar las acciones del panel formal embebido');
  // Cada CTA de la barra vive dentro de una rama `primaryCta.id === ...`: no hay ninguna
  // renderizada incondicionalmente (la "exactamente una CTA" en runtime la cubre D6).
  const unguarded = bar
    .split(/\{primaryCta\.id === /)
    .shift();
  assert.equal(/tender-decision-axis-cta/.test(unguarded), false, 'ninguna CTA primaria puede renderizarse fuera de una rama de primaryCta');
});

// --- 5) Una mutación confirmada del expediente refresca la disponibilidad canónica ---

const REVIEWABLE_ARTIFACT = {
  id: 'artifact-propuesta',
  artifact_key: 'propuesta',
  title: 'Propuesta económica',
  required: true,
  origin: 'seed_go',
  current_version: {
    id: 'version-1', version: 1, content_kind: 'markdown', content_text: 'Borrador de propuesta',
    author_id: 'profile-1', created_at: '2026-09-01T15:00:00.000Z',
  },
  review_status: 'pendiente',
  has_approved_version: false,
  version_count: 1,
};
const ARTIFACT_WORKSPACE = { ...DOSSIER_WORKSPACE, artifacts: [REVIEWABLE_ARTIFACT] };

// El contenedor real sólo incrementa con este aviso la revisión de disponibilidad; aquí basta con
// anotar cada aviso junto al número de lecturas del expediente que lo precedieron, para distinguir
// "avisó después de recargar" de "avisó durante el montaje" (que sería un ciclo de refresco).
function mountDossierPanelWithParent(workspace) {
  const { request, calls } = makeRequest([
    { path: '/api/tender-offer-status', reply: { status: 'en_preparacion', history: [] } },
    { path: '/api/tender-dossier-workspace', reply: () => workspace },
    { path: '/api/tender-dossier-artifact-review', method: 'POST', reply: () => ({ artifact: REVIEWABLE_ARTIFACT }) },
    { path: '/api/tender-dossier-seed', method: 'POST', reply: () => workspace },
  ]);
  const workspaceReads = () => calls.filter(call => call.startsWith('GET /api/tender-dossier-workspace')).length;
  const notifications = [];
  const view = mountWithJsdom(TenderDossierWorkspacePanel, {
    opportunityId: 'opportunity-cali',
    request,
    profiles: [],
    canApprove: true,
    onChanged: () => { notifications.push(workspaceReads()); },
  });
  return { view, calls, notifications, workspaceReads };
}

test('5 — las cargas iniciales no avisan al contenedor ni sondean: no puede haber ciclo de refresco', async () => {
  const { view, notifications, workspaceReads } = mountDossierPanelWithParent(ARTIFACT_WORKSPACE);
  try {
    await settle(view);
    assert.ok(view.container.querySelector('#tender-dossier'), 'el expediente post-GO debe montarse');
    assert.equal(workspaceReads(), 1, 'el montaje lee el expediente una sola vez: no hay sondeo');
    assert.deepEqual(
      notifications,
      [],
      'resolver el estado de oferta y cargar el expediente no puede avisar al contenedor: nada cambió en el backend que obligue a releer la disponibilidad',
    );
  } finally {
    await view.unmount();
  }
});

test('5 — una mutación confirmada recarga el expediente y luego avisa al contenedor exactamente una vez', async () => {
  const { view, calls, notifications, workspaceReads } = mountDossierPanelWithParent(ARTIFACT_WORKSPACE);
  try {
    await settle(view);
    const approve = buttonByText(view.container, 'Aprobar versión vigente');
    assert.ok(approve, 'la aprobación humana de la versión vigente debe seguir disponible');
    await clickNode(view, approve);
    await settle(view);
    assert.ok(
      calls.some(call => call.startsWith('POST /api/tender-dossier-artifact-review')),
      'la aprobación debe confirmarse en el backend antes de refrescar nada',
    );
    assert.equal(workspaceReads(), 2, 'la mutación confirmada recarga el expediente local exactamente una vez');
    assert.deepEqual(
      notifications,
      [2],
      'un único aviso al contenedor, emitido después de la recarga, para que se relea la disponibilidad canónica',
    );
  } finally {
    await view.unmount();
  }
});

test('5 — el seed legacy avisa una sola vez y sin recarga duplicada', async () => {
  const { view, calls, notifications, workspaceReads } = mountDossierPanelWithParent(DOSSIER_WORKSPACE);
  try {
    await settle(view);
    const initialize = buttonByText(view.container, 'Inicializar expediente');
    assert.ok(initialize, 'un expediente vacío conserva la inicialización para dirección');
    await clickNode(view, initialize);
    await settle(view);
    assert.ok(calls.some(call => call.startsWith('POST /api/tender-dossier-seed')));
    assert.equal(workspaceReads(), 2, 'tras el seed se recarga una sola vez');
    assert.deepEqual(notifications, [2], 'el seed también refresca la disponibilidad canónica, una sola vez');
  } finally {
    await view.unmount();
  }
});

test('5 — el cableado contenedor → expediente → checklist/documentos usa el mismo camino de refresco', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../src/tenders/components/TenderDossierWorkspacePanel.tsx', import.meta.url), 'utf8');

  const mount = main.match(/<TenderDossierWorkspacePanel[\s\S]*?\/>/)?.[0] || '';
  assert.ok(mount, 'el detalle debe seguir montando el expediente');
  assert.match(
    mount,
    /onChanged=\{[\s\S]*?setTenderDossierReadinessRevision\(revision => revision \+ 1\)/,
    'el expediente debe incrementar la revisión de disponibilidad al mutar',
  );
  assert.match(
    mount,
    /onChanged=\{[\s\S]*?activeDetailIdRef\.current === o\.id/,
    'sólo la oportunidad activa puede incrementar la revisión',
  );
  assert.match(
    main,
    /<TenderOfferPreparationPanel key=\{`tender-preparation-\$\{o\.id\}-\$\{tenderRevision\}`\}/,
    'la preparación (y con ella TenderOfferStatusPanel) sigue aislada por oportunidad y por decisión formal',
  );

  assert.match(panel, /<TenderDossierChecklist[^>]*onChanged=\{handleCommittedMutation\}/, 'el checklist avisa por el camino de mutación');
  assert.match(panel, /<TenderDossierArtifacts[^>]*onChanged=\{handleCommittedMutation\}/, 'los documentos avisan por el camino de mutación');
  assert.equal(/onChanged=\{reload\}/.test(panel), false, 'los hijos no pueden recargar sin avisar al contenedor');
  assert.equal(/setInterval|setTimeout/.test(panel), false, 'el refresco es por evento, nunca por sondeo');
});

// --- 6) El refresco de disponibilidad no puede remontar nada (no puede borrar borradores) ---

// Reproduce el cableado real del contenedor: `readinessRevision` llega como prop (nunca como key),
// así que subirla vuelve a ejecutar el efecto de disponibilidad sobre la MISMA instancia.
function mountOfferStatusPanelWithRevision(workspaceReplies, { status = 'en_preparacion' } = {}) {
  const replies = [...workspaceReplies];
  const { request, calls } = makeRequest([
    { path: '/api/tender-offer-status', reply: { status, history: [] } },
    { path: '/api/tender-dossier-workspace', reply: () => {
      const next = replies.length > 1 ? replies.shift() : replies[0];
      return typeof next === 'function' ? next() : next;
    } },
    { path: '/api/tender-offer-status', method: 'POST', reply: () => { throw new Error('la transición no debía intentarse'); } },
  ]);
  const control = {};
  const Container = () => {
    const [readinessRevision, setReadinessRevision] = useState(0);
    control.bump = setReadinessRevision;
    return createElement(TenderOfferStatusPanel, {
      opportunityId: 'opportunity-cali',
      opportunityName: 'Cali',
      currentProfile: AUTHORIZED_PROFILE,
      request,
      onChanged: () => {},
      readinessRevision,
    });
  };
  const view = mountWithJsdom(Container, {});
  // Equivale a la mutación confirmada del expediente avisando al contenedor: N → N+1.
  const bumpReadinessRevision = async () => {
    await act(async () => { control.bump(revision => revision + 1); });
    await settle(view);
  };
  const reads = prefix => calls.filter(call => call.startsWith(prefix)).length;
  return { view, calls, bumpReadinessRevision, reads };
}

test('6 — subir readinessRevision tras una mutación confirmada relee la disponibilidad y habilita la acción sin remontar el panel', async () => {
  // Primera lectura con pendientes (acción inhabilitada); tras la mutación el expediente ya habilita.
  const { view, bumpReadinessRevision, reads } = mountOfferStatusPanelWithRevision([NOT_READY_WORKSPACE, READY_WORKSPACE]);
  try {
    await settle(view);
    const button = buttonByText(view.container, 'Marcar lista para presentar');
    assert.equal(button.disabled, true, 'con pendientes requeridos la transición no puede ofrecerse');
    const section = view.container.querySelector('.tender-offer-status-panel');
    assert.ok(section, 'el panel de estado de oferta debe estar montado');
    const statusReadsBefore = reads('GET /api/tender-offer-status');
    const workspaceReadsBefore = reads('GET /api/tender-dossier-workspace');

    await bumpReadinessRevision();

    assert.equal(
      reads('GET /api/tender-dossier-workspace'),
      workspaceReadsBefore + 1,
      'cambiar la revisión debe releer la disponibilidad canónica exactamente una vez, sin sondeo',
    );
    const after = buttonByText(view.container, 'Marcar lista para presentar');
    assert.equal(after.disabled, false, 'con can_mark_ready true la acción queda habilitada sin recargar la página');
    // Continuidad de instancia sobre el DOM real: un remontaje habría reemplazado estos nodos y
    // habría vuelto a resolver el estado canónico de oferta desde cero.
    assert.equal(after, button, 'el botón debe ser el mismo nodo del DOM, no uno reconstruido');
    assert.equal(view.container.querySelector('.tender-offer-status-panel'), section, 'la sección no puede haberse remontado');
    assert.equal(
      reads('GET /api/tender-offer-status'),
      statusReadsBefore,
      'un remontaje habría vuelto a pedir el estado de oferta: el refresco es sólo de disponibilidad',
    );
  } finally {
    await view.unmount();
  }
});

test('6 — el refresco de disponibilidad conserva el estado local visible: la confirmación abierta sigue abierta', async () => {
  const { view, bumpReadinessRevision } = mountOfferStatusPanelWithRevision([READY_WORKSPACE]);
  try {
    await settle(view);
    await clickNode(view, buttonByText(view.container, 'Marcar lista para presentar'));
    await settle(view);
    const dialog = view.container.querySelector('[role="dialog"]');
    assert.ok(dialog, 'con el expediente listo la confirmación debe abrirse');
    const note = dialog.querySelector('textarea');
    assert.ok(note, 'la confirmación conserva su nota opcional en curso');

    await bumpReadinessRevision();

    const dialogAfter = view.container.querySelector('[role="dialog"]');
    assert.ok(dialogAfter, 'una mutación del expediente no puede cerrar la confirmación abierta: eso es exactamente lo que hacía el remontaje');
    assert.equal(dialogAfter, dialog, 'la confirmación debe ser el mismo nodo, con el trabajo en curso intacto');
    assert.equal(dialogAfter.querySelector('textarea'), note, 'la nota en curso no puede reconstruirse');
  } finally {
    await view.unmount();
  }
});

// Canal completo, con las MISMAS keys que el detalle real (`${o.id}-${tenderRevision}`): el
// expediente avisa, el contenedor sube sólo la revisión de disponibilidad, y el gate se relee.
const APPROVED_ARTIFACT = { ...REVIEWABLE_ARTIFACT, review_status: 'aprobado', has_approved_version: true };
const READY_ARTIFACT_WORKSPACE = {
  ...ARTIFACT_WORKSPACE,
  artifacts: [APPROVED_ARTIFACT],
  readiness: { ready: true, pending_required_items: [], blocking_items: [], active_blockers: [], unapproved_artifacts: [] },
  can_mark_ready: true,
};

function mountReadinessChannel() {
  // El backend sólo habilita la presentación después de la aprobación confirmada.
  let approved = false;
  const { request, calls } = makeRequest([
    { path: '/api/tender-offer-status', reply: { status: 'en_preparacion', history: [] } },
    { path: '/api/tender-dossier-workspace', reply: () => (approved ? READY_ARTIFACT_WORKSPACE : ARTIFACT_WORKSPACE) },
    { path: '/api/tender-dossier-artifact-review', method: 'POST', reply: () => { approved = true; return { artifact: APPROVED_ARTIFACT }; } },
  ]);
  // La revisión que remonta sólo cambia por oportunidad o decisión formal: nada en este canal la toca.
  const tenderRevision = 0;
  const Container = () => {
    const [readinessRevision, setReadinessRevision] = useState(0);
    return createElement('div', null,
      createElement('div', { key: `tender-preparation-opportunity-cali-${tenderRevision}` },
        createElement(TenderOfferStatusPanel, {
          opportunityId: 'opportunity-cali',
          opportunityName: 'Cali',
          currentProfile: AUTHORIZED_PROFILE,
          request,
          onChanged: () => {},
          readinessRevision,
        })),
      createElement(TenderDossierWorkspacePanel, {
        key: `tender-dossier-opportunity-cali-${tenderRevision}`,
        opportunityId: 'opportunity-cali',
        request,
        profiles: [],
        canApprove: true,
        onChanged: () => { setReadinessRevision(revision => revision + 1); },
      }),
    );
  };
  return { view: mountWithJsdom(Container, {}), calls };
}

test('6 — una mutación confirmada del expediente rehabilita el gate por el canal de disponibilidad, sin remontar expediente ni gate', async () => {
  const { view, calls } = mountReadinessChannel();
  try {
    await settle(view);
    const gate = buttonByText(view.container, 'Marcar lista para presentar');
    assert.equal(gate.disabled, true, 'con el documento sin aprobar la transición no puede ofrecerse');
    const statusSection = view.container.querySelector('.tender-offer-status-panel');
    const dossier = view.container.querySelector('#tender-dossier');
    const versionDraft = view.container.querySelector('#tender-dossier .tender-dossier-artifact textarea');
    assert.ok(statusSection && dossier && versionDraft, 'gate y expediente deben convivir en el detalle');

    await clickNode(view, buttonByText(view.container, 'Aprobar versión vigente'));
    // La cadena es larga (POST → recarga del expediente → aviso → relectura del gate) pero toda por
    // microtareas encadenadas: ni temporizadores ni sondeo.
    await settle(view, 12);

    assert.ok(calls.some(call => call.startsWith('POST /api/tender-dossier-artifact-review')), 'la aprobación se confirma en el backend');
    assert.equal(
      buttonByText(view.container, 'Marcar lista para presentar').disabled,
      false,
      'tras la mutación confirmada el gate canónico debe releerse y habilitarse sin recargar la página',
    );
    // Nada se remonta: los borradores en curso del expediente y el estado del gate sobreviven.
    assert.equal(view.container.querySelector('.tender-offer-status-panel'), statusSection, 'el gate no puede remontarse por una mutación del expediente');
    assert.equal(view.container.querySelector('#tender-dossier'), dossier, 'el expediente no puede remontarse a sí mismo');
    assert.equal(
      view.container.querySelector('#tender-dossier .tender-dossier-artifact textarea'),
      versionDraft,
      'el campo de nueva versión debe ser el mismo nodo: un remontaje habría borrado el borrador en curso',
    );
  } finally {
    await view.unmount();
  }
});

test('6 — la revisión de disponibilidad existe aparte, se reinicia por oportunidad y no entra en ninguna key', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const statusPanel = readFileSync(new URL('../src/tenders/components/TenderOfferStatusPanel.tsx', import.meta.url), 'utf8');

  assert.match(
    main,
    /const \[tenderDossierReadinessRevision, setTenderDossierReadinessRevision\] = useState\(0\);/,
    'el detalle debe tener un canal de refresco de disponibilidad separado de la revisión que remonta',
  );
  assert.match(
    main,
    /setTenderRevision\(0\); setTenderDossierReadinessRevision\(0\);/,
    'cambiar de oportunidad debe reiniciar también la revisión de disponibilidad',
  );

  const dossierMount = main.match(/<TenderDossierWorkspacePanel[\s\S]*?\/>/)?.[0] || '';
  const dossierOnChanged = dossierMount.match(/onChanged=\{[\s\S]*?\}\}/)?.[0] || '';
  assert.ok(dossierOnChanged, 'el expediente debe seguir avisando al contenedor');
  assert.match(dossierOnChanged, /setTenderDossierReadinessRevision\(revision => revision \+ 1\)/);
  assert.equal(
    /setTenderRevision/.test(dossierOnChanged),
    false,
    'mutar el expediente nunca puede tocar la revisión que remonta: destruiría los borradores en curso',
  );

  // Ninguna key del detalle puede depender de la revisión de disponibilidad.
  const keys = main.match(/key=\{[^{}]*(?:\$\{[^{}]*\}[^{}]*)*\}/g) || [];
  assert.ok(keys.length >= 2, 'deben seguir existiendo keys explícitas en el detalle');
  assert.deepEqual(
    keys.filter(key => /readinessRevision/i.test(key)),
    [],
    'la revisión de disponibilidad no puede formar parte de ninguna key: una key nueva remonta y borra borradores',
  );

  // El refresco viaja como prop, de punta a punta, y sólo re-ejecuta el efecto de disponibilidad.
  assert.match(main, /<TenderOfferPreparationPanel[^\n]*?readinessRevision=\{tenderDossierReadinessRevision\}/, 'la preparación recibe la revisión como prop');
  assert.match(main, /<TenderOfferStatusPanel[^\n]*?readinessRevision=\{readinessRevision\}/, 'la preparación transmite la revisión al panel del gate');
  assert.match(statusPanel, /readinessRevision\?: number;/, 'el panel del gate declara la prop opcional');
  assert.match(
    statusPanel,
    /\}, \[payload\.status, refreshReadiness, readinessRevision\]\);/,
    'el efecto de disponibilidad canónica debe releer cuando cambia la revisión',
  );
});

test('6 — los borradores locales sólo pueden perderse por cambio de oportunidad o de decisión formal', () => {
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const artifacts = readFileSync(new URL('../src/tenders/components/TenderDossierArtifacts.tsx', import.meta.url), 'utf8');
  const workbench = readFileSync(new URL('../src/tenders/components/TenderDossierVigiaWorkbench.tsx', import.meta.url), 'utf8');

  // Los borradores en riesgo viven en estado local: sólo un remontaje los borra. La nota interna de
  // preparación se retiró con el pseudo-expediente narrativo, así que ya no hay un tercer borrador
  // que proteger dentro de TenderOfferPreparationPanel.
  assert.equal(
    /const \[note, setNote\] = useState\(''\);[\s\S]{0,400}tender-offer-preparation-note/.test(main),
    false,
    'la nota interna de preparación ya no existe: no puede reintroducirse un borrador narrativo en el panel de preparación',
  );
  assert.match(artifacts, /const \[drafts, setDrafts\] = useState/, 'los documentos del expediente mantienen borradores locales');
  assert.match(workbench, /useState/, 'la Mesa Vig-IA mantiene estado local dentro del expediente');

  // Y sus keys sólo dependen de la oportunidad y de la revisión de decisión formal.
  assert.match(main, /<TenderOfferPreparationPanel key=\{`tender-preparation-\$\{o\.id\}-\$\{tenderRevision\}`\}/);
  assert.match(main, /<TenderDossierWorkspacePanel key=\{`tender-dossier-\$\{o\.id\}-\$\{tenderRevision\}`\}/);
});

// --- 7) attachEvidence sólo debe borrar el borrador cuando el backend confirma la evidencia ---

function checklistItem(overrides = {}) {
  return {
    id: 'item-1',
    item_key: 'poliza',
    title: 'Póliza de seriedad',
    item_type: 'documento',
    required: true,
    origin: 'seed_go',
    status: 'pendiente',
    applicability: 'requerido',
    assignee_id: null,
    assignee_name: null,
    target_date: null,
    latest_evidence: null,
    ...overrides,
  };
}

function checklistWorkspace(item) {
  return {
    opportunity_id: 'opportunity-cali',
    checklist: [item],
    artifacts: [],
    readiness: { ready: false, pending_required_items: [], blocking_items: [], active_blockers: [], unapproved_artifacts: [] },
    can_mark_ready: false,
    workbench_enabled: false,
  };
}

function mountChecklist(actionReply) {
  const { request, calls } = makeRequest([
    { path: '/api/tender-dossier-item-action', method: 'POST', reply: actionReply },
  ]);
  const notifications = [];
  const view = mountWithJsdom(TenderDossierChecklist, {
    opportunityId: 'opportunity-cali',
    workspace: checklistWorkspace(checklistItem()),
    request,
    profiles: [],
    canApprove: true,
    onChanged: async () => { notifications.push(true); },
  });
  return { view, calls, notifications };
}

// mountWithJsdom importa react-dom antes de instalar los globales de jsdom, así que los eventos
// 'input'/'change' despachados aquí nunca llegan al onChange sintético de React. El puente es la
// prop React adjunta al nodo montado (`__reactProps$...`): devuelve el onChange REAL del árbol.
function reactOnChange(node, label) {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, `${label} debe tener props de React adjuntas (__reactProps$...)`);
  const onChange = node[reactPropsKey].onChange;
  assert.equal(typeof onChange, 'function', `${label} debe tener un onChange de React invocable`);
  return onChange;
}

const nativeValueSetter = view => Object.getOwnPropertyDescriptor(view.window.HTMLInputElement.prototype, 'value').set;

// Simula tecleo real: fija el valor con el setter nativo y dispara el onChange de React dentro de `act`.
async function typeInto(view, input, value) {
  const setter = nativeValueSetter(view);
  const onChange = reactOnChange(input, 'el input');
  await act(async () => {
    setter.call(input, value);
    onChange({ target: input, currentTarget: input });
  });
}

test('7 — el rechazo del backend conserva el texto de evidencia tecleado y muestra el error', async () => {
  const { view, notifications } = mountChecklist(() => { throw new Error('evidencia rechazada por el servidor'); });
  try {
    await settle(view);
    const input = view.container.querySelector('input[aria-label="Evidencia"]');
    await typeInto(view, input, 'Evidencia escrita por la persona usuaria');
    const button = buttonByText(view.container, 'Guardar evidencia');
    await waitUntil(view, () => button.disabled === false, {
      label: 'el botón "Guardar evidencia" habilitado tras teclear',
    });
    assert.equal(button.disabled, false, 'el botón "Guardar evidencia" debe estar habilitado antes del click');
    await clickNode(view, button);
    await waitUntil(view, () => /evidencia rechazada por el servidor/.test(view.container.textContent), {
      label: 'el error del backend visible tras el rechazo',
    });
    assert.equal(
      input.value,
      'Evidencia escrita por la persona usuaria',
      'un rechazo del backend no puede borrar lo que la persona usuaria ya tecleó',
    );
    assert.ok(
      /evidencia rechazada por el servidor/.test(view.container.textContent),
      'el error del backend debe quedar visible junto al borrador conservado',
    );
    assert.deepEqual(notifications, [], 'un rechazo no puede avisar al contenedor de una mutación que nunca ocurrió');
  } finally {
    await view.unmount();
  }
});

test('7 — el éxito del backend limpia el borrador de evidencia y avisa al contenedor exactamente una vez', async () => {
  const { view, notifications } = mountChecklist(() => ({
    item: checklistItem({ latest_evidence: { kind: 'texto', text: 'Evidencia confirmada', url: null, at: '2026-09-07T12:00:00.000Z' } }),
  }));
  try {
    await settle(view);
    const input = view.container.querySelector('input[aria-label="Evidencia"]');
    await typeInto(view, input, 'Evidencia confirmada');
    const button = buttonByText(view.container, 'Guardar evidencia');
    await waitUntil(view, () => button.disabled === false, {
      label: 'el botón "Guardar evidencia" habilitado tras teclear',
    });
    assert.equal(button.disabled, false, 'el botón "Guardar evidencia" debe estar habilitado antes del click');
    await clickNode(view, button);
    await waitUntil(view, () => input.value === '' && notifications.length === 1, {
      label: 'el borrador limpio y exactamente un aviso al contenedor',
    });
    assert.equal(input.value, '', 'una evidencia confirmada por el backend sí debe limpiar el borrador');
    assert.deepEqual(notifications, [true], 'una mutación confirmada debe avisar al contenedor exactamente una vez');
  } finally {
    await view.unmount();
  }
});

// --- 8) Dos campos del mismo ítem editados en el mismo lote de React no pueden pisarse ---

test('8 — evidencia y fecha objetivo editadas en el mismo lote conservan ambos borradores', async () => {
  // Sin backend en juego: el defecto es puramente del estado local de borradores del checklist.
  const { view, calls } = mountChecklist(() => { throw new Error('ninguna acción debía enviarse en esta prueba'); });
  try {
    await settle(view);
    const evidence = view.container.querySelector('input[aria-label="Evidencia"]');
    const targetDate = view.container.querySelector('input[type="date"]');
    assert.ok(evidence && targetDate, 'el ítem debe exponer a la vez el borrador de evidencia y el de fecha objetivo');
    const setter = nativeValueSetter(view);
    const onEvidenceChange = reactOnChange(evidence, 'el campo de evidencia');
    const onTargetDateChange = reactOnChange(targetDate, 'el campo de fecha objetivo');

    // Un solo `act`: React agrupa ambos setState en el MISMO lote, así que los dos actualizadores
    // corren sin render intermedio entre ellos. Si el merge parte del `drafts` capturado en el
    // render y no del estado vigente, el segundo campo reconstruye el borrador desde su valor
    // base y borra lo que el primero acababa de escribir.
    await act(async () => {
      setter.call(evidence, 'Evidencia tecleada antes de fijar la fecha');
      onEvidenceChange({ target: evidence, currentTarget: evidence });
      setter.call(targetDate, '2026-10-15');
      onTargetDateChange({ target: targetDate, currentTarget: targetDate });
    });
    await settle(view);

    // Se releen del contenedor: la aserción es sobre lo que React dejó en el DOM controlado real.
    assert.equal(
      view.container.querySelector('input[aria-label="Evidencia"]').value,
      'Evidencia tecleada antes de fijar la fecha',
      'fijar la fecha objetivo en el mismo lote no puede borrar la evidencia ya tecleada',
    );
    assert.equal(
      view.container.querySelector('input[type="date"]').value,
      '2026-10-15',
      'la fecha objetivo tecleada en el mismo lote debe conservarse',
    );
    assert.deepEqual(calls, [], 'editar borradores locales no puede disparar ninguna acción de expediente');
  } finally {
    await view.unmount();
  }
});

// --- 9) El ítem sembrado por AGT-002 post-GO muestra su procedencia y su instrucción ---

function mountChecklistWithItem(item) {
  const { request, calls } = makeRequest([
    { path: '/api/tender-dossier-item-action', method: 'POST', reply: () => { throw new Error('ninguna acción debía enviarse en esta prueba'); } },
  ]);
  const view = mountWithJsdom(TenderDossierChecklist, {
    opportunityId: 'opportunity-cali',
    workspace: checklistWorkspace(item),
    request,
    profiles: [],
    canApprove: true,
    onChanged: async () => {},
  });
  return { view, calls };
}

test('9 — un ítem con analysis_source muestra el badge "Desde Análisis" y su instrucción bajo el título', async () => {
  const item = checklistItem({
    title: 'Capital de trabajo mínimo exigido',
    instruction: 'Revisar los estados financieros y el capital de trabajo.',
    analysis_source: {
      decision_id: 'decision-1',
      analysis_run_id: 'run-1',
      source_id: 'unit-financial-1',
      requirement_id: 'financial-working-capital',
    },
  });
  const { view } = mountChecklistWithItem(item);
  try {
    await settle(view);
    assert.ok(
      [...view.container.querySelectorAll('.badge')].some(badge => badge.textContent.trim() === 'Desde Análisis'),
      'el ítem sembrado por AGT-002 debe declarar su procedencia con un badge',
    );
    const instruction = view.container.querySelector('.tender-dossier-instruction');
    assert.ok(instruction, 'la instrucción debe mostrarse bajo el título');
    assert.equal(instruction.textContent, 'Revisar los estados financieros y el capital de trabajo.');
    assert.doesNotMatch(
      view.container.innerHTML,
      /decision-1|run-1|unit-financial-1|financial-working-capital/,
      'ningún identificador técnico de analysis_source puede quedar visible en el DOM',
    );
  } finally {
    await view.unmount();
  }
});

test('9 — un ítem ordinario (sin analysis_source ni instruction) no muestra badge ni instrucción', async () => {
  const { view } = mountChecklistWithItem(checklistItem());
  try {
    await settle(view);
    assert.equal(
      [...view.container.querySelectorAll('.badge')].some(badge => badge.textContent.trim() === 'Desde Análisis'),
      false,
      'un ítem seed_go/human ordinario nunca declara procedencia AGT-002',
    );
    assert.equal(view.container.querySelector('.tender-dossier-instruction'), null, 'sin instruction no puede renderizarse el párrafo de instrucción');
  } finally {
    await view.unmount();
  }
});
