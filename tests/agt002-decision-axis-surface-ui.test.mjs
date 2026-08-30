import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES } from '../agt002-pre-go-analysis.js';
import { loadReactComponent, renderReactComponent } from './helpers/bundle-react-component.mjs';

const TenderDecisionAxisSurface = await loadReactComponent(
  'src/tenders/components/TenderDecisionAxisSurface.tsx',
  'TenderDecisionAxisSurface',
);

const AXES = ['legal', 'experiencia_financiera', 'imposibilidad_tecnica_grave', 'plazo', 'viabilidad_economica'];
const COVERAGE_BLOCK = { status: 'complete', total_source_units: 5, dispositioned_source_units: 5, requirement_count: 5 };
const READY_COVERAGE = {
  tender_requirement_inventory: {
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    expedient_coverage: COVERAGE_BLOCK,
    analyzed_coverage: COVERAGE_BLOCK,
  },
};

function finding(reviewedStatus = 'decision_question') {
  return {
    id: 'finding-financial-1',
    requirement_id: 'financial-working-capital',
    label: 'Capital de trabajo mínimo',
    reviewed_status: reviewedStatus,
    rationale: 'TEXTO-INTERNO-NUNCA-FRONTAL',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital' }],
    material_impediment_category: 'capacidad_financiera_insuficiente',
    presentation: {
      title: 'Capital de trabajo mínimo',
      summary: 'La capacidad debe validarse con evidencia vigente.',
      missing: 'Validación financiera vigente.',
      action_required: 'Revisar el soporte con la persona responsable.',
    },
    question_responses: [],
  };
}

const OPEN_CATEGORIES = ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic', 'technical'];

function openIntegralUnit(index, category) {
  const number = index + 1;
  return {
    unit_id: `UNIT-INTERNAL-${number}`,
    unit_kind: 'tender_requirement',
    requirement_id: `REQ-INTERNAL-${number}`,
    category,
    sequence: number,
    title: `Requisito operativo ${number}`,
    assessment_mode: 'abstained',
    conclusion: { status: 'insufficient_evidence', summary: `Conocimiento documental ${number}.`, confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'unknown', reason: 'Pendiente.' },
    evidence_state: { presence: 'unknown', review: 'not_reviewed', validity: 'unknown', applicability: 'unknown', compliance: 'unknown' },
    evidence_refs: number === 1 ? [{ ref: 'HASH-OFFSET-INTERNAL', source_type: 'tender_document', purpose: 'requirement_basis' }] : [],
    missing_evidence: number === 6 ? [] : [{ missing_id: `MISS-INTERNAL-${number}`, evidence_class_id: null, needed_source_type: 'company_evidence', reason: `Faltante documental ${number}.`, critical: true }],
    commercial_impact: { level: 'unknown', summary: `Impacto comercial ${number}.`, dimension: 'unknown' },
    legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Pendiente.', human_legal_review_required: true },
    actions: number === 6 ? [] : [{ action_id: `ACTION-INTERNAL-${number}`, action_type: 'review', summary: `Acción humana ${number}.`, basis_unit_id: `UNIT-INTERNAL-${number}`, suggested_role: 'authorized_human', priority: 'high', external_side_effect: false }],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Pendiente.' },
    closure: { status: 'open', condition: 'Pendiente de cierre humano.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Revisión humana pendiente.' },
  };
}

