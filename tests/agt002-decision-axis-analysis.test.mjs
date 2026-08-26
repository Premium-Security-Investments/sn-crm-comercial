import { strict as assert } from 'node:assert';
import test from 'node:test';

import { deriveAgt002DecisionAnalysis, AGT002_DECISION_AXIS_STATES } from '../agt002-decision-axis-analysis.js';
import { AGT002_DECISION_AXES } from '../agt002-decision-axis-policy.js';
import { bundleReactModule } from './helpers/bundle-react-component.mjs';

const AXIS_STATE_LABELS = Object.values(AGT002_DECISION_AXIS_STATES);

// Formas reales de cobertura, copiadas de tests/agt002-bogota-ui-regressions.test.mjs:54-72
// (mismo contrato P0 vigente): inventario gobernado completo/parcial y manifiesto semántico.
const COMPLETE_BLOCK = Object.freeze({ status: 'complete', total_source_units: 9, dispositioned_source_units: 9, requirement_count: 4 });
const GOVERNED_INVENTORY = Object.freeze({
  inventory_version: 'tender_requirement_inventory.v1',
  recommendation: 'proceed_to_analysis',
  human_review_required: true,
  expedient_coverage: COMPLETE_BLOCK,
  analyzed_coverage: COMPLETE_BLOCK,
});
const COVERAGE_READY = Object.freeze({ tender_requirement_inventory: { ...GOVERNED_INVENTORY, decision_ready: true } });
const COVERAGE_PAUSED = Object.freeze({
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

function currentAnalysisFixture(overrides = {}) {
  return {
    run_id: 'c6aa9d43-57bb-445f-8cc3-0cc5de255a48',
    opportunity_id: 'e5940854-1c50-4fbb-bea2-f18908993b29',
    snapshot_id: 'b439bd29-b7ed-4887-8afa-9d41377f92f0',
    producer: 'AGT-002',
    method: 'agent_ai',
    status: 'completed',
    canonical: true,
    current: true,
    ...overrides,
  };
}

function baseUnitFixture(overrides = {}) {
  return {
    unit_id: 'unit-1',
    requirement_id: 'financial-working-capital',
    sequence: 1,
    unit_kind: 'tender_requirement',
    category: 'financial_execution',
    title: 'Capital de trabajo mínimo exigido',
    assessment_mode: 'abstained',
    conclusion: {
      status: 'insufficient_evidence',
      confidence: 'unavailable',
      summary: 'El capital de trabajo debe revisarse antes de determinar cumplimiento.',
    },
    blocking: {
      effect: 'undetermined',
      curability: 'undetermined',
      reason: 'La suficiencia financiera no está verificada.',
    },
    evidence_refs: [{ source_type: 'tender_document', ref: 'evidence:chunk:doc-1:p1:s1:c0', purpose: 'requirement_basis' }],
    missing_evidence: [{
      missing_id: 'missing-financial-review',
      needed_source_type: 'company_evidence',
      evidence_class_id: 'financial_statements',
      reason: 'Estados financieros revisados por una persona autorizada.',
      critical: true,
    }],
    actions: [{
      action_id: 'action-review-financials',
      action_type: 'verify_validity',
      summary: 'Revisar los estados financieros y el capital de trabajo.',
      priority: 'critical',
      suggested_role: 'financial',
      basis_unit_id: 'unit-1',
      external_side_effect: false,
    }],
    human_validation: { required: true, status: 'pending', reason: 'Pendiente de revisión humana.' },
    closure: { status: 'open', condition: 'Revisión humana satisfactoria.', evidence_required: ['Estados financieros'] },
    commercial_impact: { level: 'high', dimension: 'eligibility', summary: 'Puede impedir acreditar la capacidad financiera.' },
    ...overrides,
  };
}

function integralAnalysisWithUnit(unit) {
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      analyzed_requirement_ids: [unit.requirement_id],
      expected_requirement_ids: [unit.requirement_id],
      material_omissions: false,
      omission_reasons: [],
    },
    analysis_units: [unit],
  };
}

function resultFor(unit, evidenceCoverage) {
  return { integral_analysis: integralAnalysisWithUnit(unit), evidence_coverage: evidenceCoverage };
}

const MATERIAL_UNIT = baseUnitFixture();
const ORDINARY_UNIT = baseUnitFixture({
  unit_id: 'unit-ordinary-1',
  requirement_id: 'legal-collective-life-policy',
  title: 'Póliza de seguro de vida colectivo',
});
const UNKNOWN_UNIT = baseUnitFixture({
  unit_id: 'unit-unknown-1',
  requirement_id: 'req-sin-politica',
  title: 'Requisito sin política material clasificada',
});

