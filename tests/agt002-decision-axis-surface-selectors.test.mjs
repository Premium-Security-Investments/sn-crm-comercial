import { strict as assert } from 'node:assert';
import test from 'node:test';

import { bundleReactModule } from './helpers/bundle-react-component.mjs';

const selectors = await bundleReactModule('src/tenders/tenderDecisionAxisSurface.ts');
const {
  AGT002_DECISION_AXIS_LABELS,
  AGT002_DECISION_AXES,
  tenderDecisionAxisViews,
  tenderDecisionCoverageCopy,
  tenderDecisionPrimaryCta,
  tenderDecisionSurfaceState,
} = selectors;

const AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];
const STATES = ['Favorable con evidencia', 'Impedimento material', 'Por confirmar', 'No evaluado'];

const COVERAGE_BLOCK = { status: 'complete', total_source_units: 5, dispositioned_source_units: 5, requirement_count: 5 };
const READY_EVIDENCE_COVERAGE = {
  tender_requirement_inventory: {
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    expedient_coverage: COVERAGE_BLOCK,
    analyzed_coverage: COVERAGE_BLOCK,
  },
};

function emptyBucket(axis) {
  return { axis, state: 'No evaluado', findings: [], counts: { blocker: 0, decision_question: 0, supported: 0 } };
}

function finding(overrides = {}) {
  return {
    id: 'finding-financial-1',
    requirement_id: 'financial-working-capital',
    label: 'Capital de trabajo mínimo',
    reviewed_status: 'decision_question',
    rationale: 'Texto técnico interno',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital' }],
    material_impediment_category: 'capacidad_financiera_insuficiente',
    presentation: {
      title: 'Capital de trabajo mínimo',
      summary: 'La capacidad debe validarse con evidencia vigente.',
      missing: 'Validación financiera vigente.',
      action_required: 'Revisar el soporte con la persona responsable.',
    },
    question_responses: [],
    ...overrides,
  };
}

function analysisFixture(overrides = {}) {
  const axes = Object.fromEntries(AXES.map(axis => [axis, emptyBucket(axis)]));
  axes.experiencia_financiera = {
    axis: 'experiencia_financiera',
    state: 'Por confirmar',
    findings: [finding()],
    counts: { blocker: 0, decision_question: 1, supported: 0 },
  };
  return {
    run_id: 'run-current',
    snapshot_id: 'snapshot-current',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    evidence_coverage: READY_EVIDENCE_COVERAGE,
    decision_review: { review_findings: [] },
    decision_axis_analysis: {
      contract_version: 'agt002-decision-axis-analysis@1',
      global_state: 'ready_for_human_review',
      paused_reason: null,
      coverage: { decision_ready: true, total_source_units: 5, dispositioned_source_units: 5, unresolved_source_units: 0 },
      axes,
      preparation: [],
      counts: { material_findings: 1, ordinary_reclassified: 0 },
    },
    ...overrides,
  };
}

test('C1.1 — devuelve siempre cinco ejes en orden, con etiquetas humanas y cuatro estados cerrados', () => {
  assert.deepEqual(AGT002_DECISION_AXES, AXES);
  const views = tenderDecisionAxisViews(analysisFixture(), []);
  assert.equal(views.length, 5);
  assert.deepEqual(views.map(view => view.axis), AXES);
  for (const view of views) {
    assert.equal(view.label, AGT002_DECISION_AXIS_LABELS[view.axis]);
    assert.ok(STATES.includes(view.state));
  }
});

test('C1.2 — corrida histórica sin decision_axis_analysis queda pausada con cinco ejes No evaluado', () => {
  const analysis = analysisFixture({ decision_axis_analysis: null });
  const views = tenderDecisionAxisViews(analysis, []);
  assert.deepEqual(views.map(view => view.state), Array(5).fill('No evaluado'));
  assert.deepEqual(tenderDecisionSurfaceState(analysis, null), { state: 'paused', readOnly: true });
});