function analysisFixture({ paused = false } = {}) {
  const axes = Object.fromEntries(AXES.map(axis => [axis, {
    axis,
    state: 'No evaluado',
    findings: [],
    counts: { blocker: 0, decision_question: 0, supported: 0 },
  }]));
  if (!paused) {
    axes.experiencia_financiera = {
      axis: 'experiencia_financiera',
      state: 'Por confirmar',
      findings: [finding()],
      counts: { blocker: 0, decision_question: 1, supported: 0 },
    };
    axes.viabilidad_economica = {
      axis: 'viabilidad_economica',
      state: 'Favorable con evidencia',
      findings: [{ ...finding('supported'), id: 'finding-economic-1', material_impediment_category: 'inviabilidad_economica_critica' }],
      counts: { blocker: 0, decision_question: 0, supported: 1 },
    };
  }
  const total = paused ? 11345 : 5;
  const resolved = paused ? 8 : 5;
  const evidenceCoverage = paused
    ? {
      tender_requirement_inventory: {
        inventory_version: 'tender_requirement_inventory.v1',
        decision_ready: false,
        expedient_coverage: { status: 'partial', total_source_units: total, dispositioned_source_units: resolved, requirement_count: resolved },
        analyzed_coverage: { status: 'incomplete', total_source_units: total, dispositioned_source_units: resolved, requirement_count: resolved },
      },
    }
    : READY_COVERAGE;
  return {
    run_id: 'run-current',
    snapshot_id: 'snapshot-current',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    current: true,
    critical_open_count: 0,
    integral_analysis: paused ? {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: {
        analyzed_requirement_ids: OPEN_CATEGORIES.map((_, index) => `REQ-INTERNAL-${index + 1}`),
        expected_requirement_ids: OPEN_CATEGORIES.map((_, index) => `REQ-INTERNAL-${index + 1}`),
      },
      analysis_units: OPEN_CATEGORIES.map((category, index) => openIntegralUnit(index, category)),
    } : undefined,
    evidence_coverage: evidenceCoverage,
    decision_review: { review_findings: [], blockers: [], decision_questions: [], supported: [], preparation: [], not_applicable: [] },
    decision_axis_analysis: {
      contract_version: 'agt002-decision-axis-analysis@1',
      global_state: paused ? 'paused' : 'ready_for_human_review',
      paused_reason: paused ? 'coverage_not_decision_ready' : null,
      coverage: {
        decision_ready: !paused,
        total_source_units: total,
        dispositioned_source_units: resolved,
        unresolved_source_units: total - resolved,
      },
      axes,
      preparation: [],
      counts: { material_findings: paused ? 0 : 2, ordinary_reclassified: 0 },
    },
  };
}

const request = async () => ({ decision: null, history: [], preparation: null });
const commonProps = {
  opportunityId: 'opportunity-1',
  opportunityName: 'Oportunidad de prueba',
  questionResponses: [],
  currentProfile: { id: 'profile-1', full_name: 'Revisora', role: 'analista', permissions: [] },
  request,
  canAnswerQuestions: false,
  onDecisionChanged: () => {},
  decisionState: { phase: 'ready', value: null },
  onOpenHelpDesk: () => {},
};

function render(analysis, overrides = {}) {
  return renderReactComponent(TenderDecisionAxisSurface, { ...commonProps, ...overrides, analysis });
}

function count(html, needle) {
  return html.split(needle).length - 1;
}

test('D1.1-D1.2 — cinco chips accesibles comunican eje, estado y conteo; No evaluado no usa clase favorable', () => {
  const html = render(analysisFixture());
  assert.equal(count(html, 'class="tender-decision-axis-chip '), 5);
  assert.equal(count(html, 'aria-pressed='), 5);
  for (const label of ['Legal', 'Experiencia y capacidad financiera', 'Imposibilidad técnica grave', 'Plazo', 'Viabilidad económica']) {
    assert.ok(html.includes(label), `falta chip ${label}`);
  }
  assert.ok(html.includes('Por confirmar'));
  assert.ok(html.includes('No evaluado'));
  assert.ok(html.includes('tender-decision-axis-chip state-not-evaluated'));
  assert.equal(html.includes('tender-decision-axis-chip state-favorable state-not-evaluated'), false);
});

test('D1.3 — existe exactamente una CTA primaria y respeta la precedencia de pregunta material', () => {
  const html = render(analysisFixture());
  assert.equal(count(html, 'class="tender-decision-axis-cta"'), 1);
  assert.ok(html.includes('Resolver la pregunta prioritaria'));
});

test('D1.4-D1.5 — tabla y dl conservan cinco campos y el banner usa aria-live polite', () => {
  const html = render(analysisFixture());
  assert.ok(html.includes('<caption>'));
  for (const heading of ['Exigencia', 'Evidencia', 'Cruce', 'Efecto', 'Acción']) {
    assert.ok(html.includes(`<th scope="col">${heading}</th>`));
    assert.ok(html.includes(`<dt>${heading}</dt>`));
  }
  assert.ok(html.includes('<dl class="tender-decision-axis-card-fields">'));
  assert.ok(html.includes('aria-live="polite"'));
});

