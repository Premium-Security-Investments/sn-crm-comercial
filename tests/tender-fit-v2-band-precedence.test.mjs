// Contrato RED (TDD) de bandas/precedencia/prioridad de impacto de tender-fit-v2,
// a nivel de política completa (`evaluateTenderFit`). Complementa
// tests/tender-fit-policy.test.mjs: aquí se fija además el contrato de que cada
// razón y cada data_gap relevante para el ranking de impacto expone un campo
// `impact_priority` propio (no solo un comparador), derivado de
// REASON_IMPACT_PRIORITY_GROUPS en tender-fit-v2-parameters.js. No se exige
// ningún piso de 25 puntos de complemento ni ninguna etiqueta de prioridad para UI:
// únicamente el valor numérico determinístico `impact_priority`.
import assert from 'node:assert/strict';
import { TENDER_FIT_POLICY_VERSION, evaluateTenderFit, classifyTenderFitV2ScoreBand } from '../tender-fit-policy.js';
import {
  SCORE_BANDS,
  AXIS_MAX_POINTS,
  REASON_IMPACT_PRIORITY_GROUPS,
  CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP,
  CORPORATE_MAX_DEBT_RATIO,
  CORPORATE_EXPERIENCE_CAPACITY_SMMLV,
  TERRITORY_NATIONAL_COVERAGE_PHRASES,
  SMMLV_2026,
  VALUE_FAMILY_FLOORS_SMMLV,
} from '../tender-fit-v2-parameters.js';

const NOW = '2026-01-04T15:00:00.000Z'; // domingo en Bogotá, mismo fixture que tests/tender-fit-v2-time-axis.test.mjs

assert.equal(TENDER_FIT_POLICY_VERSION, 'tender-fit-v2');

function baseTender(o = {}) {
  return {
    title: 'Vigilancia armada con CCTV y control de acceso', description: '',
    value: 10_000_000_000, deadline_at: '2026-12-31', city: 'Bogotá', dept: 'Cundinamarca', ...o,
  };
}
function reasonsByAxis(result) {
  const byAxis = {};
  for (const r of result.reasons) (byAxis[r.axis] ||= []).push(r);
  return byAxis;
}

// ---------------------------------------------------------------------------
// 1. Clasificador numérico puro: fronteras exactas 80 Alto, 79 Medio, 60 Medio, 59 Bajo
// ---------------------------------------------------------------------------
assert.deepEqual(SCORE_BANDS, { ALTO_MIN: 80, MEDIO_MIN: 60 });
assert.equal(classifyTenderFitV2ScoreBand(80), 'alto');
assert.equal(classifyTenderFitV2ScoreBand(79), 'medio');
assert.equal(classifyTenderFitV2ScoreBand(60), 'medio');
assert.equal(classifyTenderFitV2ScoreBand(59), 'bajo');

// ---------------------------------------------------------------------------
// 2. Precedencia de bandas sobre el score numérico
// ---------------------------------------------------------------------------

// 2.1 Cierre vencido o <5 días hábiles fuerza Bajo, incluso si ADEMÁS hay una
//     brecha crítica en otro eje (precedencia 1 gana sobre precedencia 2).
const forcedLowWithCriticalGapInsufficient = evaluateTenderFit(
  baseTender({ city: '', dept: '', deadline_at: '2026-01-09' /* 4 días hábiles */ }),
  { nowIso: NOW },
);
assert.ok(
  reasonsByAxis(forcedLowWithCriticalGapInsufficient).territorio.some(r => r.critical),
  'debe existir además una brecha crítica de territorio en este caso',
);
assert.equal(
  forcedLowWithCriticalGapInsufficient.band,
  'bajo',
  '<5 días hábiles debe forzar Bajo aunque coexista una brecha crítica',
);

const forcedLowWithCriticalGapExpired = evaluateTenderFit(
  baseTender({ city: '', dept: '', deadline_at: '2026-01-01' /* vencida */ }),
  { nowIso: NOW },
);
assert.ok(reasonsByAxis(forcedLowWithCriticalGapExpired).territorio.some(r => r.critical));
assert.equal(
  forcedLowWithCriticalGapExpired.band,
  'bajo',
  'fecha vencida debe forzar Bajo aunque coexista una brecha crítica',
);

// 2.2 Si la precedencia 1 no aplica, cualquier brecha crítica fuerza Por validar.
const criticalGapNoForcedLow = evaluateTenderFit(
  baseTender({ city: '', dept: '', deadline_at: '2026-12-31' /* ventana amplia: no activa precedencia 1 */ }),
  { nowIso: NOW },
);
assert.ok(reasonsByAxis(criticalGapNoForcedLow).territorio.some(r => r.critical));
assert.equal(
  criticalGapNoForcedLow.band,
  'por_validar',
  'sin forzado a Bajo, una brecha crítica debe forzar Por validar',
);