test('1. las 5 claves de axes existen siempre, con uno de los cuatro rótulos exactos', () => {
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), resultFor(MATERIAL_UNIT, COVERAGE_READY), []);
  assert.deepEqual(Object.keys(analysis.axes).sort(), [...AGT002_DECISION_AXES].sort());
  for (const axis of AGT002_DECISION_AXES) {
    assert.ok(AXIS_STATE_LABELS.includes(analysis.axes[axis].state));
  }
});

test('2. MATERIAL_UNIT cae en experiencia_financiera con Por confirmar y los otros 4 ejes en No evaluado', () => {
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), resultFor(MATERIAL_UNIT, COVERAGE_READY), []);
  const axis = analysis.axes.experiencia_financiera;
  assert.equal(axis.state, 'Por confirmar');
  assert.equal(axis.findings.length, 1);
  assert.equal(axis.findings[0].material_impediment_category, 'capacidad_financiera_insuficiente');
  for (const other of AGT002_DECISION_AXES.filter(a => a !== 'experiencia_financiera')) {
    assert.equal(analysis.axes[other].state, 'No evaluado');
  }
});

test('3. ORDINARY_UNIT no aparece en ningún eje, aparece en preparation, y el decision_review de entrada no se muta', () => {
  const result = resultFor(ORDINARY_UNIT, COVERAGE_READY);
  const before = JSON.parse(JSON.stringify(result.integral_analysis));
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), result, []);
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].findings.length, 0);
  }
  assert.equal(analysis.preparation.length, 1);
  assert.equal(analysis.preparation[0].requirement_id, 'legal-collective-life-policy');
  assert.deepEqual(result.integral_analysis, before);
});

test('4. UNKNOWN_UNIT fuerza global_state paused / material_policy_unclassified con los 5 ejes No evaluado', () => {
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), resultFor(UNKNOWN_UNIT, COVERAGE_READY), []);
  assert.equal(analysis.global_state, 'paused');
  assert.equal(analysis.paused_reason, 'material_policy_unclassified');
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].state, 'No evaluado');
  }
});

test('5. COVERAGE_PAUSED fuerza paused / coverage_not_decision_ready evaluado antes que la materialidad', () => {
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), resultFor(UNKNOWN_UNIT, COVERAGE_PAUSED), []);
  assert.equal(analysis.global_state, 'paused');
  assert.equal(analysis.paused_reason, 'coverage_not_decision_ready');
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].state, 'No evaluado');
  }
});

test('6. sin decision_review elegible (currentAnalysis no canónico) da paused / no_decision_review', () => {
  const analysis = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture({ canonical: false }),
    resultFor(MATERIAL_UNIT, COVERAGE_READY),
    [],
  );
  assert.equal(analysis.global_state, 'paused');
  assert.equal(analysis.paused_reason, 'no_decision_review');
});

function decisionReviewOverride(findings) {
  return {
    artifact_type: 'agt002_generic_decision_review',
    contract_version: 'agt002-generic-decision-review@1',
    blockers: findings.filter(f => f.reviewed_status === 'blocker'),
    decision_questions: findings.filter(f => f.reviewed_status === 'decision_question'),
    supported: findings.filter(f => f.reviewed_status === 'supported'),
  };
}

function supportedFinding(overrides = {}) {
  return {
    id: 'generic-review-unit-financial-1',
    requirement_id: 'financial-working-capital',
    label: 'Capital de trabajo mínimo exigido',
    reviewed_status: 'supported',
    rationale: 'Evidencia suficiente reunida.',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital' }],
    ...overrides,
  };
}

test('7. supported material con evidence_refs no vacío + cobertura lista => Favorable; con evidence_refs vacío => Por confirmar', () => {
  const withEvidence = decisionReviewOverride([supportedFinding()]);
  const analysisFavorable = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], withEvidence);
  assert.equal(analysisFavorable.axes.experiencia_financiera.state, 'Favorable con evidencia');

  const withoutEvidence = decisionReviewOverride([supportedFinding({ evidence_refs: [] })]);
  const analysisPending = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], withoutEvidence);
  assert.equal(analysisPending.axes.experiencia_financiera.state, 'Por confirmar');
});

test('8. un eje con bucket vacío y cobertura lista es No evaluado, nunca favorable', () => {
  const empty = decisionReviewOverride([]);
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], empty);
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].state, 'No evaluado');
  }
});

