// AGT-002 actionable review — frontend RED (design
// docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md §§4-5, 12,
// 19.6). None of the production artifacts asserted here exist yet:
// `TenderActionableReviewDrawer.tsx`, `tender-actionable-review-drawer.css` and the CTA/wiring
// changes to `TenderOperationalPendingProjection.tsx`, `TenderDecisionAxisSurface.tsx`,
// `TenderAnalysisSection.tsx` and `main.tsx`. Every test below documents one contract from the
// task brief and must fail today for a missing artifact or absent wiring, not for a typo.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { mountWithJsdom } from './helpers/render-react-dom.mjs';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

function unitPresentation(key, overrides = {}) {
  return {
    key,
    title: `Requisito ${key}`,
    categoryLabel: 'Técnico',
    conclusionLabel: 'Evidencia insuficiente',
    conclusionSummary: 'Conocimiento documental pendiente.',
    commercialImpactLabel: 'Por determinar',
    commercialImpactSummary: 'Impacto por confirmar.',
    missingEvidenceReasons: ['Falta soporte vigente.'],
    actionSummaries: ['Solicitar soporte.'],
    primaryActionSummary: 'Solicitar soporte.',
    requirementId: `REQ-${key}`,
    citedEvidenceCount: 0,
    pendingEvidenceCount: 1,
    evidenceSourceLabels: [],
    hasCitedEvidence: false,
    hasPendingEvidence: true,
    technical: {},
    ...overrides,
  };
}

// --- Contract 1: exactly one "Revisar pendiente" CTA per eligible V3 pending card, with
// projected status and comment/attachment counts; a read-only viewer gets "Ver revisión"
// instead, never both, and the legacy flow is not mounted on the same card. The projection now
// owns its own state (design §10.1/§18): it calls `listReviews` itself instead of receiving a
// parent-computed map, so this asserts against the real async render. -------------------------
test('cada tarjeta pendiente V3 elegible expone exactamente un CTA "Revisar pendiente" con estado y conteos proyectados', async () => {
  const TenderOperationalPendingProjection = await loadReactComponent(
    'src/tenders/components/TenderOperationalPendingProjection.tsx',
    'TenderOperationalPendingProjection',
  );
  const groups = [{
    key: 'grupo-tecnico',
    label: 'Técnico',
    units: [
      unitPresentation('unit-1', { technical: { unitId: 'unit-1' } }),
      unitPresentation('unit-2', { technical: { unitId: 'unit-2' } }),
    ],
  }];
  const items = [
    { id: 'review-item-1', requirement_id: 'REQ-unit-1', state: 'pendiente', outcome: null, sequence: 0, comment_count: 2, attachment_count: 1, current_supports_count: 0, capabilities: { can_contribute: true, can_resolve: true }, timeline: [], attachments: [] },
    { id: 'review-item-2', requirement_id: 'REQ-unit-2', state: 'pendiente', outcome: null, sequence: 0, comment_count: 0, attachment_count: 0, current_supports_count: 0, capabilities: { can_contribute: false, can_resolve: false }, timeline: [], attachments: [] },
  ];
  const view = mountWithJsdom(TenderOperationalPendingProjection, {
    groups,
    count: 2,
    opportunityId: 'opportunity-1',
    analysisRunId: 'run-1',
    currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'comercial', identity_type: 'human' },
    request: async () => ({ analysis_run_id: 'run-1', items, summary: { open_count: 2, confirmed_risk_count: 0 }, history_available: false }),
    apiDownload: async () => new Blob(),
  });
  try {
    await view.flush();
    const html = view.container.innerHTML;
    assert.equal((html.match(/Revisar pendiente/g) || []).length, 1, 'debe existir exactamente un CTA "Revisar pendiente" para la tarjeta con permiso de escritura');
    assert.equal((html.match(/Ver revisión/g) || []).length, 1, 'la tarjeta de sólo lectura debe mostrar "Ver revisión", nunca el CTA de escritura');
    assert.match(html, /aria-haspopup="dialog"/, 'el CTA debe declarar aria-haspopup="dialog"');
    assert.match(html, /aria-controls="/, 'el CTA debe declarar aria-controls hacia el drawer');
    assert.match(html, /aria-expanded="false"/, 'el CTA debe declarar aria-expanded');
    assert.match(html, /2 comentarios/, 'debe mostrar el conteo de comentarios proyectado');
    assert.match(html, /1 archivo/, 'debe mostrar el conteo de archivos proyectado');
    assert.doesNotMatch(html, /Ver detalle \/ Responder|Respuesta histórica \(reanaliza\)/, 'una tarjeta V3 elegible nunca monta el editor legado junto al CTA nuevo');
  } finally {
    await view.unmount();
  }
});

