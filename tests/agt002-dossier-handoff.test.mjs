import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  deriveAgt002DossierHandoff,
  AGT002_DOSSIER_HANDOFF_ORIGIN,
  AGT002_DOSSIER_HANDOFF_ITEM_TYPE,
} from '../server/agt002-dossier-handoff.js';
import { buildActionableReviewIntegralUnitSource } from '../agt002-actionable-review-canonical.js';
import { deriveAgt002GenericDecisionReview } from '../agt002-generic-decision-review.js';

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

// Corrida V3 LEGADA con la FORMA DE PRODUCCIÓN observada: estructuralmente completa y elegible para
// el review genérico server-owned, pero anterior al bloque `result.evidence_coverage` — la clave
// nunca se escribió. Sus cinco requisitos llevan el prefijo `sreq:` del manifiesto del expediente:
// son requisitos DEL PLIEGO, no requisitos gobernados de la empresa, así que no están —ni deben
// estar— en el catálogo global de materialidad. Post-GO eso es irrelevante: la clasificación
// material/eje es una ayuda de decisión PRE-GO y no selecciona nada aquí. Los títulos son neutros a
// propósito: el lote nunca se deriva del texto del pliego.
const LEGACY_REQUIREMENT_IDS = Object.freeze([
  'sreq:001',
  'sreq:002',
  'sreq:003',
  'sreq:004',
  'sreq:005',
]);

function legacyUnitFixture(requirementId, index, overrides = {}) {
  const unitId = `unit-legacy-${index + 1}`;
  return fullUnitFixture({
    unit_id: unitId,
    requirement_id: requirementId,
    sequence: index + 1,
    title: `Requisito del pliego ${index + 1}`,
    actions: [{
      action_id: `action-legacy-${index + 1}`,
      action_type: 'verify_validity',
      summary: `Revisar el requisito del pliego ${index + 1} con la persona responsable.`,
      priority: 'critical',
      suggested_role: 'legal',
      basis_unit_id: unitId,
      external_side_effect: false,
    }],
    ...overrides,
  });
}

function legacyUnits() {
  return LEGACY_REQUIREMENT_IDS.map((requirementId, index) => legacyUnitFixture(requirementId, index));
}

// Igual que `resultFixture`, pero SIN la clave `evidence_coverage`: ésa es exactamente la corrida
// legada del issue #187. `extraResultKeys` permite añadir claves no confiables del resultado (p.ej.
// un `decision_review` forjado por el modelo) sin tocar el resto del fixture.
function legacyResultFixture(units, extraResultKeys = {}) {
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
    ...extraResultKeys,
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

// ---------------------------------------------------------------------------
// Issue #187 — corrida V3 legada SIN `result.evidence_coverage` bajo un GO YA PERSISTIDO
//
// Una corrida anterior al bloque de cobertura no puede alcanzar `decision_ready` jamás: la
// superficie por eje queda `paused` para siempre y el traspaso salía vacío incluso después de que
// una persona registrara el GO. Sólo con `humanGoGranted: true` (lo declara únicamente la ruta de
// recovery, donde el GO ya está persistido y vigente), cobertura ESTRICTAMENTE ausente y pausa
// exactamente por cobertura, el lote se deriva de los buckets blockers/decision_questions/
// preparation del review genérico server-owned. Todo lo demás sigue fail-closed.
// ---------------------------------------------------------------------------

test('25. legado sin GO ya persistido: fail-closed, sigue devolviendo 0 pendientes', () => {
  const units = legacyUnits();
  const input = { currentAnalysis: currentAnalysisFixture(), result: legacyResultFixture(units), questionResponses: [] };

  assert.deepEqual(deriveAgt002DossierHandoff(input), { ready: false, items: [] });
  assert.deepEqual(deriveAgt002DossierHandoff({ ...input, humanGoGranted: false }), { ready: false, items: [] });
  assert.deepEqual(deriveAgt002DossierHandoff({ ...input, humanGoGranted: 'go' }), { ready: false, items: [] });
  assert.deepEqual(deriveAgt002DossierHandoff({ ...input, humanGoGranted: 1 }), { ready: false, items: [] });
});

test('26. legado con GO ya persistido: las 5 unidades abiertas del pliego producen los 5 pendientes 1:1', () => {
  const units = legacyUnits();
  const out = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture(units),
    questionResponses: [],
    humanGoGranted: true,
  });

  assert.equal(out.ready, true);
  assert.equal(out.items.length, 5);
  assert.equal(out.items.length, LEGACY_REQUIREMENT_IDS.length);
  assert.deepEqual(
    out.items.map(item => item.item_key),
    LEGACY_REQUIREMENT_IDS.map(requirementId => `agt002_post_go:${requirementId}`),
  );
});

