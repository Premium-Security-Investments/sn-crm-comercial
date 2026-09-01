import { readFileSync, mkdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const component = readFileSync(new URL('../src/tenders/components/TenderDetailNavigation.tsx', import.meta.url), 'utf8');
const navigationState = readFileSync(new URL('../src/tenders/detailNavigationState.ts', import.meta.url), 'utf8');
const decisionPanel = readFileSync(new URL('../src/tenders/components/TenderGoNoGoDecisionPanel.tsx', import.meta.url), 'utf8');
const documentSection = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const corpus = `${component}\n${navigationState}\n${main}`;
const countOfSource = (haystack, needle) => haystack.split(needle).length - 1;

for (const id of ['tender-summary', 'tender-document-review', 'tender-analysis', 'tender-decision', 'tender-preparation', 'tender-follow-up']) {
  assert.match(corpus, new RegExp(`id=[\\"'{]*${id}|['\\"]${id}['\\"]`), `falta ancla ${id}`);
  assert.match(navigationState, new RegExp(id), `la navegación debe apuntar a ${id}`);
}
for (const label of ['Resumen', 'Documentos', 'Análisis', 'Decisión', 'Preparación', 'Seguimiento']) assert.match(navigationState, new RegExp(label));
assert.doesNotMatch(component, /tender-detail-breadcrumb|Ruta del expediente|Línea de avance/);
assert.match(component, /← Oportunidades/);
assert.match(component, /aria-label="Abrir fuente oficial en una pestaña nueva"/);
assert.match(component, /aria-label="Secciones del expediente"/);
assert.match(component, /IntersectionObserver/);
assert.match(component, /new IntersectionObserver\(/, 'el shell debe seguir usando el IntersectionObserver real del navegador');
// La acumulación de visibilidad ya no se verifica buscando texto: se prueba conductualmente sobre
// `createTenderDetailSectionObserver` (lotes parciales de entradas) al final de este archivo.
assert.match(component, /createTenderDetailSectionObserver/, 'el efecto debe delegar en el helper observable y testeable');
assert.match(component, /openTenderDetailSection/, 'la navegación debe delegar en el helper de estado + scroll + foco');
// Guardas de cableado: el comportamiento se prueba abajo, pero el efecto real debe conectar el
// observer con los contenedores del documento y con el estado que dibuja `aria-current`.
assert.match(component, /resolveElement: id => document\.getElementById\(id\)/, 'el observer debe resolver contenedores reales del documento');
assert.match(component, /onVisibleSection:\s*(?:[A-Za-z_$][\w$]*Intent\.)?onObservedSection\b/, 'el observer debe delegar la sección visible en el intent de navegación que actualiza aria-current');
assert.match(component, /aria-current=\{activeSection === id \? 'location' : undefined\}/);
assert.match(component, /tender-detail-indicator/);
assert.match(component, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
assert.match(component, /sourceUrl/);
assert.match(component, /observations/);
assert.match(component, /Link fuente:/, 'el URL histórico sólo debe ser fallback explícito');
assert.match(main, /<TenderDetailNavigation/);
assert.match(main, /statusSnapshot=\{tenderNavigationSnapshot\}/);
assert.match(main, /onNavigationStateChanged/);
assert.match(main, /importError: Boolean\(data\.import_error\)/, 'La navegación debe conservar fallos de importación documentales persistidos.');
assert.match(decisionPanel, /onNavigationStateChanged/);
assert.doesNotMatch(main, /\/api\/tender-opportunities[^'"`]*opportunity_id/, 'no debe agregarse una solicitud duplicada');
assert.match(server, /from\('psi_public_tenders'\)\.select\('url'\)\.eq\('converted_opportunity_id', id\)/);
assert.match(server, /opportunity\.source_url = tenderSource\?\.url \|\| getTenderSourceUrlFromOpportunity\(opportunity\)/);
assert.match(styles, /\.tender-detail-navigation\{[^}]*grid-template-columns:/);
assert.match(styles, /\.tender-detail-sections\{[^}]*overflow-x:auto/);
for (const tone of ['ready', 'attention', 'error', 'unknown']) assert.match(styles, new RegExp(`\\.tender-detail-indicator\\.tone-${tone}`));
assert.match(styles, /scroll-margin-top/);

// ---------------------------------------------------------------------------------------------
// Task 6 · único enlace Fuente oficial en el shell; Documentos y Resumen no lo duplican.
// ---------------------------------------------------------------------------------------------
assert.match(main, /<TenderDetailNavigation entity=\{o\.company_name\} sourceUrl=\{o\.source_url\} observations=\{o\.observaciones\} expectedCloseDate=\{o\.expected_close_date\}/, 'el shell debe recibir expectedCloseDate para computar la vigencia.');
assert.doesNotMatch(main, /Abrir fuente oficial/, 'ninguna otra vista del expediente debe duplicar el enlace único de fuente oficial.');
assert.doesNotMatch(main, /tender-opportunity-summary-actions/, 'el Resumen no debe conservar el bloque de acciones duplicado con la fuente oficial.');
assert.doesNotMatch(documentSection, /Abrir fuente oficial|sourceUrl/, 'Documentos no debe volver a montar la fuente oficial ni recibir esa prop.');
assert.doesNotMatch(styles, /tender-document-external-link/, 'la clase muerta del enlace duplicado debe eliminarse de los estilos.');
assert.doesNotMatch(styles, /tender-opportunity-summary-actions/, 'la clase muerta del bloque de acciones del Resumen debe eliminarse de los estilos.');

// ---------------------------------------------------------------------------------------------
// Task 6 · Resumen sin Etapa duplicada, Ciudad con fallback exacto, vigencia fuera de Decisión.
// ---------------------------------------------------------------------------------------------
const summaryStart = main.indexOf('<Panel title="Resumen de la oportunidad"');
const summaryEnd = main.indexOf('</Panel>', summaryStart) + '</Panel>'.length;
assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'debe existir el panel de Resumen.');
const summaryBlock = main.slice(summaryStart, summaryEnd);
for (const label of ['Entidad', 'Servicio', 'Sector', 'Ciudad', 'Cuantía', 'Cierre oficial', 'Responsable']) {
  const count = summaryBlock.split(`label="${label}"`).length - 1;
  assert.equal(count, 1, `el campo ${label} debe aparecer exactamente una vez en Resumen.`);
}
assert.doesNotMatch(summaryBlock, /label="Etapa"/, 'Etapa ya se expresa en el shell (Badge) y no debe repetirse en Resumen.');
assert.match(summaryBlock, /Ciudad por confirmar/, 'la ciudad ausente debe usar exactamente "Ciudad por confirmar".');
assert.doesNotMatch(main, /daysLabel: tenderDaysRemainingLabel/, 'Decisión no debe recibir un texto capaz de imprimir Vencida de nuevo.');
// El Resumen es exactamente esa lista de siete campos: cualquier campo extra reabre la puerta a
// duplicar datos ya expresados por el shell (Etapa, Responsable, Fuente oficial o la vigencia).
assert.equal(countOfSource(summaryBlock, '<Info '), 7, 'el Resumen debe mostrar exactamente los siete campos gobernados.');
// La vigencia temporal vive una sola vez, en el banner del shell. El Resumen puede mostrar la
// fecha de cierre pero no una segunda alerta de vencimiento («Días restantes» → «Vencida»).
assert.doesNotMatch(summaryBlock, /label="Días restantes"/, 'el Resumen no debe repetir la vigencia como Días restantes.');
assert.doesNotMatch(summaryBlock, /\bVigente\b|\bVencida\b/, 'la vigencia no puede escribirse dentro del Resumen.');
assert.doesNotMatch(main, /tenderDaysRemainingLabel/, 'el helper que imprime «Vencida» fuera del banner debe desaparecer del expediente.');
// El destino de la navegación recibe el foco programático: debe ser visible para teclado.
assert.match(
  styles,
  /\.tender-detail-anchor:focus-visible[^{]*\{[^}]*outline:/,
  'el contenedor enfocado por la navegación debe mostrar foco visible.',
);
assert.match(
  styles,
  /#tender-document-review:focus-visible[^{]*\{[^}]*outline:|,#tender-document-review:focus-visible/,
  'Documentos y Análisis comparten el foco visible del resto de anclas.',
);
const summaryShellStart = main.indexOf('<div id="tender-summary"');
const summaryShellBlock = main.slice(summaryShellStart, summaryEnd);
assert.ok(summaryShellStart >= 0 && summaryEnd > summaryShellStart, 'el ancla de Resumen debe preceder al panel de Resumen.');
assert.doesNotMatch(summaryShellBlock, /\bVigente\b|\bVencida\b/, 'sólo TenderDetailNavigation escribe la vigencia; el shell de Resumen nunca la repite.');

// ---------------------------------------------------------------------------------------------
// Task 6 · las seis anclas aceptan foco programático real (tabIndex=-1) para la navegación.
// ---------------------------------------------------------------------------------------------
for (const id of ['tender-summary', 'tender-document-review', 'tender-analysis', 'tender-decision', 'tender-preparation', 'tender-follow-up']) {
  assert.match(main, new RegExp(`id="${id}"[^>]*tabIndex=\\{-1\\}`), `${id} debe aceptar foco programático (tabIndex=-1) para el enfoque de navegación.`);
}

// ---------------------------------------------------------------------------------------------
// Task 6 · el orden de render (no el orden textual de las funciones) sigue el canon
// Resumen→Documentos→Análisis→Decisión→Preparación→Seguimiento, condición para que el
// IntersectionObserver resuelva secciones hermanas reales en el orden esperado de scroll.
// TenderDocumentReviewPanel se define más abajo en el archivo pero se invoca entre Resumen y
// Decisión; por eso el orden de render se prueba combinando la posición de invocación en
// OpportunityDetail con el orden interno dentro de TenderDocumentReviewPanel.
// ---------------------------------------------------------------------------------------------
const opportunityDetailStart = main.indexOf('function OpportunityDetail(');
const opportunityDetailEnd = main.indexOf('\nfunction TenderDocumentReviewPanel', opportunityDetailStart);
assert.ok(opportunityDetailStart >= 0 && opportunityDetailEnd > opportunityDetailStart, 'debe existir OpportunityDetail seguida de TenderDocumentReviewPanel.');
const opportunityDetailBlock = main.slice(opportunityDetailStart, opportunityDetailEnd);
const summaryPos = opportunityDetailBlock.indexOf('id="tender-summary"');
const reviewPanelInvocationPos = opportunityDetailBlock.indexOf('<TenderDocumentReviewPanel');
const decisionPos = opportunityDetailBlock.indexOf('id="tender-decision"');
const preparationPos = opportunityDetailBlock.indexOf('id="tender-preparation"');
const followUpPos = opportunityDetailBlock.indexOf('id="tender-follow-up"');
assert.ok(
  [summaryPos, reviewPanelInvocationPos, decisionPos, preparationPos, followUpPos].every(position => position >= 0),
  'Resumen, la invocación de Documentos/Análisis, Decisión, Preparación y Seguimiento deben existir en OpportunityDetail.',
);
assert.ok(summaryPos < reviewPanelInvocationPos, 'Resumen debe preceder a Documentos/Análisis.');
assert.ok(reviewPanelInvocationPos < decisionPos, 'Documentos/Análisis deben preceder a Decisión.');
assert.ok(decisionPos < preparationPos, 'Decisión debe preceder a Preparación.');
assert.ok(preparationPos < followUpPos, 'Preparación debe preceder a Seguimiento.');

const reviewPanelStart = main.indexOf('function TenderDocumentReviewPanel(');
const reviewPanelEnd = main.indexOf('\nfunction TenderOfferPreparationPanel', reviewPanelStart);
assert.ok(reviewPanelStart >= 0 && reviewPanelEnd > reviewPanelStart, 'debe existir TenderDocumentReviewPanel seguida de TenderOfferPreparationPanel.');
const reviewPanelBlock = main.slice(reviewPanelStart, reviewPanelEnd);
const documentReviewPos = reviewPanelBlock.indexOf('id="tender-document-review"');
const analysisPos = reviewPanelBlock.indexOf('id="tender-analysis"');
assert.ok(documentReviewPos >= 0 && analysisPos > documentReviewPos, 'Documentos debe preceder a Análisis dentro de TenderDocumentReviewPanel.');

// ---------------------------------------------------------------------------------------------
// Task 6 · jerarquía de acciones de oportunidad: Editar/Seguimiento ordinarias, Sacar riesgosa.
// ---------------------------------------------------------------------------------------------
const summaryAnchorStart = main.indexOf('<div id="tender-summary"');
const summaryAnchorEnd = main.indexOf('<TenderModuleNavigation', summaryAnchorStart);
assert.ok(summaryAnchorStart >= 0 && summaryAnchorEnd > summaryAnchorStart, 'debe existir el ancla tender-summary seguida del módulo de navegación.');
const summaryAnchorBlock = main.slice(summaryAnchorStart, summaryAnchorEnd);
const editIndex = summaryAnchorBlock.indexOf('>Editar<');
const followUpIndex = summaryAnchorBlock.indexOf('>Pasar a Seguimiento<');
const exitIndex = summaryAnchorBlock.indexOf('>Sacar de oportunidad<');
assert.ok(editIndex >= 0 && followUpIndex > editIndex && exitIndex > followUpIndex, 'Editar y Seguimiento deben preceder a la acción riesgosa Sacar de oportunidad.');
assert.match(summaryAnchorBlock, /className="danger"[^>]*onClick=\{\(\) => void exitTender\('radar'\)\}[^>]*>Sacar de oportunidad</, 'Sacar de oportunidad debe ser la única acción con tono de riesgo.');
assert.match(main, /window\.confirm\(destination === 'radar' \?/, 'Sacar de oportunidad debe seguir exigiendo confirmación antes de ejecutar la salida.');

console.log('tender detail navigation shell passed');

// ---------------------------------------------------------------------------------------------
// Task 6 · pruebas conductuales sobre helpers puros y HTML realmente renderizado (no sólo texto).
// ---------------------------------------------------------------------------------------------
const root = new URL('../', import.meta.url);
const cacheDir = new URL('node_modules/.cache/agt002-task6-navigation/', root);
mkdirSync(cacheDir, { recursive: true });

function loadComponent(relativePath, outName) {
  const outfile = new URL(outName, cacheDir).pathname;
  buildSync({
    entryPoints: [new URL(relativePath, root).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    outfile,
    write: true,
  });
  return import(pathToFileURL(outfile).href);
}

const {
  TenderDetailNavigation,
  resolveTenderSourceUrl,
  resolveTenderValidity,
  resolveInitialTenderDetailSection,
  resolveMostVisibleTenderSection,
  focusTenderDetailSection,
  createTenderDetailSectionObserver,
  createTenderDetailNavigationIntent,
  openTenderDetailSection,
} = await loadComponent('src/tenders/components/TenderDetailNavigation.tsx', 'TenderDetailNavigation.mjs');
const { TENDER_DETAIL_SECTIONS, tenderDetailSectionHref, tenderDetailHashWithSection } = await loadComponent('src/tenders/detailNavigationState.ts', 'detailNavigationState.mjs');
const { TenderDocumentSection } = await loadComponent('src/tenders/components/TenderDocumentSection.tsx', 'TenderDocumentSection.mjs');

const CANONICAL_SECTION_IDS = [
  'tender-summary',
  'tender-document-review',
  'tender-analysis',
  'tender-decision',
  'tender-preparation',
  'tender-follow-up',
];

const STATUS_SNAPSHOT = {
  documents: { phase: 'loading' },
  analysis: { phase: 'loading' },
  decision: { phase: 'loading' },
  preparation: { phase: 'loading' },
  followUp: { code: 'missing', label: 'Sin agenda', detail: 'Programar próxima gestión' },
};

function renderNavigation(overrides = {}, hash = '') {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { location: { hash } },
  });
  try {
    return renderToStaticMarkup(createElement(TenderDetailNavigation, {
      entity: 'Alcaldía de Prueba',
      statusSnapshot: STATUS_SNAPSHOT,
      onBack: () => {},
      ...overrides,
    }));
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------------------------
// Review · SSR real: la navegación debe renderizarse sin que el harness invente `window`.
// ---------------------------------------------------------------------------------------------
test('TenderDetailNavigation se renderiza en SSR real sin globalThis.window', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'window');
  try {
    const html = renderToStaticMarkup(createElement(TenderDetailNavigation, {
      entity: 'Alcaldía SSR',
      statusSnapshot: STATUS_SNAPSHOT,
      onBack: () => {},
    }));
    assert.match(html, /Alcaldía SSR/, 'el shell debe renderizar su entidad sin depender de APIs del navegador');
    assert.match(html, /aria-current="location"/, 'sin hash del navegador, SSR conserva Resumen como sección activa');
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

// ---------------------------------------------------------------------------------------------
// Review · Teclado: Tab y teclas de desplazamiento se disparan antes de que el foco salga de la
// barra. Por eso no pueden depender de que event.target ya esté fuera de navigationRootRef.
// ---------------------------------------------------------------------------------------------
test('las teclas de salida o desplazamiento liberan la intención aunque el foco siga dentro de la navegación', () => {
  const effectStart = component.indexOf('const releaseOutsideNavigation =');
  const effectEnd = component.indexOf("window.addEventListener('wheel'", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart, 'debe existir el cableado de liberación por teclado dentro del efecto de navegación');
  const keyboardRelease = component.slice(effectStart, effectEnd);
  assert.match(
    keyboardRelease,
    /const releaseForNavigationKey = \(event: KeyboardEvent\) => \{[\s\S]*?includes\(event\.key\)[\s\S]*?navigationIntent\.releaseForExplicitUserInteraction\(\);[\s\S]*?\}/,
    'Tab y las teclas de desplazamiento deben liberar la intención directamente, antes de que el navegador traslade el foco fuera de la barra',
  );
});

test('resolveTenderValidity marca Vigente en el futuro y Vencida en el pasado, sin fecha asume Vigente', () => {
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(resolveTenderValidity(inFiveDays), { label: 'Vigente', tone: 'success' });
  assert.deepEqual(resolveTenderValidity(yesterday), { label: 'Vencida', tone: 'danger' });
  assert.deepEqual(resolveTenderValidity(null), { label: 'Vigente', tone: 'success' });
  assert.deepEqual(resolveTenderValidity(undefined), { label: 'Vigente', tone: 'success' });
  assert.deepEqual(resolveTenderValidity('fecha-invalida'), { label: 'Vigente', tone: 'success' });
});

test('resolveInitialTenderDetailSection lee ?section= válido y usa Resumen como fallback', () => {
  assert.equal(resolveInitialTenderDetailSection('#/tenders/detail/abc?section=tender-decision'), 'tender-decision');
  assert.equal(resolveInitialTenderDetailSection('#/tenders/detail/abc?section=no-existe'), 'tender-summary');
  assert.equal(resolveInitialTenderDetailSection('#/tenders/detail/abc'), 'tender-summary');
  assert.equal(resolveInitialTenderDetailSection(''), 'tender-summary');
});

test('resolveMostVisibleTenderSection prioriza mayor ratio y desempata por cercanía al top', () => {
  const ids = ['tender-summary', 'tender-document-review', 'tender-analysis'];
  const highestRatioWins = resolveMostVisibleTenderSection(
    ids,
    new Map([['tender-summary', 0.2], ['tender-document-review', 0.8], ['tender-analysis', 0]]),
    new Map([['tender-summary', 10], ['tender-document-review', 40], ['tender-analysis', 0]]),
  );
  assert.equal(highestRatioWins, 'tender-document-review');

  const tieBreaksByTop = resolveMostVisibleTenderSection(
    ids,
    new Map([['tender-summary', 0.5], ['tender-document-review', 0.5], ['tender-analysis', 0]]),
    new Map([['tender-summary', 120], ['tender-document-review', 8], ['tender-analysis', 0]]),
  );
  assert.equal(tieBreaksByTop, 'tender-document-review');

  const noneVisible = resolveMostVisibleTenderSection(ids, new Map(), new Map());
  assert.equal(noneVisible, undefined);
});

test('focusTenderDetailSection desplaza y enfoca el contenedor sin preseleccionar controles internos', () => {
  const calls = [];
  const target = {
    scrollIntoView: options => calls.push(['scrollIntoView', options]),
    focus: options => calls.push(['focus', options]),
  };
  focusTenderDetailSection(target);
  assert.deepEqual(calls, [
    ['scrollIntoView', { behavior: 'smooth', block: 'start' }],
    ['focus', { preventScroll: true }],
  ]);
  assert.doesNotThrow(() => focusTenderDetailSection(null));
  assert.doesNotThrow(() => focusTenderDetailSection(undefined));
});

test('el HTML renderizado expone exactamente un enlace Fuente oficial cuando hay URL válida, ninguno si no la hay', () => {
  const withSource = renderNavigation({ sourceUrl: 'https://www.contratos.gov.co/proceso/123' });
  assert.equal(countOf(withSource, 'Fuente oficial'), 1);
  const withoutSource = renderNavigation({ sourceUrl: null, observations: null });
  assert.equal(countOf(withoutSource, 'Fuente oficial'), 0);
});

test('resolveTenderSourceUrl prefiere la URL estructurada y sólo cae al enlace histórico seguro', () => {
  assert.equal(
    resolveTenderSourceUrl('https://www.contratos.gov.co/proceso/123', 'Link fuente: https://historico.gov.co/otro'),
    'https://www.contratos.gov.co/proceso/123',
    'la URL estructurada gana sobre el texto histórico',
  );
  assert.equal(
    resolveTenderSourceUrl(null, 'Observaciones previas. Link fuente: https://historico.gov.co/proceso-9 y más texto'),
    'https://historico.gov.co/proceso-9',
    'sin URL estructurada se usa el enlace histórico explícito',
  );
  assert.equal(resolveTenderSourceUrl(null, 'Sin enlaces registrados.'), null, 'sin enlace no se inventa una fuente');
  assert.equal(resolveTenderSourceUrl('http://www.contratos.gov.co/x'), null, 'una fuente no https no se publica');
  assert.equal(resolveTenderSourceUrl(null, 'Link fuente: http://localhost:3000/interno'), null, 'un destino interno nunca se publica');
});

test('el único enlace Fuente oficial también se resuelve desde el fallback histórico', () => {
  const html = renderNavigation({ sourceUrl: null, observations: 'Link fuente: https://historico.gov.co/proceso-9' });
  assert.equal(countOf(html, 'Fuente oficial'), 1, 'el fallback histórico produce un solo enlace, no dos');
  assert.match(html, /href="https:\/\/historico\.gov\.co\/proceso-9"/, 'el href debe ser exactamente la fuente histórica saneada');
  assert.match(html, /rel="noreferrer"/, 'el enlace externo conserva rel="noreferrer"');
});

test('el HTML renderizado muestra la vigencia exactamente una vez, como Vigente o Vencida', () => {
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

  const vigente = renderNavigation({ expectedCloseDate: inFiveDays });
  assert.equal(countOf(vigente, 'Vigente'), 1);
  assert.equal(countOf(vigente, 'Vencida'), 0);
  assert.match(vigente, /badge badge-success tender-detail-validity">Vigente</);

  const vencida = renderNavigation({ expectedCloseDate: yesterday });
  assert.equal(countOf(vencida, 'Vencida'), 1);
  assert.equal(countOf(vencida, 'Vigente'), 0);
  assert.match(vencida, /badge badge-danger tender-detail-validity">Vencida</);
});

test('aria-current inicial refleja la ancla válida del hash; Resumen es el fallback', () => {
  const withHash = renderNavigation({}, '#/tenders/detail/abc?section=tender-decision');
  const buttons = withHash.split('<button').slice(1);
  const current = buttons.filter(chunk => chunk.includes('aria-current="location"'));
  assert.equal(current.length, 1, 'sólo una sección puede llevar aria-current="location".');
  assert.match(current[0], /aria-label="Decisión GO \/ NO GO/, 'el hash ?section=tender-decision debe activar Decisión.');

  const withoutHash = renderNavigation({}, '');
  const defaultButtons = withoutHash.split('<button').slice(1);
  const defaultCurrent = defaultButtons.filter(chunk => chunk.includes('aria-current="location"'));
  assert.equal(defaultCurrent.length, 1);
  assert.match(defaultCurrent[0], /aria-label="Resumen de la oportunidad/, 'sin hash válido, Resumen es el fallback activo.');

  const invalidHash = renderNavigation({}, '#/tenders/detail/abc?section=no-existe');
  const invalidButtons = invalidHash.split('<button').slice(1);
  const invalidCurrent = invalidButtons.filter(chunk => chunk.includes('aria-current="location"'));
  assert.match(invalidCurrent[0], /aria-label="Resumen de la oportunidad/, 'un ancla inválida también cae al fallback Resumen.');
});

// ---------------------------------------------------------------------------------------------
// Task 6 · el orden canónico de secciones es el contrato que consumen la navegación y el observer.
// ---------------------------------------------------------------------------------------------
test('TENDER_DETAIL_SECTIONS conserva el orden canónico Resumen→Documentos→Análisis→Decisión→Preparación→Seguimiento', () => {
  assert.deepEqual(TENDER_DETAIL_SECTIONS.map(section => section.id), CANONICAL_SECTION_IDS);
  assert.deepEqual(
    TENDER_DETAIL_SECTIONS.map(section => section.label),
    ['Resumen', 'Documentos', 'Análisis', 'Decisión', 'Preparación', 'Seguimiento'],
  );
});

// ---------------------------------------------------------------------------------------------
// Task 6 · el IntersectionObserver observa contenedores hermanos reales y acumula su visibilidad.
// Los dobles reemplazan al DOM: si el helper dejara de acumular por contenedor, un lote parcial
// de entradas (el comportamiento real del navegador) borraría la sección visible.
// ---------------------------------------------------------------------------------------------
function sectionObserverHarness(availableIds = CANONICAL_SECTION_IDS) {
  const containers = new Map(availableIds.map((id, index) => [id, {
    id,
    getBoundingClientRect: () => ({ top: index * 100 }),
    querySelector: () => { throw new Error('el observer no debe inspeccionar controles internos'); },
    focus: () => { throw new Error('el observer no debe enfocar nada'); },
  }]));
  const harness = {
    containers,
    requested: [],
    observed: [],
    visible: [],
    disconnects: 0,
    createdObservers: 0,
    emit: null,
  };
  harness.stop = createTenderDetailSectionObserver({
    resolveElement: id => { harness.requested.push(id); return containers.get(id) || null; },
    onVisibleSection: id => harness.visible.push(id),
    createObserver: callback => {
      harness.createdObservers += 1;
      harness.emit = callback;
      return {
        observe: element => harness.observed.push(element),
        disconnect: () => { harness.disconnects += 1; },
      };
    },
  });
  return harness;
}

test('el observer se monta exactamente sobre los seis contenedores hermanos reales, en orden canónico', () => {
  const harness = sectionObserverHarness();
  assert.deepEqual(harness.requested, CANONICAL_SECTION_IDS, 'debe resolver los contenedores por el id canónico de cada sección');
  assert.deepEqual(
    harness.observed.map(element => element.id),
    CANONICAL_SECTION_IDS,
    'debe observar los seis contenedores hermanos y nada más',
  );
  assert.equal(typeof harness.stop, 'function', 'debe devolver la limpieza del efecto');
  harness.stop();
  assert.equal(harness.disconnects, 1, 'la limpieza debe desconectar el observer');
});

test('el observer sólo monta las secciones realmente presentes y no crea observer si no hay ninguna', () => {
  const partial = sectionObserverHarness(['tender-summary', 'tender-decision']);
  assert.deepEqual(partial.observed.map(element => element.id), ['tender-summary', 'tender-decision']);

  const empty = createTenderDetailSectionObserver({
    resolveElement: () => null,
    onVisibleSection: () => { throw new Error('sin contenedores no debe resolverse ninguna sección'); },
    createObserver: () => { throw new Error('sin contenedores no debe crearse un observer'); },
  });
  assert.equal(empty, undefined, 'sin contenedores montados el efecto no deja limpieza pendiente');
});

test('la visibilidad se acumula por contenedor entre lotes parciales de entradas', () => {
  const harness = sectionObserverHarness();
  const container = id => harness.containers.get(id);

  harness.emit([{ target: container('tender-analysis'), isIntersecting: true, intersectionRatio: 0.8 }]);
  assert.equal(harness.visible.at(-1), 'tender-analysis', 'la sección más visible se sincroniza en el primer lote');

  // Lote posterior con OTRO contenedor y menor ratio: Análisis debe seguir ganando porque su
  // visibilidad previa se conserva. Sin acumulación, este lote lo borraría a 0.
  harness.emit([{ target: container('tender-summary'), isIntersecting: true, intersectionRatio: 0.2 }]);
  assert.equal(harness.visible.at(-1), 'tender-analysis', 'un lote parcial no puede borrar la visibilidad acumulada');

  // Cuando Análisis sale del viewport, la sección visible pasa a ser la que conserva ratio > 0.
  harness.emit([{ target: container('tender-analysis'), isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(harness.visible.at(-1), 'tender-summary', 'al salir del viewport la sección visible se recalcula');

  // Sin ninguna sección visible no se fuerza un aria-current arbitrario.
  const before = harness.visible.length;
  harness.emit([{ target: container('tender-summary'), isIntersecting: false, intersectionRatio: 0 }]);
  assert.equal(harness.visible.length, before, 'sin secciones visibles no se sincroniza ninguna sección');
});

// ---------------------------------------------------------------------------------------------
// Task 6 · navegar actualiza estado, desplaza y enfoca el contenedor (tabIndex=-1), nunca un
// control interno.
// ---------------------------------------------------------------------------------------------
test('openTenderDetailSection actualiza el estado y desplaza+enfoca el contenedor, sin preseleccionar controles', () => {
  const events = [];
  const requested = [];
  const active = [];
  const container = {
    scrollIntoView: options => events.push(['scrollIntoView', options]),
    focus: options => events.push(['focus', options]),
    querySelector: () => { throw new Error('la navegación no debe buscar controles internos'); },
    querySelectorAll: () => { throw new Error('la navegación no debe buscar controles internos'); },
  };

  openTenderDetailSection('tender-decision', {
    resolveElement: id => { requested.push(id); return id === 'tender-decision' ? container : null; },
    setActiveSection: id => active.push(id),
  });

  assert.deepEqual(active, ['tender-decision'], 'el estado activo debe sincronizarse con la sección pedida');
  assert.deepEqual(requested, ['tender-decision'], 'sólo se resuelve el contenedor de la sección pedida');
  assert.deepEqual(events, [
    ['scrollIntoView', { behavior: 'smooth', block: 'start' }],
    ['focus', { preventScroll: true }],
  ], 'primero desplaza y después enfoca el contenedor');
});

test('openTenderDetailSection mantiene aria-current sincronizado aunque el contenedor no esté montado', () => {
  const active = [];
  assert.doesNotThrow(() => openTenderDetailSection('tender-preparation', {
    resolveElement: () => null,
    setActiveSection: id => active.push(id),
  }));
  assert.deepEqual(active, ['tender-preparation'], 'el estado activo no depende de que el contenedor exista');
});

// ---------------------------------------------------------------------------------------------
// Task 7 QA · al pulsar Decisión antes de que V3 inserte contenido por encima, el observer puede
// informar transitoriamente Análisis. La intención explícita conserva aria-current; el observer
// nunca reancla y sólo una notificación explícita de layout vuelve a resolver y realinear sin foco.
// Una interacción explícita libera el controller. Todas las dependencias se inyectan sin DOM ni timers.
// ---------------------------------------------------------------------------------------------
test('la intención explícita sobre Decisión ignora observer, sólo realinea tras layout shift y se libera por interacción explícita', () => {
  assert.equal(
    typeof createTenderDetailNavigationIntent,
    'function',
    'la navegación debe exponer un controlador testeable de intención estable con dependencias inyectables',
  );

  const active = [];
  const resolved = [];
  const focused = [];
  const realigned = [];
  const controller = createTenderDetailNavigationIntent({
    resolveElement: id => {
      resolved.push(id);
      return { id, top: id === 'tender-decision' ? 15090 : 0 };
    },
    setActiveSection: id => active.push(id),
    focusSection: target => focused.push(target),
    realignSection: target => realigned.push(target),
  });

  controller.navigate('tender-decision');
  assert.deepEqual(active, ['tender-decision'], 'el click explícito fija aria-current en Decisión antes de cualquier observer');
  assert.deepEqual(resolved, ['tender-decision']);
  assert.deepEqual(focused.map(target => target.id), ['tender-decision']);
  assert.deepEqual(realigned, [], 'la navegación inicial conserva scroll+foco, sin realineación adicional');

  controller.onObservedSection('tender-analysis');
  assert.deepEqual(active, ['tender-decision'], 'el observer tardío no puede robar aria-current con Análisis');
  assert.deepEqual(resolved, ['tender-decision'], 'el observer no reancla ni vuelve a resolver el destino');
  assert.deepEqual(focused.map(target => target.id), ['tender-decision'], 'el observer no roba ni repite el foco');
  assert.deepEqual(realigned, [], 'el observer no debe provocar realineación');

  controller.onLayoutChanged();
  assert.deepEqual(active, ['tender-decision'], 'el layout shift conserva aria-current en la intención explícita');
  assert.deepEqual(
    resolved,
    ['tender-decision', 'tender-decision'],
    'el cambio de layout vuelve a resolver el destino, no reutiliza una posición obsoleta',
  );
  assert.deepEqual(realigned.map(target => target.id), ['tender-decision'], 'el cambio de layout realinea el destino explícito');
  assert.deepEqual(focused.map(target => target.id), ['tender-decision'], 'la realineación no repite el foco programático');

  controller.releaseForExplicitUserInteraction();
  controller.onLayoutChanged();
  assert.deepEqual(resolved, ['tender-decision', 'tender-decision'], 'tras release un nuevo layout shift no vuelve a resolver el destino liberado');
  assert.deepEqual(realigned.map(target => target.id), ['tender-decision'], 'tras release un nuevo layout shift no vuelve a realinear');
  assert.deepEqual(focused.map(target => target.id), ['tender-decision'], 'tras release no se vuelve a enfocar el destino');
  controller.onObservedSection('tender-analysis');
  assert.deepEqual(active, ['tender-decision', 'tender-analysis'], 'sólo después de interacción explícita el observer puede actualizar la sección activa');
});

// ---------------------------------------------------------------------------------------------
// Task 6 · Documentos: jerarquía coherente de acciones y cero duplicación de la fuente oficial.
// ---------------------------------------------------------------------------------------------
const DOCUMENT_FIXTURE = [{
  id: 'doc-1',
  name: 'pliego.pdf',
  size: 2048,
  document_type: 'pliego',
  current: true,
  uploaded_at: '2026-08-01T10:00:00.000Z',
  uploaded_by: 'Sistema',
  download_url: '/api/tender-documents/doc-1/download?opportunity_id=44444444-4444-4444-8444-444444444444',
}];

function renderDocuments(overrides = {}) {
  return renderToStaticMarkup(createElement(TenderDocumentSection, {
    documents: DOCUMENT_FIXTURE,
    busy: false,
    onRefresh: () => {},
    onUpload: () => {},
    ...overrides,
  }));
}

test('Documentos agrupa ver/actualizar/cargar con una sola acción primaria y sin acción riesgosa', () => {
  const html = renderDocuments();
  const groupStart = html.indexOf('class="tender-document-actions-group"');
  assert.ok(groupStart >= 0, 'las acciones documentales deben vivir en un grupo dedicado');

  const verIndex = html.indexOf('Ver documentos');
  const actualizarIndex = html.indexOf('Actualizar documentos');
  const cargarIndex = html.indexOf('Cargar complementarios');
  assert.ok(verIndex >= 0 && actualizarIndex > verIndex && cargarIndex > actualizarIndex, 'el orden debe ser inventario → actualización → carga');

  // Una sola acción primaria (Actualizar) y dos secundarias (Ver, Cargar) → jerarquía coherente.
  const secondarySummaryMatches = html.match(/<summary[^>]*class="button secondary(?:\s[\w-]+)*"[^>]*>/g) || [];
  assert.equal(secondarySummaryMatches.length, 2, 'inventario y carga comparten la jerarquía secundaria (dos <summary> con el token de clase "button secondary", aunque tengan clases adicionales)');
  assert.equal(countOf(html, '<button'), 1, 'Documentos expone exactamente una acción primaria');
  const primaryButtonMatch = html.match(/<button[^>]*>[\s\S]*?<\/button>/);
  assert.ok(primaryButtonMatch, 'Documentos expone un botón primario');
  const primaryButtonHtml = primaryButtonMatch[0];
  assert.match(primaryButtonHtml, /class="[^"]*\btender-document-action-refresh\b[^"]*"/, 'el botón primario lleva el token de clase tender-document-action-refresh');
  assert.match(primaryButtonHtml, /<strong>Actualizar documentos<\/strong>/, 'la acción primaria es Actualizar documentos');
  assert.doesNotMatch(html, /class="[^"]*danger/, 'Documentos no contiene acciones riesgosas');
});

test('Documentos nunca duplica la Fuente oficial única del shell', () => {
  const html = renderDocuments();
  assert.equal(countOf(html, 'Fuente oficial'), 0, 'la fuente oficial vive sólo en TenderDetailNavigation');
  assert.equal(countOf(html, 'target="_blank"'), 0, 'el inventario no abre ningún destino externo: la descarga es una ruta same-origin del backend');
  assert.match(html, /<a href="\/api\/tender-documents\/doc-1\/download\?opportunity_id=[^"]+"/, 'el documento se descarga por la ruta same-origin autenticada');
});

test('mientras hay trabajo en curso Documentos bloquea actualizar y cargar de forma coherente', () => {
  const html = renderDocuments({ busy: true });
  const busyButtonMatch = html.match(/<button[^>]*>[\s\S]*?<\/button>/);
  assert.ok(busyButtonMatch, 'Documentos expone un botón primario en estado busy');
  const busyButtonHtml = busyButtonMatch[0];
  assert.match(busyButtonHtml, /<button[^>]*\bdisabled\b[^>]*>/, 'la acción primaria se deshabilita mientras hay trabajo en curso');
  assert.match(busyButtonHtml, /<strong>Actualizando…<\/strong>/, 'la acción primaria refleja el trabajo en curso');
  assert.match(html, /<input[^>]*type="file"[^>]*disabled/, 'la carga complementaria se bloquea junto con la actualización');
});

// ---------------------------------------------------------------------------------------------
// AGT-002 QA visual · el legado ?focus=documents debe seguir abriendo Documentos, pero a través
// de la sección canónica; existe un único helper compartido para construir el enlace de sección.
// ---------------------------------------------------------------------------------------------
test('resolveInitialTenderDetailSection mapea el legado ?focus=documents a la sección canónica tender-document-review', () => {
  assert.equal(
    resolveInitialTenderDetailSection('#/tenders/detail/abc?focus=documents'),
    'tender-document-review',
    'el enlace legado ?focus=documents debe seguir abriendo Documentos a través de la sección canónica',
  );
  assert.equal(
    resolveInitialTenderDetailSection('#/tenders/detail/abc?section=tender-analysis&focus=documents'),
    'tender-analysis',
    'un ?section= explícito debe ganar sobre el parámetro legado focus=documents',
  );
  assert.equal(
    resolveInitialTenderDetailSection('#/tenders/detail/abc?focus=otra-cosa'),
    'tender-summary',
    'un valor de focus distinto a documents no debe activar el mapeo legado',
  );
});

test('tenderDetailSectionHref construye el único enlace canónico ?section= reutilizable en todo el expediente', () => {
  assert.equal(
    typeof tenderDetailSectionHref,
    'function',
    'debe existir un helper puro y compartido para construir enlaces canónicos hacia una sección del expediente',
  );
  assert.equal(
    tenderDetailSectionHref('44444444-4444-4444-8444-444444444444', 'tender-document-review'),
    '#/detail/44444444-4444-4444-8444-444444444444?section=tender-document-review',
    'el helper debe producir el hash canónico exacto con el parámetro ?section=',
  );
});

test('la navegación explícita sincroniza el parámetro canónico ?section= de la URL', () => {
  const syncCalls = [];
  const controller = createTenderDetailNavigationIntent({
    resolveElement: () => ({ id: 'target', scrollIntoView: () => {}, focus: () => {} }),
    setActiveSection: () => {},
    syncSectionUrl: id => syncCalls.push(id),
  });
  controller.navigate('tender-decision');
  assert.deepEqual(
    syncCalls,
    ['tender-decision'],
    'un clic explícito debe sincronizar la URL con la sección de destino para que el enlace sea compartible',
  );
});

test('el observer sincroniza ?section= sólo mientras no hay una intención explícita fijada', () => {
  const syncCalls = [];
  const controller = createTenderDetailNavigationIntent({
    resolveElement: () => ({ id: 'target', scrollIntoView: () => {}, focus: () => {} }),
    setActiveSection: () => {},
    syncSectionUrl: id => syncCalls.push(id),
  });
  controller.onObservedSection('tender-analysis');
  assert.deepEqual(
    syncCalls,
    ['tender-analysis'],
    'sin intención explícita, el observer debe sincronizar la URL con la sección visible',
  );

  controller.navigate('tender-decision');
  controller.onObservedSection('tender-summary');
  assert.deepEqual(
    syncCalls,
    ['tender-analysis', 'tender-decision'],
    'con una intención explícita fijada, el observer no debe sobreescribir la URL sincronizada por el clic',
  );
});

// ---------------------------------------------------------------------------------------------
// AGT-002 QA visual · las seis anclas deben reservar más espacio del que ocupan la barra sticky y
// su sombra: el valor exacto anterior (96px escritorio / 142px móvil) resultó insuficiente y
// producía solape visual al navegar.
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Review · gap de spec: createTenderDetailNavigationIntent acepta y llama syncSectionUrl, pero
// TenderDetailNavigation lo crea sin proveerlo (líneas ~192-196), así que la URL del navegador
// nunca cambia. tenderDetailHashWithSection es el helper puro que falta: reemplaza/agrega la
// sección canónica en un hash existente, sin duplicar el parámetro ni perder el resto del hash.
// ---------------------------------------------------------------------------------------------
test('tenderDetailHashWithSection agrega ?section= cuando el hash no tiene sección previa', () => {
  assert.equal(
    typeof tenderDetailHashWithSection,
    'function',
    'debe existir un helper puro para escribir la sección canónica dentro de un hash existente',
  );
  assert.equal(
    tenderDetailHashWithSection('#/detail/44444444-4444-4444-8444-444444444444', 'tender-decision'),
    '#/detail/44444444-4444-4444-8444-444444444444?section=tender-decision',
    'sin query previa, debe anexar ?section= al path del hash',
  );
});

test('tenderDetailHashWithSection reemplaza canónicamente una sección existente sin duplicar el parámetro', () => {
  assert.equal(
    tenderDetailHashWithSection('#/detail/44444444-4444-4444-8444-444444444444?section=tender-summary', 'tender-decision'),
    '#/detail/44444444-4444-4444-8444-444444444444?section=tender-decision',
    'debe sustituir el valor de ?section= existente, no anexar uno nuevo',
  );
  assert.equal(
    tenderDetailHashWithSection('#/detail/44444444-4444-4444-8444-444444444444?a=1&section=tender-summary&b=2', 'tender-decision'),
    '#/detail/44444444-4444-4444-8444-444444444444?a=1&section=tender-decision&b=2',
    'al reemplazar debe conservar la posición original del parámetro dentro de la query',
  );
});

test('tenderDetailHashWithSection elimina el parámetro legado focus=documents al fijar la sección canónica', () => {
  assert.equal(
    tenderDetailHashWithSection('#/detail/44444444-4444-4444-8444-444444444444?focus=documents', 'tender-document-review'),
    '#/detail/44444444-4444-4444-8444-444444444444?section=tender-document-review',
    'focus=documents es un parámetro legado: debe desaparecer, no coexistir con ?section=',
  );
});

test('tenderDetailHashWithSection preserva parámetros de consulta y ruta no relacionados con la sección', () => {
  assert.equal(
    tenderDetailHashWithSection('#/detail/44444444-4444-4444-8444-444444444444?tab=x&focus=documents&utm_source=y', 'tender-preparation'),
    '#/detail/44444444-4444-4444-8444-444444444444?tab=x&utm_source=y&section=tender-preparation',
    'parámetros ajenos a section/focus deben sobrevivir intactos y en su orden relativo',
  );
});

// ---------------------------------------------------------------------------------------------
// Review · el manual review encontró que el shell real nunca provee syncSectionUrl al crear el
// intent (líneas ~192-196 de TenderDetailNavigation.tsx), así que la URL nunca refleja la sección
// activa. Estas pruebas fijan el cableado esperado: syncSectionUrl debe existir, usar
// window.history.replaceState (no pushState, para no ensuciar el historial) construido con
// tenderDetailHashWithSection sobre window.location.hash, y no debe escuchar 'hashchange' (eso
// crearía un bucle entre la sincronización de URL y el propio disparador de navegación).
// ---------------------------------------------------------------------------------------------
test('TenderDetailNavigation provee syncSectionUrl real al crear el intent de navegación', () => {
  const intentCreationStart = component.indexOf('navigationIntentRef.current = createTenderDetailNavigationIntent({');
  assert.ok(intentCreationStart >= 0, 'debe existir la creación real del intent de navegación en el shell');
  const intentCreationEnd = component.indexOf('});', intentCreationStart);
  assert.ok(intentCreationEnd > intentCreationStart, 'la creación del intent debe cerrar con el objeto de dependencias');
  const intentCreationBlock = component.slice(intentCreationStart, intentCreationEnd);
  assert.match(
    intentCreationBlock,
    /syncSectionUrl:/,
    'el shell real debe proveer syncSectionUrl; sin esto la URL del navegador nunca cambia al navegar',
  );
});

test('syncSectionUrl usa replaceState con el helper canónico sobre el hash actual, sin pushState ni listener de hashchange', () => {
  assert.match(
    component,
    /tenderDetailHashWithSection/,
    'el shell debe importar y usar el helper canónico para construir el hash con la sección activa',
  );
  assert.match(
    component,
    /window\.history\.replaceState\([^)]*tenderDetailHashWithSection\(window\.location\.hash,\s*[A-Za-z_$][\w$]*\)[^)]*\)/,
    'debe llamar replaceState con el hash canónico calculado a partir del window.location.hash vigente',
  );
  assert.doesNotMatch(
    component,
    /window\.history\.pushState/,
    'nunca debe usar pushState: cada scroll/click crearía una entrada nueva de historial (spam de historial)',
  );
  assert.doesNotMatch(
    component,
    /addEventListener\(\s*['"]hashchange['"]/,
    'no debe escuchar hashchange: reaccionar a su propio replaceState crearía un bucle de sincronización',
  );
});

test('las seis anclas del expediente reservan más de 96px (escritorio) y 142px (móvil) de scroll-margin-top', () => {
  const scrollMarginPattern = /\.tender-detail-anchor,#tender-document-review,#tender-analysis\{scroll-margin-top:(\d+)px\}/g;
  const matches = [...styles.matchAll(scrollMarginPattern)];
  assert.equal(matches.length, 2, 'deben existir exactamente dos reglas de scroll-margin-top para las seis anclas: escritorio y móvil');
  const [desktopMatch, mobileMatch] = matches;
  const betweenRules = styles.slice(desktopMatch.index, mobileMatch.index);
  assert.match(betweenRules, /@media\(max-width:640px\)\{/, 'la segunda regla debe vivir dentro de un bloque responsive <=640px, después de la de escritorio');
  assert.ok(Number(desktopMatch[1]) > 96, `scroll-margin-top de escritorio debe ser mayor a 96px (actual: ${desktopMatch[1]}px)`);
  assert.ok(Number(mobileMatch[1]) > 142, `scroll-margin-top móvil debe ser mayor a 142px (actual: ${mobileMatch[1]}px)`);
});

// ---------------------------------------------------------------------------------------------
// AGT-002 QA visual · la columna de entidad de la barra del expediente resultaba demasiado
// angosta en escritorio (mínimo exacto de 88px); debe crecer conservando el tooltip accesible.
// ---------------------------------------------------------------------------------------------
test('la columna de entidad reserva más de 88px en escritorio y conserva el tooltip accesible', () => {
  const gridMatch = styles.match(/\.tender-detail-navigation\{[^}]*grid-template-columns:auto minmax\((\d+)px,\s*\.25fr\)/);
  assert.ok(gridMatch, 'debe existir la columna de entidad definida con minmax(<px>, .25fr) en la rejilla de navegación de escritorio');
  assert.ok(Number(gridMatch[1]) > 88, `el ancho mínimo de la columna de entidad debe ser mayor a 88px (actual: ${gridMatch[1]}px)`);
  assert.match(component, /title=\{entity \|\| 'Expediente'\}/, 'el nombre completo de la entidad debe seguir disponible como tooltip accesible aunque la columna crezca');
});