// --- Contract 1b: a unit without structural technical.unitId can never be matched to a source
// nor ensured, so it gets the closed "sin identidad revisable" badge and no CTA at all. ---------
test('una unidad sin technical.unitId estructural muestra el rótulo cerrado y no ofrece ningún CTA', async () => {
  const TenderOperationalPendingProjection = await loadReactComponent(
    'src/tenders/components/TenderOperationalPendingProjection.tsx',
    'TenderOperationalPendingProjection',
  );
  const groups = [{ key: 'grupo-tecnico', label: 'Técnico', units: [unitPresentation('unit-sin-identidad', { technical: {} })] }];
  const view = mountWithJsdom(TenderOperationalPendingProjection, {
    groups,
    count: 1,
    opportunityId: 'opportunity-1',
    analysisRunId: 'run-1',
    currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'comercial', identity_type: 'human' },
    request: async () => ({ analysis_run_id: 'run-1', items: [], summary: { open_count: 0, confirmed_risk_count: 0 }, history_available: false }),
    apiDownload: async () => new Blob(),
  });
  try {
    await view.flush();
    assert.match(view.container.textContent || '', /Pendiente sin identidad revisable/);
    assert.equal(view.container.querySelector('.tender-decision-operational-card-review-cta'), null, 'una tarjeta sin identidad estructural nunca ofrece CTA');
  } finally {
    await view.unmount();
  }
});

// --- Contract 1c: with no persisted row yet, the CTA calls `ensureReview` with card.technical.
// unitId (never requirement_id/title), refreshes the list, and opens the drawer on the exact
// UUID the server returned. -----------------------------------------------------------------------
test('sin pendiente persistido, el CTA llama a ensureReview con technical.unitId y abre el drawer con el UUID devuelto', async () => {
  const TenderOperationalPendingProjection = await loadReactComponent(
    'src/tenders/components/TenderOperationalPendingProjection.tsx',
    'TenderOperationalPendingProjection',
  );
  const groups = [{
    key: 'grupo-tecnico',
    label: 'Técnico',
    units: [unitPresentation('unit-3', { technical: { unitId: 'unit-3' } })],
  }];
  const ensureCalls = [];
  let listCallCount = 0;
  const request = async (path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && path.startsWith('/api/tender-actionable-reviews?')) {
      listCallCount += 1;
      const items = listCallCount > 1
        ? [{ id: 'review-item-3', requirement_id: 'REQ-unit-3', state: 'pendiente', outcome: null, sequence: 0, comment_count: 0, attachment_count: 0, current_supports_count: 0, capabilities: { can_contribute: true, can_resolve: true }, timeline: [], attachments: [] }]
        : [];
      return { analysis_run_id: 'run-1', items, summary: { open_count: items.length, confirmed_risk_count: 0 }, history_available: false };
    }
    if (method === 'POST' && path === '/api/tender-actionable-reviews/ensure') {
      ensureCalls.push(JSON.parse(options.body));
      return { id: 'review-item-3', status: 'pendiente', requirement_id: 'REQ-unit-3' };
    }
    throw new Error(`unexpected call ${method} ${path}`);
  };
  const view = mountWithJsdom(TenderOperationalPendingProjection, {
    groups,
    count: 1,
    opportunityId: 'opportunity-1',
    analysisRunId: 'run-1',
    currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'comercial', identity_type: 'human' },
    request,
    apiDownload: async () => new Blob(),
  });
  try {
    await view.flush();
    await view.click('.tender-decision-operational-card-review-cta');
    for (let i = 0; i < 8; i += 1) await view.flush();
    assert.equal(ensureCalls.length, 1, 'debe llamar ensureReview exactamente una vez');
    assert.deepEqual(ensureCalls[0], { opportunity_id: 'opportunity-1', analysis_run_id: 'run-1', source_kind: 'integral_unit', source_id: 'unit-3' }, 'debe enviar el cuerpo cerrado exacto usando technical.unitId como source_id');
    assert.ok(listCallCount >= 2, 'debe refrescar la lista después de ensure');
    assert.ok(view.container.querySelector('[role="dialog"]'), 'debe abrir el drawer con el UUID devuelto por ensure');
  } finally {
    await view.unmount();
  }
});

