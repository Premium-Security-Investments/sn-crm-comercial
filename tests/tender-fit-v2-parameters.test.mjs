// Contrato RED (TDD) del módulo de parámetros dedicado de tender-fit-v2.
// Objetivo: que SMMLV, pisos por familia, bandas de valor, tablas de territorio,
// bandas de tiempo (días hábiles) y la prioridad de impacto de razones vivan en UN
// módulo de datos versionado — `tender-fit-v2-parameters.js` — en vez de literales
// duplicados dentro del evaluador (tender-fit-policy.js). Los demás archivos de
// prueba de tender-fit-v2 importan estas constantes como fuente única de verdad
// para derivar sus valores esperados (nunca repiten los literales a mano).
//
// Este módulo NO EXISTE TODAVÍA (fase RED): se espera ERR_MODULE_NOT_FOUND hasta
// que la implementación productiva lo cree.
import assert from 'node:assert/strict';
import {
  TENDER_FIT_V2_PARAMETERS_VERSION,
  SMMLV_2026,
  VALUE_FAMILY_FLOORS_SMMLV,
  VALUE_BAND_THRESHOLDS_SMMLV,
  VALUE_BAND_POINTS,
  CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP,
  CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE,
  CORPORATE_MAX_DEBT_RATIO,
  CORPORATE_EXPERIENCE_CAPACITY_SMMLV,
  TERRITORY_EXACT_CITY_POINTS_15,
  TERRITORY_EXACT_CITY_POINTS_10,
  TERRITORY_DEPARTMENTS_POINTS_5,
  TERRITORY_NATIONAL_COVERAGE_PHRASES,
  TIME_BUSINESS_DAY_BANDS,
  TIME_BUSINESS_DAY_POINTS_ABOVE_20,
  TIME_MISSING_DEADLINE_POINTS,
  TIME_FORCED_LOW_BUSINESS_DAY_THRESHOLD,
  COLOMBIA_HOLIDAYS_2026,
  SCORE_BANDS,
  AXIS_MAX_POINTS,
  REASON_IMPACT_PRIORITY_GROUPS,
} from '../tender-fit-v2-parameters.js';

// ---------------------------------------------------------------------------
// 1. Versión del módulo de parámetros
// ---------------------------------------------------------------------------
assert.equal(typeof TENDER_FIT_V2_PARAMETERS_VERSION, 'string');
assert.ok(TENDER_FIT_V2_PARAMETERS_VERSION.trim().length > 0);

// ---------------------------------------------------------------------------
// 2. SMMLV 2026 con metadatos (requisito 3)
// ---------------------------------------------------------------------------
assert.ok(SMMLV_2026 && typeof SMMLV_2026 === 'object');
assert.equal(SMMLV_2026.value_cop, 1_750_905, 'SMMLV 2026 debe ser COP 1.750.905');
assert.equal(SMMLV_2026.year, 2026);
assert.equal(typeof SMMLV_2026.source, 'string');
assert.ok(SMMLV_2026.source.trim().length > 0, 'debe traer metadato source');
assert.equal(typeof SMMLV_2026.norm, 'string');
assert.ok(SMMLV_2026.norm.trim().length > 0, 'debe traer metadato norm');
assert.equal(typeof SMMLV_2026.status, 'string');
assert.ok(SMMLV_2026.status.trim().length > 0, 'debe traer metadato status');
assert.equal(Object.isFrozen(SMMLV_2026), true);

// ---------------------------------------------------------------------------
// 3. Pisos por familia (SMMLV) — HIBRIDA/FISICA=170, ELECTRONICA=60, SUMINISTRO=30
// ---------------------------------------------------------------------------
assert.deepEqual(VALUE_FAMILY_FLOORS_SMMLV, { HIBRIDA: 170, FISICA: 170, ELECTRONICA: 60, SUMINISTRO: 30 });
assert.equal(Object.isFrozen(VALUE_FAMILY_FLOORS_SMMLV), true);

