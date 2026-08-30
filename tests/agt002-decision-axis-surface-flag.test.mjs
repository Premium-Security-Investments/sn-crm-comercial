import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';
import { buildAgt002AnalysisConfig } from '../agt002-analysis-config.js';

// Corte E de docs/superpowers/plans/2026-08-25-agt002-analisis-para-decidir.md: flag
// AGT002_DECISION_AXIS_SURFACE apagado por defecto, literal server-owned en el payload documental,
// montaje único de la superficie y supresión de las vistas competidoras cuando está encendido.

const TenderDecisionExperience = await loadReactComponent(
  'src/tenders/components/TenderDecisionExperience.tsx',
  'TenderDecisionExperience',
);
const TenderAnalysisSection = await loadReactComponent(
  'src/tenders/components/TenderAnalysisSection.tsx',
  'TenderAnalysisSection',
);

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const analysisSectionSource = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const experienceSource = readFileSync(new URL('../src/tenders/components/TenderDecisionExperience.tsx', import.meta.url), 'utf8');

const AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];
const COVERAGE_BLOCK = { status: 'complete', total_source_units: 1, dispositioned_source_units: 1, requirement_count: 1 };
const READY_COVERAGE = {
  tender_requirement_inventory: {
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    expedient_coverage: COVERAGE_BLOCK,
    analyzed_coverage: COVERAGE_BLOCK,
  },
};

const DECISION_QUESTION = {
  id: 'finding-financial-1',
  requirement_id: 'financial-working-capital',
  label: 'Capital de trabajo mínimo',
  reviewed_status: 'decision_question',
  rationale: 'Pendiente de revisión humana.',
  evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital' }],
  presentation: {
    title: 'Capital de trabajo mínimo',
    summary: 'La capacidad debe validarse con evidencia vigente.',
    missing: 'Validación financiera vigente.',
    action_required: 'Revisar el soporte con la persona responsable.',
  },
};

const DECISION_REVIEW = {
  artifact_type: 'agt002_generic_decision_review',
  review_findings: [],
  blockers: [],
  decision_questions: [DECISION_QUESTION],
  supported: [],
  preparation: [],
  not_applicable: [],
  counts: { supported: 0, preparation: 0, not_applicable: 0, decision_questions: 1, blockers: 0 },
};

const analysis = {
  run_id: 'run-current',
  snapshot_id: 'snapshot-current',
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  critical_open_count: 0,
  evidence_coverage: READY_COVERAGE,
  commercial_fit: { positives: [] },
  integral_analysis: { contract_version: 'agt002-integral-analysis-v3', analysis_units: [{ unit_id: 'unit-1', requirement_id: 'financial-working-capital' }] },
  decision_review: DECISION_REVIEW,
  decision_axis_analysis: {
    contract_version: 'agt002-decision-axis-analysis@1',
    global_state: 'ready_for_human_review',
    paused_reason: null,
    coverage: { decision_ready: true, total_source_units: 1, dispositioned_source_units: 1, unresolved_source_units: 0 },
    axes: Object.fromEntries(AXES.map(axis => [axis, { axis, state: 'No evaluado', findings: [], counts: { blocker: 0, decision_question: 0, supported: 0 } }])),
    preparation: [],
    counts: { material_findings: 0, ordinary_reclassified: 0 },
  },
};

const experienceProps = {
  opportunityId: 'opportunity-1',
  opportunityName: 'Oportunidad de prueba',
  analysis,
  questionResponses: [],
  currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'analista', permissions: [] },
  request: async () => ({ decision: null, history: [], preparation: null }),
  canAnswerQuestions: false,
  onDecisionChanged: () => {},
  decisionState: { phase: 'ready', value: null },
  onOpenHelpDesk: () => {},
  commercialContext: { amountLabel: '$1.000' },
};

const analysisSectionProps = {
  analysis,
  documents: [{ id: 'doc-1', current: true }],
  busy: false,
  canRunPreview: true,
  onAnalyzePreview: () => {},
  questionResponses: [],
  canAnswerQuestions: false,
};

const count = (html, value) => html.split(value).length - 1;

test('E1 — AGT002_DECISION_AXIS_SURFACE vive en el config central, apagada por defecto y sólo con el literal true', () => {
  assert.equal(buildAgt002AnalysisConfig({}).AGT002_DECISION_AXIS_SURFACE, false);
  for (const rawValue of ['1', 'TRUE', ' true ', 'yes', '', undefined]) {
    assert.equal(
      buildAgt002AnalysisConfig({ AGT002_DECISION_AXIS_SURFACE: rawValue }).AGT002_DECISION_AXIS_SURFACE,
      false,
      `${JSON.stringify(rawValue)} no debe encender la superficie`,
    );
  }
  assert.equal(buildAgt002AnalysisConfig({ AGT002_DECISION_AXIS_SURFACE: 'true' }).AGT002_DECISION_AXIS_SURFACE, true);
});

