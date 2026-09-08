import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  deriveAgt002DossierHandoff,
  AGT002_DOSSIER_HANDOFF_ORIGIN,
  AGT002_DOSSIER_HANDOFF_ITEM_TYPE,
} from '../server/agt002-dossier-handoff.js';
import { buildActionableReviewIntegralUnitSource } from '../agt002-actionable-review-canonical.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BLOCK = Object.freeze({ total_source_units: 1, dispositioned_source_units: 1 });
const COVERAGE_READY = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: true,
    expedient_coverage: BLOCK,
    analyzed_coverage: BLOCK,
  }),
});
const COVERAGE_PAUSED = Object.freeze({
  tender_requirement_inventory: Object.freeze({
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: false,
    expedient_coverage: BLOCK,
    analyzed_coverage: BLOCK,
  }),
});

function currentAnalysisFixture(overrides = {}) {
  return {
    run_id: 'run-1',
    opportunity_id: 'opp-1',
    snapshot_id: 'snap-1',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    current: true,
    ...overrides,
  };
}

// Unidad V3 completa: expone exactamente las 19 claves de la proyección §6.4 (necesarias para
// buildActionableReviewIntegralUnitSource) y también las que exige la elegibilidad estructural de
// deriveAgt002GenericDecisionReview, para poder reutilizar el mismo fixture en ambas rutas.
function fullUnitFixture(overrides = {}) {
  return {
    unit_id: 'unit-financial-1',
    unit_kind: 'tender_requirement',
    requirement_id: 'financial-working-capital',
    category: 'financial_execution',
    sequence: 1,
    title: 'Capital de trabajo mínimo exigido',
    assessment_mode: 'abstained',
    conclusion: { status: 'insufficient_evidence', confidence: 'unavailable', summary: 'El capital de trabajo debe revisarse.' },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'La suficiencia financiera no está verificada.' },
    evidence_state: { applicability: 'applicable', compliance: 'pending_review' },
    evidence_refs: [{ source_type: 'tender_document', ref: 'evidence:chunk:doc-1:p1:s1:c0', purpose: 'requirement_basis' }],
    missing_evidence: [{
      missing_id: 'missing-financial-review',
      needed_source_type: 'company_evidence',
      evidence_class_id: 'financial_statements',
      reason: 'Estados financieros revisados por una persona autorizada.',
      critical: true,
    }],
    commercial_impact: { level: 'high', dimension: 'eligibility', summary: 'Puede impedir acreditar la capacidad financiera.' },
    legal_assessment: null,
    actions: [{
      action_id: 'action-review-financials',
      action_type: 'verify_validity',
      summary: 'Revisar los estados financieros y el capital de trabajo.',
      priority: 'critical',
      suggested_role: 'financial',
      basis_unit_id: 'unit-financial-1',
      external_side_effect: false,
    }],
    milestone: null,
    escalation: null,
    closure: { status: 'open', condition: 'Revisión humana satisfactoria.', evidence_required: ['Estados financieros'] },
    human_validation: { required: true, status: 'pending', reason: 'Pendiente de revisión humana.' },
    ...overrides,
  };
}

function resultFixture(units, evidenceCoverage = COVERAGE_READY) {
  const requirementIds = units.map(unit => unit.requirement_id);
  return {
    integral_analysis: {
      contract_version: 'agt002-integral-analysis-v3',
      coverage: {
        analyzed_requirement_ids: requirementIds,
        expected_requirement_ids: requirementIds,
        material_omissions: false,
        omission_reasons: [],
      },
      analysis_units: units,
    },
    evidence_coverage: evidenceCoverage,
  };
}

function readyDecisionAnalysis({ axes = {}, preparation = [] } = {}) {
  return { global_state: 'ready_for_human_review', paused_reason: null, coverage: { decision_ready: true }, axes, preparation };
}

function axisFinding(overrides = {}) {
  return { id: 'finding-1', requirement_id: 'req-1', reviewed_status: 'decision_question', label: 'irrelevante', ...overrides };
}

// ---------------------------------------------------------------------------
// ready / paused
// ---------------------------------------------------------------------------

test('1. global_state distinto de ready_for_human_review => {ready:false, items:[]}', () => {
  const input = { currentAnalysis: currentAnalysisFixture({ canonical: false }), result: resultFixture([fullUnitFixture()]), questionResponses: [] };
  const out = deriveAgt002DossierHandoff(input);
  assert.deepEqual(out, { ready: false, items: [] });
});

test('2. coverage.decision_ready=false aunque global_state sea ready_for_human_review => not ready', () => {
  const decisionAnalysis = { global_state: 'ready_for_human_review', coverage: { decision_ready: false }, axes: {}, preparation: [] };
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [] } });
  assert.equal(out.ready, false);
  assert.deepEqual(out.items, []);
});