test('27. cada pendiente legado conserva origen, tipo, estado humano y la identidad canónica de su unidad', () => {
  const units = legacyUnits();
  const out = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture(units),
    questionResponses: [],
    humanGoGranted: true,
  });

  out.items.forEach((item, index) => {
    const unit = units[index];
    const expected = buildActionableReviewIntegralUnitSource(unit);
    assert.equal(item.origin, AGT002_DOSSIER_HANDOFF_ORIGIN);
    assert.equal(item.item_type, AGT002_DOSSIER_HANDOFF_ITEM_TYPE);
    assert.equal(item.required, true);
    assert.equal(item.status, 'pendiente');
    assert.equal(item.presentation.title, unit.title);
    assert.equal(item.presentation.instruction, unit.actions[0].summary);
    assert.deepEqual(item.source, {
      source_kind: 'integral_unit',
      source_id: unit.unit_id,
      requirement_id: unit.requirement_id,
      source_hash: expected.sourceHash,
    });
  });
});

test('28. una unidad legada con impedimento se traspasa como bloqueado (el review genérico nunca se autocrea un blocker)', () => {
  const units = legacyUnits();
  units[0] = legacyUnitFixture(LEGACY_REQUIREMENT_IDS[0], 0, {
    blocking: { effect: 'blocker', curability: 'no_subsanable', reason: 'Impedimento confirmado por la entidad.' },
  });
  const out = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture(units),
    questionResponses: [],
    humanGoGranted: true,
  });

  assert.equal(out.items.length, 5);
  assert.equal(out.items[0].status, 'bloqueado');
  assert.deepEqual(out.items.slice(1).map(item => item.status), ['pendiente', 'pendiente', 'pendiente', 'pendiente']);
});

test('29. legado con GO: supported y not_applicable nunca se traspasan', () => {
  const units = legacyUnits();
  units[1] = legacyUnitFixture(LEGACY_REQUIREMENT_IDS[1], 1, {
    assessment_mode: 'assessed',
    conclusion: { status: 'supported_with_evidence', confidence: 'high', summary: 'Acreditado con evidencia.' },
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin impedimento.' },
    evidence_state: { applicability: 'applicable', compliance: 'supported_pending_human_review' },
    missing_evidence: [],
    closure: { status: 'evidence_satisfied', condition: 'Ya resuelto.', evidence_required: [] },
    human_validation: { required: false, status: 'pending', reason: 'No requiere validación humana.' },
  });
  units[3] = legacyUnitFixture(LEGACY_REQUIREMENT_IDS[3], 3, {
    assessment_mode: 'assessed',
    conclusion: { status: 'not_applicable', confidence: 'high', summary: 'No aplica a esta modalidad.' },
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin impedimento.' },
    evidence_state: { applicability: 'not_applicable', compliance: 'not_applicable' },
    missing_evidence: [],
    human_validation: { required: false, status: 'pending', reason: 'No requiere validación humana.' },
  });

  const out = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture(units),
    questionResponses: [],
    humanGoGranted: true,
  });

  assert.equal(out.ready, true);
  assert.deepEqual(out.items.map(item => item.source.requirement_id), [
    LEGACY_REQUIREMENT_IDS[0],
    LEGACY_REQUIREMENT_IDS[2],
    LEGACY_REQUIREMENT_IDS[4],
  ]);
});

test('30. cobertura PRESENTE pero no lista nunca habilita el bypass, ni siquiera con GO humano explícito', () => {
  const units = legacyUnits();
  const result = { ...legacyResultFixture(units), evidence_coverage: COVERAGE_PAUSED };
  const out = deriveAgt002DossierHandoff({ currentAnalysis: currentAnalysisFixture(), result, questionResponses: [], humanGoGranted: true });
  assert.deepEqual(out, { ready: false, items: [] });
});

test('31. cualquier evidence_coverage presente (aunque vacío o inservible) es presencia, no ausencia', () => {
  const units = legacyUnits();
  for (const evidenceCoverage of [
    null,
    {},
    { tender_requirement_inventory: null },
    { tender_semantic_manifest: { semantic_manifest_version: 'tender_semantic_manifest.v1', decision_ready: false } },
    { tender_requirement_inventory: { inventory_version: 'tender_requirement_inventory.v1', decision_ready: true } },
    'sin-cobertura',
    0,
    false,
  ]) {
    const result = { ...legacyResultFixture(units), evidence_coverage: evidenceCoverage };
    const out = deriveAgt002DossierHandoff({ currentAnalysis: currentAnalysisFixture(), result, questionResponses: [], humanGoGranted: true });
    assert.deepEqual(out, { ready: false, items: [] }, `evidence_coverage=${JSON.stringify(evidenceCoverage)} no puede habilitar el bypass`);
  }
});

