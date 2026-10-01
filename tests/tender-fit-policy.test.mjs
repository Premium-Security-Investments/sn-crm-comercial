// Contrato RED (TDD) de la fórmula canónica tender-fit-v2, reemplazo autorizado y
// único de tender-fit-v1 (no queda ningún modo sombra: `evaluateTenderFit` debe
// devolver v2 directamente, sin campo `shadow`).
//
// Ejes: A Servicio (50, tests/tender-service-matrix-v2.test.mjs sección 16 fija la
// integración exacta con TENDER_SERVICE_MATRIX_V2), B Valor (20,
// tests/tender-fit-v2-value-axis.test.mjs), C Territorio (15,
// tests/tender-fit-v2-territory-axis.test.mjs), D Tiempo (15,
// tests/tender-fit-v2-time-axis.test.mjs). Este archivo fija el contrato a nivel
// de política: versión, ausencia de `shadow`, bandas/precedencia, prioridad de
// impacto de razones (selección de máx. 2 para UI/Discord) y el contrato general
// (score máx. 100, feedback, totalidad sobre todas las filas).
import assert from 'node:assert/strict';
import { TENDER_FIT_POLICY_VERSION, evaluateTenderFit, classifyTenderFitV2ScoreBand, compareTenderFitV2ReasonsByImpact } from '../tender-fit-policy.js';
import { AXIS_MAX_POINTS, SCORE_BANDS } from '../tender-fit-v2-parameters.js';

const NOW = '2026-01-04T15:00:00.000Z'; // domingo en Bogotá

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
// 1. Versión de política es tender-fit-v2; no existe campo shadow
// ---------------------------------------------------------------------------
assert.equal(TENDER_FIT_POLICY_VERSION, 'tender-fit-v2');
const sample = evaluateTenderFit(baseTender(), { nowIso: NOW });
assert.equal(sample.policy_version, 'tender-fit-v2');
assert.equal('shadow' in sample, false, 'tender-fit-v2 es la fórmula única: no debe quedar ningún campo shadow');

// ---------------------------------------------------------------------------
// 2. reasons: cuatro ejes base en orden fijo servicio,valor,territorio,tiempo
// ---------------------------------------------------------------------------
assert.equal(sample.reasons.slice(0, 4).map(r => r.axis).join(','), 'servicio,valor,territorio,tiempo');
for (const reason of sample.reasons) {
  assert.ok(['axis', 'points', 'code', 'detail', 'source', 'critical'].every(key => key in reason), 'cada razón debe traer axis/points/code/detail/source/critical');
  assert.equal(typeof reason.critical, 'boolean');
}

// ---------------------------------------------------------------------------
// 3. Contrato: score máximo 100 (A50+B20+C15+D15), feedback evidence_only
// ---------------------------------------------------------------------------
assert.deepEqual(AXIS_MAX_POINTS, { SERVICIO: 50, VALOR: 20, TERRITORIO: 15, TIEMPO: 15 });
const maxTender = baseTender({
  title: 'Vigilancia armada con CCTV y control de acceso', // HIBRIDA -> 50
  value: 9_980_158_500, // exactamente 5700 SMMLV 2026 (170 SMMLV*1.750.905) y bajo el umbral de capacidad financiera -> 20
  city: 'Bogotá', dept: 'Cundinamarca', // 15
  deadline_at: '2026-12-31', // muy por encima de 20 días hábiles -> 15
});
const maxResult = evaluateTenderFit(maxTender, { nowIso: NOW });
assert.equal(maxResult.score, 100, 'la combinación máxima de los cuatro ejes debe dar exactamente 100');
assert.equal(maxResult.band, 'alto');
assert.deepEqual(sample.feedback, { mode: 'evidence_only', applied_points: 0, policy: 'human_reviewed_version_only' });
for (const result of [sample, maxResult]) {
  assert.ok(result.score >= 0 && result.score <= 100, 'el score siempre debe quedar en [0,100]');
}

// ---------------------------------------------------------------------------
// 4. Totalidad: toda fila se evalúa y devuelve (sin lógica de ocultar candidatas aquí)
// ---------------------------------------------------------------------------
assert.doesNotThrow(() => evaluateTenderFit({}, { nowIso: NOW }));
const emptyResult = evaluateTenderFit({}, { nowIso: NOW });
assert.equal(typeof emptyResult.score, 'number');
assert.equal(typeof emptyResult.band, 'string');
assert.equal(emptyResult.reasons.length >= 4, true, 'incluso sin datos deben existir las cuatro razones de eje base');
assert.throws(() => evaluateTenderFit(null, { nowIso: NOW }), /invalid|inválid/i);
assert.throws(() => evaluateTenderFit(42, { nowIso: NOW }), /invalid|inválid/i);
assert.throws(() => evaluateTenderFit(baseTender(), { nowIso: 'no-es-una-fecha' }), /invalid|inválid/i);

