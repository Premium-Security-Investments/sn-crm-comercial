import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const projectionPath = new URL('../src/tenders/components/TenderOperationalPendingProjection.tsx', import.meta.url);
const main = read('src/main.tsx');
const styles = read('src/styles.css');
const axis = read('src/tenders/components/TenderDecisionAxisSurface.tsx');
const axisStyles = read('src/tenders/components/tender-decision-axis-surface.css');
const navigation = read('src/tenders/components/TenderDetailNavigation.tsx');
const analysis = read('src/tenders/components/TenderAnalysisSection.tsx');

test('proyección compartida: Análisis posee la lista y Decisión sólo el puntero', () => {
  assert.equal(existsSync(projectionPath), true, 'Debe existir un componente compartido para los pendientes V3.');
  const projection = existsSync(projectionPath) ? read('src/tenders/components/TenderOperationalPendingProjection.tsx') : '';
  assert.match(projection, /export function TenderOperationalPendingProjection/);
  assert.match(analysis, /<TenderOperationalPendingProjection/);
  assert.doesNotMatch(axis, /function OperationalPendingCard|function OperationalPendingProjection/);
  assert.doesNotMatch(axis, /<TenderOperationalPendingProjection/);
  assert.match(axis, /focusTenderDetailSection\(document\.getElementById\('tender-analysis'\)\)/);
});