// --- Contract 3 (legacy separation half): the new drawer is mounted exclusively inside the
// operational projection/Analysis surface; TenderDecisionAxisSurface never imports it, and its
// own historical/non-eligible flow keeps the legacy "reanaliza" copy untouched. -----------------
test('el drawer nuevo se monta una sola vez en TenderOperationalPendingProjection y TenderDecisionAxisSurface conserva el flujo legado sin importarlo', () => {
  const projectionSource = read('src/tenders/components/TenderOperationalPendingProjection.tsx');
  const mountCount = (projectionSource.match(/<TenderActionableReviewDrawer/g) || []).length;
  assert.equal(mountCount, 1, 'TenderOperationalPendingProjection debe montar el drawer nuevo exactamente una vez');
  assert.match(
    projectionSource,
    /import \{[^}]*TenderActionableReviewDrawer[^}]*\} from '\.\/TenderActionableReviewDrawer'/s,
    'debe importar el drawer nuevo desde su único punto de montaje',
  );

  const axisSurfaceSource = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
  assert.doesNotMatch(
    axisSurfaceSource,
    /TenderActionableReviewDrawer/,
    'TenderDecisionAxisSurface nunca debe importar ni montar el drawer nuevo: duplicaría la fuente de verdad',
  );
  assert.match(axisSurfaceSource, /Respuesta histórica \(reanaliza\)/, 'el flujo legado debe usar la etiqueta fijada por la spec §8.7');
  assert.match(axisSurfaceSource, /Este mecanismo legado crea una nueva corrida; no registra una revisión del pendiente actual\./, 'debe mostrar la advertencia legada exacta antes de guardar');
});

