// Contrato autorizado de la fórmula de producción tender-fit-v2 para los ejes
// A. Servicio (alineado 1:1 con tender-service-matrix-v2) y B. Valor (piso +
// bandas SMMLV + límite de estimación + gaps de endeudamiento/experiencia).
// El contrato de score máximo 100 queda para otra porción de pruebas (fuera de
// alcance aquí).
//
// `tender-fit-policy.js` reporta TENDER_FIT_POLICY_VERSION 'tender-fit-v2' en
// producción, sin ningún campo `shadow` aditivo (ver sección 0 más abajo).
import assert from 'node:assert/strict';
import { TENDER_FIT_POLICY_VERSION, evaluateTenderFit } from '../tender-fit-policy.js';
import {
  SMMLV_2026,
  VALUE_FAMILY_FLOORS_SMMLV,
  VALUE_BAND_THRESHOLDS_SMMLV,
  VALUE_BAND_POINTS,
  CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP,
  CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE,
  CORPORATE_MAX_DEBT_RATIO,
  CORPORATE_EXPERIENCE_CAPACITY_SMMLV,
} from '../tender-fit-v2-parameters.js';

const NOW = '2026-09-20T15:00:00.000Z';

function tender(overrides = {}) {
  return {
    title: '', description: '', detail: '',
    value: 500_000_000, deadline_at: '2026-10-10', city: 'Bogotá', dept: 'Cundinamarca', category: 'Licitación pública',
    ...overrides,
  };
}

const axisReason = (result, axis) => result.reasons.find(r => r.axis === axis);
const criticalGapIds = result => result.data_gaps.filter(g => g.severity === 'critical').map(g => g.gap_id);

// ---------------------------------------------------------------------------
// 0. Versión v2 y ausencia de `shadow`
// ---------------------------------------------------------------------------
assert.equal(TENDER_FIT_POLICY_VERSION, 'tender-fit-v2');

const baseResult = evaluateTenderFit(
  tender({ title: 'Vigilancia armada con CCTV y control de acceso', value: 2_500_000_000 }),
  { nowIso: NOW },
);
assert.equal(baseResult.policy_version, 'tender-fit-v2');
assert.equal(
  Object.prototype.hasOwnProperty.call(baseResult, 'shadow'),
  false,
  'tender-fit-v2 es la versión de producción: ya no debe exponer el campo shadow aditivo de v1',
);
assert.equal(
  baseResult.reasons.map(r => r.axis).join(','),
  'servicio,valor,territorio,tiempo',
  'el eje de escala comercial se renombra a "valor" y el eje de ventana se renombra a "tiempo" en v2',
);

// ---------------------------------------------------------------------------
// A. Servicio: debe igualar exactamente tender-service-matrix-v2
// ---------------------------------------------------------------------------
const SERVICIO_CASES = [
  { title: 'Vigilancia armada con CCTV y control de acceso', points: 50, code: 'servicio_hibrida' },
  { title: 'Instalación de CCTV y control de acceso perimetral', points: 48, code: 'servicio_electronica' },
  { title: 'Contrato de vigilancia armada en sede principal', points: 45, code: 'servicio_fisica' },
  { title: 'Suministro e instalación de cámaras para sede principal', points: 40, code: 'servicio_suministro' },
  { title: 'Suministro de papelería', description: 'Oficina', points: 0, code: 'servicio_fuera_de_alcance' },
];
for (const { title, description = '', points, code } of SERVICIO_CASES) {
  const result = evaluateTenderFit(tender({ title, description }), { nowIso: NOW });
  const servicio = axisReason(result, 'servicio');
  assert.equal(servicio.points, points, `servicio points para "${title}" debe coincidir con tender-service-matrix-v2`);
  assert.equal(servicio.code, code, `servicio code para "${title}"`);
}

// Ambigua confirmada (AMBIGUA/POR_VALIDAR en la matriz v2) = 30 puntos y
// genera una brecha crítica de Por validar (no solo un puntaje bajo). El
// código de razón base y el gap_id crítico correspondiente comparten el
// mismo código canónico `servicio_ambiguo`.
const ambiguaResult = evaluateTenderFit(tender({ title: 'Servicio de escolta con armas 24 horas' }), { nowIso: NOW });
const servicioAmbigua = axisReason(ambiguaResult, 'servicio');
assert.equal(servicioAmbigua.points, 30);
assert.equal(servicioAmbigua.code, 'servicio_ambiguo');
assert.ok(
  criticalGapIds(ambiguaResult).includes('servicio_ambiguo'),
  'una familia AMBIGUA/POR_VALIDAR en el eje servicio debe producir una brecha crítica de Por validar con el mismo código servicio_ambiguo',
);
assert.equal(ambiguaResult.band, 'por_validar');