test('ids, foco, navegación e intersección permanecen en los seis contenedores canónicos', () => {
  assert.match(main, /id="tender-analysis"[^>]*tabIndex=\{-1\}/);
  assert.match(main, /id="tender-decision"[^>]*tabIndex=\{-1\}/);
  assert.doesNotMatch(main, /id="tender-decision-operational-pending"/);
  assert.match(navigation, /createTenderDetailSectionObserver/);
  assert.match(navigation, /TENDER_DETAIL_SECTIONS[\s\S]*?resolveElement/);
  assert.match(styles, /#tender-analysis:focus-visible/);
});

test('Resumen y control formal usan densidad acotada, también en responsive', () => {
  assert.match(main, /className="tender-summary-anchor tender-detail-anchor"/);
  assert.match(main, /<Panel title="Resumen de la oportunidad" className="tender-opportunity-summary-panel">/);
  assert.match(styles, /\.tender-opportunity-summary-panel\{/);
  assert.match(axisStyles, /\.tender-decision-axis-formal \.tender-go-no-go-panel\s*\{/);
  assert.match(axisStyles, /@media \(max-width: 640px\)[\s\S]*?tender-decision-axis-formal/);
});

test('timeline presenta el copy correcto sin reescribir historial', () => {
  assert.match(main, /converted: 'Convertida en oportunidad'/);
  assert.doesNotMatch(main, /Convertida En Oportunidad/);
  assert.match(main, /className="timeline tender-business-timeline"/);
  assert.match(styles, /\.tender-business-timeline \.event strong\{text-transform:none\}/);
});

test('Guardar actuación explica el requisito vacío sin cambiar la validación', () => {
  assert.match(main, /id="tender-follow-up-note"[^>]*required[^>]*aria-describedby=\{!note\.trim\(\) \? 'tender-follow-up-note-help' : undefined\}/);
  assert.match(main, /id="tender-follow-up-note-help"[^>]*>Escriba una descripción para habilitar Guardar actuación\./);
  assert.match(main, /<button disabled=\{!note\.trim\(\)\}>Guardar actuación<\/button>/);
});

// ---------------------------------------------------------------------------------------------
// AGT-002 QA visual · en modo formal-primary, el hero externo de TenderDecisionAxisSurface
// duplicaba el título "Decisión GO / NO GO" que ya muestra TenderGoNoGoDecisionPanel embebido.
// El hero duplicado debe eliminarse conservando aria-labelledby resolviendo a un id real.
// ---------------------------------------------------------------------------------------------
function count(html, needle) {
  return html.split(needle).length - 1;
}

const AGT002_QA_AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];

function pausedFormalPrimaryAnalysisFixture() {
  const axes = Object.fromEntries(AGT002_QA_AXES.map(axis => [axis, {
    axis,
    state: 'No evaluado',
    findings: [],
    counts: { blocker: 0, decision_question: 0, supported: 0 },
  }]));
  const unit = {
    unit_id: 'unit-formal-primary-qa',
    unit_kind: 'tender_requirement',
    requirement_id: 'REQ-formal-primary-qa',
    category: 'technical',
    sequence: 1,
    title: 'Requisito operativo de prueba',
    assessment_mode: 'abstained',
    conclusion: { status: 'insufficient_evidence', summary: 'Conocimiento documental disponible.', confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'unknown', reason: 'Pendiente.' },
    evidence_state: { presence: 'unknown', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown' },
    evidence_refs: [],
    missing_evidence: [{ missing_id: 'missing-formal-primary-qa', evidence_class_id: null, needed_source_type: 'company_evidence', reason: 'Falta soporte.', critical: true }],
    commercial_impact: { level: 'unknown', summary: 'Impacto por confirmar.', dimension: 'unknown' },
    legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Pendiente.', human_legal_review_required: true },
    actions: [{ action_id: 'action-formal-primary-qa', action_type: 'review', summary: 'Gestionar pendiente.', basis_unit_id: 'unit-formal-primary-qa', suggested_role: 'authorized_human', priority: 'high', external_side_effect: false }],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Pendiente.' },
    closure: { status: 'open', condition: 'Pendiente de cierre humano.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Revisión humana pendiente.' },
  };
  return {
    run_id: 'run-formal-primary-qa',
    snapshot_id: 'snapshot-formal-primary-qa',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 1,
    integral_analysis: {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: { analyzed_requirement_ids: ['REQ-formal-primary-qa'], expected_requirement_ids: ['REQ-formal-primary-qa'] },
      analysis_units: [unit],
    },
    evidence_coverage: {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: false,
        expedient_coverage: { status: 'partial', total_source_units: 1, dispositioned_source_units: 0, requirement_count: 0 },
        analyzed_coverage: { status: 'incomplete', total_source_units: 1, dispositioned_source_units: 0, requirement_count: 0 },
      },
    },
    decision_review: { review_findings: [], blockers: [], decision_questions: [], supported: [], preparation: [], not_applicable: [] },
    decision_axis_analysis: {
      contract_version: 'agt002-decision-axis-analysis@1',
      global_state: 'paused',
      paused_reason: 'coverage_not_decision_ready',
      coverage: { decision_ready: false, total_source_units: 1, dispositioned_source_units: 0, unresolved_source_units: 1 },
      axes,
      preparation: [],
      counts: { material_findings: 0, ordinary_reclassified: 0 },
    },
  };
}

test('en la proyección formal-primary, el hero externo no duplica "Decisión GO / NO GO" y los aria-labelledby siguen resolviendo a un id real', async () => {
  const TenderDecisionAxisSurface = await loadReactComponent(
    'src/tenders/components/TenderDecisionAxisSurface.tsx',
    'TenderDecisionAxisSurface',
  );
  const html = renderReactComponent(TenderDecisionAxisSurface, {
    opportunityId: 'opportunity-1',
    opportunityName: 'Oportunidad de prueba',
    analysis: pausedFormalPrimaryAnalysisFixture(),
    questionResponses: [],
    currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'analista', permissions: [] },
    request: async () => ({ decision: null, history: [], preparation: null }),
    canAnswerQuestions: false,
    onDecisionChanged: () => {},
    decisionState: { phase: 'ready', value: null },
    onOpenHelpDesk: () => {},
  });
  assert.equal(
    count(html, 'Decisión GO / NO GO'),
    1,
    'el título "Decisión GO / NO GO" debe aparecer una sola vez: el panel formal es la única fuente, el hero externo no debe duplicarlo',
  );
  const labelledByIds = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(match => match[1]);
  assert.ok(labelledByIds.length > 0, 'el render debe declarar al menos un aria-labelledby para ejercer la verificación');
  for (const id of labelledByIds) {
    assert.match(html, new RegExp(`id="${id}"`), `aria-labelledby="${id}" debe apuntar a un id real presente en el HTML renderizado`);
  }
});