test('D1.6 — cinco ejes vacíos con seis unidades V3 abiertas se sustituyen por seis pendientes operativos humanos', () => {
  const html = render(analysisFixture({ paused: true }));
  assert.ok(html.includes('Lectura documental incompleta'));
  assert.ok(html.includes('6 pendientes accionables'));
  assert.equal(count(html, 'class="tender-decision-operational-card"'), 6);
  assert.equal(count(html, 'No evaluado · 0'), 0, 'los chips vacíos deben ceder su lugar a la proyección V3');
  assert.equal(html.includes('Favorable con evidencia'), false);
  assert.equal(html.includes('Sin impedimentos'), false);
  for (const category of [
    'Presentación y causales de rechazo',
    'Requisitos habilitantes',
    'Capacidad y obligaciones técnicas',
    'Capacidad financiera y económica',
    'Condiciones estratégicas y contractuales',
  ]) assert.ok(html.includes(category), `falta categoría humana ${category}`);
  assert.equal(count(html, 'class="tender-decision-operational-label"'), 6, 'cada tarjeta rotula su título una vez como requisito');
  for (const field of ['Qué sabemos', 'Qué falta por confirmar o aportar', 'Por qué importa', 'Siguiente acción', 'Referencias']) {
    assert.ok(html.includes(`<dt>${field}</dt>`), `falta campo separado ${field}`);
  }
  assert.equal(count(html, 'Requisito operativo 1'), 1, 'el título/requisito no debe repetirse dentro de la tarjeta');
  assert.equal(count(html, 'Lectura documental incompleta'), 1, 'el estado operativo se anuncia una sola vez');
  assert.equal(count(html, '6 pendientes accionables'), 1, 'el conteo operativo se anuncia una sola vez');
  for (const literal of ['Requisito operativo 1', 'Conocimiento documental 1.', 'Faltante documental 1.', 'Impacto comercial 1.', 'Acción humana 1.']) assert.ok(html.includes(literal));
  assert.ok(html.includes('No hay un faltante específico registrado; la validación humana continúa pendiente.'));
  assert.ok(html.includes('No hay una siguiente acción específica registrada; asignar revisión humana.'));
  for (const forbidden of ['Ver trazabilidad técnica', 'Ver respaldo técnico del análisis', 'UNIT-INTERNAL', 'REQ-INTERNAL', 'HASH-OFFSET-INTERNAL', 'financial_execution', '6 de 6.809', 'Cobertura: LISTA']) {
    assert.equal(html.includes(forbidden), false, `se filtró contenido técnico/prohibido: ${forbidden}`);
  }
});

test('D1.7-D1.8 — la pregunta usa copy pendiente y la barra integra Mesa de ayuda + control formal', () => {
  const html = render(analysisFixture());
  assert.ok(html.includes('pregunta material pendiente'));
  const questionRow = html.match(/Capital de trabajo mínimo[\s\S]*?Ver detalle \/ Responder/)?.[0] || '';
  assert.ok(questionRow);
  assert.equal(/impediment/i.test(questionRow), false);
  assert.ok(html.includes('Mesa de ayuda'));
  assert.ok(html.includes('Decisión GO / NO GO'));
  assert.equal(count(html, 'class="tender-decision-axis-cta"'), 1);
});

test('D1.8 — estado formal aún no resuelto bloquea la CTA y deja cualquier drawer en sólo lectura', () => {
  const html = render(analysisFixture(), { decisionState: { phase: 'loading' } });
  assert.match(
    html,
    /<button[^>]*class="tender-decision-axis-cta"[^>]*disabled=""[^>]*>/,
    'la CTA primaria no puede actuar antes de conocer la decisión humana vigente',
  );
  assert.equal(html.includes('Ver detalle / Responder'), false, 'un estado bloqueado no debe prometer edición');
  assert.ok(html.includes('Ver detalle'));
  const source = readFileSync(new URL('../src/tenders/components/TenderDecisionAxisSurface.tsx', import.meta.url), 'utf8');
  assert.match(source, /const decisionStateUnresolved = decisionState\.phase !== 'ready'/);
  assert.match(source, /readOnly=\{drawerReadOnly\}/);
});