test('3. global_state paused (vía coverage no lista) por la ruta currentAnalysis/result => not ready', () => {
  const input = { currentAnalysis: currentAnalysisFixture(), result: resultFixture([fullUnitFixture()], COVERAGE_PAUSED), questionResponses: [] };
  const out = deriveAgt002DossierHandoff(input);
  assert.equal(out.ready, false);
});

// ---------------------------------------------------------------------------
// Integración de la ruta currentAnalysis/result/questionResponses
// ---------------------------------------------------------------------------

test('4. ruta currentAnalysis/result deriva decisionAnalysis internamente y produce el item esperado', () => {
  const unit = fullUnitFixture();
  const input = { currentAnalysis: currentAnalysisFixture(), result: resultFixture([unit]), questionResponses: [] };
  const out = deriveAgt002DossierHandoff(input);
  assert.equal(out.ready, true);
  assert.equal(out.items.length, 1);
  const item = out.items[0];
  assert.equal(item.item_key, 'agt002_post_go:financial-working-capital');
  assert.equal(item.origin, AGT002_DOSSIER_HANDOFF_ORIGIN);
  assert.equal(item.item_type, AGT002_DOSSIER_HANDOFF_ITEM_TYPE);
  assert.equal(item.required, true);
  assert.equal(item.status, 'pendiente');
  assert.equal(item.presentation.title, unit.title);
  assert.equal(item.presentation.instruction, unit.actions[0].summary);
  assert.equal(item.source.source_kind, 'integral_unit');
  assert.equal(item.source.source_id, unit.unit_id);
  assert.equal(item.source.requirement_id, unit.requirement_id);
});

// ---------------------------------------------------------------------------
// Buckets: blocker|decision_question de eje, preparation con status preparation; excluye
// supported/not_applicable
// ---------------------------------------------------------------------------

test('5. sólo entran blocker/decision_question de eje y preparation con status preparation', () => {
  const unitBlocker = fullUnitFixture({ unit_id: 'unit-blocker', requirement_id: 'req-blocker' });
  const unitQuestion = fullUnitFixture({ unit_id: 'unit-question', requirement_id: 'req-question' });
  const unitPrep = fullUnitFixture({ unit_id: 'unit-prep', requirement_id: 'req-prep' });

  const decisionAnalysis = readyDecisionAnalysis({
    axes: {
      legal: { findings: [axisFinding({ id: 'f-blocker', requirement_id: 'req-blocker', reviewed_status: 'blocker' })] },
      plazo: { findings: [axisFinding({ id: 'f-supported', requirement_id: 'req-supported', reviewed_status: 'supported' })] },
      experiencia_financiera: { findings: [axisFinding({ id: 'f-question', requirement_id: 'req-question', reviewed_status: 'decision_question' })] },
    },
    preparation: [
      axisFinding({ id: 'f-prep', requirement_id: 'req-prep', reviewed_status: 'preparation' }),
      axisFinding({ id: 'f-na', requirement_id: 'req-na', reviewed_status: 'not_applicable' }),
    ],
  });
  const integralAnalysis = { analysis_units: [unitBlocker, unitQuestion, unitPrep] };

  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis });
  assert.equal(out.ready, true);
  const keys = out.items.map(item => item.item_key).sort();
  assert.deepEqual(keys, ['agt002_post_go:req-blocker', 'agt002_post_go:req-prep', 'agt002_post_go:req-question']);
});

// ---------------------------------------------------------------------------
// Unión: exactamente una unidad V3 tender_requirement; evidence_satisfied se excluye
// ---------------------------------------------------------------------------

test('6. la unión usa el helper canónico: source_id/requirement_id/source_hash coinciden exactamente', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });

  const expected = buildActionableReviewIntegralUnitSource(unit);
  const item = out.items[0];
  assert.equal(item.source.source_kind, 'integral_unit');
  assert.equal(item.source.source_id, expected.sourceId);
  assert.equal(item.source.requirement_id, expected.requirementId);
  assert.equal(item.source.source_hash, expected.sourceHash);
});

test('7. una unidad evidence_satisfied duplicada no cuenta para la unión: se usa la unidad abierta', () => {
  const unitOpen = fullUnitFixture({ unit_id: 'unit-open', requirement_id: 'req-dup' });
  const unitSatisfied = fullUnitFixture({
    unit_id: 'unit-satisfied',
    requirement_id: 'req-dup',
    closure: { status: 'evidence_satisfied', condition: 'Ya resuelto.', evidence_required: [] },
  });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: 'req-dup' })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unitSatisfied, unitOpen] } });

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].source.source_id, 'unit-open');
});

test('8. requirement_id sin ninguna unidad V3 elegible falla el lote entero (unión ausente)', () => {
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: 'req-huerfano' })] } } });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [] } }),
    /sin unidad V3 tender_requirement elegible/,
  );
});