// ---------------------------------------------------------------------------
// 4. Bandas de valor (múltiplos de SMMLV) y sus puntos: 6/12/17/20, nunca cae
// ---------------------------------------------------------------------------
assert.deepEqual(VALUE_BAND_THRESHOLDS_SMMLV, { TIER_1_MAX: 290, TIER_2_MAX: 1150, TIER_3_MAX: 5700 });
assert.deepEqual(VALUE_BAND_POINTS, { TIER_1: 6, TIER_2: 12, TIER_3: 17, TIER_4: 20 });

// ---------------------------------------------------------------------------
// 5. Umbral de revisión de capacidad financiera (COP) y supuesto del 25%
// ---------------------------------------------------------------------------
assert.equal(CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP, 45_535_037_196);
assert.equal(CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE, 0.25);

// ---------------------------------------------------------------------------
// 6. Referencias corporativas opcionales: endeudamiento y experiencia
// ---------------------------------------------------------------------------
assert.equal(CORPORATE_MAX_DEBT_RATIO, 0.5056);
assert.equal(CORPORATE_EXPERIENCE_CAPACITY_SMMLV, 136565.79);

// ---------------------------------------------------------------------------
// 7. Territorio: ciudades exactas 15/10 y departamentos de foco (5)
// ---------------------------------------------------------------------------
assert.deepEqual([...TERRITORY_EXACT_CITY_POINTS_15].sort(), ['Barranquilla', 'Bogotá', 'Cali', 'Medellín', 'Pereira']);
assert.deepEqual([...TERRITORY_EXACT_CITY_POINTS_10].sort(), ['Armenia', 'Cartagena', 'Manizales']);
assert.deepEqual([...TERRITORY_DEPARTMENTS_POINTS_5].sort(), [
  'Antioquia', 'Caldas', 'Caquetá', 'Cauca', 'Cundinamarca', 'Huila', 'Nariño',
  'Quindío', 'Risaralda', 'Tolima', 'Valle del Cauca',
]);
assert.equal(Object.isFrozen(TERRITORY_EXACT_CITY_POINTS_15), true);
assert.equal(Object.isFrozen(TERRITORY_EXACT_CITY_POINTS_10), true);
assert.equal(Object.isFrozen(TERRITORY_DEPARTMENTS_POINTS_5), true);
// Sin solapamiento entre las dos listas de ciudades exactas (15 vs 10)
assert.deepEqual(
  TERRITORY_EXACT_CITY_POINTS_15.filter(c => TERRITORY_EXACT_CITY_POINTS_10.includes(c)),
  [],
  'una ciudad no puede estar en ambas listas de puntaje exacto',
);
// Frases de cobertura nacional: al menos una, todas strings no vacíos
assert.ok(Array.isArray(TERRITORY_NATIONAL_COVERAGE_PHRASES) && TERRITORY_NATIONAL_COVERAGE_PHRASES.length > 0);
assert.ok(TERRITORY_NATIONAL_COVERAGE_PHRASES.every(p => typeof p === 'string' && p.trim().length > 0));

// ---------------------------------------------------------------------------
// 8. Tiempo: bandas de días hábiles, techo >20, ausencia de fecha, umbral de forzado bajo
// ---------------------------------------------------------------------------
assert.ok(Array.isArray(TIME_BUSINESS_DAY_BANDS) && TIME_BUSINESS_DAY_BANDS.length > 0);
for (const band of TIME_BUSINESS_DAY_BANDS) {
  assert.equal(typeof band.max, 'number');
  assert.equal(typeof band.points, 'number');
}
// Bandas exactas pedidas: 0-4=>0 (banda de 4 o el "forzado bajo" la cubre), 5=>4, 6-8=>7, 9-12=>10, 13-20=>13
assert.deepEqual(
  TIME_BUSINESS_DAY_BANDS.map(b => [b.max, b.points]),
  [[4, 0], [5, 4], [8, 7], [12, 10], [20, 13]],
);
assert.equal(TIME_BUSINESS_DAY_POINTS_ABOVE_20, 15);
assert.equal(TIME_MISSING_DEADLINE_POINTS, 5);
assert.equal(TIME_FORCED_LOW_BUSINESS_DAY_THRESHOLD, 5, '<5 días hábiles fuerza Bajo (precedencia 1)');

