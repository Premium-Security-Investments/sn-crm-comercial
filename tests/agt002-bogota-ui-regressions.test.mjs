import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

// AGT-002 · regresiones visuales y de estado reportadas en producción (expediente Bogotá).
//
// Tres defectos independientes, un solo parche:
//
//   1. Colapso de la grilla en el respaldo técnico V3. `src/styles.css` define globalmente
//      `dl{display:grid;grid-template-columns:150px minmax(0,1fr)}`. Los `dl` locales del V3
//      redeclaran `display:grid` pero NO reinician `grid-template-columns`, así que sus filas
//      (`div` hijos) se reparten en las dos columnas globales. Las filas que caen en la columna de
//      150px aplican a su vez `minmax(120px,.22fr) minmax(0,1fr)`, dejando ~20px para el `dd`:
//      texto en vertical letra por letra y tarjetas enormes.
//
//   2. Trazabilidad histórica abierta de par en par. `PhaseWorkbench` abría siempre las fases con
//      evidencia pendiente (`open={group.hasPendingEvidence}`), lo que en el respaldo histórico
//      —donde la lectura para decisión está pausada— despliega el expediente entero de golpe.
//
//   3. Copy de cierre semánticamente falso. Al terminar el análisis la UI decía siempre «completó
//      el análisis. La recomendación requiere revisión humana.», incluso cuando
//      `tenderAnalysisCoverageReady` es false y la propia superficie muestra la cobertura pausada
//      y «No hay recomendación integral disponible».
//
// Sin red, sin base de datos, sin commit/push/deploy.

const root = new URL('../', import.meta.url);

const v3Css = readFileSync(new URL('src/tenders/components/tender-integral-analysis-v3.css', root), 'utf8');
const globalCss = readFileSync(new URL('src/styles.css', root), 'utf8');
const technicalViewSource = readFileSync(new URL('src/tenders/components/TenderIntegralAnalysisV3View.tsx', root), 'utf8');
const mainSource = readFileSync(new URL('src/main.tsx', root), 'utf8');