// 2.3 Exactamente 5 días hábiles NO se fuerza a Bajo (frontera exacta del umbral).
const exactlyFiveDaysNoCriticalGap = evaluateTenderFit(
  baseTender({ deadline_at: '2026-01-10' /* exactamente 5 días hábiles */ }),
  { nowIso: NOW },
);
assert.equal(
  reasonsByAxis(exactlyFiveDaysNoCriticalGap).tiempo[0].points,
  4,
  'fijación: 5 días hábiles debe mapear a la banda de 4 puntos, no a la banda forzada',
);
assert.notEqual(
  exactlyFiveDaysNoCriticalGap.band,
  'bajo',
  'exactamente 5 días hábiles no debe forzarse a Bajo',
);
assert.equal(
  exactlyFiveDaysNoCriticalGap.band,
  classifyTenderFitV2ScoreBand(exactlyFiveDaysNoCriticalGap.score),
  'sin brechas críticas en este caso, el band debe salir directamente del score numérico, sin ningún forzado',
);

// 2.4 Caso puramente numérico: sin forzado a Bajo ni brechas críticas, el band
//     sale exactamente del clasificador numérico sobre el score calculado.
const pureNumeric = evaluateTenderFit(
  baseTender({
    title: 'Instalación de CCTV y control de acceso perimetral', // ELECTRONICA, sin ambigüedad
    city: 'Leticia', dept: 'Amazonas', // confirmado fuera de foco, sin crítico
    deadline_at: '2026-01-23', // 13 días hábiles, sin crítico
  }),
  { nowIso: NOW },
);
for (const axis of ['servicio', 'valor', 'territorio', 'tiempo']) {
  assert.equal(reasonsByAxis(pureNumeric)[axis][0].critical, false, `eje ${axis} no debe tener brecha crítica en este caso`);
}
assert.equal(pureNumeric.band, classifyTenderFitV2ScoreBand(pureNumeric.score), 'sin forzados, el band debe salir exactamente del score numérico');

// ---------------------------------------------------------------------------
// 3. Score máximo 100 (A50+B20+C15+D15), nunca por encima; feedback fijo.
// ---------------------------------------------------------------------------
assert.deepEqual(AXIS_MAX_POINTS, { SERVICIO: 50, VALOR: 20, TERRITORIO: 15, TIEMPO: 15 });
assert.equal(AXIS_MAX_POINTS.SERVICIO + AXIS_MAX_POINTS.VALOR + AXIS_MAX_POINTS.TERRITORIO + AXIS_MAX_POINTS.TIEMPO, 100);