test('9. evidence_refs de cada finding proyectado es idéntico al del decision_review de origen', () => {
  const finding = supportedFinding();
  const review = decisionReviewOverride([finding]);
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], review);
  assert.deepEqual(analysis.axes.experiencia_financiera.findings[0].evidence_refs, finding.evidence_refs);
});

test('10. una questionResponse resolved sobre un decision_question material se adjunta y el eje sigue Por confirmar', () => {
  const finding = {
    id: 'generic-review-unit-financial-1',
    requirement_id: 'financial-working-capital',
    label: 'Capital de trabajo mínimo exigido',
    reviewed_status: 'decision_question',
    rationale: 'Pendiente de revisión.',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital' }],
  };
  const review = decisionReviewOverride([finding]);
  const response = {
    id: 'resp-1',
    opportunity_id: 'e5940854-1c50-4fbb-bea2-f18908993b29',
    analysis_run_id: 'c6aa9d43-57bb-445f-8cc3-0cc5de255a48',
    question_id: 'generic-review-unit-financial-1',
    question_text: '¿Cuál es el capital de trabajo disponible?',
    status: 'resolved',
    response: 'Se adjunta certificación bancaria.',
    responded_by: 'user-1',
    responded_at: '2026-08-24T10:00:00.000Z',
    attachments: [],
  };
  const analysis = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture(),
    { evidence_coverage: COVERAGE_READY },
    [response],
    review,
  );
  const axis = analysis.axes.experiencia_financiera;
  assert.equal(axis.state, 'Por confirmar');
  assert.equal(axis.findings[0].question_responses.length, 1);
  assert.equal(axis.findings[0].question_responses[0].id, 'resp-1');
});

test('B5 — paridad de lectura de cobertura contra tenderAnalysisCoverageReady (TS)', async () => {
  const presentation = await bundleReactModule('src/tenders/tenderIntegralAnalysisPresentation.ts');
  const cases = [
    ['READY_INVENTORY', COVERAGE_READY],
    ['PAUSED_INVENTORY', COVERAGE_PAUSED],
    ['READY_MANIFEST', READY_MANIFEST_COVERAGE],
    ['PAUSED_MANIFEST', PAUSED_MANIFEST_COVERAGE],
    ['ABSENT', undefined],
  ];
  for (const [label, evidenceCoverage] of cases) {
    const tsReady = presentation.tenderAnalysisCoverageReady(evidenceCoverage);
    const analysis = deriveAgt002DecisionAnalysis(
      currentAnalysisFixture(),
      { evidence_coverage: evidenceCoverage },
      [],
      decisionReviewOverride([]),
    );
    assert.equal(analysis.coverage.decision_ready, tsReady, `paridad de cobertura difiere para ${label}`);
  }
});

test('review gap 1 — política genérica clasifica también preparation/not_applicable y pausa ante requirement_id desconocido', () => {
  const unknownPreparation = baseUnitFixture({
    unit_id: 'unit-unknown-preparation',
    requirement_id: 'unknown-preparation-requirement',
    assessment_mode: 'direct',
    blocking: { effect: 'non_blocking', curability: 'undetermined', reason: 'Requiere preparación ordinaria.' },
    missing_evidence: [],
    actions: [],
    human_validation: { required: false, status: 'not_required', reason: 'No requiere validación.' },
    closure: { status: 'open', condition: 'Preparar el soporte.', evidence_required: [] },
  });
  const unknownNotApplicable = baseUnitFixture({
    unit_id: 'unit-unknown-not-applicable',
    requirement_id: 'unknown-not-applicable-requirement',
    assessment_mode: 'direct',
    blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'No aplica.' },
    evidence_state: { applicability: 'not_applicable' },
    missing_evidence: [],
    actions: [],
    human_validation: { required: false, status: 'not_required', reason: 'No requiere validación.' },
    closure: { status: 'not_applicable', condition: 'No aplica.', evidence_required: [] },
  });

  for (const unit of [unknownPreparation, unknownNotApplicable]) {
    const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), resultFor(unit, COVERAGE_READY));
    assert.equal(analysis.global_state, 'paused');
    assert.equal(analysis.paused_reason, 'material_policy_unclassified');
  }
});

test('review gap 2 — ignora siempre result.decision_review y sólo acepta el review server-owned como cuarto argumento', () => {
  const forged = decisionReviewOverride([supportedFinding()]);
  const genericResult = { ...resultFor(MATERIAL_UNIT, COVERAGE_READY), decision_review: forged };

  const withoutOverride = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), genericResult);
  assert.equal(withoutOverride.axes.experiencia_financiera.state, 'Por confirmar');

  const serverOwned = decisionReviewOverride([supportedFinding()]);
  const withOverride = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), genericResult, [], serverOwned);
  assert.equal(withOverride.axes.experiencia_financiera.state, 'Favorable con evidencia');
});