// ---------------------------------------------------------------------------
// B. Valor: forma de los parámetros autorizados (fuente única de verdad:
//    tender-fit-v2-parameters.js, importado directamente por nombre).
// ---------------------------------------------------------------------------
assert.equal(SMMLV_2026.year, 2026);
assert.equal(SMMLV_2026.value_cop, 1_750_905, 'SMMLV 2026 en COP');
assert.equal(typeof SMMLV_2026.source, 'string');
assert.ok(SMMLV_2026.source.trim().length > 0, 'SMMLV_2026.source debe documentar de dónde sale el valor');
assert.equal(typeof SMMLV_2026.norm, 'string');
assert.ok(SMMLV_2026.norm.trim().length > 0, 'SMMLV_2026.norm debe documentar la norma que fija el valor');
assert.equal(typeof SMMLV_2026.status, 'string');
assert.ok(SMMLV_2026.status.trim().length > 0, 'SMMLV_2026.status debe documentar el estado (p.ej. oficial/proyectado)');

assert.deepEqual(
  VALUE_FAMILY_FLOORS_SMMLV,
  { HIBRIDA: 170, FISICA: 170, ELECTRONICA: 60, SUMINISTRO: 30 },
  'pisos por familia en múltiplos de SMMLV',
);

assert.deepEqual(VALUE_BAND_THRESHOLDS_SMMLV, { TIER_1_MAX: 290, TIER_2_MAX: 1150, TIER_3_MAX: 5700 });
assert.deepEqual(VALUE_BAND_POINTS, { TIER_1: 6, TIER_2: 12, TIER_3: 17, TIER_4: 20 });

assert.equal(CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP, 45_535_037_196, 'límite de estimación en COP');
assert.equal(CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE, 0.25, 'el límite de estimación asume un 25% (decimal)');
assert.equal(CORPORATE_MAX_DEBT_RATIO, 0.5056, 'límite de endeudamiento corporativo de referencia');
assert.equal(CORPORATE_EXPERIENCE_CAPACITY_SMMLV, 136565.79, 'umbral de experiencia requerida en múltiplos de SMMLV');

// ---------------------------------------------------------------------------
// B. Valor: comportamiento, leyendo los umbrales/pisos/bandas del módulo de
//    parámetros importado (no se hardcodean montos salvo los exigidos
//    arriba como contrato de parámetros).
// ---------------------------------------------------------------------------
const SMMLV_COP = SMMLV_2026.value_cop;
const FLOORS = VALUE_FAMILY_FLOORS_SMMLV;

const FISICA_TITLE = 'Contrato de vigilancia armada en sede principal';
function fisicaTender(overrides = {}) {
  return tender({ title: FISICA_TITLE, ...overrides });
}

const floorFisicaCop = FLOORS.FISICA * SMMLV_COP;
const band1MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_1_MAX * SMMLV_COP;
const band2MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_2_MAX * SMMLV_COP;
const band3MaxCop = VALUE_BAND_THRESHOLDS_SMMLV.TIER_3_MAX * SMMLV_COP;

// Debajo del piso de familia -> 0 puntos y brecha crítica de Por validar,
// con el mismo código canónico `valor_bajo_piso` en la razón y en el gap.
const bajoPiso = evaluateTenderFit(fisicaTender({ value: floorFisicaCop - 1 }), { nowIso: NOW });
assert.equal(axisReason(bajoPiso, 'valor').points, 0);
assert.equal(axisReason(bajoPiso, 'valor').code, 'valor_bajo_piso');
assert.ok(criticalGapIds(bajoPiso).includes('valor_bajo_piso'));

// Recorrido de bandas desde el piso de familia hacia arriba (nunca baja una vez alcanzada una banda superior).
const BANDAS_FISICA = [
  [floorFisicaCop, VALUE_BAND_POINTS.TIER_1],
  [band1MaxCop - 1, VALUE_BAND_POINTS.TIER_1],
  [band1MaxCop, VALUE_BAND_POINTS.TIER_2],
  [band2MaxCop - 1, VALUE_BAND_POINTS.TIER_2],
  [band2MaxCop, VALUE_BAND_POINTS.TIER_3],
  [band3MaxCop - 1, VALUE_BAND_POINTS.TIER_3],
  [band3MaxCop, VALUE_BAND_POINTS.TIER_4],
  [band3MaxCop * 100, VALUE_BAND_POINTS.TIER_4],
];
for (const [value, expectedPoints] of BANDAS_FISICA) {
  const result = evaluateTenderFit(fisicaTender({ value }), { nowIso: NOW });
  assert.equal(axisReason(result, 'valor').points, expectedPoints, `valor COP ${value} (FISICA) -> ${expectedPoints}`);
}

// Valor ausente o no positivo -> 0 puntos y brecha crítica de Por validar
// (mismo código canónico `valor_ausente`), para cualquier familia.
for (const value of [undefined, 0, -1]) {
  const result = evaluateTenderFit(fisicaTender({ value }), { nowIso: NOW });
  assert.equal(axisReason(result, 'valor').points, 0, `valor ${value} debe dar 0 puntos`);
  assert.equal(axisReason(result, 'valor').code, 'valor_ausente');
  assert.ok(criticalGapIds(result).includes('valor_ausente'));
}

