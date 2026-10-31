// Pedir un borrador a Vig-IA desde el panel de documentos del expediente (punto 8).
//
// Las otras pruebas de este panel fijan el texto fuente. Esta monta el componente de verdad en
// jsdom y afirma sobre el DOM que React produce y sobre el cuerpo que la pantalla postea, porque
// lo que hay que demostrar es justamente lo que un `assert.match` sobre el archivo no ve: que la
// fila se sigue pintando en los cuatro estados, que el botón aparece sólo donde debe, y que el
// pedido lleva la versión vigente que el control optimista del servidor va a comparar.
//
// Importa en esta semana: Terminal cierra el 4 de noviembre y es la pantalla que Katherine usa, así
// que un error de render en este panel le quitaría los documentos del expediente.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, useState } from 'react';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const TenderDossierArtifacts = await loadReactComponent(
  'src/tenders/components/TenderDossierArtifacts.tsx',
  'TenderDossierArtifacts',
);

const OPPORTUNITY = '6ca7043f-ec54-4938-8674-1696403123bd';
const THREAD = '10000000-0000-4000-8000-0000000000aa';
const SNAPSHOT = '10000000-0000-4000-8000-0000000000bb';
const CONTEXT_LINKS = [{ kind: 'snapshot', id: SNAPSHOT, label: 'Paquete analizado', source_ref: 'psi:1' }];

// Los cuatro estados que un expediente real presenta hoy en Terminal (medido por select el
// 2026-10-31): sin versión, con versión humana vigente, con versión de Vig-IA por revisar, y
// aprobada.
function artifact(overrides = {}) {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    artifact_key: 'anexo_07_experiencia',
    title: 'Anexo 7 · Certificaciones de experiencia',
    required: true,
    origin: 'seed_go',
    current_version: null,
    review_status: 'pendiente',
    has_approved_version: false,
    version_count: 0,
    ...overrides,
  };
}
const humanVersion = {
  id: '10000000-0000-4000-8000-0000000000c1',
  version: 1,
  content_kind: 'markdown',
  content_text: 'Relación de contratos de vigilancia ejecutados.',
  content_metadata: null,
  author_id: 'profile-1',
  author_kind: 'human',
  origin_agent_job_id: null,
  created_at: '2026-10-30T12:00:00.000Z',
};

function makeRequest(routes) {
  const calls = [];
  const request = async (path, options) => {
    const method = options?.method || 'GET';
    calls.push({ method, path, body: options?.body ? JSON.parse(options.body) : null });
    for (const route of routes) {
      if (path.startsWith(route.path) && (route.method || 'GET') === method) {
        return typeof route.reply === 'function' ? route.reply() : route.reply;
      }
    }
    throw new Error(`ruta no esperada en la prueba: ${method} ${path}`);
  };
  return { request, calls };
}

const mesaRoutes = [
  {
    path: '/api/tender-dossier-workbench',
    reply: () => ({
      enabled: true,
      thread_id: THREAD,
      reference: { snapshot_id: SNAPSHOT, context_links: CONTEXT_LINKS },
      messages: [], jobs: [], required_actions: [], learning_proposals: [], active_learning_policies: [],
    }),
  },
  { path: '/api/tender-dossier-workbench/messages', method: 'POST', reply: () => ({ status: 'queued', job_id: 'job-1' }) },
];

const labels = container => [...container.querySelectorAll('button')].map(button => button.textContent.trim());
const byText = (container, text) => [...container.querySelectorAll('button')].find(button => button.textContent.trim() === text);
const DRAFT_LABEL = 'Pedir borrador a Vig-IA Licitaciones';

async function waitUntil(view, predicate, label, turns = 50) {
  for (let index = 0; index < turns; index += 1) {
    if (predicate()) return;
    await view.flush();
  }
  throw new Error(`tiempo de espera agotado sin cumplirse: ${label}`);
}

