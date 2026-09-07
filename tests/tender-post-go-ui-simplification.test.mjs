// RED — próxima simplificación de la UI posterior a GO. Este archivo fija, contra el código
// actual, las señales visibles que deben desaparecer una vez completada la simplificación:
//   A) El panel formal GO/NO GO repite "Control formal" y un artículo puntero
//      ("Aquí sólo se registra la decisión humana") que ya no debe existir en el resumen, y ese
//      resumen no puede repetir el puntero a pendientes de Análisis que ya vive en el eje de
//      decisión.
//   B) La superficie del eje de decisión, en su variante formal-primaria (post-GO / cinco ejes sin
//      evaluar con unidades V3 abiertas), deja de necesitar su propio puntero a Análisis.
//   C) TenderOfferPreparationPanel (src/main.tsx) deja de repetir el plan inicial completo, los
//      documentos por generar, los pendientes humanos, las notas del sistema y la nota interna de
//      preparación, todo eso ya representado por el expediente canónico.
//   D) TenderOfferStatusPanel deja de mostrar el historial siempre expandido con un texto vacío
//      dedicado; el historial pasa a un <details> cerrado por defecto.
// Ninguna de estas aserciones puede fallar por un error de configuración: todas montan/leen
// exactamente los mismos componentes reales que el resto de la suite (esbuild + jsdom real).
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const TenderGoNoGoDecisionPanel = await loadReactComponent(
  'src/tenders/components/TenderGoNoGoDecisionPanel.tsx',
  'TenderGoNoGoDecisionPanel',
);
const TenderOfferStatusPanel = await loadReactComponent(
  'src/tenders/components/TenderOfferStatusPanel.tsx',
  'TenderOfferStatusPanel',
);

const AUTHORIZED_PROFILE = {
  id: 'profile-1',
  full_name: 'Dirección de Licitaciones',
  role: 'director',
  active: true,
  identity_type: 'human',
  permissions: ['licitaciones'],
};

async function settle(view, turns = 8) {
  for (let index = 0; index < turns; index += 1) await view.flush();
}

// --- A) El resumen formal GO/NO GO no puede repetir "Control formal" ni el puntero a Análisis ---

const CURRENT_GO_DECISION = {
  id: 'decision-go-1',
  opportunity_id: 'opportunity-1',
  tender_id: 'tender-1',
  decision: 'go',
  analysis_interaction_id: null,
  analysis_run_id: 'run-current',
  justification: null,
  decided_by: 'profile-1',
  decided_at: '2026-09-01T15:00:00.000Z',
  supersedes_decision_id: null,
  psi_sales_profiles: { full_name: 'Dirección de Licitaciones' },
};

// Un impedimento material confirmado pendiente: exactamente la condición que hoy activa el
// puntero "Revisar pendientes en Análisis" dentro del panel formal, aun con GO ya vigente.
const ANALYSIS_WITH_PENDING_BLOCKER = {
  run_id: 'run-current',
  snapshot_id: 'snapshot-1',
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  critical_open_count: 1,
  decision_review: {
    artifact_type: 'tender_decision_review',
    contract_version: 'agt002-decision-review@1',
    opportunity_id: 'opportunity-1',
    human_approval_required: true,
    decision_status: 'pending_human_decision',
    decision_ready: false,
    routing_action: 'flag_for_responsible_person',
    external_communications_allowed: false,
    evidence_requests_allowed: true,
    review_findings: [],
    exercise_mode: { active: false, bypassed_requirement_ids: [] },
    recommendation: 'do_not_advance',
    blockers: [{
      id: 'blocker-1',
      requirement_id: 'req-1',
      label: 'Impedimento material confirmado',
      reviewed_status: 'blocker',
      rationale: 'TEXTO-INTERNO-NUNCA-FRONTAL',
      evidence_refs: [],
      material_impediment_category: 'capacidad_financiera_insuficiente',
      presentation: {
        title: 'Impedimento material confirmado',
        summary: 'Resumen humano del impedimento.',
        missing: 'Falta evidencia vigente.',
        action_required: 'Revisar con la persona responsable.',
      },
    }],
    decision_questions: [],
    supported: [],
    preparation: [],
    not_applicable: [],
    counts: { supported: 0, preparation: 0, not_applicable: 0, decision_questions: 0, blockers: 1 },
  },
};