// ---------------------------------------------------------------------------
// 9. Feriados de Colombia 2026 — fixture usado por el helper de días hábiles.
//    Se verifican el tamaño y únicamente las fechas fijas/no desplazables (sin
//    dependencia del cálculo de Pascua), que son las que este conjunto de
//    pruebas puede fijar con certeza absoluta por fecha fija de ley.
// ---------------------------------------------------------------------------
assert.ok(Array.isArray(COLOMBIA_HOLIDAYS_2026));
assert.equal(COLOMBIA_HOLIDAYS_2026.length, 19, 'Colombia tiene 19 festivos oficiales en 2026');
assert.equal(new Set(COLOMBIA_HOLIDAYS_2026).size, 19, 'no debe haber fechas repetidas');
assert.deepEqual([...COLOMBIA_HOLIDAYS_2026].sort(), COLOMBIA_HOLIDAYS_2026, 'debe venir ordenado ascendentemente');
for (const fixedHoliday of ['2026-01-01', '2026-05-01', '2026-07-20', '2026-08-07', '2026-12-08', '2026-12-25']) {
  assert.ok(COLOMBIA_HOLIDAYS_2026.includes(fixedHoliday), `falta el festivo fijo ${fixedHoliday}`);
}
// Reyes Magos (6 de enero, martes en 2026) se traslada por Ley Emiliani al lunes siguiente: 12 de enero.
assert.ok(COLOMBIA_HOLIDAYS_2026.includes('2026-01-12'), 'Reyes Magos trasladado debe ser 2026-01-12');
assert.ok(!COLOMBIA_HOLIDAYS_2026.includes('2026-01-06'), 'la fecha original no trasladada no debe listarse como festivo');
// San Pedro y San Pablo (29 de junio de 2026) ya cae en lunes: no se traslada.
assert.ok(COLOMBIA_HOLIDAYS_2026.includes('2026-06-29'), 'San Pedro y San Pablo 2026 ya cae en lunes, no se traslada');
assert.ok(COLOMBIA_HOLIDAYS_2026.includes('2026-07-13'), 'Chiquinquirá 2026 debe trasladarse al lunes 13 de julio');
assert.equal(Object.isFrozen(COLOMBIA_HOLIDAYS_2026), true);

// ---------------------------------------------------------------------------
// 10. Bandas de score numérico y puntos máximos por eje (A50+B20+C15+D15=100)
// ---------------------------------------------------------------------------
assert.deepEqual(SCORE_BANDS, { ALTO_MIN: 80, MEDIO_MIN: 60 });
assert.deepEqual(AXIS_MAX_POINTS, { SERVICIO: 50, VALOR: 20, TERRITORIO: 15, TIEMPO: 15 });
assert.equal(
  AXIS_MAX_POINTS.SERVICIO + AXIS_MAX_POINTS.VALOR + AXIS_MAX_POINTS.TERRITORIO + AXIS_MAX_POINTS.TIEMPO,
  100,
  'la suma de los puntos máximos por eje debe ser exactamente 100',
);

// ---------------------------------------------------------------------------
// 11. Prioridad de impacto de razones (requisito 7), en grupos (empates explícitos)
// ---------------------------------------------------------------------------
assert.ok(Array.isArray(REASON_IMPACT_PRIORITY_GROUPS) && REASON_IMPACT_PRIORITY_GROUPS.length === 8);
assert.deepEqual(REASON_IMPACT_PRIORITY_GROUPS, [
  ['plazo_vencido', 'plazo_insuficiente'],
  ['servicio_ambiguo'],
  ['valor_ausente', 'valor_bajo_piso'],
  ['capacidad_financiera_por_validar'],
  ['plazo_ausente'],
  ['territorio_indeterminado'],
  ['cobertura_por_validar'],
  ['endeudamiento_por_validar', 'experiencia_por_validar'],
]);
// Ningún código de razón se repite entre grupos (el ranking debe ser determinístico y único)
const allPriorityCodes = REASON_IMPACT_PRIORITY_GROUPS.flat();
assert.equal(new Set(allPriorityCodes).size, allPriorityCodes.length, 'ningún código debe repetirse entre grupos de prioridad');
for (const group of REASON_IMPACT_PRIORITY_GROUPS) {
  assert.ok(Array.isArray(group) && group.length > 0);
}

console.log('tender-fit-v2-parameters: OK');