// --- Contract 3b: single source of truth for both the DOM id that anchors an Analysis card and
// the eligibility rule that decides whether a Decision finding may still open the legacy editor.
// Neither concept may be reimplemented locally in either component. -----------------------------
test('Análisis y Decisión comparten el mismo helper de id de tarjeta y la misma regla pura de elegibilidad, sin reimplementarlos', () => {
  const projectionSource = read('src/tenders/components/TenderOperationalPendingProjection.tsx');
  const axisSurfaceSource = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
  const presentationSource = read('src/tenders/tenderIntegralAnalysisPresentation.ts');

  assert.match(presentationSource, /export function tenderOperationalPendingCardDomId\(/, 'el id de la tarjeta debe derivarse en un único helper puro compartido');
  assert.match(
    projectionSource,
    /import \{[\s\S]*?tenderOperationalPendingCardDomId[\s\S]*?\} from '\.\.\/tenderIntegralAnalysisPresentation'/,
    'Análisis debe usar el helper compartido para marcar la tarjeta, nunca un id armado a mano',
  );
  assert.match(
    axisSurfaceSource,
    /import \{[\s\S]*?tenderOperationalPendingCardDomId[\s\S]*?\} from '\.\.\/tenderIntegralAnalysisPresentation'/,
    'Decisión debe usar el mismo helper compartido para enfocar la tarjeta, nunca un id armado a mano',
  );
  assert.doesNotMatch(axisSurfaceSource, /document\.querySelector\(\s*['"`]#/, 'Decisión nunca arma un selector CSS interpolando un id crudo');

  assert.match(
    axisSurfaceSource,
    /import \{ resolvesEligibleForNewDrawer \} from '\.\.\/tenderActionableReviewProjection'/,
    'Decisión debe reutilizar la única regla pura de exclusión mutua, nunca reimplementarla',
  );
});

// --- Contract 2: TenderAnalysisSection threads opportunity id, immutable analysis run id, and
// human identity/permissions into the operational projection — never GO/NO-GO or AGT-002
// execution. --------------------------------------------------------------------------------
test('TenderAnalysisSection pasa opportunityId, analysisRunId inmutable y currentProfile a la proyección operativa', () => {
  const source = read('src/tenders/components/TenderAnalysisSection.tsx');
  assert.match(source, /opportunityId:\s*string/, 'TenderAnalysisSectionProps debe tipar opportunityId');
  assert.match(source, /currentProfile\??:\s*TenderCurrentProfile/, 'TenderAnalysisSectionProps debe tipar currentProfile');
  const projectionCallStart = source.indexOf('<TenderOperationalPendingProjection');
  assert.notEqual(projectionCallStart, -1, 'debe seguir montando TenderOperationalPendingProjection');
  const projectionCall = source.slice(projectionCallStart, projectionCallStart + 400);
  assert.match(projectionCall, /opportunityId=\{opportunityId\}/, 'debe reenviar opportunityId a la proyección');
  assert.match(projectionCall, /analysisRunId=\{analysis\?\.run_id/, 'debe reenviar la corrida inmutable, nunca un id inventado en el cliente');
  assert.match(projectionCall, /currentProfile=\{currentProfile\}/, 'debe reenviar currentProfile para derivar capacidades');
  for (const forbidden of ['reanalyzeAgt002AfterHumanAnswer', 'enqueueAgt002CanonicalReanalysis', 'psi_tender_decisions', 'GO_NO_GO', 'go_no_go']) {
    assert.doesNotMatch(source, new RegExp(forbidden), `TenderAnalysisSection no debe ejecutar/registrar ${forbidden}`);
  }
});

// --- Contract 3: the drawer is a labelled dialog with loading/error/live regions and the six
// ordered sections from §8.3 (header/conclusion/timeline/comment/attachment/resolve). ----------
const drawerProps = {
  item: {
    id: 'review-item-1',
    requirement_title: 'Requisito técnico',
    analysis_conclusion_summary: 'Conclusión del análisis inmutable.',
    state: 'pendiente',
    outcome: null,
    comment_count: 0,
    attachment_count: 0,
    current_supports_count: 0,
    capabilities: { can_contribute: true, can_resolve: true },
    timeline: [],
  },
  opportunityId: 'opportunity-1',
  analysisRunId: 'run-1',
  currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'comercial', permissions: ['licitaciones'] },
  request: async () => ({ items: [], summary: { open_count: 0, confirmed_risk_count: 0 } }),
  apiDownload: async () => new Blob(),
  onClose: () => {},
  triggerLabel: 'Revisar pendiente',
};

test('el drawer es un diálogo etiquetado con regiones vivas/error y las secciones ordenadas de §8.3', async () => {
  const TenderActionableReviewDrawer = await loadReactComponent(
    'src/tenders/components/TenderActionableReviewDrawer.tsx',
    'TenderActionableReviewDrawer',
  );
  const html = renderReactComponent(TenderActionableReviewDrawer, drawerProps);
  assert.match(html, /role="dialog"/, 'el drawer debe ser role="dialog"');
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="/);
  assert.match(html, /aria-describedby="/);
  assert.match(html, /Conclusión del análisis/, 'debe mostrar el bloque de conclusión inmutable');
  assert.match(html, /<ol/, 'el timeline es un ol (§8.6)');
  assert.match(html, /Añadir comentario/);
  assert.match(html, /Adjuntar soporte de revisión/);
  assert.match(html, /Registrar resultado/);
  const timelineIndex = html.indexOf('<ol');
  const commentIndex = html.indexOf('Añadir comentario');
  const attachmentIndex = html.indexOf('Adjuntar soporte de revisión');
  const resolveIndex = html.indexOf('Registrar resultado');
  assert.ok(timelineIndex < commentIndex && commentIndex < attachmentIndex && attachmentIndex < resolveIndex, 'las secciones deben respetar el orden de §8.3');
});

test('el drawer separa carga y error: role="status" mientras carga, role="alert" con Reintentar ante fallo', async () => {
  const TenderActionableReviewDrawer = await loadReactComponent(
    'src/tenders/components/TenderActionableReviewDrawer.tsx',
    'TenderActionableReviewDrawer',
  );
  const loadingHtml = renderReactComponent(TenderActionableReviewDrawer, {
    ...drawerProps,
    request: () => new Promise(() => {}),
  });
  assert.match(loadingHtml, /role="status"/, 'debe anunciar la carga inicial con role="status"');
  const view = mountWithJsdom(TenderActionableReviewDrawer, {
    ...drawerProps,
    request: async () => { throw new Error('boom'); },
  });
  try {
    await view.flush();
    const alert = view.container.querySelector('[role="alert"]');
    assert.ok(alert, 'un error de carga inicial debe mostrar role="alert"');
    assert.match(alert.textContent, /Reintentar/i);
  } finally {
    await view.unmount();
  }
});

// --- Focus management: initial focus on open, Escape closes, focus returns to the exact CTA
// on close (§8.6). ------------------------------------------------------------------------------
test('el drawer mueve el foco al título al abrir, cierra con Escape y devuelve el foco a la CTA original', async () => {
  const TenderActionableReviewDrawer = await loadReactComponent(
    'src/tenders/components/TenderActionableReviewDrawer.tsx',
    'TenderActionableReviewDrawer',
  );
  let closed = false;
  const view = mountWithJsdom(TenderActionableReviewDrawer, {
    ...drawerProps,
    onClose: () => { closed = true; },
  });
  try {
    await view.flush();
    const heading = view.window.document.activeElement;
    assert.notEqual(heading, view.window.document.body, 'el foco inicial debe moverse fuera del body');
    assert.match(heading.textContent || '', /Requisito técnico/);
    view.window.document.dispatchEvent(new view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await view.flush();
    assert.equal(closed, true, 'Escape debe invocar onClose salvo confirmación no cancelable en curso');
  } finally {
    await view.unmount();
  }
});

// --- Contract 4: mandatory copy and the exact closed set of four resolution outcomes; note is
// mandatory to resolve/reopen. ------------------------------------------------------------------
test('el copy incluye "Adjuntar soporte de revisión" y los cuatro resultados cerrados exactos', () => {
  const source = read('src/tenders/components/TenderActionableReviewDrawer.tsx');
  assert.match(source, /Adjuntar soporte de revisión/);
  for (const label of ['Aclarado con soporte', 'Riesgo confirmado', 'No aplica', 'Información insuficiente']) {
    assert.ok(source.includes(label), `falta la etiqueta de resultado ${label}`);
  }
  for (const invented of ['No aplicable', 'Sin resultado', 'Rechazado', 'Pendiente de resultado']) {
    assert.equal(source.includes(invented), false, `no debe inventarse un resultado fuera del dominio: ${invented}`);
  }
  assert.match(source, /nota/i);
  assert.match(source, /required|obligatoria/i, 'la nota debe ser obligatoria para resolver/reabrir');
});

// --- Contract 6: main.tsx passes opportunity.id and currentProfile identity/permissions into
// TenderAnalysisSection, never a service_role credential. ---------------------------------------
test('main.tsx pasa opportunity.id y currentProfile a TenderAnalysisSection sin exponer service_role', () => {
  const main = read('src/main.tsx');
  const callIndex = main.indexOf('<TenderAnalysisSection');
  assert.notEqual(callIndex, -1, 'main.tsx debe seguir montando TenderAnalysisSection');
  const call = main.slice(callIndex, main.indexOf('/>', callIndex) + 2);
  assert.match(call, /opportunityId=\{opportunity\.id\}/, 'debe pasar el id real de la oportunidad (la variable en alcance es `opportunity`, no un alias `o` inventado)');
  assert.match(call, /currentProfile=\{(?:data\.)?currentProfile\}/, 'debe pasar la identidad/permisos humanos vigentes');
  assert.doesNotMatch(call, /service_role/i, 'nunca debe exponer una credencial service_role al navegador');
});

// --- Contract 7: responsive drawer/card states and reduced-motion/accessibility hooks are
// asserted statically. -----------------------------------------------------------------------
test('el CSS del drawer declara estados responsive y respeta prefers-reduced-motion', () => {
  const drawerSource = read('src/tenders/components/TenderActionableReviewDrawer.tsx');
  assert.match(drawerSource, /import '\.\/tender-actionable-review-drawer\.css'/, 'el drawer debe traer su propia hoja de estilos, igual que TenderDecisionAxisSurface');
  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  assert.match(css, /@media \(max-width: 640px\)/, 'debe declarar el punto de quiebre móvil de una sola columna (§8.6)');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'debe neutralizar animación/transición para reduced-motion');
  assert.match(css, /overflow-wrap\s*:\s*anywhere/, 'el drawer móvil no debe producir scroll horizontal (§8.6)');
});

test('el CSS de la tarjeta operativa declara estados de la tarjeta compacta (badge/CTA)', () => {
  const css = read('src/tenders/components/tender-decision-axis-surface.css');
  assert.match(css, /\.tender-decision-operational-card-review-cta/, 'debe existir una clase dedicada al CTA "Revisar pendiente" en la tarjeta compacta');
  assert.match(css, /\.tender-decision-operational-card-badge/, 'debe existir una clase dedicada al badge de estado de la tarjeta compacta');
});

// --- AGT-002 visual QA · dos citas provenientes de una sola fuente documental deben presentarse
// con el copy exacto "N citas en M documento(s): <fuentes>", no la redacción genérica anterior de
// "referencia(s) documental(es)". -----------------------------------------------------------------
test('la tarjeta operativa presenta el copy exacto de citas cuando dos referencias provienen de una sola fuente documental', async () => {
  const TenderOperationalPendingProjection = await loadReactComponent(
    'src/tenders/components/TenderOperationalPendingProjection.tsx',
    'TenderOperationalPendingProjection',
  );
  const groups = [{
    key: 'grupo-tecnico',
    label: 'Técnico',
    units: [unitPresentation('unit-citas', {
      technical: { unitId: 'unit-citas' },
      citedEvidenceCount: 2,
      evidenceSourceLabels: ['Documento del pliego'],
      hasCitedEvidence: true,
    })],
  }];
  const view = mountWithJsdom(TenderOperationalPendingProjection, {
    groups,
    count: 1,
    opportunityId: 'opportunity-1',
    analysisRunId: 'run-1',
    currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'comercial', identity_type: 'human' },
    request: async () => ({ analysis_run_id: 'run-1', items: [], summary: { open_count: 0, confirmed_risk_count: 0 }, history_available: false }),
    apiDownload: async () => new Blob(),
  });
  try {
    await view.flush();
    assert.match(
      view.container.textContent || '',
      /2 citas en 1 documento: Documento del pliego/,
      'dos citas provenientes de una sola fuente deben presentarse exactamente como "2 citas en 1 documento: Documento del pliego"',
    );
  } finally {
    await view.unmount();
  }
});

// --- AGT-002 visual QA · el encabezado sticky del drawer necesita espacio propio y una
// separación visible para no aparentar solaparse con el contenido que se desplaza debajo. --------
test('el encabezado sticky del drawer reserva espacio simétrico y una separación visible frente al contenido que se desplaza debajo', () => {
  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  const headerRuleMatch = css.match(/\.tender-actionable-review-drawer-header\s*\{([^}]*)\}/);
  assert.ok(headerRuleMatch, 'debe existir la regla del encabezado sticky del drawer');
  const headerRule = headerRuleMatch[1];
  assert.match(headerRule, /padding-top\s*:/, 'el encabezado sticky necesita espacio superior propio, no sólo el padding heredado del contenedor con scroll');
  assert.match(
    headerRule,
    /box-shadow\s*:|border-bottom\s*:/,
    'el encabezado sticky necesita una separación visible (box-shadow o border-bottom) para no aparentar solaparse con el contenido que se desplaza debajo',
  );
});

// --- AGT-002 visual QA · las filas de resultado (radio) del drawer deben ocupar el ancho
// completo del formulario y alinear su contenido a la izquierda de forma explícita. --------------
test('las filas de resultado (radio) del drawer ocupan el ancho completo y alinean el texto a la izquierda', () => {
  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  const outcomeRuleMatch = css.match(/\.tender-actionable-review-drawer-outcome-option\s*,\s*\.tender-actionable-review-drawer-checkbox\s*\{([^}]*)\}/);
  assert.ok(outcomeRuleMatch, 'debe existir la regla compartida de las filas de resultado y checkbox');
  const outcomeRule = outcomeRuleMatch[1];
  assert.match(outcomeRule, /width\s*:\s*100%/, 'cada fila de resultado debe declarar ancho completo explícito, no depender de un contenedor que podría encogerla');
  assert.match(
    outcomeRule,
    /justify-content\s*:\s*flex-start|text-align\s*:\s*left/,
    'cada fila de resultado debe alinear su contenido a la izquierda de forma explícita',
  );
});

// --- AGT-002 visual QA · el input de archivo del drawer no puede dejar el botón nativo del
// selector de archivo con el estilo por defecto del navegador. -----------------------------------
test('el input de archivo del drawer estiliza el botón nativo ::file-selector-button', () => {
  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  assert.match(
    css,
    /\.tender-actionable-review-drawer\s+input\[type="file"\]::file-selector-button\s*\{[^}]*\}/,
    'debe existir una regla dedicada a ::file-selector-button para que el botón nativo de selección de archivo no se muestre con el estilo por defecto del navegador',
  );
});

// --- AGT-002 visual QA · los botones deshabilitados del drawer necesitan un color de texto
// legible propio: la regla global de sólo opacidad reduce el contraste por debajo de lo legible.
test('los botones deshabilitados del drawer declaran un color de texto legible propio', () => {
  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  const disabledRuleMatch = css.match(/\.tender-actionable-review-drawer\s+button:disabled\s*\{([^}]*)\}/);
  assert.ok(disabledRuleMatch, 'debe existir una regla propia para botones deshabilitados del drawer');
  assert.match(
    disabledRuleMatch[1],
    /color\s*:/,
    'la regla debe fijar un color de texto explícito, para no depender únicamente de la opacidad global que reduce el contraste',
  );
});