test('9. requirement_id nulo en un hallazgo de preparation falla el lote entero', () => {
  const decisionAnalysis = readyDecisionAnalysis({ preparation: [axisFinding({ requirement_id: null, reviewed_status: 'preparation' })] });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [] } }),
    /sin requirement_id no nulo utilizable/,
  );
});

test('10. dos unidades V3 tender_requirement elegibles para el mismo requirement_id fallan el lote entero (duplicado)', () => {
  const unitA = fullUnitFixture({ unit_id: 'unit-a', requirement_id: 'req-ambiguo' });
  const unitB = fullUnitFixture({ unit_id: 'unit-b', requirement_id: 'req-ambiguo' });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: 'req-ambiguo' })] } } });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unitA, unitB] } }),
    /más de una unidad V3 tender_requirement elegible/,
  );
});

test('11. una unidad tender_requirement de otro unit_kind (strategic_consideration) nunca cuenta como unión', () => {
  const strategic = fullUnitFixture({ unit_id: 'unit-strategic', requirement_id: 'req-strategic', unit_kind: 'strategic_consideration' });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: 'req-strategic' })] } } });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [strategic] } }),
    /sin unidad V3 tender_requirement elegible/,
  );
});

// ---------------------------------------------------------------------------
// status: bloqueado si finding blocker o unit.blocking.effect blocker; si no, pendiente
// ---------------------------------------------------------------------------

test('12. status bloqueado si el hallazgo es blocker, aunque la unidad sea non_blocking', () => {
  const unit = fullUnitFixture({ blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'ok' } });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id, reviewed_status: 'blocker' })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].status, 'bloqueado');
});

test('13. status bloqueado si la unidad tiene blocking.effect blocker, aunque el hallazgo sea decision_question', () => {
  const unit = fullUnitFixture({ blocking: { effect: 'blocker', curability: 'undeterminable', reason: 'Impedimento confirmado.' } });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id, reviewed_status: 'decision_question' })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].status, 'bloqueado');
});

test('14. status pendiente cuando ni el hallazgo ni la unidad son blocker', () => {
  const unit = fullUnitFixture({ blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'ok' } });
  const decisionAnalysis = readyDecisionAnalysis({ preparation: [axisFinding({ requirement_id: unit.requirement_id, reviewed_status: 'preparation' })] });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].status, 'pendiente');
});

// ---------------------------------------------------------------------------
// presentation: título/instrucción con reservas unit title / actions summary / closure.condition
// ---------------------------------------------------------------------------

test('15. instrucción usa el resumen de la acción priorizada (critical antes que low), no el orden del arreglo', () => {
  const unit = fullUnitFixture({
    actions: [
      { action_id: 'a-low', action_type: 'verify_validity', summary: 'Acción de baja prioridad.', priority: 'low', suggested_role: 'legal', basis_unit_id: 'unit-financial-1', external_side_effect: false },
      { action_id: 'a-critical', action_type: 'verify_validity', summary: 'Acción crítica.', priority: 'critical', suggested_role: 'legal', basis_unit_id: 'unit-financial-1', external_side_effect: false },
    ],
  });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.instruction, 'Acción crítica.');
});

test('16. sin acciones utilizables la instrucción cae en closure.condition', () => {
  const unit = fullUnitFixture({ actions: [], closure: { status: 'open', condition: 'Confirmar con la persona responsable.', evidence_required: [] } });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.instruction, 'Confirmar con la persona responsable.');
});

test('17. sin acciones ni closure.condition utilizables la instrucción es null', () => {
  const unit = fullUnitFixture({ actions: [], closure: { status: 'open', condition: '   ', evidence_required: [] } });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.instruction, null);
});