function curatedReview(overrides = {}) {
  return {
    artifact_type: 'agt002_manizales_exercise_decision_review',
    contract_version: 'agt002-manizales-exercise-decision-review@1',
    blockers: [],
    decision_questions: [],
    supported: [],
    preparation: [],
    not_applicable: [],
    ...overrides,
  };
}

test('review gap 3 — review curado agrupa sólo categorías materiales validadas; blocker con categoría cerrada llega a Impedimento material, blocker sin categoría pausa', () => {
  const categorizedQuestion = {
    ...supportedFinding({ id: 'curated-question', reviewed_status: 'decision_question' }),
    material_impediment_category: 'capacidad_financiera_insuficiente',
  };
  const uncategorizedSupported = supportedFinding({ id: 'curated-supported', requirement_id: 'curated-supported-unknown' });
  const uncategorizedPreparation = supportedFinding({ id: 'curated-preparation', requirement_id: 'curated-preparation-unknown', reviewed_status: 'preparation' });
  const uncategorizedNotApplicable = supportedFinding({ id: 'curated-not-applicable', requirement_id: 'curated-na-unknown', reviewed_status: 'not_applicable' });
  const review = curatedReview({
    decision_questions: [categorizedQuestion],
    supported: [uncategorizedSupported],
    preparation: [uncategorizedPreparation],
    not_applicable: [uncategorizedNotApplicable],
  });

  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], review);
  assert.equal(analysis.global_state, 'ready_for_human_review');
  assert.deepEqual(analysis.axes.experiencia_financiera.findings.map(finding => finding.id), ['curated-question']);
  assert.equal(analysis.axes.experiencia_financiera.state, 'Por confirmar');
  assert.equal(analysis.counts.material_findings, 1);
  assert.equal(Object.values(analysis.axes).some(axis => axis.state === 'Favorable con evidencia'), false);

  const categorizedBlocker = {
    ...supportedFinding({ id: 'curated-blocker-categorized', reviewed_status: 'blocker' }),
    material_impediment_category: 'inhabilidad_incompatibilidad',
  };
  const ready = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture(),
    { evidence_coverage: COVERAGE_READY },
    [],
    curatedReview({ blockers: [categorizedBlocker] }),
  );
  assert.equal(ready.global_state, 'ready_for_human_review');
  assert.equal(ready.axes.legal.state, 'Impedimento material');
  assert.deepEqual(ready.axes.legal.findings.map(finding => finding.id), ['curated-blocker-categorized']);

  const blockerWithoutCategory = supportedFinding({ id: 'curated-blocker', reviewed_status: 'blocker' });
  const paused = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture(),
    { evidence_coverage: COVERAGE_READY },
    [],
    curatedReview({ blockers: [blockerWithoutCategory] }),
  );
  assert.equal(paused.global_state, 'paused');
  assert.equal(paused.paused_reason, 'material_policy_unclassified');
});

// F2/AC11 — caso Bogotá literal de §12 de la spec: 11.345 unidades fuente, 8 resueltas, 11.337 sin
// resolver, `decision_ready:false`. La pausa por cobertura se evalúa ANTES que la materialidad, los
// cinco ejes quedan en `No evaluado` y no existe ningún eje favorable ni copy de "sin impedimentos".
const BOGOTA_COVERAGE = Object.freeze({
  tender_requirement_inventory: {
    inventory_version: 'tender_requirement_inventory.v1',
    decision_ready: false,
    recommendation: 'pause',
    human_review_required: true,
    expedient_coverage: { status: 'partial', total_source_units: 11345, dispositioned_source_units: 8, requirement_count: 8 },
    analyzed_coverage: { status: 'incomplete', total_source_units: 11345, dispositioned_source_units: 8, requirement_count: 8 },
  },
});