// ---------------------------------------------------------------------------
// 5. Bandas numéricas puras: Alto >=80, Medio 60-79, Bajo <60 (frontera exacta)
// ---------------------------------------------------------------------------
assert.deepEqual(SCORE_BANDS, { ALTO_MIN: 80, MEDIO_MIN: 60 });
assert.equal(classifyTenderFitV2ScoreBand(100), 'alto');
assert.equal(classifyTenderFitV2ScoreBand(80), 'alto');
assert.equal(classifyTenderFitV2ScoreBand(79), 'medio');
assert.equal(classifyTenderFitV2ScoreBand(60), 'medio');
assert.equal(classifyTenderFitV2ScoreBand(59), 'bajo');
assert.equal(classifyTenderFitV2ScoreBand(0), 'bajo');

// ---------------------------------------------------------------------------
// 6. Precedencia 1: cierre vencido o <5 días hábiles fuerza Bajo, aunque el score
//    numérico sea de Alto. Exactamente 5 días hábiles NO se fuerza.
// ---------------------------------------------------------------------------
const highScoreFewDays = evaluateTenderFit(baseTender({ deadline_at: '2026-01-09' /* 4 días hábiles */ }), { nowIso: NOW });
assert.ok(highScoreFewDays.score >= 80, 'el score numérico de este caso debe calificar como Alto si no se forzara');
assert.equal(highScoreFewDays.band, 'bajo', 'cierre con <5 días hábiles debe forzar Bajo pese al score alto');

const exactlyFiveDays = evaluateTenderFit(baseTender({ deadline_at: '2026-01-10' /* exactamente 5 días hábiles */ }), { nowIso: NOW });
assert.ok(exactlyFiveDays.score >= 80, 'con exactamente 5 días hábiles el score numérico sigue siendo de Alto');
assert.equal(exactlyFiveDays.band, 'alto', 'exactamente 5 días hábiles NO debe forzarse a Bajo');

const expiredHighScore = evaluateTenderFit(baseTender({ deadline_at: '2026-01-01' /* vencida */ }), { nowIso: NOW });
assert.equal(expiredHighScore.band, 'bajo', 'fecha vencida debe forzar Bajo pese al score alto en los demás ejes');

// ---------------------------------------------------------------------------
// 7. Precedencia 2: cualquier incertidumbre crítica fuerza Por validar (si la
//    precedencia 1 no aplicó ya).
// ---------------------------------------------------------------------------
const criticalGapHighScore = evaluateTenderFit(
  baseTender({ city: '', dept: '', deadline_at: '2026-12-31' /* ventana amplia: no activa precedencia 1 */ }),
  { nowIso: NOW },
);
assert.ok(reasonsByAxis(criticalGapHighScore).territorio.some(r => r.critical), 'debe existir una brecha crítica de territorio');
assert.ok(
  (criticalGapHighScore.reasons.find(r => r.axis === 'servicio').points
    + criticalGapHighScore.reasons.find(r => r.axis === 'valor').points
    + criticalGapHighScore.reasons.find(r => r.axis === 'tiempo').points) >= 80,
  'los demás ejes por sí solos ya calificarían como Alto si no hubiera incertidumbre crítica',
);
assert.equal(criticalGapHighScore.band, 'por_validar', 'incertidumbre crítica (territorio indeterminado) debe forzar Por validar pese al score alto');

// ---------------------------------------------------------------------------
// 8. La precedencia 1 (forzado Bajo) gana sobre la precedencia 2 (Por validar)
//    cuando ambas condiciones aplican a la vez.
// ---------------------------------------------------------------------------
const bothPrecedences = evaluateTenderFit(
  baseTender({ city: '', dept: '', deadline_at: '2026-01-09' /* <5 días hábiles Y territorio indeterminado */ }),
  { nowIso: NOW },
);
assert.ok(reasonsByAxis(bothPrecedences).territorio.some(r => r.critical), 'sigue existiendo la brecha crítica de territorio');
assert.equal(bothPrecedences.band, 'bajo', 'cuando ambas precedencias aplican, el forzado a Bajo (precedencia 1) gana sobre Por validar (precedencia 2)');

