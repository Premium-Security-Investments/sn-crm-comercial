import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const count = (source, needle) => source.split(needle).length - 1;

const TenderDecisionExperience = await loadReactComponent(
  'src/tenders/components/TenderDecisionExperience.tsx',
  'TenderDecisionExperience',
);
const TenderAnalysisSection = await loadReactComponent(
  'src/tenders/components/TenderAnalysisSection.tsx',
  'TenderAnalysisSection',
);

const AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];
const coverageBlock = { status: 'complete', total_source_units: 1, dispositioned_source_units: 1, requirement_count: 1 };
const analysis = {
  run_id: 'run-current',
  snapshot_id: 'snapshot-current',
  producer: 'AGT-002',
  method: 'agent_ai',
  status: 'completed',
  current: true,
  critical_open_count: 0,
  recommendation: 'conditional',
  summary: 'Resumen legado que no debe competir con la superficie única.',
  strengths: ['Fortaleza legada'],
  weaknesses: ['Debilidad legada'],
  questions: [{ id: 'legacy-question', text: 'Pregunta legada', critical: false, evidence_refs: [] }],
  evidence_coverage: {
    tender_requirement_inventory: {
      inventory_version: 'tender_requirement_inventory.v1',
      decision_ready: true,
      expedient_coverage: coverageBlock,
      analyzed_coverage: coverageBlock,
    },
  },
  integral_analysis: {
    contract_version: 'agt002-integral-analysis-v3',
    analysis_units: [{ requirement_id: 'financial-working-capital' }],
    coverage: { analyzed_requirement_ids: ['financial-working-capital'], expected_requirement_ids: ['financial-working-capital'] },
  },
  decision_review: {
    artifact_type: 'review',
    review_findings: [],
    blockers: [],
    decision_questions: [],
    supported: [],
    preparation: [],
    not_applicable: [],
    counts: { supported: 0, preparation: 0, not_applicable: 0, decision_questions: 0, blockers: 0 },
  },
  decision_axis_analysis: {
    contract_version: 'agt002-decision-axis-analysis@1',
    global_state: 'ready_for_human_review',
    paused_reason: null,
    coverage: { decision_ready: true, total_source_units: 1, dispositioned_source_units: 1, unresolved_source_units: 0 },
    axes: Object.fromEntries(AXES.map(axis => [axis, {
      axis,
      state: 'No evaluado',
      findings: [],
      counts: { blocker: 0, decision_question: 0, supported: 0 },
    }])),
    preparation: [],
    counts: { material_findings: 0, ordinary_reclassified: 0 },
  },
};

