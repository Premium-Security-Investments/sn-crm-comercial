import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSync } from 'esbuild';

import { runAgt002ManizalesV3LocalRun } from '../scripts/agt002-manizales-v3-local-run.mjs';

const DYNAMIC_ANALYSIS = JSON.parse(readFileSync(new URL('./fixtures/tender-integral-analysis-dynamic.v3.json', import.meta.url), 'utf8'));
const DYNAMIC_V3 = DYNAMIC_ANALYSIS.integral_analysis;

// AGT-002 Task 2 · pure presentation selectors over TenderIntegralAnalysisV3 (raw v3 units).
// Uses unit.title / unit.conclusion.summary / unit.commercial_impact.summary /
// unit.missing_evidence[].reason / unit.actions[].summary directly — never a textual heuristic.
// Enum translation only via closed dictionaries with an explicit "Por revisar" fallback; raw
// enum values only ever live under technical traceability. Generic across fixture sizes.

const presentationPath = new URL('../src/tenders/tenderIntegralAnalysisPresentation.ts', import.meta.url).pathname;
const bundled = buildSync({ entryPoints: [presentationPath], bundle: true, platform: 'node', format: 'esm', write: false });
const presentationUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const {
  tenderIntegralUnitPresentation,
  tenderIntegralUnitsPresentation,
  tenderIntegralAnalysisCounts,
  tenderIntegralPrimaryUnitForCondition,
  tenderIntegralAnalysisSummary,
  tenderIntegralPhaseGroups,
  tenderIntegralCategoryLabel,
  tenderIntegralUnitPrimaryConditionKey,
  tenderIntegralUnitConditionAnchor,
  TENDER_INTEGRAL_PHASES,
} = await import(presentationUrl);

const surfacePath = new URL('../src/tenders/tenderDecisionSurface.ts', import.meta.url).pathname;
const bundledSurface = buildSync({ entryPoints: [surfacePath], bundle: true, platform: 'node', format: 'esm', write: false });
const surfaceUrl = `data:text/javascript;base64,${Buffer.from(bundledSurface.outputFiles[0].contents).toString('base64')}`;
const { tenderDecisionConditionAnchor } = await import(surfaceUrl);

async function buildPilotIntegralAnalysis() {
  const result = await runAgt002ManizalesV3LocalRun();
  return result.envelope.integral_analysis;
}