function mount(artifacts, { workbenchEnabled = true, canApprove = false, routes = mesaRoutes } = {}) {
  const { request, calls } = makeRequest(routes);
  const view = mountWithJsdom(TenderDossierArtifacts, {
    opportunityId: OPPORTUNITY,
    artifacts,
    request,
    canApprove,
    workbenchEnabled,
    onChanged: async () => {},
  });
  return { view, calls };
}

test('1 — las cuatro filas se pintan y el botón aparece sólo donde debe', async () => {
  const { view } = mount([
    artifact({ id: 'a-sin-version' }),
    artifact({ id: 'a-humana', current_version: humanVersion, version_count: 1 }),
    artifact({ id: 'a-agente', version_count: 2, current_version: { ...humanVersion, version: 2, author_kind: 'agent', origin_agent_job_id: 'job-0' } }),
    artifact({ id: 'a-aprobada', current_version: humanVersion, version_count: 1, review_status: 'aprobado', has_approved_version: true }),
  ]);
  try {
    // Render completo: las cuatro filas existen, así que ningún estado rompe el panel.
    assert.equal(view.container.querySelectorAll('details.tender-dossier-artifact').length, 4);
    // Tres pedibles (sin versión, humana, de agente); la aprobada no.
    assert.equal(labels(view.container).filter(label => label === DRAFT_LABEL).length, 3);
    const aprobada = view.container.querySelectorAll('details.tender-dossier-artifact')[3];
    assert.ok(!byText(aprobada, DRAFT_LABEL), 'no se pide borrador sobre una versión aprobada');
    assert.match(aprobada.textContent, /aprobada: un borrador nuevo la reemplazar/i, 'y se dice por qué');
    // La procedencia de una versión de Vig-IA se declara en la fila.
    const agente = view.container.querySelectorAll('details.tender-dossier-artifact')[2];
    assert.match(agente.textContent, /la vigente la redactó Vig-IA Licitaciones y está pendiente de revisión humana/);
    // Y no se declara donde la versión es humana.
    const humana = view.container.querySelectorAll('details.tender-dossier-artifact')[1];
    assert.doesNotMatch(humana.textContent, /la redactó Vig-IA/);
  } finally { await view.unmount(); }
});

test('2 — con la Mesa apagada no se ofrece el pedido, y el panel sigue sirviendo', async () => {
  const { view, calls } = mount([artifact({ current_version: humanVersion, version_count: 1 })], { workbenchEnabled: false });
  try {
    assert.ok(!byText(view.container, DRAFT_LABEL));
    assert.doesNotMatch(view.container.textContent, /aprobada: un borrador nuevo/i);
    // El camino humano de siempre sigue en pie.
    assert.ok(byText(view.container, 'Guardar nueva versión'));
    assert.equal(calls.length, 0, 'un panel sin Mesa no consulta la Mesa');
  } finally { await view.unmount(); }
});

test('3 — el pedido lleva la versión vigente que el servidor va a comparar', async () => {
  const { view, calls } = mount([artifact({ current_version: humanVersion, version_count: 1 })]);
  try {
    await view.click('button.secondary');
    await waitUntil(view, () => calls.some(call => call.method === 'POST'), 'el POST del pedido');
    assert.deepEqual(calls.map(call => `${call.method} ${call.path.split('?')[0]}`), [
      'GET /api/tender-dossier-workbench',
      'POST /api/tender-dossier-workbench/messages',
    ], 'primero se lee el hilo y la referencia canónica, después se postea');
    const body = calls.find(call => call.method === 'POST').body;
    assert.equal(body.capability_id, 'agt002.dossier-workbench.draft.v1');
    assert.equal(body.artifact_id, '10000000-0000-4000-8000-000000000001');
    assert.equal(body.base_version_id, humanVersion.id, 'la versión vigente, no null: si no, la RPC responde stale');
    assert.equal(body.thread_id, THREAD);
    assert.equal(body.snapshot_id, SNAPSHOT);
    assert.deepEqual(body.context_links, CONTEXT_LINKS);
    assert.match(body.content, /versión 1 que ya está registrada/);
    assert.match(body.client_message_id, /^[0-9a-f-]{36}$/);
  } finally { await view.unmount(); }
});