// Cada familia tiene su propio piso: ELECTRONICA (60) y SUMINISTRO (30) deben diferir de FISICA/HIBRIDA (170).
const ELECTRONICA_TITLE = 'Instalación de CCTV y control de acceso perimetral';
const floorElectronicaCop = FLOORS.ELECTRONICA * SMMLV_COP;
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: ELECTRONICA_TITLE, value: floorElectronicaCop - 1 }), { nowIso: NOW }), 'valor').points,
  0,
);
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: ELECTRONICA_TITLE, value: floorElectronicaCop }), { nowIso: NOW }), 'valor').points,
  VALUE_BAND_POINTS.TIER_1,
);

const SUMINISTRO_TITLE = 'Suministro e instalación de cámaras para sede principal';
const floorSuministroCop = FLOORS.SUMINISTRO * SMMLV_COP;
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: SUMINISTRO_TITLE, value: floorSuministroCop - 1 }), { nowIso: NOW }), 'valor').points,
  0,
);
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: SUMINISTRO_TITLE, value: floorSuministroCop }), { nowIso: NOW }), 'valor').points,
  VALUE_BAND_POINTS.TIER_1,
);

const HIBRIDA_TITLE = 'Vigilancia armada con CCTV y control de acceso';
const floorHibridaCop = FLOORS.HIBRIDA * SMMLV_COP;
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: HIBRIDA_TITLE, value: floorHibridaCop - 1 }), { nowIso: NOW }), 'valor').points,
  0,
);
assert.equal(
  axisReason(evaluateTenderFit(tender({ title: HIBRIDA_TITLE, value: floorHibridaCop }), { nowIso: NOW }), 'valor').points,
  VALUE_BAND_POINTS.TIER_1,
);

// Por encima del límite de estimación: los puntos de B se quedan en el tope (20, nunca bajan)
// y se añade una brecha crítica de Por validar (mismo código canónico
// `capacidad_financiera_por_validar`) cuyo detalle incluye el monto y el supuesto del 25%.
const sobreLimiteCop = CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP + 1;
const sobreLimite = evaluateTenderFit(fisicaTender({ value: sobreLimiteCop }), { nowIso: NOW });
assert.equal(
  axisReason(sobreLimite, 'valor').points,
  VALUE_BAND_POINTS.TIER_4,
  'por encima del límite de estimación, B se mantiene en el tope de banda, nunca baja',
);
const limiteGap = sobreLimite.data_gaps.find(g => g.gap_id === 'capacidad_financiera_por_validar');
assert.ok(limiteGap, 'debe añadirse una brecha crítica de Por validar cuando el valor supera el límite de estimación');
assert.equal(limiteGap.severity, 'critical');
assert.ok(
  limiteGap.detail.includes(String(CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP)),
  'el detalle de la brecha debe incluir el monto del límite de estimación',
);
assert.ok(limiteGap.detail.includes('25%'), 'el detalle de la brecha debe incluir el supuesto del 25%');

// Límite explícito de endeudamiento (required_max_debt_ratio) por debajo del corporativo y
// experiencia requerida por encima del umbral: cada uno añade su propia brecha crítica de
// Por validar (endeudamiento_por_validar / experiencia_por_validar) pero ninguno altera los
// puntos de B.
const puntosBase = axisReason(evaluateTenderFit(fisicaTender({ value: band2MaxCop }), { nowIso: NOW }), 'valor').points;

const deudaInsuficiente = evaluateTenderFit(
  fisicaTender({ value: band2MaxCop, required_max_debt_ratio: CORPORATE_MAX_DEBT_RATIO - 0.01 }),
  { nowIso: NOW },
);
assert.equal(axisReason(deudaInsuficiente, 'valor').points, puntosBase, 'un límite de endeudamiento explícito no debe alterar los puntos de B');
assert.ok(criticalGapIds(deudaInsuficiente).includes('endeudamiento_por_validar'));

const deudaSuficiente = evaluateTenderFit(
  fisicaTender({ value: band2MaxCop, required_max_debt_ratio: CORPORATE_MAX_DEBT_RATIO }),
  { nowIso: NOW },
);
assert.ok(
  !criticalGapIds(deudaSuficiente).includes('endeudamiento_por_validar'),
  'un límite de endeudamiento igual o superior al corporativo no debe generar esta brecha',
);

const experienciaExcesiva = evaluateTenderFit(
  fisicaTender({ value: band2MaxCop, required_experience_smmlv: CORPORATE_EXPERIENCE_CAPACITY_SMMLV + 1 }),
  { nowIso: NOW },
);
assert.equal(axisReason(experienciaExcesiva, 'valor').points, puntosBase, 'una experiencia requerida excesiva no debe alterar los puntos de B');
assert.ok(criticalGapIds(experienciaExcesiva).includes('experiencia_por_validar'));

const experienciaDentroDeUmbral = evaluateTenderFit(
  fisicaTender({ value: band2MaxCop, required_experience_smmlv: CORPORATE_EXPERIENCE_CAPACITY_SMMLV }),
  { nowIso: NOW },
);
assert.ok(
  !criticalGapIds(experienciaDentroDeUmbral).includes('experiencia_por_validar'),
  'una experiencia requerida igual al umbral no debe generar esta brecha',
);

console.log('tender-fit-policy-v2-service-value: OK');