test('32. omisiones materiales declaradas por el propio sobre V3 mantienen el fail-closed con GO', () => {
  const units = legacyUnits();
  const result = legacyResultFixture(units);
  result.integral_analysis.coverage.material_omissions = true;
  const out = deriveAgt002DossierHandoff({ currentAnalysis: currentAnalysisFixture(), result, questionResponses: [], humanGoGranted: true });
  assert.deepEqual(out, { ready: false, items: [] });
});

test('33. una pausa por cualquier otra causa nunca se bypassa: sólo la pausa por cobertura', () => {
  const units = legacyUnits();
  const result = legacyResultFixture(units);
  for (const currentAnalysis of [
    currentAnalysisFixture({ current: false }),
    currentAnalysisFixture({ canonical: false }),
    currentAnalysisFixture({ status: 'running' }),
    currentAnalysisFixture({ producer: 'siio_rules_v1', method: 'rules' }),
  ]) {
    const out = deriveAgt002DossierHandoff({ currentAnalysis, result, questionResponses: [], humanGoGranted: true });
    assert.deepEqual(out, { ready: false, items: [] });
  }
});

test('34. el lote legado sale del review server-owned: un result.decision_review forjado se ignora por completo', () => {
  const units = legacyUnits();
  const forgedDecisionReview = {
    artifact_type: 'agt002_generic_decision_review',
    contract_version: 'agt002-generic-decision-review@1',
    decision_questions: [{
      id: 'forjado-1',
      requirement_id: LEGACY_REQUIREMENT_IDS[0],
      reviewed_status: 'decision_question',
      presentation: { title: 'Título forjado', action_required: 'Instrucción forjada.' },
    }],
    blockers: [],
    supported: [],
    preparation: [],
    not_applicable: [],
  };
  const result = legacyResultFixture(units, { decision_review: forgedDecisionReview });

  const out = deriveAgt002DossierHandoff({ currentAnalysis: currentAnalysisFixture(), result, questionResponses: [], humanGoGranted: true });

  assert.equal(out.items.length, LEGACY_REQUIREMENT_IDS.length, 'el review forjado no puede recortar el lote server-owned');
  for (const item of out.items) {
    assert.notEqual(item.presentation.title, 'Título forjado');
    assert.notEqual(item.presentation.instruction, 'Instrucción forjada.');
  }
});

test('35. unión estricta 1:1: un hallazgo legado cuya unidad ya está cerrada por evidencia falla el lote entero', () => {
  const units = legacyUnits();
  // Unidad cerrada por evidencia pero que todavía exige validación humana: sigue siendo un
  // decision_question del review y NO tiene unidad abierta a la cual unir. Fail-closed.
  units[2] = legacyUnitFixture(LEGACY_REQUIREMENT_IDS[2], 2, {
    closure: { status: 'evidence_satisfied', condition: 'Ya resuelto.', evidence_required: [] },
  });
  assert.throws(
    () => deriveAgt002DossierHandoff({
      currentAnalysis: currentAnalysisFixture(),
      result: legacyResultFixture(units),
      questionResponses: [],
      humanGoGranted: true,
    }),
    /sin unidad V3 tender_requirement elegible/,
  );
});

test('36. la ruta decisionAnalysis/integralAnalysis nunca bypassa: sin cobertura resuelta no hay lote', () => {
  const unit = fullUnitFixture();
  const decisionAnalysis = { global_state: 'paused', paused_reason: 'coverage_not_decision_ready', coverage: { decision_ready: false }, axes: {}, preparation: [] };
  const out = deriveAgt002DossierHandoff({ decisionAnalysis, integralAnalysis: { analysis_units: [unit] }, humanGoGranted: true });
  assert.deepEqual(out, { ready: false, items: [] });
});