const maxTender = baseTender({
  title: 'Vigilancia armada con CCTV y control de acceso', // HIBRIDA -> 50
  value: 9_980_158_500, // exactamente 5700 SMMLV 2026, bajo el umbral de capacidad financiera -> 20
  city: 'Bogotá', dept: 'Cundinamarca', // 15
  deadline_at: '2026-12-31', // muy por encima de 20 días hábiles -> 15
});
const maxResult = evaluateTenderFit(maxTender, { nowIso: NOW });
assert.equal(maxResult.score, 100, 'la combinación máxima de los cuatro ejes debe dar exactamente 100');
assert.deepEqual(maxResult.feedback, { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' });

for (const result of [
  forcedLowWithCriticalGapInsufficient, forcedLowWithCriticalGapExpired, criticalGapNoForcedLow,
  exactlyFiveDaysNoCriticalGap, pureNumeric, maxResult,
]) {
  assert.ok(result.score >= 0 && result.score <= 100, 'el score siempre debe quedar en [0,100], nunca por encima de 100');
  assert.deepEqual(result.feedback, { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' });
}

// ---------------------------------------------------------------------------
// 4. Totalidad: toda entrada evaluada devuelve un resultado completo, sin
//    ocultar ni filtrar filas por criticidad.
// ---------------------------------------------------------------------------
const emptyResult = evaluateTenderFit({}, { nowIso: NOW });
assert.equal(typeof emptyResult.score, 'number');
assert.equal(typeof emptyResult.band, 'string');
assert.ok(Array.isArray(emptyResult.reasons) && emptyResult.reasons.length >= 4, 'incluso sin datos deben existir las cuatro razones de eje base');
assert.ok(Array.isArray(emptyResult.data_gaps));

// Caso con múltiples brechas críticas simultáneas: todas las razones de eje
// base siguen presentes, y las razones/gaps adicionales no se ocultan.
const multiCritical = evaluateTenderFit(
  baseTender({
    title: 'Servicio de escolta con armas 24 horas', description: '',
    value: undefined, city: '', dept: '', deadline_at: '2026-01-09',
  }),
  { nowIso: NOW },
);
assert.equal(multiCritical.reasons.filter(r => r.axis === 'servicio').length, 1);
assert.equal(multiCritical.reasons.filter(r => r.axis === 'valor').length, 1);
assert.ok(multiCritical.reasons.filter(r => r.axis === 'territorio').length >= 1);
assert.equal(multiCritical.reasons.filter(r => r.axis === 'tiempo').length, 1);
assert.equal(typeof multiCritical.score, 'number');
assert.equal(typeof multiCritical.band, 'string');

// ---------------------------------------------------------------------------
// 5. Prioridad de impacto determinística: cada razón/gap relevante para el
//    ranking expone `impact_priority`, derivado del índice de su grupo en
//    REASON_IMPACT_PRIORITY_GROUPS (empates = mismo índice de grupo).
// ---------------------------------------------------------------------------
assert.deepEqual(REASON_IMPACT_PRIORITY_GROUPS, [
  ['plazo_vencido', 'plazo_insuficiente'],              // 0: plazo vencido/insuficiente
  ['servicio_ambiguo'],                                  // 1: servicio ambiguo
  ['valor_ausente', 'valor_bajo_piso'],                  // 2: valor ausente/bajo piso
  ['capacidad_financiera_por_validar'],                  // 3: capacidad financiera
  ['plazo_ausente'],                                     // 4: plazo ausente
  ['territorio_indeterminado'],                          // 5: territorio indeterminado
  ['cobertura_por_validar'],                             // 6: cobertura nacional
  ['endeudamiento_por_validar', 'experiencia_por_validar'], // 7: endeudamiento/experiencia opcional
]);

function groupIndexOf(code) {
  const index = REASON_IMPACT_PRIORITY_GROUPS.findIndex(group => group.includes(code));
  assert.ok(index >= 0, `código "${code}" debe pertenecer a algún grupo de REASON_IMPACT_PRIORITY_GROUPS`);
  return index;
}
function allRankable(result) {
  const codes = new Set(REASON_IMPACT_PRIORITY_GROUPS.flat());
  const fromReasons = result.reasons.filter(r => codes.has(r.code));
  const fromGaps = result.data_gaps.filter(g => codes.has(g.gap_id)).map(g => ({ code: g.gap_id, impact_priority: g.impact_priority }));
  return [...fromReasons.map(r => ({ code: r.code, impact_priority: r.impact_priority })), ...fromGaps];
}

// 5.1 Escenario A: cubre los grupos 0 (plazo_insuficiente), 1 (servicio_ambiguo),
//     2 (valor_ausente), 5 (territorio_indeterminado) y 6 (cobertura_por_validar)
//     en una sola evaluación.
const nationalCoveragePhrase = TERRITORY_NATIONAL_COVERAGE_PHRASES[0];
const scenarioA = evaluateTenderFit(
  baseTender({
    // El lenguaje de cobertura nacional se agrega al final del title (mismo
    // campo usado por tests/tender-fit-v2-territory-axis.test.mjs) para no
    // introducir una suposición distinta sobre qué campo escanea la detección.
    title: `Servicio de escolta con armas 24 horas, ${nationalCoveragePhrase}`,
    description: '',
    value: undefined,
    city: '', dept: '',
    deadline_at: '2026-01-09', // 4 días hábiles -> plazo_insuficiente
  }),
  { nowIso: NOW },
);
const rankedA = allRankable(scenarioA);
for (const item of rankedA) {
  assert.equal(typeof item.impact_priority, 'number', `"${item.code}" debe traer impact_priority numérico`);
  assert.equal(item.impact_priority, groupIndexOf(item.code), `impact_priority de "${item.code}" debe coincidir con su índice de grupo`);
}
const codesA = rankedA.map(item => item.code);
for (const expectedCode of ['plazo_insuficiente', 'servicio_ambiguo', 'valor_ausente', 'territorio_indeterminado', 'cobertura_por_validar']) {
  assert.ok(codesA.includes(expectedCode), `el escenario A debe producir el código "${expectedCode}"`);
}
const sortedA = [...rankedA].sort((a, b) => a.impact_priority - b.impact_priority);
assert.deepEqual(
  sortedA.slice(0, 2).map(item => item.code),
  ['plazo_insuficiente', 'servicio_ambiguo'],
  'las 2 razones de mayor impacto deben ser plazo_insuficiente y servicio_ambiguo, en ese orden (contrato de selección máx-2 para UI/Discord)',
);
assert.equal(scenarioA.band, 'bajo', '<5 días hábiles sigue forzando Bajo en este escenario mixto');

// 5.2 Escenario B: cubre los grupos 3 (capacidad_financiera_por_validar),
//     4 (plazo_ausente) y 7 (endeudamiento_por_validar/experiencia_por_validar,
//     empatados) en una sola evaluación.
const scenarioB = evaluateTenderFit(
  baseTender({
    title: 'Contrato de vigilancia armada en sede principal',
    value: CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP + 1,
    required_max_debt_ratio: CORPORATE_MAX_DEBT_RATIO - 0.01,
    required_experience_smmlv: CORPORATE_EXPERIENCE_CAPACITY_SMMLV + 1,
    deadline_at: undefined,
  }),
  { nowIso: NOW },
);
const rankedB = allRankable(scenarioB);
for (const item of rankedB) {
  assert.equal(item.impact_priority, groupIndexOf(item.code), `impact_priority de "${item.code}" debe coincidir con su índice de grupo`);
}
const byCodeB = Object.fromEntries(rankedB.map(item => [item.code, item.impact_priority]));
assert.ok('capacidad_financiera_por_validar' in byCodeB, 'el escenario B debe producir capacidad_financiera_por_validar');
assert.ok('plazo_ausente' in byCodeB, 'el escenario B debe producir plazo_ausente');
assert.ok('endeudamiento_por_validar' in byCodeB, 'el escenario B debe producir endeudamiento_por_validar');
assert.ok('experiencia_por_validar' in byCodeB, 'el escenario B debe producir experiencia_por_validar');
assert.ok(
  byCodeB.capacidad_financiera_por_validar < byCodeB.plazo_ausente,
  'capacidad_financiera_por_validar (grupo 3) debe tener mayor impacto que plazo_ausente (grupo 4)',
);
assert.ok(
  byCodeB.plazo_ausente < byCodeB.endeudamiento_por_validar,
  'plazo_ausente (grupo 4) debe tener mayor impacto que endeudamiento_por_validar (grupo 7)',
);
assert.equal(
  byCodeB.endeudamiento_por_validar,
  byCodeB.experiencia_por_validar,
  'endeudamiento_por_validar y experiencia_por_validar están empatados en el mismo grupo (7) y deben compartir impact_priority',
);

// 5.3 Empates dentro de grupo: plazo_vencido vs plazo_insuficiente (grupo 0) y
//     valor_ausente vs valor_bajo_piso (grupo 2) deben compartir impact_priority.
const expiredDeadlineResult = evaluateTenderFit(baseTender({ deadline_at: '2026-01-03' /* vencida */ }), { nowIso: NOW });
const insufficientDeadlineResult = evaluateTenderFit(baseTender({ deadline_at: '2026-01-09' /* 4 días hábiles */ }), { nowIso: NOW });
const expiredReason = expiredDeadlineResult.reasons.find(r => r.axis === 'tiempo');
const insufficientReason = insufficientDeadlineResult.reasons.find(r => r.axis === 'tiempo');
assert.equal(expiredReason.code, 'plazo_vencido');
assert.equal(insufficientReason.code, 'plazo_insuficiente');
assert.equal(expiredReason.impact_priority, insufficientReason.impact_priority, 'plazo_vencido y plazo_insuficiente comparten grupo (0) y deben compartir impact_priority');

const floorFisicaCop = VALUE_FAMILY_FLOORS_SMMLV.FISICA * SMMLV_2026.value_cop;
const valorAusenteResult = evaluateTenderFit(baseTender({ title: 'Contrato de vigilancia armada en sede principal', value: undefined }), { nowIso: NOW });
const valorBajoPisoResult = evaluateTenderFit(baseTender({ title: 'Contrato de vigilancia armada en sede principal', value: floorFisicaCop - 1 }), { nowIso: NOW });
const valorAusenteReason = valorAusenteResult.reasons.find(r => r.axis === 'valor');
const valorBajoPisoReason = valorBajoPisoResult.reasons.find(r => r.axis === 'valor');
assert.equal(valorAusenteReason.code, 'valor_ausente');
assert.equal(valorBajoPisoReason.code, 'valor_bajo_piso');
assert.equal(valorAusenteReason.impact_priority, valorBajoPisoReason.impact_priority, 'valor_ausente y valor_bajo_piso comparten grupo (2) y deben compartir impact_priority');

console.log('tender-fit-v2-band-precedence: OK');