test('18. sin finding.presentation.title utilizable, el título cae en unit.title, nunca derivado del texto libre del hallazgo (sin heurística)', () => {
  const unit = fullUnitFixture({ title: 'Título estructural de la unidad V3' });
  const decisionAnalysis = readyDecisionAnalysis({
    axes: {
      legal: {
        findings: [axisFinding({
          requirement_id: unit.requirement_id,
          label: 'Un rótulo totalmente distinto que no debería usarse jamás como título',
          rationale: 'Una razón de texto libre que tampoco debería influir en el título.',
        })],
      },
    },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.title, 'Título estructural de la unidad V3');
});

test('18b. finding.presentation.title no vacío tiene prioridad sobre unit.title', () => {
  const unit = fullUnitFixture({ title: 'Título estructural de la unidad V3' });
  const decisionAnalysis = readyDecisionAnalysis({
    axes: {
      legal: {
        findings: [axisFinding({
          requirement_id: unit.requirement_id,
          presentation: { title: 'Título gobernado del hallazgo', action_required: 'Instrucción gobernada del hallazgo.' },
        })],
      },
    },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.title, 'Título gobernado del hallazgo');
});

test('18c. finding.presentation.action_required no vacío tiene prioridad sobre las acciones y closure.condition de la unidad', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({
    axes: {
      legal: {
        findings: [axisFinding({
          requirement_id: unit.requirement_id,
          presentation: { title: 'Título gobernado del hallazgo', action_required: 'Instrucción gobernada del hallazgo.' },
        })],
      },
    },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.instruction, 'Instrucción gobernada del hallazgo.');
});

test('18d. finding.presentation con title/action_required vacíos o en blanco cae en los fallbacks de la unidad, no en label/rationale/summary', () => {
  const unit = fullUnitFixture({ title: 'Título estructural de la unidad V3' });
  const decisionAnalysis = readyDecisionAnalysis({
    axes: {
      legal: {
        findings: [axisFinding({
          requirement_id: unit.requirement_id,
          label: 'Rótulo que nunca debería usarse',
          rationale: 'Razón de texto libre que nunca debería usarse',
          presentation: { title: '   ', action_required: '   ', summary: 'Resumen de texto libre que nunca debería usarse' },
        })],
      },
    },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.title, 'Título estructural de la unidad V3');
  assert.equal(out.items[0].presentation.instruction, unit.actions[0].summary);
});

test('18e. finding.presentation ausente (undefined) cae íntegramente en los fallbacks de la unidad', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({
    axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id, presentation: undefined })] } },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.title, unit.title);
  assert.equal(out.items[0].presentation.instruction, unit.actions[0].summary);
});

test('18f. finding.presentation no es un objeto (texto/heurística mal formada) se ignora y cae en los fallbacks de la unidad', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({
    axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id, presentation: 'no es un objeto' })] } },
  });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.equal(out.items[0].presentation.title, unit.title);
  assert.equal(out.items[0].presentation.instruction, unit.actions[0].summary);
});

// ---------------------------------------------------------------------------
// malformed / colisiones / item_key > 200
// ---------------------------------------------------------------------------

test('19. una unidad V3 sin la clave cerrada exacta de la proyección falla el lote entero (malformed)', () => {
  const unit = fullUnitFixture();
  delete unit.milestone;
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  assert.throws(() => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } }));
});

test('20. dos hallazgos que resuelven al mismo item_key fallan el lote entero (colisión)', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({
    axes: { legal: { findings: [axisFinding({ id: 'f-1', requirement_id: unit.requirement_id, reviewed_status: 'blocker' })] } },
    preparation: [axisFinding({ id: 'f-2', requirement_id: unit.requirement_id, reviewed_status: 'preparation' })],
  });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } }),
    /item_key duplicado/,
  );
});

test('21. un item_key resultante de más de 200 caracteres falla el lote entero', () => {
  const longRequirementId = 'r'.repeat(190);
  const unit = fullUnitFixture({ requirement_id: longRequirementId });
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: longRequirementId })] } } });
  assert.throws(
    () => deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } }),
    /item_key resultante excede/,
  );
});

// ---------------------------------------------------------------------------
// No mutación
// ---------------------------------------------------------------------------

function deepFreezeFixture(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreezeFixture);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreezeFixture);
    return Object.freeze(value);
  }
  return value;
}

test('22. no muta currentAnalysis/result/questionResponses (ruta A) — congelados en profundidad de antemano', () => {
  const currentAnalysis = deepFreezeFixture(currentAnalysisFixture());
  const result = deepFreezeFixture(resultFixture([fullUnitFixture()]));
  const questionResponses = deepFreezeFixture([]);
  const before = JSON.stringify({ currentAnalysis, result, questionResponses });

  const out = deriveAgt002DossierHandoff({ currentAnalysis, result, questionResponses });

  assert.equal(out.ready, true);
  assert.equal(JSON.stringify({ currentAnalysis, result, questionResponses }), before);
});

test('23. no muta decisionAnalysis/integralAnalysis (ruta B) — congelados en profundidad de antemano', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = deepFreezeFixture(readyDecisionAnalysis({
    axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } },
  }));
  const integralAnalysis = deepFreezeFixture({ analysis_units: [unit] });
  const before = JSON.stringify({ decisionAnalysis, integralAnalysis });

  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis });

  assert.equal(out.ready, true);
  assert.equal(JSON.stringify({ decisionAnalysis, integralAnalysis }), before);
});

test('24. la salida es inmutable (congelada)', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = readyDecisionAnalysis({ axes: { legal: { findings: [axisFinding({ requirement_id: unit.requirement_id })] } } });
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] } });
  assert.throws(() => { out.items.push({}); }, TypeError);
  assert.throws(() => { out.items[0].status = 'pendiente'; }, TypeError);
});