// --- AGT-002 post-review a11y hotfix · the global `button:disabled,input:disabled{opacity:.58}`
// rule (src/styles.css) crushes contrast on the drawer's disabled buttons. Disabled controls are
// exempt from WCAG 1.4.3, but this project still holds them to an internal readability/design
// target: the drawer's own `button:disabled` rule must neutralize that opacity (opacity:1),
// declare its own light background and a readable foreground, and the declared hex pair must
// clear this project's internal target of >= 4.5:1 for normal text. Computed statically from the
// declared hex values — no browser rendering involved, so this stays deterministic in Node. -----
function expandHex(hex) {
  const body = hex.replace('#', '');
  const full = body.length === 3 ? body.split('').map(ch => ch + ch).join('') : body.slice(0, 6);
  return full;
}

function hexToRgb(hex) {
  const full = expandHex(hex);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function srgbChannelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r, g, b].map(srgbChannelToLinear);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

test('el botón deshabilitado del drawer neutraliza la opacidad global y mantiene el objetivo interno de legibilidad (>= 4.5:1)', () => {
  const globalCss = read('src/styles.css');
  assert.match(
    globalCss,
    /button:disabled\s*,\s*input:disabled\s*\{[^}]*opacity\s*:\s*\.58/,
    'precondición: la regla global debe seguir reduciendo la opacidad a .58 (si esto cambia, este hotfix debe revisarse)',
  );

  const css = read('src/tenders/components/tender-actionable-review-drawer.css');
  const disabledRuleMatch = css.match(/\.tender-actionable-review-drawer\s+button:disabled\s*\{([^}]*)\}/);
  assert.ok(disabledRuleMatch, 'debe existir una regla propia para botones deshabilitados del drawer');
  const decl = disabledRuleMatch[1];

  const opacityMatch = decl.match(/opacity\s*:\s*([\d.]+)\s*(?:!important)?\s*;?/);
  assert.ok(opacityMatch, 'la regla debe fijar opacity explícita para neutralizar la opacidad global .58 heredada de src/styles.css');
  assert.equal(Number(opacityMatch[1]), 1, 'opacity debe ser 1 para anular por completo la reducción global de opacidad (.58)');

  const backgroundMatch = decl.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(backgroundMatch, 'la regla debe declarar un fondo claro propio para el estado deshabilitado, no depender del fondo heredado');
  const backgroundHex = backgroundMatch[1];
  assert.ok(relativeLuminance(backgroundHex) > 0.5, 'el fondo declarado para el estado deshabilitado debe ser claro');

  const colorMatch = decl.match(/(?<!background-)(?<!-)\bcolor\s*:\s*(#[0-9a-fA-F]{3,8})/);
  assert.ok(colorMatch, 'la regla debe fijar un color de texto explícito y legible');
  const foregroundHex = colorMatch[1];

  const ratio = contrastRatio(foregroundHex, backgroundHex);
  assert.ok(
    ratio >= 4.5,
    `el contraste entre el color declarado (${foregroundHex}) y el fondo declarado (${backgroundHex}) es ${ratio.toFixed(2)}:1, por debajo del objetivo interno de legibilidad/diseño de este proyecto de 4.5:1`,
  );
});

console.log('AGT-002 actionable review frontend UI contract (RED — production artifacts missing) checked');