test('E3 — ambos backends proyectan el literal server-owned y siguen byte-idénticos', () => {
  const projection = 'decision_axis_surface_enabled: agt002AnalysisConfig.AGT002_DECISION_AXIS_SURFACE === true,';
  assert.equal(count(server, projection), 1, 'server/index.js debe proyectar el literal exactamente una vez');
  assert.equal(count(vercel, projection), 1, 'api/[...path].js debe proyectar el literal exactamente una vez');
  assert.equal(vercel, server, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');
  // El valor jamás proviene del cliente ni de la base de datos: no se lee de req/body/query ni de
  // una columna, sólo del config construido con process.env al arrancar.
  assert.doesNotMatch(server, /decision_axis_surface_enabled:\s*(req|request|body|payload|query|row|record|data)\b/);
  assert.equal(server.includes('AGT002_DECISION_AXIS_SURFACE_ENABLED'), false, 'no debe sobrevivir el nombre de flag antiguo');
});

test('E3 — el front consume el literal del payload y nunca una variable de build', () => {
  assert.ok(main.includes('data.decision_axis_surface_enabled === true'));
  assert.equal(main.includes('import.meta.env.VITE_AGT002_DECISION_AXIS_SURFACE'), false);
  assert.equal(main.includes('AGT002_DECISION_AXIS_SURFACE_ENABLED'), false);
});

test('E4.1/E4.5 — flag off conserva exactamente el brief y el panel legados, sin ninguna cadena de la superficie nueva', () => {
  const html = renderReactComponent(TenderDecisionExperience, { ...experienceProps, decisionAxisSurfaceEnabled: false });
  assert.ok(html.includes('Brief de decisión'));
  assert.equal(count(html, 'Decisión GO / NO GO'), 1);
  for (const nueva of [
    'Cinco señales para una decisión humana',
    'tender-decision-axis-surface',
    'tender-decision-axis-cta',
    'Ejes del análisis para decidir',
  ]) {
    assert.equal(html.includes(nueva), false, `con el flag apagado no debe aparecer "${nueva}"`);
  }
});

test('E4.2 — flag on monta una sola superficie, un solo panel formal y ningún brief competidor', () => {
  const html = renderReactComponent(TenderDecisionExperience, { ...experienceProps, decisionAxisSurfaceEnabled: true });
  assert.ok(html.includes('Cinco señales para una decisión humana'));
  assert.equal(html.includes('Brief de decisión'), false);
  assert.equal(count(html, 'Decisión GO / NO GO'), 1, 'el panel formal se monta exactamente una vez');
  assert.equal(count(html, 'class="tender-decision-axis-surface"'), 1);
  assert.equal(count(html, 'class="tender-decision-axis-cta"'), 1, 'una sola CTA primaria');
  // El único punto de montaje del panel formal es la superficie: no hay rama alterna en el shell.
  assert.equal(count(experienceSource, '<TenderGoNoGoDecisionPanel'), 1);
  assert.match(experienceSource, /if \(decisionAxisSurfaceEnabled\)[\s\S]*<TenderDecisionAxisSurface/);
});

test('E4.3 — decisionSurfaceElsewhere suprime la lectura competidora y el montaje técnico duplicado, conservando controles', () => {
  const legacy = renderReactComponent(TenderAnalysisSection, { ...analysisSectionProps, decisionSurfaceElsewhere: false });
  assert.ok(legacy.includes('Condiciones pendientes de validar'), 'con el flag apagado la sección conserva la lectura de hoy');
  assert.ok(legacy.includes('Aspectos favorables y capacidad'));
  assert.ok(legacy.includes('Acciones de preparación'));

  const suppressed = renderReactComponent(TenderAnalysisSection, { ...analysisSectionProps, decisionSurfaceElsewhere: true });
  for (const competidor of [
    'Condiciones pendientes de validar',
    'Aspectos favorables y capacidad',
    'Acciones de preparación',
    'Clasificación ejecutiva no disponible',
  ]) {
    assert.equal(suppressed.includes(competidor), false, `"${competidor}" no debe duplicarse fuera de la superficie única`);
  }
  // Conserva los controles de corrida y el disclosure de productor.
  assert.ok(suppressed.includes('tender-analysis-actions'));
  assert.ok(suppressed.includes('tender-analysis-primary-cta'));
  // Por defecto es false: el render con el flag apagado es idéntico al de hoy.
  assert.match(analysisSectionSource, /decisionSurfaceElsewhere = false/);
  // La lectura V3 duplicada ya no se monta en main: la superficie para decidir es única.
  assert.equal(main.includes('id="tender-technical-analysis"'), false);
  assert.equal(main.includes('<TenderIntegralAnalysisV3View'), false);
});

test('E4.4 — el panel documental propaga el literal y el saver sin duplicar las acciones de respuesta', () => {
  assert.match(main, /onDecisionSurfaceFlagChanged\?\.\(data\.decision_axis_surface_enabled === true\)/);
  assert.equal(
    count(main, 'onDecisionSurfaceFlagChanged?.(data.decision_axis_surface_enabled === true)'),
    4,
    'carga, upload, análisis preview e import deben repropagar el literal server-owned',
  );
  assert.match(main, /decisionSurfaceElsewhere=\{payload\.decision_axis_surface_enabled === true\}/);
  assert.match(main, /onQuestionResponseSaverReady\?\.\(saveQuestionResponse\)/);
  assert.equal(count(main, 'createTenderQuestionResponseActions('), 1, 'las acciones de respuesta se construyen una sola vez');
});