// ---------------------------------------------------------------------------------------------
// 1 · Copy de cierre: helper puro, comprobable por comportamiento (patrón esbuild de
//     tests/tender-processing-supersession.test.mjs).
// ---------------------------------------------------------------------------------------------
const processingBundle = buildSync({
  entryPoints: [new URL('src/tenders/processingStatus.ts', root).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const processing = await import(
  `data:text/javascript;base64,${Buffer.from(processingBundle.outputFiles[0].contents).toString('base64')}`
);

const COVERAGE_PENDING_MESSAGE = 'Vig-IA Licitaciones completó la revisión técnica. La cobertura del expediente sigue pendiente; no hay recomendación integral disponible.';

const COMPLETE_BLOCK = Object.freeze({ status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 });
const GOVERNED_INVENTORY = Object.freeze({
  inventory_version: 'tender_requirement_inventory.v1',
  recommendation: 'proceed_to_analysis',
  human_review_required: true,
  expedient_coverage: COMPLETE_BLOCK,
  analyzed_coverage: COMPLETE_BLOCK,
});
const READY_INVENTORY_COVERAGE = Object.freeze({ tender_requirement_inventory: { ...GOVERNED_INVENTORY, decision_ready: true } });
// Forma real del contrato P0 vigente: inventario presente y bien formado, pero `decision_ready:false`.
const PAUSED_INVENTORY_COVERAGE = Object.freeze({
  tender_requirement_inventory: {
    ...GOVERNED_INVENTORY,
    decision_ready: false,
    recommendation: 'pause',
    expedient_coverage: { status: 'partial', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 },
    analyzed_coverage: { status: 'incomplete', total_source_units: 9, dispositioned_source_units: 0, requirement_count: 0 },
  },
});
const READY_MANIFEST_COVERAGE = Object.freeze({
  tender_requirement_inventory: { ...GOVERNED_INVENTORY, decision_ready: false },
  tender_semantic_manifest: {
    semantic_manifest_version: 'tender_semantic_manifest.v1',
    decision_ready: true,
    recommendation: 'ready_for_human_review',
    discovery_coverage: COMPLETE_BLOCK,
    analyzed_coverage: COMPLETE_BLOCK,
  },
});
const PAUSED_MANIFEST_COVERAGE = Object.freeze({
  ...READY_MANIFEST_COVERAGE,
  tender_semantic_manifest: { ...READY_MANIFEST_COVERAGE.tender_semantic_manifest, decision_ready: false, recommendation: 'pause' },
});

test('el copy de cierre es un helper puro de presentación, comprobable por comportamiento', () => {
  assert.equal(
    typeof processing.tenderAnalysisCompletionMessage,
    'function',
    'el cierre del análisis debe derivarse de una regla pura y probable, no de un literal incrustado en main.tsx',
  );
});

test('con cobertura lista el cierre anuncia una recomendación disponible sólo para revisión humana obligatoria', () => {
  for (const [caso, coverage] of [['inventario legado listo', READY_INVENTORY_COVERAGE], ['frontera semántica lista', READY_MANIFEST_COVERAGE]]) {
    const message = processing.tenderAnalysisCompletionMessage({ evidence_coverage: coverage });
    assert.ok(message.includes('Vig-IA Licitaciones'), `el cierre debe nombrar al agente visible (${caso})`);
    assert.match(message, /revisi[oó]n humana/i, `el cierre debe declarar la revisión humana obligatoria (${caso})`);
    assert.notEqual(message, COVERAGE_PENDING_MESSAGE, `con cobertura lista el cierre no puede declarar la cobertura pendiente (${caso})`);
    assert.doesNotMatch(message, /no hay recomendaci[oó]n integral/i, `con cobertura lista sí hay recomendación para revisar (${caso})`);
  }
});

test('sin cobertura lista el cierre nunca anuncia una recomendación integral', () => {
  const casos = [
    ['inventario pausado (decision_ready:false)', { evidence_coverage: PAUSED_INVENTORY_COVERAGE }],
    ['frontera semántica pausada', { evidence_coverage: PAUSED_MANIFEST_COVERAGE }],
    ['cobertura ausente', { evidence_coverage: undefined }],
    ['cobertura nula', { evidence_coverage: null }],
    ['análisis sin cobertura declarada', {}],
    ['sin análisis', null],
    ['análisis indefinido', undefined],
  ];
  for (const [caso, analysis] of casos) {
    assert.equal(
      processing.tenderAnalysisCompletionMessage(analysis),
      COVERAGE_PENDING_MESSAGE,
      `sin cobertura lista el cierre debe fallar cerrado y decir la verdad (${caso})`,
    );
  }
});

test('main.tsx deriva el cierre del helper y del análisis recién recargado, nunca de un literal ni del estado de React previo', () => {
  assert.doesNotMatch(
    mainSource,
    /completó el análisis\. La recomendación requiere revisión humana\./,
    'el literal incondicional de cierre ya no puede vivir en main.tsx: mentía cuando la cobertura estaba pausada',
  );
  assert.match(
    mainSource,
    /import \{[^}]*tenderAnalysisCompletionMessage[^}]*\} from '\.\/tenders\/processingStatus'/,
    'main.tsx debe importar el helper puro de cierre',
  );

  // loadDocuments devuelve lo que cargó (o undefined si la petición quedó superada).
  assert.match(
    mainSource,
    /const loadDocuments = async \(\): Promise<TenderDocumentsPayload \| undefined> =>/,
    'loadDocuments debe declarar que devuelve el payload cargado, o undefined si quedó superado',
  );

  const completedBranch = mainSource.match(/if \(job\.status === 'completed'\) \{[\s\S]*?\n {8}\}/);
  assert.ok(completedBranch, 'la rama de job completado debe seguir existiendo');
  assert.match(
    completedBranch[0],
    /const \[loaded\] = await Promise\.all\(\[loadDocuments\(\), onReload\?\.\(\)\]\)/,
    'la rama completada debe capturar el payload realmente recargado',
  );
  assert.match(
    completedBranch[0],
    /tenderAnalysisCompletionMessage\(/,
    'el mensaje de la rama completada debe derivarse del helper',
  );
  assert.match(
    completedBranch[0],
    /tenderAnalysisCompletionMessage\(reloaded \? reloaded\.analysis :/,
    'el mensaje debe derivarse del análisis recién recargado, no del estado de React del render',
  );

  // Éxito inmediato sin job: se deriva del análisis que acaba de devolver el backend.
  assert.match(
    mainSource,
    /tenderAnalysisCompletionMessage\(data\.analysis\)/,
    'el éxito inmediato debe derivarse del análisis devuelto por la petición, no de un literal',
  );

  // Fallback y no disponibilidad se conservan intactos.
  assert.match(
    mainSource,
    /\$\{VIGIA_VISIBLE_NAMES\.tenders\} no estuvo disponible; se aplicó fallback seguro por reglas\./,
    'el copy de fallback seguro por reglas se conserva',
  );
  assert.match(
    mainSource,
    /\$\{VIGIA_VISIBLE_NAMES\.tenders\} no pudo completar el análisis\./,
    'el copy de no disponibilidad se conserva',
  );
});

// ---------------------------------------------------------------------------------------------
// 2 · Colapso de la grilla: los `dl` locales del V3 deben reiniciar la plantilla global.
// ---------------------------------------------------------------------------------------------
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[}{;\\n])\\s*${escaped}\\{([^{}]*)\\}`));
  return match ? match[1] : null;
}

function declarations(body) {
  return Object.fromEntries(
    body.split(';').filter(Boolean).map(entry => {
      const separator = entry.indexOf(':');
      return [entry.slice(0, separator).trim(), entry.slice(separator + 1).trim()];
    }),
  );
}

// Cuenta pistas de `grid-template-columns` respetando los paréntesis de minmax()/repeat().
function gridTracks(value) {
  const tracks = [];
  let depth = 0;
  let current = '';
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ' ' && depth === 0) {
      if (current) tracks.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current) tracks.push(current);
  return tracks;
}

test('la cascada global que provoca el colapso sigue siendo la premisa de esta regresión', () => {
  assert.ok(
    globalCss.includes('dl{display:grid;grid-template-columns:150px minmax(0,1fr)'),
    'si la regla global de dl cambia, esta prueba debe revisarse: es la causa del colapso',
  );
});

test('el dl de cada requisito declara explícitamente una sola columna', () => {
  const body = ruleBody(v3Css, '.agt002-v3-requirement>dl');
  assert.ok(body, 'la regla del dl del requisito debe existir');
  const declared = declarations(body);
  assert.equal(declared['display'], 'grid', 'el dl del requisito sigue siendo una grilla');
  assert.ok(
    declared['grid-template-columns'],
    'el dl del requisito debe reiniciar grid-template-columns: sin ello hereda las dos columnas globales y sus filas se reparten entre ellas',
  );
  assert.equal(
    gridTracks(declared['grid-template-columns']).length,
    1,
    `el dl del requisito debe apilar sus filas en una sola columna (recibido: ${declared['grid-template-columns']})`,
  );
});

test('ningún dl local del respaldo técnico V3 hereda la plantilla global de dos columnas', () => {
  // Todos los `dl` que rinde TenderIntegralAnalysisV3View. `.agt002-v3-scope` ya declaraba su
  // propia plantilla; el resto la heredaba del global y colapsaba igual que el del requisito.
  const localDlSelectors = [
    '.agt002-v3-requirement>dl',
    '.agt002-v3-trace-meta',
    '.agt002-v3-summary,.agt002-v3-indicators',
    '.agt002-v3-run-meta',
    '.agt002-v3-scope',
  ];
  for (const selector of localDlSelectors) {
    const body = ruleBody(v3Css, selector);
    assert.ok(body, `la regla de ${selector} debe existir`);
    const declared = declarations(body);
    assert.equal(declared['display'], 'grid', `${selector} es una grilla propia`);
    assert.ok(
      declared['grid-template-columns'],
      `${selector} debe declarar su propia plantilla; heredar la global reparte sus filas en dos columnas y aplasta los valores`,
    );
  }
});

test('las filas etiqueta/valor conservan dos columnas en escritorio y una sola a <=1120px', () => {
  const rowBody = ruleBody(v3Css, '.agt002-v3-requirement>dl>div');
  assert.ok(rowBody, 'la regla de la fila etiqueta/valor debe existir');
  const rowDeclared = declarations(rowBody);
  assert.equal(
    gridTracks(rowDeclared['grid-template-columns']).length,
    2,
    'en escritorio cada fila sigue siendo etiqueta + valor',
  );
  assert.ok(
    v3Css.includes('@media(max-width:1120px)'),
    'el punto de quiebre de 1120px se conserva',
  );
  const narrow = v3Css.slice(v3Css.indexOf('@media(max-width:1120px)'));
  assert.match(
    narrow,
    /\.agt002-v3-requirement>dl>div\{grid-template-columns:1fr\}/,
    'a <=1120px cada fila se apila en una sola columna',
  );
});

test('el dl del requisito y sus filas conservan salvaguardas de desbordamiento', () => {
  assert.match(
    ruleBody(v3Css, '.agt002-v3-requirement>dl'),
    /min-width:0/,
    'una grilla anidada necesita min-width:0 para no desbordar su tarjeta',
  );
  assert.match(
    ruleBody(v3Css, '.agt002-v3-requirement>dl>div'),
    /min-width:0/,
    'la fila etiqueta/valor necesita min-width:0 para no desbordar',
  );
  assert.match(
    ruleBody(v3Css, '.agt002-v3-requirement dd'),
    /overflow-wrap:anywhere/,
    'los valores gobernados pueden traer cadenas largas sin espacios: deben partirse, no desbordar',
  );
});

// ---------------------------------------------------------------------------------------------
// 3 · Trazabilidad histórica: cerrada por defecto, sin perder acceso al detalle.
// ---------------------------------------------------------------------------------------------
const TenderIntegralAnalysisV3View = await loadReactComponent(
  'src/tenders/components/TenderIntegralAnalysisV3View.tsx',
  'TenderIntegralAnalysisV3View',
);

const CATEGORIES = ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic'];
// Sólo estas dos fases traen evidencia pendiente, así que la fixture distingue de verdad entre
// fases que la lectura vigente abre y fases que quedan cerradas en las dos superficies.
const PENDING_PHASES = new Set(['discard', 'technical']);

function integralUnit(index) {
  const n = index + 1;
  const category = CATEGORIES[index % CATEGORIES.length];
  return {
    unit_id: `bog-unit-${n}`,
    unit_kind: 'tender_requirement',
    requirement_id: `bog-req-${n}`,
    category,
    sequence: n,
    title: `Requisito gobernado ${n}`,
    assessment_mode: 'assessed',
    conclusion: { status: 'gap_evidenced', summary: `Conclusión ${n}: la evidencia aportada no cubre el requisito.`, confidence: 'medium' },
    blocking: { effect: 'non_blocking', curability: 'curable', reason: `Sin efecto bloqueante ${n}.` },
    evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
    evidence_refs: [{ ref: `evidence:chunk:bog:${n}`, source_type: 'tender_document', purpose: 'requirement_basis' }],
    missing_evidence: PENDING_PHASES.has(category)
      ? [{ missing_id: `bog-missing-${n}`, evidence_class_id: null, needed_source_type: 'company_evidence', reason: `Falta el certificado ${n}.`, critical: true }]
      : [],
    commercial_impact: { level: 'high', summary: `Impacto comercial ${n}.`, dimension: 'schedule' },
    legal_assessment: { status: 'not_verified', basis_refs: [], summary: `Sin verificación legal ${n}.`, human_legal_review_required: false },
    actions: [{ summary: `Acción ${n}: solicitar el soporte al área responsable.` }],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: `Sin hito ${n}.` },
    escalation: { required: false, level: 'none', reason: `Sin escalamiento ${n}.` },
    closure: { status: 'human_confirmation_required', condition: `Condición de cierre ${n}.`, evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: `Validación humana pendiente ${n}.` },
  };
}

const UNITS = Array.from({ length: 10 }, (_, index) => integralUnit(index));
const BASE_ANALYSIS = {
  run_id: 'run-bogota',
  snapshot_id: 'snap-bogota',
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  integral_analysis: {
    contract_version: 'test@1',
    coverage: {
      manifest_version: 'test@1',
      expected_requirement_ids: UNITS.map(unit => unit.requirement_id),
      analyzed_requirement_ids: UNITS.map(unit => unit.requirement_id),
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'test@1',
      company_evidence_class_ids: [],
      legal_corpus_version_id: null,
    },
    analysis_units: UNITS,
  },
};

const historicalHtml = renderReactComponent(TenderIntegralAnalysisV3View, {
  analysis: { ...BASE_ANALYSIS, evidence_coverage: PAUSED_INVENTORY_COVERAGE },
});
const currentHtml = renderReactComponent(TenderIntegralAnalysisV3View, {
  analysis: { ...BASE_ANALYSIS, evidence_coverage: READY_INVENTORY_COVERAGE },
});

const PHASE_DETAILS = /<details class="agt002-v3-phase"[^>]*>/g;

test('el respaldo técnico histórico mantiene todas las fases plegadas por defecto', () => {
  assert.ok(historicalHtml.includes('data-mode="historical-traceability"'), 'la fixture debe caer en el modo histórico');
  const phases = historicalHtml.match(PHASE_DETAILS) ?? [];
  assert.ok(phases.length >= CATEGORIES.length, 'las cinco fases institucionales se conservan');
  for (const phase of phases) {
    assert.doesNotMatch(phase, /\bopen\b/, `ninguna fase histórica puede desplegarse sola: ${phase}`);
  }
});

test('plegar las fases históricas no quita el acceso al detalle', () => {
  for (const unit of UNITS) {
    assert.ok(historicalHtml.includes(`<h4>${unit.title}</h4>`), `${unit.title} sigue en el HTML del respaldo histórico`);
    assert.ok(historicalHtml.includes(unit.conclusion.summary), 'la conclusión gobernada sigue conservada');
  }
  assert.ok(historicalHtml.includes('Ver trazabilidad técnica'), 'la segunda capa de trazabilidad sigue disponible');
  assert.ok(historicalHtml.includes('pendiente(s) de evidencia'), 'el resumen de cada fase sigue anunciando sus pendientes');
  assert.ok(historicalHtml.includes('Validación humana pendiente'), 'la autoridad humana no cambia');
  assert.ok(historicalHtml.includes('No decide GO / NO GO'), 'la semántica gobernada no cambia');
});

test('la lectura integral vigente conserva la apertura deliberada de las fases con evidencia pendiente', () => {
  assert.equal(currentHtml.includes('data-mode="historical-traceability"'), false, 'con cobertura lista no es modo histórico');
  const phases = currentHtml.match(PHASE_DETAILS) ?? [];
  const openPhases = phases.filter(phase => /\bopen\b/.test(phase)).map(phase => phase.match(/data-phase="([^"]+)"/)[1]);
  assert.deepEqual(
    openPhases.sort(),
    [...PENDING_PHASES].sort(),
    'con cobertura lista abren exactamente las fases con evidencia pendiente real, ni una más',
  );
  for (const phase of phases) {
    const key = phase.match(/data-phase="([^"]+)"/)[1];
    if (PENDING_PHASES.has(key)) continue;
    assert.doesNotMatch(phase, /\bopen\b/, `una fase sin pendientes sigue cerrada: ${key}`);
  }
});

test('la apertura automática es una decisión explícita del llamador, no un valor incrustado en PhaseWorkbench', () => {
  assert.doesNotMatch(
    technicalViewSource,
    /open=\{group\.hasPendingEvidence\}/,
    'PhaseWorkbench no puede abrir fases por su cuenta: el modo histórico y la lectura vigente difieren',
  );
  assert.match(
    technicalViewSource,
    /function PhaseWorkbench\(\{[^}]*autoOpenPendingPhases[^}]*\}/,
    'PhaseWorkbench debe recibir una prop deliberada de apertura',
  );
  assert.match(
    technicalViewSource,
    /open=\{autoOpenPendingPhases && group\.hasPendingEvidence\}/,
    'la apertura debe exigir a la vez el permiso del llamador y la evidencia pendiente real',
  );

  const historicalWorkbench = technicalViewSource.match(/<PhaseWorkbench integral=\{integral\} conditionAnchorByUnitId=\{null\}[^/]*\/>/);
  assert.ok(historicalWorkbench, 'el respaldo histórico debe seguir montando PhaseWorkbench sin superficie de decisión');
  assert.match(
    historicalWorkbench[0],
    /autoOpenPendingPhases=\{false\}/,
    'el respaldo histórico debe pedir explícitamente todas las fases plegadas',
  );

  const currentWorkbench = technicalViewSource.match(/<PhaseWorkbench integral=\{integral\} conditionAnchorByUnitId=\{conditionAnchorByUnitId\}[^/]*\/>/);
  assert.ok(currentWorkbench, 'la lectura vigente debe seguir montando PhaseWorkbench con sus anclas');
  assert.match(
    currentWorkbench[0],
    /autoOpenPendingPhases\b/,
    'la lectura vigente debe pedir explícitamente la apertura de las fases con pendientes',
  );
});