const decisionProps = {
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

const analysisProps = {
  analysis,
  documents: [{ id: 'doc-1', name: 'Pliego.pdf', current: true }],
  busy: false,
  canRunPreview: true,
  onAnalyzePreview: () => {},
  questionResponses: [],
};

test('E1/E3 — el payload proyecta únicamente el literal server-owned en ambos backends byte-idénticos', () => {
  const server = read('server/index.js');
  const api = read('api/[...path].js');
  const projection = 'decision_axis_surface_enabled: agt002AnalysisConfig.AGT002_DECISION_AXIS_SURFACE === true';
  assert.ok(server.includes(projection));
  assert.ok(api.includes(projection));
  assert.equal(server, api, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');
  assert.equal(server.includes('body.decision_axis_surface_enabled'), false);
  assert.equal(server.includes("from('decision_axis_surface_enabled')"), false);
});

test('E4.1/E4.2 — flag off conserva brief+panel; flag on monta una sola superficie y un solo panel formal', () => {
  const off = renderReactComponent(TenderDecisionExperience, { ...decisionProps, decisionAxisSurfaceEnabled: false });
  assert.ok(off.includes('Brief de decisión'));
  assert.equal(off.includes('Cinco señales para una decisión humana'), false);
  assert.equal(count(off, 'Decisión GO / NO GO'), 1);

  const on = renderReactComponent(TenderDecisionExperience, { ...decisionProps, decisionAxisSurfaceEnabled: true });
  assert.ok(on.includes('Cinco señales para una decisión humana'));
  assert.equal(on.includes('Brief de decisión'), false);
  assert.equal(count(on, 'class="tender-decision-axis-surface"'), 1);
  assert.equal(count(on, 'Decisión GO / NO GO'), 1);
});

test('E4.3 — decisionSurfaceElsewhere suprime toda lectura competidora y conserva controles de corrida', () => {
  const legacy = renderReactComponent(TenderAnalysisSection, { ...analysisProps, decisionSurfaceElsewhere: false });
  assert.ok(legacy.includes('Condiciones pendientes de validar'));

  const unified = renderReactComponent(TenderAnalysisSection, { ...analysisProps, decisionSurfaceElsewhere: true });
  for (const forbidden of [
    'Condiciones pendientes de validar',
    'Aspectos favorables y capacidad',
    'Acciones de preparación',
    'Fortalezas',
    'Debilidades y bloqueadores',
    'Dudas abiertas',
  ]) {
    assert.equal(unified.includes(forbidden), false, `la lectura competidora debe ocultar: ${forbidden}`);
  }
  assert.ok(unified.includes('Actualizar con'));

  const historicalAnalysis = { ...analysis, integral_analysis: undefined, decision_review: null };
  const historicalUnified = renderReactComponent(TenderAnalysisSection, {
    ...analysisProps,
    analysis: historicalAnalysis,
    decisionSurfaceElsewhere: true,
  });
  for (const forbidden of ['Fortalezas', 'Debilidades y bloqueadores', 'Dudas abiertas', 'Información no verificada']) {
    assert.equal(historicalUnified.includes(forbidden), false, `el brief histórico tampoco debe competir: ${forbidden}`);
  }
  assert.ok(historicalUnified.includes('Actualizar con'));
});

test('E4.3 — cobertura parcial se comunica sólo en la superficie única, no también en Análisis', () => {
  const partialCoverage = { status: 'partial', total_source_units: 11345, dispositioned_source_units: 8, requirement_count: 11345 };
  const pausedAnalysis = {
    ...analysis,
    evidence_coverage: {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: false,
        expedient_coverage: partialCoverage,
        analyzed_coverage: partialCoverage,
      },
    },
  };
  const legacy = renderReactComponent(TenderAnalysisSection, {
    ...analysisProps,
    analysis: pausedAnalysis,
    decisionSurfaceElsewhere: false,
  });
  assert.ok(legacy.includes('Análisis integral pausado'), 'flag off conserva el aviso de cobertura legado');

  const unified = renderReactComponent(TenderAnalysisSection, {
    ...analysisProps,
    analysis: pausedAnalysis,
    decisionSurfaceElsewhere: true,
  });
  assert.equal(
    unified.includes('Análisis integral pausado'),
    false,
    'flag on deja el estado de cobertura exclusivamente en Análisis para decidir',
  );
  assert.ok(unified.includes('Actualizar con'), 'los controles de corrida se conservan');
});

test('E4.4/E6 — main propaga flag+saver, no duplica acciones y navega a la preparación existente', () => {
  const main = read('src/main.tsx');
  assert.ok(main.includes('onDecisionSurfaceFlagChanged'));
  assert.ok(main.includes('onQuestionResponseSaverReady'));
  assert.ok(main.includes('data.decision_axis_surface_enabled === true'));
  assert.equal(count(main, 'createTenderQuestionResponseActions({'), 1);
  assert.ok(main.includes("focusTenderDetailSection(document.getElementById('tender-preparation'))"));
  assert.equal(main.includes('import.meta.env.VITE_AGT002_DECISION_AXIS_SURFACE'), false);
});

test('E4.5 — el montaje único queda encapsulado en TenderDecisionExperience y la superficie integra el panel', () => {
  const main = read('src/main.tsx');
  const experience = read('src/tenders/components/TenderDecisionExperience.tsx');
  const surface = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
  assert.equal(count(main, '<TenderDecisionExperience'), 1);
  assert.equal(count(experience, '<TenderDecisionAxisSurface'), 1);
  assert.equal(count(experience, '<TenderGoNoGoDecisionPanel'), 1, 'fallback off: un solo punto legado');
  assert.equal(count(surface, '<TenderGoNoGoDecisionPanel'), 1, 'flag on: un solo punto embebido');
  assert.ok(experience.includes('if (decisionAxisSurfaceEnabled)'));
});