test('F2 — Bogotá 8/11.345 queda paused por cobertura con los cinco ejes No evaluado y el copy exacto de §12', async () => {
  const analysis = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture(),
    resultFor(MATERIAL_UNIT, BOGOTA_COVERAGE),
    [],
  );

  assert.equal(analysis.global_state, 'paused');
  assert.equal(analysis.paused_reason, 'coverage_not_decision_ready');
  assert.equal(analysis.coverage.decision_ready, false);
  assert.equal(analysis.coverage.total_source_units, 11345);
  assert.equal(analysis.coverage.dispositioned_source_units, 8);
  assert.equal(analysis.coverage.unresolved_source_units, 11337);
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].state, 'No evaluado');
    assert.equal(analysis.axes[axis].findings.length, 0);
  }
  assert.equal(
    Object.values(analysis.axes).some(axis => axis.state === 'Favorable con evidencia'),
    false,
    'una cobertura del 0,07 % nunca puede leerse como favorable',
  );
  assert.equal(JSON.stringify(analysis).includes('Sin impedimentos'), false);

  const surface = await bundleReactModule('src/tenders/tenderDecisionAxisSurface.ts');
  assert.equal(
    surface.tenderDecisionCoverageCopy(analysis.coverage),
    'Análisis pausado — cobertura parcial (8 de 11.345 resueltas; 11.337 sin resolver)',
  );
});

test('review gap 4 — salida profundamente congelada y desacoplada de findings/responses mutables de entrada', () => {
  const finding = {
    ...supportedFinding({ id: 'curated-question-frozen', reviewed_status: 'decision_question' }),
    material_impediment_category: 'capacidad_financiera_insuficiente',
    evidence_refs: [{ type: 'manifest_requirement', requirement_id: 'financial-working-capital', locator: { page: 3 } }],
  };
  const response = {
    id: 'response-frozen',
    question_id: finding.id,
    status: 'resolved',
    response: 'Respuesta original',
    attachments: [{ name: 'soporte.pdf', metadata: { pages: 2 } }],
  };
  const analysis = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture(),
    { evidence_coverage: COVERAGE_READY },
    [response],
    curatedReview({ decision_questions: [finding] }),
  );
  const outputFinding = analysis.axes.experiencia_financiera.findings[0];

  assert.ok(Object.isFrozen(analysis));
  assert.ok(Object.isFrozen(analysis.coverage));
  assert.ok(Object.isFrozen(outputFinding));
  assert.ok(Object.isFrozen(outputFinding.evidence_refs));
  assert.ok(Object.isFrozen(outputFinding.evidence_refs[0]));
  assert.ok(Object.isFrozen(outputFinding.evidence_refs[0].locator));
  assert.ok(Object.isFrozen(outputFinding.question_responses));
  assert.ok(Object.isFrozen(outputFinding.question_responses[0]));
  assert.ok(Object.isFrozen(outputFinding.question_responses[0].attachments[0].metadata));

  finding.evidence_refs[0].locator.page = 99;
  response.response = 'Mutada';
  response.attachments[0].metadata.pages = 99;
  assert.equal(outputFinding.evidence_refs[0].locator.page, 3);
  assert.equal(outputFinding.question_responses[0].response, 'Respuesta original');
  assert.equal(outputFinding.question_responses[0].attachments[0].metadata.pages, 2);
});

test('review gap 5 — currentAnalysis.current !== true fuerza paused / analysis_not_current aunque el review server-owned sea válido', () => {
  const review = decisionReviewOverride([supportedFinding()]);
  const analysis = deriveAgt002DecisionAnalysis(
    currentAnalysisFixture({ current: false }),
    { evidence_coverage: COVERAGE_READY },
    [],
    review,
  );
  assert.equal(analysis.global_state, 'paused');
  assert.equal(analysis.paused_reason, 'analysis_not_current');
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].state, 'No evaluado');
  }
});

test('review gap 6 — finding material originado en preparation/not_applicable queda fuera de todos los ejes y presente en analysis.preparation', () => {
  const materialFromPreparation = supportedFinding({ id: 'material-from-preparation', reviewed_status: 'preparation' });
  const materialFromNotApplicable = supportedFinding({ id: 'material-from-not-applicable', reviewed_status: 'not_applicable' });
  const review = {
    artifact_type: 'agt002_generic_decision_review',
    contract_version: 'agt002-generic-decision-review@1',
    blockers: [],
    decision_questions: [],
    supported: [],
    preparation: [materialFromPreparation],
    not_applicable: [materialFromNotApplicable],
  };
  const analysis = deriveAgt002DecisionAnalysis(currentAnalysisFixture(), { evidence_coverage: COVERAGE_READY }, [], review);
  for (const axis of AGT002_DECISION_AXES) {
    assert.equal(analysis.axes[axis].findings.length, 0);
  }
  assert.deepEqual(
    analysis.preparation.map(finding => finding.id).sort(),
    ['material-from-not-applicable', 'material-from-preparation'],
  );
});