function makeDecisionRequest(reply) {
  return async (path, options) => {
    const method = options?.method || 'GET';
    if (path.startsWith('/api/tender-go-no-go-decision') && method === 'GET') return reply;
    throw new Error(`ruta no esperada en la prueba: ${method} ${path}`);
  };
}

test('A — con GO vigente el resumen formal ya no repite "Control formal" ni su puntero, ni duplica los pendientes de Análisis', async () => {
  const view = mountWithJsdom(TenderGoNoGoDecisionPanel, {
    opportunityId: 'opportunity-1',
    opportunityName: 'Oportunidad de prueba',
    analysis: ANALYSIS_WITH_PENDING_BLOCKER,
    currentProfile: AUTHORIZED_PROFILE,
    request: makeDecisionRequest({ decision: CURRENT_GO_DECISION, history: [CURRENT_GO_DECISION], preparation: null }),
    questionResponses: [],
    onChanged: () => {},
  });
  try {
    await settle(view);
    assert.ok(view.container.textContent.includes('GO registrado'), 'la decisión vigente debe seguir siendo visible (precondición de la prueba)');

    assert.equal(
      /Control formal/.test(view.container.textContent),
      false,
      'el panel simplificado no puede mostrar "Control formal" como copia visible',
    );
    assert.equal(
      view.container.textContent.includes('Aquí sólo se registra la decisión humana'),
      false,
      'el artículo puntero "Aquí sólo se registra la decisión humana" debe desaparecer del resumen',
    );
    assert.equal(
      view.container.textContent.includes('Revisar pendientes en Análisis'),
      false,
      'el panel formal no puede duplicar el puntero a pendientes de Análisis que ya vive en el eje de decisión',
    );

    const summaryArticles = view.container.querySelectorAll('.tender-go-no-go-summary > article');
    assert.equal(
      summaryArticles.length,
      2,
      'el resumen debe conservar exactamente dos artículos directos (decisión vigente y estado operativo), sin el puntero de control formal',
    );
  } finally {
    await view.unmount();
  }
});

// --- B) La variante formal-primaria del eje de decisión no necesita su propio puntero a Análisis ---

test('B — la variante formal-primaria del eje de decisión ya no trae su propio puntero a Análisis', () => {
  const surfaceSource = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
  assert.equal(
    /tender-decision-analysis-pointer/.test(surfaceSource),
    false,
    'la superficie formal-primaria no puede mantener su propio bloque puntero a Análisis',
  );
  assert.equal(
    surfaceSource.includes('Pendientes documentales en Análisis'),
    false,
    'el copy "Pendientes documentales en Análisis" debe desaparecer de la variante formal-primaria',
  );
});

// --- C) TenderOfferPreparationPanel (src/main.tsx) deja de repetir el plan completo de preparación ---