test('4 — el primer borrador de un documento sin versión va con base en null', async () => {
  const { view, calls } = mount([artifact()]);
  try {
    await view.click('button.secondary');
    await waitUntil(view, () => calls.some(call => call.method === 'POST'), 'el POST del pedido');
    const body = calls.find(call => call.method === 'POST').body;
    assert.equal(body.base_version_id, null);
    assert.match(body.content, /primer borrador/);
  } finally { await view.unmount(); }
});

test('5 — si el borrador no aterriza la fila lo dice, y nunca se queda pegado', async () => {
  const { view, calls } = mount([artifact({ current_version: humanVersion, version_count: 1 })]);
  try {
    await view.click('button.secondary');
    await waitUntil(view, () => /El pedido quedó registrado y todavía no hay versión nueva/.test(view.container.textContent),
      'el aviso de pedido sin borrador');
    assert.ok(calls.some(call => call.method === 'POST'));
  } finally { await view.unmount(); }

  // Y con el borrador aterrizado el aviso no aparece: el contenedor recarga y pasa la versión
  // nueva por props, igual que en producción. El aviso es derivado, no un estado que se quede
  // pegado diciendo que no llegó algo que sí llegó.
  const landed = { ...humanVersion, id: '10000000-0000-4000-8000-0000000000c2', version: 2, author_kind: 'agent', origin_agent_job_id: 'job-1' };
  const { request, calls: landedCalls } = makeRequest(mesaRoutes);
  function Harness() {
    const [version, setVersion] = useState(humanVersion);
    return createElement(TenderDossierArtifacts, {
      opportunityId: OPPORTUNITY,
      artifacts: [artifact({ current_version: version, version_count: version === humanVersion ? 1 : 2 })],
      request,
      canApprove: false,
      workbenchEnabled: true,
      // Lo que hace el contenedor tras una mutación confirmada: releer y volver a pasar props.
      onChanged: async () => { setVersion(landed); },
    });
  }
  const second = mountWithJsdom(Harness, {});
  try {
    await second.click('button.secondary');
    await waitUntil(second, () => landedCalls.some(call => call.method === 'POST'), 'el POST del pedido');
    await waitUntil(second, () => /Versión 2/.test(second.container.textContent), 'la versión nueva en la fila');
    assert.doesNotMatch(second.container.textContent, /El pedido quedó registrado y todavía no hay versión nueva/,
      'con el borrador aterrizado el aviso tiene que haber desaparecido solo');
    assert.match(second.container.textContent, /la vigente la redactó Vig-IA Licitaciones y está pendiente de revisión humana/);
  } finally { await second.unmount(); }
});

test('6 — un rechazo del servidor se muestra y no se inventa que el borrador llegó', async () => {
  const { view } = mount([artifact({ current_version: humanVersion, version_count: 1 })], {
    routes: [
      mesaRoutes[0],
      {
        path: '/api/tender-dossier-workbench/messages',
        method: 'POST',
        reply: () => { throw new Error('El documento cambió de versión mientras se pedía el borrador; vuelva a abrir el expediente.'); },
      },
    ],
  });
  try {
    await view.click('button.secondary');
    await waitUntil(view, () => /cambió de versión/.test(view.container.textContent), 'el mensaje del servidor en pantalla');
    assert.ok(view.container.querySelector('[role="alert"]'), 'el rechazo se anuncia como alerta');
    assert.doesNotMatch(view.container.textContent, /El pedido quedó registrado/, 'un pedido rechazado no se da por registrado');
  } finally { await view.unmount(); }
});