function buildSecondV3() {
  return {
    contract_version: 'second-fixture@1',
    coverage: {
      manifest_version: 'second@1',
      expected_requirement_ids: ['req-1', 'req-2', 'req-3'],
      analyzed_requirement_ids: ['req-1', 'req-2', 'req-3'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'second@1',
      company_evidence_class_ids: [],
      legal_corpus_version_id: null,
    },
    analysis_units: [
      {
        unit_id: 'second-unit-1',
        unit_kind: 'tender_requirement',
        requirement_id: 'req-1',
        category: 'habilitating',
        sequence: 1,
        title: 'Segunda unidad uno',
        assessment_mode: 'assessed',
        conclusion: { status: 'supported_with_evidence', summary: 'Conclusión cruda de la unidad uno.', confidence: 'high' },
        blocking: { effect: 'non_blocking', curability: 'n/a', reason: 'sin bloqueo' },
        evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
        evidence_refs: [{ ref: 'ref-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
        missing_evidence: [],
        commercial_impact: { level: 'high', summary: 'Resumen de impacto comercial de la unidad uno.', dimension: 'contractual' },
        legal_assessment: { status: 'supported', basis_refs: [], summary: 'lectura jurídica', human_legal_review_required: false },
        actions: [{ action_id: 'a1', action_type: 'review', summary: 'Acción de la unidad uno.', basis_unit_id: 'second-unit-1', suggested_role: 'legal', priority: 'medium', external_side_effect: false }],
        milestone: { status: 'n/a', type: 'n/a', at: null, source_ref: null, summary: 'sin hito' },
        escalation: { required: false, level: 'none', reason: 'sin escalamiento' },
        closure: { status: 'open', condition: 'sin condición', evidence_required: [] },
        human_validation: { required: true, status: 'pending', reason: 'requiere revisión' },
      },
      {
        unit_id: 'second-unit-2',
        unit_kind: 'tender_requirement',
        requirement_id: 'req-2',
        category: 'technical',
        sequence: 2,
        title: 'Segunda unidad dos',
        assessment_mode: 'abstained',
        conclusion: { status: 'insufficient_evidence', summary: 'Conclusión cruda de la unidad dos.', confidence: 'unavailable' },
        blocking: { effect: 'blocker', curability: 'curable', reason: 'falta evidencia' },
        evidence_state: { presence: 'absent', review: 'not_reviewed', validity: 'valid', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
        evidence_refs: [],
        missing_evidence: [{ missing_id: 'm1', evidence_class_id: null, needed_source_type: 'company_evidence', reason: 'Falta la evidencia de la unidad dos.', critical: true }],
        commercial_impact: { level: 'unknown', summary: 'Resumen de impacto comercial de la unidad dos.', dimension: 'contractual' },
        legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'lectura jurídica dos', human_legal_review_required: true },
        actions: [],
        milestone: { status: 'n/a', type: 'n/a', at: null, source_ref: null, summary: 'sin hito' },
        escalation: { required: true, level: 'high', reason: 'impedimento' },
        closure: { status: 'open', condition: 'sin condición', evidence_required: ['m1'] },
        human_validation: { required: true, status: 'pending', reason: 'requiere revisión' },
      },
      {
        unit_id: 'second-unit-3',
        unit_kind: 'strategic_consideration',
        requirement_id: 'req-3',
        category: 'strategic',
        sequence: 3,
        title: 'Segunda unidad tres',
        assessment_mode: 'assessed',
        // An unrecognized/future enum value the closed dictionary must not know about.
        conclusion: { status: 'future_unknown_status', summary: 'Conclusión cruda de la unidad tres.', confidence: 'low' },
        blocking: { effect: 'undetermined', curability: 'n/a', reason: 'sin determinar' },
        evidence_state: { presence: 'unknown', review: 'not_reviewed', validity: 'not_applicable', applicability: 'applicable', compliance: 'partially_supported_pending_human_review' },
        evidence_refs: [{ ref: 'ref-3', source_type: 'company_evidence', purpose: 'company_capacity' }],
        missing_evidence: [{ missing_id: 'm2', evidence_class_id: null, needed_source_type: 'legal_corpus', reason: 'Falta la evidencia de la unidad tres.', critical: false }],
        // An unrecognized commercial impact level as well.
        commercial_impact: { level: 'future_unknown_level', summary: 'Resumen de impacto comercial de la unidad tres.', dimension: 'estratégico' },
        legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'lectura jurídica tres', human_legal_review_required: false },
        actions: [{ action_id: 'a2', action_type: 'prepare', summary: 'Acción de la unidad tres.', basis_unit_id: 'second-unit-3', suggested_role: 'comercial', priority: 'low', external_side_effect: false }],
        milestone: { status: 'n/a', type: 'n/a', at: null, source_ref: null, summary: 'sin hito' },
        escalation: { required: false, level: 'none', reason: 'sin escalamiento' },
        closure: { status: 'open', condition: 'sin condición', evidence_required: [] },
        human_validation: { required: true, status: 'pending', reason: 'requiere revisión' },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// V3 must use the raw human text directly — no textual heuristics, no rewriting.
// ---------------------------------------------------------------------------------------------
test('tenderIntegralUnitPresentation uses unit.title/conclusion.summary/commercial_impact.summary/missing_evidence[].reason/actions[].summary directly, verbatim', () => {
  const v3 = buildSecondV3();
  const unit = v3.analysis_units[1];
  const card = tenderIntegralUnitPresentation(unit);
  assert.equal(card.title, unit.title);
  assert.equal(card.conclusionSummary, unit.conclusion.summary);
  assert.equal(card.commercialImpactSummary, unit.commercial_impact.summary);
  assert.deepEqual(card.missingEvidenceReasons, unit.missing_evidence.map(item => item.reason));

  const unitWithAction = v3.analysis_units[0];
  const cardWithAction = tenderIntegralUnitPresentation(unitWithAction);
  assert.deepEqual(cardWithAction.actionSummaries, unitWithAction.actions.map(item => item.summary));
});

// ---------------------------------------------------------------------------------------------
// Closed dictionaries, "Por revisar" fallback for unknown enum values, raw value only kept for
// technical traceability (never surfacing a raw enum code as the visible label).
// ---------------------------------------------------------------------------------------------
test('unrecognized V3 enum values translate to the closed fallback label "Por revisar", raw value preserved only in technical traceability', () => {
  const v3 = buildSecondV3();
  const unit = v3.analysis_units[2];
  const card = tenderIntegralUnitPresentation(unit);

  assert.equal(card.conclusionLabel, 'Por revisar');
  assert.equal(card.commercialImpactLabel, 'Por revisar');
  assert.equal(card.technical.conclusionStatus, 'future_unknown_status');
  assert.equal(card.technical.commercialImpactLevel, 'future_unknown_level');

  const values = [card.title, card.conclusionLabel, card.commercialImpactLabel, card.conclusionSummary, card.commercialImpactSummary, ...card.missingEvidenceReasons, ...card.actionSummaries];
  for (const value of values) {
    assert.doesNotMatch(String(value), /future_unknown_status|future_unknown_level/, 'a raw unrecognized enum code must never leak into visible text');
  }
});

test('known V3 enum values translate through the closed dictionary', () => {
  const v3 = buildSecondV3();
  const supportedCard = tenderIntegralUnitPresentation(v3.analysis_units[0]);
  assert.equal(supportedCard.categoryLabel, 'Habilitantes');
  assert.equal(supportedCard.conclusionLabel, 'Sustentado con evidencia');
  assert.equal(supportedCard.commercialImpactLabel, 'Alto');
});

// ---------------------------------------------------------------------------------------------
// Cited evidence and pending evidence are independent, non-exclusive indicators.
// ---------------------------------------------------------------------------------------------
test('hasCitedEvidence and hasPendingEvidence are computed independently, never as complements of each other', () => {
  const v3 = buildSecondV3();
  const bothPresentUnit = { ...v3.analysis_units[0], missing_evidence: [{ missing_id: 'm3', evidence_class_id: null, needed_source_type: 'company_evidence', reason: 'Ambos indicadores presentes a la vez.', critical: false }] };
  const card = tenderIntegralUnitPresentation(bothPresentUnit);
  assert.equal(card.hasCitedEvidence, true);
  assert.equal(card.hasPendingEvidence, true);

  const neitherUnit = { ...v3.analysis_units[0], evidence_refs: [], missing_evidence: [] };
  const neitherCard = tenderIntegralUnitPresentation(neitherUnit);
  assert.equal(neitherCard.hasCitedEvidence, false);
  assert.equal(neitherCard.hasPendingEvidence, false);
});

// ---------------------------------------------------------------------------------------------
// Relation V3 → primary condition exclusively by explicit requirement_id equality.
// ---------------------------------------------------------------------------------------------
test('tenderIntegralPrimaryUnitForCondition relates by explicit requirement_id equality only, never by label/title text', () => {
  const v3 = buildSecondV3();
  const match = tenderIntegralPrimaryUnitForCondition(v3.analysis_units, 'req-2');
  assert.equal(match.unit_id, 'second-unit-2');

  assert.equal(tenderIntegralPrimaryUnitForCondition(v3.analysis_units, 'Segunda unidad dos'), null, 'a title-text match must never substitute for requirement_id equality');
  assert.equal(tenderIntegralPrimaryUnitForCondition(v3.analysis_units, 'req-does-not-exist'), null);
  assert.equal(tenderIntegralPrimaryUnitForCondition(v3.analysis_units, null), null);
});

// ---------------------------------------------------------------------------------------------
// Counts computed from real arrays; classifiedTotal === totalUnits invariant.
// ---------------------------------------------------------------------------------------------
test('tenderIntegralAnalysisCounts computes totals from the real analysis_units array, classifiedTotal === totalUnits', () => {
  const v3 = buildSecondV3();
  const counts = tenderIntegralAnalysisCounts(v3);
  assert.equal(counts.totalUnits, v3.analysis_units.length);
  assert.equal(counts.classifiedTotal, counts.totalUnits, 'classifiedTotal must always equal totalUnits — every unit is classified, unknowns fall to "Por revisar"');
  const sumByConclusion = Object.values(counts.byConclusion).reduce((sum, n) => sum + n, 0);
  assert.equal(sumByConclusion, counts.totalUnits);
  assert.equal(counts.byConclusion['Por revisar'], 1, 'the one unrecognized-status unit must be tallied under the closed fallback bucket');
});

test('tenderIntegralUnitsPresentation and tenderIntegralAnalysisCounts are generic across two differently-sized fixtures (pilot vs. a hand-built second fixture)', async () => {
  const pilotV3 = await buildPilotIntegralAnalysis();
  const secondV3 = buildSecondV3();
  assert.notEqual(pilotV3.analysis_units.length, secondV3.analysis_units.length, 'the two fixtures must genuinely differ in size to prove genericity');

  for (const v3 of [pilotV3, secondV3]) {
    const cards = tenderIntegralUnitsPresentation(v3);
    assert.equal(cards.length, v3.analysis_units.length);
    const counts = tenderIntegralAnalysisCounts(v3);
    assert.equal(counts.totalUnits, v3.analysis_units.length);
    assert.equal(counts.classifiedTotal, counts.totalUnits);
    for (const card of cards) {
      assert.equal(Object.hasOwn(card, 'rationale'), false);
      assert.ok(card.title);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// The pilot's own literals (25 atomized entries, 20 canonical units, 5 phases, 2 decision
// questions) must never be baked into the presentation implementation as magic constants.
// ---------------------------------------------------------------------------------------------
// =============================================================================================
// Task 4 · el respaldo técnico legible se calcula íntegramente en este helper: resumen desde los
// arreglos reales, agrupación por las cinco categorías institucionales con diccionario cerrado, y
// relación con una condición gobernada exclusivamente por igualdad explícita de requirement_id.
// =============================================================================================

test('tenderIntegralAnalysisSummary calcula el total y los conteos por estado desde el arreglo real; la suma es analysis_units.length', () => {
  const summary = tenderIntegralAnalysisSummary(DYNAMIC_V3);
  assert.equal(summary.totalUnits, DYNAMIC_V3.analysis_units.length);
  const sum = summary.byConclusion.reduce((total, bucket) => total + bucket.count, 0);
  assert.equal(sum, DYNAMIC_V3.analysis_units.length, 'la suma de los conteos por estado debe ser exactamente el total de unidades');
  assert.equal(summary.classifiedTotal, summary.totalUnits);

  const byLabel = new Map(summary.byConclusion.map(bucket => [bucket.label, bucket.count]));
  assert.equal(byLabel.get('Sustentado con evidencia'), 2);
  assert.equal(byLabel.get('Brecha evidenciada'), 1);
  assert.equal(byLabel.get('Sustento parcial'), 1);
  assert.equal(byLabel.get('Evidencia insuficiente'), 1);
  assert.equal(byLabel.get('Revisión humana requerida'), 1);
  assert.equal(byLabel.get('Por revisar'), 1, 'el estado desconocido cae en el rótulo cerrado de respaldo');
  for (const bucket of summary.byConclusion) {
    assert.doesNotMatch(bucket.label, /estado_no_reconocido|_/, 'ningún código crudo puede viajar como rótulo visible');
  }
});

test('tenderIntegralAnalysisSummary presenta referencias citadas y evidencia pendiente como indicadores independientes y no excluyentes', () => {
  const summary = tenderIntegralAnalysisSummary(DYNAMIC_V3);
  const units = DYNAMIC_V3.analysis_units;
  assert.equal(summary.citedReferenceCount, units.reduce((total, unit) => total + unit.evidence_refs.length, 0));
  assert.equal(summary.pendingEvidenceCount, units.reduce((total, unit) => total + unit.missing_evidence.length, 0));
  assert.equal(summary.unitsWithCitedEvidence, units.filter(unit => unit.evidence_refs.length > 0).length);
  assert.equal(summary.unitsWithPendingEvidence, units.filter(unit => unit.missing_evidence.length > 0).length);
  // No son complementarios: una misma unidad puede citar evidencia y además tener pendientes.
  const both = units.filter(unit => unit.evidence_refs.length > 0 && unit.missing_evidence.length > 0).length;
  assert.ok(both > 0, 'el fixture dinámico debe tener al menos una unidad con ambos indicadores');
  assert.notEqual(summary.unitsWithCitedEvidence + summary.unitsWithPendingEvidence, summary.totalUnits);
});

test('tenderIntegralAnalysisSummary es genérico: piloto y fixture dinámico difieren en tamaño y ambos cierran la suma', async () => {
  const pilotV3 = await buildPilotIntegralAnalysis();
  assert.notEqual(pilotV3.analysis_units.length, DYNAMIC_V3.analysis_units.length, 'los dos fixtures deben diferir en cantidad');
  for (const v3 of [pilotV3, DYNAMIC_V3]) {
    const summary = tenderIntegralAnalysisSummary(v3);
    assert.equal(summary.totalUnits, v3.analysis_units.length);
    assert.equal(summary.byConclusion.reduce((total, bucket) => total + bucket.count, 0), v3.analysis_units.length);
  }
  assert.deepEqual(tenderIntegralAnalysisSummary(null), tenderIntegralAnalysisSummary({ analysis_units: [] }));
});

test('tenderIntegralPhaseGroups agrupa por las cinco categorías institucionales en orden, con diccionario cerrado', () => {
  assert.deepEqual(TENDER_INTEGRAL_PHASES.map(phase => phase.key), ['discard', 'habilitating', 'technical', 'financial_execution', 'strategic']);
  assert.deepEqual(TENDER_INTEGRAL_PHASES.map(phase => phase.label), ['Descarte', 'Habilitantes', 'Técnico', 'Financiero / ejecución', 'Estratégico']);

  const groups = tenderIntegralPhaseGroups(DYNAMIC_V3);
  const labels = groups.map(group => group.label);
  assert.deepEqual(labels.slice(0, TENDER_INTEGRAL_PHASES.length), TENDER_INTEGRAL_PHASES.map(phase => phase.label));
  assert.ok(labels.includes('Por revisar'), 'una categoría desconocida abre un grupo de respaldo cerrado');
  assert.equal(tenderIntegralCategoryLabel('categoria_no_reconocida'), 'Por revisar');
  assert.equal(tenderIntegralCategoryLabel(null), 'Por revisar');
  assert.equal(tenderIntegralCategoryLabel('strategic'), 'Estratégico');
});

test('tenderIntegralPhaseGroups conserva TODAS las unidades exactamente una vez y expone los pendientes de la fase', () => {
  const groups = tenderIntegralPhaseGroups(DYNAMIC_V3);
  const keys = groups.flatMap(group => group.units.map(unit => unit.key));
  assert.equal(keys.length, DYNAMIC_V3.analysis_units.length, 'ninguna unidad puede perderse al agrupar');
  assert.equal(new Set(keys).size, keys.length, 'ninguna unidad puede duplicarse al agrupar');
  assert.deepEqual([...keys].sort(), DYNAMIC_V3.analysis_units.map(unit => unit.unit_id).sort());

  const discard = groups.find(group => group.label === 'Descarte');
  assert.equal(discard.units.length, 1);
  assert.equal(discard.hasPendingEvidence, true, 'la fase con evidencia pendiente puede iniciar abierta');
  assert.equal(discard.pendingEvidenceCount, 1);

  const strategic = groups.find(group => group.label === 'Estratégico');
  assert.equal(strategic.hasPendingEvidence, false);

  // El piloto no trae unidades de Descarte ni Estratégico: las fases vacías siguen existiendo.
  const pilotGroups = tenderIntegralPhaseGroups({ analysis_units: [] });
  assert.equal(pilotGroups.length, TENDER_INTEGRAL_PHASES.length);
  assert.deepEqual(pilotGroups.map(group => group.units.length), TENDER_INTEGRAL_PHASES.map(() => 0));
});

test('tenderIntegralUnitPresentation expone soporte, acción principal y trazabilidad técnica sin heurísticas', () => {
  const unit = DYNAMIC_V3.analysis_units[0];
  const card = tenderIntegralUnitPresentation(unit);

  assert.equal(card.requirementId, unit.requirement_id);
  assert.equal(card.citedEvidenceCount, unit.evidence_refs.length);
  assert.equal(card.pendingEvidenceCount, unit.missing_evidence.length);
  assert.deepEqual(card.evidenceSourceLabels, ['Documento del pliego', 'Evidencia empresarial']);
  assert.equal(card.primaryActionSummary, unit.actions[0].summary);
  assert.equal(tenderIntegralUnitPresentation(DYNAMIC_V3.analysis_units[3]).primaryActionSummary, null, 'una unidad sin acciones no inventa una acción');

  // La trazabilidad conserva los códigos crudos que la primera capa nunca imprime.
  assert.equal(card.technical.unitId, unit.unit_id);
  assert.equal(card.technical.requirementId, unit.requirement_id);
  assert.deepEqual(card.technical.evidenceRefs.map(ref => ref.ref), unit.evidence_refs.map(ref => ref.ref));
  assert.equal(card.technical.evidenceRefs[0].sourceType, 'tender_document');
  assert.equal(card.technical.evidenceRefs[0].sourceTypeLabel, 'Documento del pliego');
  assert.equal(card.technical.evidenceRefs[0].purposeLabel, 'Sustento del requisito');
  assert.equal(card.technical.evidenceState.length, 5, 'los cinco ejes de evidence_state viajan a la trazabilidad');
  assert.deepEqual(card.technical.evidenceState.map(axis => axis.axis), ['presence', 'review', 'validity', 'applicability', 'compliance']);
  assert.equal(card.technical.closure.condition, unit.closure.condition);
  assert.equal(card.technical.legalStatus, unit.legal_assessment.status);

  const unknown = tenderIntegralUnitPresentation(DYNAMIC_V3.analysis_units[5]);
  assert.equal(unknown.categoryLabel, 'Por revisar');
  assert.equal(unknown.conclusionLabel, 'Por revisar');
  assert.equal(unknown.commercialImpactLabel, 'Por revisar');
  assert.equal(unknown.technical.category, 'categoria_no_reconocida');
});

test('tenderIntegralUnitPrimaryConditionKey exige igualdad explícita y no nula de requirement_id contra una entrada gobernada', () => {
  const review = DYNAMIC_ANALYSIS.decision_review;
  const [uno, dos, tres, , cinco] = DYNAMIC_V3.analysis_units;

  assert.equal(tenderIntegralUnitPrimaryConditionKey(uno, review), 'agt002::dynamic::decision-question::experiencia');
  assert.equal(tenderIntegralUnitPrimaryConditionKey(dos, review), 'agt002::dynamic::blocker::territorio', 'un impedimento gobernado también es un destino válido');
  assert.equal(tenderIntegralUnitPrimaryConditionKey(tres, review), null, 'sin igualdad de requirement_id no hay enlace');
  assert.equal(tenderIntegralUnitPrimaryConditionKey(cinco, review), null, 'requirement_id nulo nunca enlaza');
  assert.equal(tenderIntegralUnitPrimaryConditionKey(uno, null), null, 'sin decision_review gobernado no hay destino seguro');

  // Nunca por texto: mismo título, requirement_id distinto ⇒ sin enlace.
  const porTexto = { ...uno, requirement_id: 'req-que-no-existe' };
  assert.equal(tenderIntegralUnitPrimaryConditionKey(porTexto, review), null);
  const nulosNoSeIgualan = { ...cinco, requirement_id: null };
  const reviewConNulo = { ...review, decision_questions: [{ ...review.decision_questions[0], requirement_id: null }] };
  assert.equal(tenderIntegralUnitPrimaryConditionKey(nulosNoSeIgualan, reviewConNulo), null, 'null === null nunca puede considerarse igualdad explícita');
});

test('tenderIntegralUnitConditionAnchor produce el mismo ancla opaco que tenderDecisionConditionAnchor: una sola función pura, sin duplicar la relación por texto ni exponer el id gobernado crudo', () => {
  const review = DYNAMIC_ANALYSIS.decision_review;
  const [uno, dos, tres] = DYNAMIC_V3.analysis_units;

  assert.equal(tenderIntegralUnitConditionAnchor(uno, review), 'tender-condition-1', 'req-dyn-experiencia es la primera entrada gobernada (decision_questions+blockers)');
  assert.equal(tenderIntegralUnitConditionAnchor(dos, review), 'tender-condition-2', 'req-dyn-territorio es la segunda entrada gobernada');
  assert.equal(tenderIntegralUnitConditionAnchor(tres, review), null, 'sin igualdad de requirement_id no hay ancla');
  assert.equal(tenderIntegralUnitConditionAnchor(uno, null), null, 'sin decision_review gobernado no hay ancla segura');

  for (const unit of [uno, dos]) {
    const findingId = tenderIntegralUnitPrimaryConditionKey(unit, review);
    assert.equal(
      tenderIntegralUnitConditionAnchor(unit, review),
      tenderDecisionConditionAnchor(review, findingId),
      'el ancla debe derivarse de la misma función compartida que usa la tarjeta de Análisis',
    );
  }
  // El ancla nunca es el id gobernado crudo (finding.id).
  assert.notEqual(tenderIntegralUnitConditionAnchor(uno, review), tenderIntegralUnitPrimaryConditionKey(uno, review));
});

test('the presentation implementation never hardcodes the pilot literals 25/20/5/2', () => {
  const source = readFileSync(presentationPath, 'utf8');
  const withoutComments = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const literal of ['25', '20', '5', '2']) {
    const pattern = new RegExp(`(?<![\\w.])${literal}(?![\\w.])`);
    assert.doesNotMatch(withoutComments, pattern, `tenderIntegralAnalysisPresentation.ts must not hardcode the pilot literal ${literal}`);
  }
});