test('C — TenderOfferPreparationPanel conserva TenderOfferStatusPanel y "Abrir carpeta" condicional, sin repetir el plan legado', () => {
  const mainSource = read('src/main.tsx');
  const match = mainSource.match(/function TenderOfferPreparationPanel[\s\S]*?\nfunction tenderDocumentTypeLabel/);
  assert.ok(match, 'debe seguir existiendo la función TenderOfferPreparationPanel en src/main.tsx');
  const panelSource = match[0];

  assert.match(panelSource, /TenderOfferStatusPanel/, 'el expediente de oferta debe seguir montando TenderOfferStatusPanel');
  assert.match(
    panelSource,
    /\{sharePointUrl \? <a[\s\S]*?>Abrir carpeta<\/a> : /,
    '"Abrir carpeta" sólo puede renderizarse condicionado a que exista sharePointUrl',
  );

  for (const legacy of [
    'Plan inicial de preparación',
    'Documentos por generar',
    'Requiere intervención humana',
    'Notas del sistema sobre el plan',
    'Nota interna de preparación',
    'Carpeta SharePoint / OneDrive',
    'El registro formal GO genera automáticamente',
  ]) {
    assert.equal(panelSource.includes(legacy), false, `TenderOfferPreparationPanel no puede seguir mostrando la copia legada: ${legacy}`);
  }
});

// --- D) TenderOfferStatusPanel: el historial deja de mostrarse siempre expandido ---

function makeStatusRequest(reply) {
  return async (path, options) => {
    const method = options?.method || 'GET';
    if (path.startsWith('/api/tender-offer-status') && method === 'GET') return reply;
    throw new Error(`ruta no esperada en la prueba: ${method} ${path}`);
  };
}

function mountStatusPanel(reply) {
  return mountWithJsdom(TenderOfferStatusPanel, {
    opportunityId: 'opportunity-1',
    opportunityName: 'Oportunidad de prueba',
    currentProfile: AUTHORIZED_PROFILE,
    request: makeStatusRequest(reply),
    onChanged: () => {},
  });
}

test('D — con historial vacío no aparece el texto "Sin cambios posteriores a la autorización GO" ni un contenedor de historial', async () => {
  const view = mountStatusPanel({ status: 'presentada', history: [] });
  try {
    await settle(view);
    assert.equal(
      view.container.textContent.includes('Sin cambios posteriores a la autorización GO'),
      false,
      'un historial vacío no debe describirse con un texto dedicado',
    );
    assert.equal(
      view.container.querySelector('section[aria-label="Historial auditable de estado de oferta"], details'),
      null,
      'sin eventos no debe quedar ningún contenedor de historial montado',
    );
  } finally {
    await view.unmount();
  }
});

test('D — con un evento de historial el historial vive en un <details> cerrado por defecto', async () => {
  const historyEvent = {
    id: 'transition-1',
    from_status: 'en_preparacion',
    to_status: 'lista_para_presentar',
    actor_id: 'profile-1',
    changed_at: '2026-09-05T10:00:00.000Z',
    note: null,
    psi_sales_profiles: { full_name: 'Dirección de Licitaciones' },
  };
  const view = mountStatusPanel({ status: 'presentada', history: [historyEvent] });
  try {
    await settle(view);
    const details = view.container.querySelector('details');
    assert.ok(details, 'el historial de estados debe vivir dentro de un <details>');
    const summary = details?.querySelector('summary');
    assert.equal(summary?.textContent.trim(), 'Historial de estados', 'el <summary> debe anunciar "Historial de estados"');
    assert.equal(details?.hasAttribute('open'), false, 'el historial debe iniciar cerrado por defecto');
  } finally {
    await view.unmount();
  }
});

// --- E) Cableado del expediente canónico que la simplificación no puede romper ---

test('E — TenderDossierWorkspacePanel conserva su cableado a checklist, documentos, readiness y can_mark_ready', () => {
  const panelSource = read('src/tenders/components/TenderDossierWorkspacePanel.tsx');
  assert.match(panelSource, /import \{ TenderDossierArtifacts \} from '\.\/TenderDossierArtifacts';/);
  assert.match(panelSource, /import \{ TenderDossierChecklist \} from '\.\/TenderDossierChecklist';/);
  assert.match(panelSource, /<TenderDossierChecklist[^>]*workspace=\{workspace\}/);
  assert.match(panelSource, /<TenderDossierArtifacts[^>]*artifacts=\{workspace\.artifacts\}/);
  assert.match(panelSource, /readiness\?\.ready/);
  assert.match(panelSource, /workspace\.can_mark_ready/);
});