// ---------------------------------------------------------------------------
// 9. Caso numérico puro: sin brechas críticas ni cierre forzado, el band sale del score
// ---------------------------------------------------------------------------
const noCriticalMedio = evaluateTenderFit(
  baseTender({
    title: 'Instalación de CCTV y control de acceso perimetral', // ELECTRONICA -> 48 (eje A)
    value: 105_054_300, // piso ELECTRONICA (60 SMMLV) exacto -> 6 puntos, sin crítico
    city: 'Leticia', dept: 'Amazonas', // confirmado fuera de foco -> 0, sin crítico
    deadline_at: '2026-01-23', // 13 días hábiles -> 13 puntos
  }),
  { nowIso: NOW },
);
assert.equal(reasonsByAxis(noCriticalMedio).valor[0].critical, false);
assert.equal(reasonsByAxis(noCriticalMedio).territorio[0].critical, false);
assert.equal(reasonsByAxis(noCriticalMedio).tiempo[0].critical, false);
assert.equal(noCriticalMedio.score, 48 + 6 + 0 + 13);
assert.equal(noCriticalMedio.band, classifyTenderFitV2ScoreBand(noCriticalMedio.score));
assert.equal(noCriticalMedio.band, 'medio');

// ---------------------------------------------------------------------------
// 10. Determinismo
// ---------------------------------------------------------------------------
assert.equal(JSON.stringify(evaluateTenderFit(baseTender(), { nowIso: NOW })), JSON.stringify(evaluateTenderFit(baseTender(), { nowIso: NOW })));

// ---------------------------------------------------------------------------
// 11. Prioridad de impacto de razones (requisito 7): comparador exportado y puro,
//     que ordena por código de impacto — no por puntos ni por orden de cálculo.
// ---------------------------------------------------------------------------
assert.equal(typeof compareTenderFitV2ReasonsByImpact, 'function');

// 11.1 No es por puntaje: un código de rango bajo con muchos puntos debe perder
// frente a un código de rango alto con pocos/ningún punto.
const lowRankHighPoints = { axis: 'servicio', points: 50, code: 'servicio_hibrida', detail: 'x', source: 'title', critical: false };
const highRankLowPoints = { axis: 'tiempo', points: 5, code: 'plazo_ausente', detail: 'y', source: 'deadline_at', critical: true };
assert.ok(
  compareTenderFitV2ReasonsByImpact(highRankLowPoints, lowRankHighPoints) < 0,
  'plazo_ausente (prioridad de impacto, código listado) debe ordenarse antes que servicio_hibrida (50 puntos, no listado) pese a tener menos puntos',
);

// 11.2 Orden completo por grupos de prioridad, insensible al orden de entrada (shuffle)
const CODE_BY_RANK = [
  'plazo_insuficiente', 'servicio_ambiguo', 'valor_bajo_piso', 'capacidad_financiera_por_validar',
  'plazo_ausente', 'territorio_indeterminado', 'cobertura_por_validar', 'experiencia_por_validar',
];
function reasonFor(code, points) {
  return { axis: 'servicio', points, code, detail: code, source: 'x', critical: true };
}
const shuffledReasons = [...CODE_BY_RANK].reverse().map((code, i) => reasonFor(code, i * 7));
const sorted = [...shuffledReasons].sort(compareTenderFitV2ReasonsByImpact);
assert.deepEqual(sorted.map(r => r.code), CODE_BY_RANK, 'el orden final debe seguir la tabla de prioridad de impacto, sin importar el orden ni los puntos de entrada');

// 11.3 Integración real: construir un caso con varias razones críticas simultáneas
// y confirmar que "elegir las 2 de mayor impacto" selecciona por prioridad, no por
// orden de cálculo del eje (A,B,C,D) ni por puntos.
const multiCritical = evaluateTenderFit(
  baseTender({
    title: 'Servicio de escolta con armas 24 horas', // AMBIGUA -> 30, servicio_ambiguo, crítico (rango 2)
    description: '',
    value: undefined, // valor_ausente, crítico (rango 3)
    city: '', dept: '', // territorio_indeterminado, crítico (rango 6)
    deadline_at: '2026-01-09', // 4 días hábiles -> plazo_insuficiente, NO crítico pero rango 1 (máxima prioridad)
  }),
  { nowIso: NOW },
);
const top2 = [...multiCritical.reasons].sort(compareTenderFitV2ReasonsByImpact).slice(0, 2);
assert.deepEqual(top2.map(r => r.code), ['plazo_insuficiente', 'servicio_ambiguo'], 'las 2 razones de mayor impacto deben ser plazo_insuficiente y servicio_ambiguo, en ese orden');
// Este mismo caso también ejemplifica la precedencia 1 ganando sobre la 2 (ver sección 8).
assert.equal(multiCritical.band, 'bajo');

console.log('tender-fit-policy (tender-fit-v2): OK');