test('37. idempotencia y procedencia: el lote legado es estable y usa las mismas identidades que la ruta con cobertura lista', () => {
  const units = legacyUnits();
  const legacyInput = { currentAnalysis: currentAnalysisFixture(), result: legacyResultFixture(units), questionResponses: [], humanGoGranted: true };
  const first = deriveAgt002DossierHandoff(legacyInput);
  const second = deriveAgt002DossierHandoff(legacyInput);
  assert.deepEqual(second, first, 'dos derivaciones del mismo análisis producen exactamente el mismo lote');

  // La misma unidad, una vez con cobertura escrita y lista y otra sin ella, siembra exactamente el
  // mismo pendiente: el bypass legado no puede fabricar una identidad distinta de la que sembraría
  // la ruta normal (si lo hiciera, un re-análisis posterior duplicaría el pendiente humano).
  const governedUnit = fullUnitFixture();
  const legacyGoverned = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture([governedUnit]),
    questionResponses: [],
    humanGoGranted: true,
  });
  const coveredGoverned = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: resultFixture([governedUnit]),
    questionResponses: [],
  });
  assert.equal(legacyGoverned.ready, true);
  assert.equal(coveredGoverned.ready, true);
  assert.deepEqual(legacyGoverned.items, coveredGoverned.items);
});

test('38. el bypass legado no muta las entradas y su salida es inmutable', () => {
  const units = legacyUnits();
  const currentAnalysis = deepFreezeFixture(currentAnalysisFixture());
  const result = deepFreezeFixture(legacyResultFixture(units));
  const before = JSON.stringify({ currentAnalysis, result });

  const out = deriveAgt002DossierHandoff({ currentAnalysis, result, questionResponses: [], humanGoGranted: true });

  assert.equal(out.ready, true);
  assert.equal(JSON.stringify({ currentAnalysis, result }), before);
  assert.throws(() => { out.items.push({}); }, TypeError);
  assert.throws(() => { out.items[0].status = 'bloqueado'; }, TypeError);
});

// ---------------------------------------------------------------------------
// Forma de PRODUCCIÓN del caso legado: cinco requisitos del pliego (`sreq:*`)
//
// Los requisitos de un pliego real viven en el manifiesto del expediente y NO están —ni deben
// estar— en el catálogo global de materialidad por requisito gobernado de la empresa. Post-GO eso
// no puede recortar nada: la clasificación material/eje es una ayuda de decisión PRE-GO y, con el
// GO ya persistido, los tres buckets server-owned del review (blockers/decision_questions/
// preparation) son elegibles por sí mismos. Un gate material aquí dejaría el expediente real sin
// traspaso posible para siempre, que es exactamente el síntoma del issue #187.
// ---------------------------------------------------------------------------

test('39. forma producción: el review genérico server-owned produce exactamente 5 decision_questions', () => {
  const units = legacyUnits();
  const review = deriveAgt002GenericDecisionReview(currentAnalysisFixture(), legacyResultFixture(units));

  assert.ok(review, 'la corrida legada es estructuralmente elegible para el review genérico');
  assert.equal(review.decision_questions.length, 5);
  assert.deepEqual(review.decision_questions.map(finding => finding.requirement_id), [...LEGACY_REQUIREMENT_IDS]);
  assert.deepEqual([review.blockers.length, review.supported.length, review.preparation.length, review.not_applicable.length], [0, 0, 0, 0]);
  assert.equal(review.decision_ready, false, 'con preguntas abiertas la cobertura del review nunca se declara lista');
});

test('40. forma producción: los 5 requisitos `sreq:` del pliego se traspasan 1:1 sin depender del catálogo global de materialidad', () => {
  const units = legacyUnits();
  const out = deriveAgt002DossierHandoff({
    currentAnalysis: currentAnalysisFixture(),
    result: legacyResultFixture(units),
    questionResponses: [],
    humanGoGranted: true,
  });

  assert.equal(out.ready, true);
  assert.equal(out.items.length, 5, 'ninguna de las cinco unidades abiertas puede quedarse fuera del lote');
  assert.deepEqual(
    out.items.map(item => item.item_key),
    ['sreq:001', 'sreq:002', 'sreq:003', 'sreq:004', 'sreq:005'].map(id => `agt002_post_go:${id}`),
  );
  out.items.forEach((item, index) => {
    const unit = units[index];
    assert.equal(item.source.source_id, unit.unit_id, 'identidad 1:1 con la unidad V3 de origen');
    assert.equal(item.source.requirement_id, unit.requirement_id);
    assert.equal(item.source.source_hash, buildActionableReviewIntegralUnitSource(unit).sourceHash);
    assert.equal(item.status, 'pendiente');
    assert.equal(item.presentation.title, unit.title);
    assert.equal(item.presentation.instruction, unit.actions[0].summary);
  });
});