test('C1.3 — post_go sólo corresponde al GO humano del run vigente; NO GO vigente queda en revisión de sólo lectura', () => {
  const analysis = analysisFixture();
  assert.deepEqual(
    tenderDecisionSurfaceState(analysis, { decision: 'go', analysis_run_id: 'run-current' }),
    { state: 'post_go', readOnly: true },
  );
  assert.deepEqual(
    tenderDecisionSurfaceState(analysis, { decision: 'go', analysis_run_id: 'run-anterior' }),
    { state: 'ready_for_human_review', readOnly: false },
  );
  assert.deepEqual(
    tenderDecisionSurfaceState(analysis, { decision: 'no_go', analysis_run_id: 'run-current' }),
    { state: 'ready_for_human_review', readOnly: true },
  );
});

test('C1.4 — resuelve exactamente una CTA por precedencia y prioridad estable de ejes/findings', () => {
  const ready = analysisFixture();
  const readyViews = tenderDecisionAxisViews(ready, []);
  assert.deepEqual(
    tenderDecisionPrimaryCta(tenderDecisionSurfaceState(ready, null), readyViews),
    { id: 'resolve_question', findingId: 'finding-financial-1' },
  );

  const paused = analysisFixture({ decision_axis_analysis: null });
  assert.deepEqual(
    tenderDecisionPrimaryCta(tenderDecisionSurfaceState(paused, null), tenderDecisionAxisViews(paused, [])),
    { id: 'coverage', href: '#tender-technical-analysis' },
  );

  const noPending = analysisFixture();
  noPending.decision_axis_analysis.axes.experiencia_financiera = {
    axis: 'experiencia_financiera',
    state: 'Favorable con evidencia',
    findings: [finding({ reviewed_status: 'supported' })],
    counts: { blocker: 0, decision_question: 0, supported: 1 },
  };
  const noPendingViews = tenderDecisionAxisViews(noPending, []);
  assert.deepEqual(
    tenderDecisionPrimaryCta(tenderDecisionSurfaceState(noPending, null), noPendingViews),
    { id: 'record_decision' },
  );
  assert.deepEqual(
    tenderDecisionPrimaryCta(
      tenderDecisionSurfaceState(noPending, { decision: 'go', analysis_run_id: 'run-current' }),
      noPendingViews,
    ),
    { id: 'open_help_desk', sectionId: 'tender-preparation' },
  );
});

test('C1.5 — copy Bogotá conserva cifras exactas con formato es-CO', () => {
  assert.equal(
    tenderDecisionCoverageCopy({ total_source_units: 11345, dispositioned_source_units: 8 }),
    'Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)',
  );
});

test('C1.6 — respuesta resolved permanece contexto separado y nunca se convierte en evidencia ni cambia el estado', () => {
  const response = {
    id: 'response-1',
    opportunity_id: 'opportunity-1',
    analysis_run_id: 'run-current',
    question_id: 'finding-financial-1',
    question_text: '¿Cuál es el capital disponible?',
    status: 'resolved',
    response: 'RESPUESTA-HUMANA-NO-ES-EVIDENCIA',
    responded_by: 'user-1',
    responded_at: '2026-08-25T10:00:00.000Z',
    attachments: [],
  };
  const [financial] = tenderDecisionAxisViews(analysisFixture(), [response])
    .filter(view => view.axis === 'experiencia_financiera');
  assert.equal(financial.state, 'Por confirmar');
  assert.equal(financial.count, 1);
  assert.equal(financial.findings[0].responses[0].response, 'RESPUESTA-HUMANA-NO-ES-EVIDENCIA');
  assert.equal(financial.findings[0].latestResponse.response, 'RESPUESTA-HUMANA-NO-ES-EVIDENCIA');
  assert.equal(JSON.stringify(financial.findings[0].evidence).includes('RESPUESTA-HUMANA-NO-ES-EVIDENCIA'), false);
});

test('C1.7 — decision_question usa exclusivamente el rótulo pregunta material pendiente', () => {
  const financial = tenderDecisionAxisViews(analysisFixture(), [])
    .find(view => view.axis === 'experiencia_financiera');
  assert.equal(financial.findings[0].effectLabel, 'pregunta material pendiente');
  assert.equal(financial.findings[0].effectLabel.toLowerCase().includes('impedimento'), false);
});