test('D6 — fuente implementa diálogo, Escape, trampa/restauración de foco y CSS responsive propio', () => {
  const source = readFileSync(new URL('../src/tenders/components/TenderDecisionAxisSurface.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/tenders/components/tender-decision-axis-surface.css', import.meta.url), 'utf8');
  assert.ok(source.includes('role="dialog"'));
  assert.ok(source.includes('aria-modal="true"'));
  assert.ok(source.includes("event.key === 'Escape'"));
  assert.ok(source.includes("event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)"));
  assert.ok(source.includes('previouslyFocusedRef'));
  assert.ok(source.includes("event.key !== 'Tab'"));
  assert.ok(source.includes('requestAnimationFrame'));
  assert.match(css, /\.tender-decision-axis-card-fields[^{]*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/s);
  assert.ok(css.includes('@media (min-width: 1120px)'));
  assert.ok(css.includes('@media (max-width: 640px)'));
  assert.match(css, /\.tender-decision-axis-surface :is\(button, a, summary, \[tabindex\]\):focus-visible/);
  assert.match(css, /\.tender-decision-axis-drawer :is\(button, a, summary, input, textarea, select, \[tabindex\]\):focus-visible/);
  assert.equal(/aria-hidden/.test(source), false, 'el contenido alternativo no debe ocultarse a lectores con aria-hidden');
});

test('D6 — el CSS local neutraliza td:last-child global en la tabla de ejes', () => {
  const globalCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(
    globalCss,
    /td:last-child\{white-space:nowrap;text-align:right/,
    'la regla global que este override neutraliza debe seguir existiendo tal como se documentó',
  );
  const css = readFileSync(new URL('../src/tenders/components/tender-decision-axis-surface.css', import.meta.url), 'utf8');
  assert.match(
    css,
    /\.tender-decision-axis-table\s+td:last-child\s*\{\s*white-space:\s*normal;\s*text-align:\s*left;\s*min-width:\s*0;?\s*\}/,
    'falta el override local de mayor especificidad para la última celda (Acción) de la tabla de ejes',
  );
});

test('D6 — post_go muestra exactamente una acción de Mesa de ayuda y una sola CTA primaria', () => {
  const html = render(analysisFixture(), {
    decisionState: {
      phase: 'ready',
      value: {
        id: 'decision-1',
        opportunity_id: 'opportunity-1',
        tender_id: 'tender-1',
        decision: 'go',
        analysis_interaction_id: null,
        analysis_run_id: 'run-current',
        justification: null,
        decided_by: 'profile-1',
        decided_at: '2026-08-20T00:00:00.000Z',
      },
    },
  });
  assert.equal(count(html, 'class="tender-decision-axis-help"'), 0, 'el botón secundario Mesa de ayuda no debe duplicar el destino de la CTA primaria en post_go');
  assert.equal(count(html, 'class="tender-decision-axis-cta"'), 1);
  assert.ok(html.includes('Abrir Mesa de ayuda'));
  assert.ok(html.includes('GO humano registrado'));
});

test('D6 — fuera de post_go se conserva el botón secundario Mesa de ayuda junto a la CTA primaria correspondiente', () => {
  const html = render(analysisFixture());
  assert.equal(count(html, 'class="tender-decision-axis-help"'), 1);
  assert.equal(count(html, 'class="tender-decision-axis-cta"'), 1);
  assert.ok(html.includes('Mesa de ayuda'));
  assert.ok(html.includes('Resolver la pregunta prioritaria'));

  const pausedHtml = render(analysisFixture({ paused: true }));
  assert.equal(count(pausedHtml, 'class="tender-decision-axis-help"'), 1);
  assert.equal(count(pausedHtml, 'class="tender-decision-axis-cta"'), 1);
  assert.ok(pausedHtml.includes('Resolver pendientes documentales'));
});

test('D6 — el harness visual usa únicamente categorías del catálogo material gobernado', () => {
  const qaSource = readFileSync(new URL('../scripts/agt002-decision-axis-visual-qa.mjs', import.meta.url), 'utf8');
  const governedCategories = new Set(AGT002_PRE_GO_MATERIAL_IMPEDIMENT_CATEGORIES);
  const fixtureCategories = [...qaSource.matchAll(/category:\s*'([^']+)'/g)].map(match => match[1]);
  assert.ok(fixtureCategories.length > 0, 'el harness debe ejercitar categorías materiales');
  for (const category of fixtureCategories) {
    assert.ok(governedCategories.has(category), `el harness usa una categoría material inexistente: ${category}`);
  }
});
