// Contrato RED (TDD) del eje B (Valor) de tender-fit-v2, basado en SMMLV y en el
// piso por familia de servicio resuelta por el eje A (tender-service-matrix-v2.js).
//
// Supuestos de campos de entrada de `tender` asumidos por este contrato (no existen
// hoy, se fijan aquí porque no existe otro documento que los defina):
//   - `tender.required_max_debt_ratio` (number, opcional): nivel máximo de
//     endeudamiento exigido por el proceso a los proponentes.
//   - `tender.required_experience_smmlv` (number, opcional): experiencia específica
//     requerida, expresada en SMMLV.
//
// El eje se evalúa a través de `evaluateTenderFit(tender, { nowIso })` completo
// (no se exige una función de eje aislada); se extrae `reasons.filter(r => r.axis
// === 'valor')` para inspeccionar la razón base y las razones adicionales opcionales.
import assert from 'node:assert/strict';
import { evaluateTenderFit } from '../tender-fit-policy.js';
import {
  SMMLV_2026,
  VALUE_FAMILY_FLOORS_SMMLV,
  CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP,
  CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE,
  CORPORATE_MAX_DEBT_RATIO,
  CORPORATE_EXPERIENCE_CAPACITY_SMMLV,
} from '../tender-fit-v2-parameters.js';

const NOW = '2026-09-20T15:00:00.000Z';
const SMMLV = SMMLV_2026.value_cop;

function floorCop(family) {
  return VALUE_FAMILY_FLOORS_SMMLV[family] * SMMLV;
}

// Títulos que anclan cada familia de forma inequívoca contra TENDER_SERVICE_MATRIX_V2
// (ver tests/tender-service-matrix-v2.test.mjs, sección 2).
const TITLE_BY_FAMILY = {
  FISICA: 'Contrato de vigilancia armada en sede principal',
  ELECTRONICA: 'Instalación de CCTV y control de acceso perimetral',
  SUMINISTRO: 'Suministro e instalación de cámaras para sede principal',
  HIBRIDA: 'Vigilancia armada con CCTV y control de acceso',
};

function baseTender(family, o = {}) {
  return {
    title: TITLE_BY_FAMILY[family], description: '', deadline_at: '2026-12-31',
    city: 'Bogotá', dept: 'Cundinamarca', ...o,
  };
}

function valorReasons(result) {
  return result.reasons.filter(r => r.axis === 'valor');
}
function baseValorReason(result) {
  const reasons = valorReasons(result);
  assert.ok(reasons.length >= 1, 'debe haber al menos una razón del eje valor');
  return reasons[0];
}

// ---------------------------------------------------------------------------
// 1. Valor ausente o no positivo: 0 puntos + razón crítica valor_ausente
// ---------------------------------------------------------------------------
for (const value of [undefined, null, 0, -1]) {
  const result = evaluateTenderFit(baseTender('FISICA', { value }), { nowIso: NOW });
  const reason = baseValorReason(result);
  assert.equal(reason.points, 0, `valor ${value} debe dar 0 puntos`);
  assert.equal(reason.code, 'valor_ausente');
  assert.equal(reason.critical, true);
}

// ---------------------------------------------------------------------------
// 2. Por debajo del piso de familia: 0 puntos + razón crítica valor_bajo_piso
// ---------------------------------------------------------------------------
for (const family of ['FISICA', 'ELECTRONICA', 'SUMINISTRO']) {
  const belowFloor = floorCop(family) - 1;
  const result = evaluateTenderFit(baseTender(family, { value: belowFloor }), { nowIso: NOW });
  const reason = baseValorReason(result);
  assert.equal(reason.points, 0, `${family}: 1 COP por debajo del piso debe dar 0 puntos`);
  assert.equal(reason.code, 'valor_bajo_piso');
  assert.equal(reason.critical, true);
}

// ---------------------------------------------------------------------------
// 3. Bandas desde el piso de familia: 6 / 12 / 17 / 20, nunca cae por encima
// ---------------------------------------------------------------------------
const TIER1_MAX_SMMLV = 290;
const TIER2_MAX_SMMLV = 1150;
const TIER3_MAX_SMMLV = 5700;

function atFloor(family) { return floorCop(family); }
function atSmmlv(multiple) { return Math.round(multiple * SMMLV); }

for (const family of ['FISICA', 'ELECTRONICA', 'SUMINISTRO', 'HIBRIDA']) {
  const floor = family === 'HIBRIDA' ? floorCop('HIBRIDA') : atFloor(family);
  // Exactamente en el piso -> primer nivel (6 puntos)
  const atFloorResult = evaluateTenderFit(baseTender(family, { value: floor }), { nowIso: NOW });
  assert.equal(baseValorReason(atFloorResult).points, 6, `${family}: justo en el piso debe dar 6 puntos`);
  assert.equal(baseValorReason(atFloorResult).critical, false, `${family}: en el piso ya no es brecha crítica`);
}

// Fronteras de banda usando FISICA (piso 170 SMMLV) como familia de referencia
const just_below_290 = atSmmlv(TIER1_MAX_SMMLV) - 1;
const at_290 = atSmmlv(TIER1_MAX_SMMLV);
const just_below_1150 = atSmmlv(TIER2_MAX_SMMLV) - 1;
const at_1150 = atSmmlv(TIER2_MAX_SMMLV);
const just_below_5700 = atSmmlv(TIER3_MAX_SMMLV) - 1;
const at_5700 = atSmmlv(TIER3_MAX_SMMLV);

for (const [value, points, label] of [
  [just_below_290, 6, 'justo bajo 290 SMMLV'],
  [at_290, 12, 'exactamente 290 SMMLV'],
  [just_below_1150, 12, 'justo bajo 1150 SMMLV'],
  [at_1150, 17, 'exactamente 1150 SMMLV'],
  [just_below_5700, 17, 'justo bajo 5700 SMMLV'],
  [at_5700, 20, 'exactamente 5700 SMMLV'],
]) {
  const result = evaluateTenderFit(baseTender('FISICA', { value }), { nowIso: NOW });
  assert.equal(baseValorReason(result).points, points, `FISICA ${label} -> ${points}`);
}

// Muy por encima de 5700 SMMLV: sigue en 20, nunca cae (a diferencia de tender-fit-v1)
const veryHigh = atSmmlv(50_000);
const veryHighResult = evaluateTenderFit(baseTender('FISICA', { value: veryHigh }), { nowIso: NOW });
assert.equal(baseValorReason(veryHighResult).points, 20, 'valores muy altos nunca deben caer por debajo de 20 puntos');

// ---------------------------------------------------------------------------
// 4. Capacidad financiera: por encima de COP 45.535.037.196 sigue en 20 puntos,
//    pero agrega una razón crítica adicional con el monto y el supuesto del 25%.
// ---------------------------------------------------------------------------
function capacityReasons(result) {
  return valorReasons(result).filter(r => r.code === 'capacidad_financiera_por_validar');
}

const belowCapacityThreshold = evaluateTenderFit(
  baseTender('FISICA', { value: CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP - 1 }), { nowIso: NOW },
);
assert.equal(baseValorReason(belowCapacityThreshold).points, 20);
assert.deepEqual(capacityReasons(belowCapacityThreshold), [], 'por debajo del umbral no debe agregarse la razón de capacidad financiera');

const aboveCapacityThreshold = evaluateTenderFit(
  baseTender('FISICA', { value: CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP + 1 }), { nowIso: NOW },
);
assert.equal(baseValorReason(aboveCapacityThreshold).points, 20, 'por encima del umbral de capacidad financiera los puntos del eje valor se mantienen en 20');
const capacityExtra = capacityReasons(aboveCapacityThreshold);
assert.equal(capacityExtra.length, 1, 'debe agregarse exactamente una razón de capacidad financiera');
assert.equal(capacityExtra[0].critical, true);
assert.match(capacityExtra[0].detail, new RegExp(String(CAPACITY_FINANCIAL_REVIEW_THRESHOLD_COP)), 'el detalle debe incluir el monto del umbral');
assert.match(capacityExtra[0].detail, /25\s?%/, 'el detalle debe incluir el supuesto del 25%');
assert.equal(CAPACITY_FINANCIAL_ASSUMED_PERCENTAGE, 0.25);
// No oculta ni cambia el band numérico por sí sola (no hay lógica de ocultar candidatas aquí)
assert.notEqual(aboveCapacityThreshold, undefined);

// ---------------------------------------------------------------------------
// 5. Endeudamiento opcional explícito por debajo del corporativo (0.5056):
//    razón crítica adicional con ambos valores; no cambia puntos ni oculta la fila.
// ---------------------------------------------------------------------------
function debtReasons(result) {
  return valorReasons(result).filter(r => r.code === 'endeudamiento_por_validar');
}

const lowerDebtLimit = evaluateTenderFit(
  baseTender('FISICA', { value: atFloor('FISICA'), required_max_debt_ratio: 0.3 }), { nowIso: NOW },
);
const lowerDebtExtra = debtReasons(lowerDebtLimit);
assert.equal(lowerDebtExtra.length, 1, 'límite de endeudamiento explícitamente más bajo que el corporativo debe agregar la razón');
assert.equal(lowerDebtExtra[0].critical, true);
assert.match(lowerDebtExtra[0].detail, /0\.3\b/, 'el detalle debe incluir el valor del proceso (0.3)');
assert.match(lowerDebtExtra[0].detail, new RegExp(String(CORPORATE_MAX_DEBT_RATIO).replace('.', '\\.')), 'el detalle debe incluir el valor corporativo (0.5056)');
assert.equal(baseValorReason(lowerDebtLimit).points, 6, 'el endeudamiento opcional no debe cambiar los puntos del eje valor');

const higherDebtLimit = evaluateTenderFit(
  baseTender('FISICA', { value: atFloor('FISICA'), required_max_debt_ratio: 0.6 }), { nowIso: NOW },
);
assert.deepEqual(debtReasons(higherDebtLimit), [], 'límite de endeudamiento más alto (no restrictivo) no debe agregar la razón');

const noDebtField = evaluateTenderFit(baseTender('FISICA', { value: atFloor('FISICA') }), { nowIso: NOW });
assert.deepEqual(debtReasons(noDebtField), [], 'sin el campo opcional no debe agregarse la razón de endeudamiento');

// ---------------------------------------------------------------------------
// 6. Experiencia requerida opcional (SMMLV) por encima de 136565.79: razón
//    crítica adicional con ambos valores; no cambia puntos ni oculta la fila.
// ---------------------------------------------------------------------------
function experienceReasons(result) {
  return valorReasons(result).filter(r => r.code === 'experiencia_por_validar');
}

const higherExperienceRequirement = evaluateTenderFit(
  baseTender('FISICA', { value: atFloor('FISICA'), required_experience_smmlv: 150000 }), { nowIso: NOW },
);
const experienceExtra = experienceReasons(higherExperienceRequirement);
assert.equal(experienceExtra.length, 1, 'experiencia requerida por encima de la capacidad corporativa debe agregar la razón');
assert.equal(experienceExtra[0].critical, true);
assert.match(experienceExtra[0].detail, /150000\b|150[.,]000\b/, 'el detalle debe incluir el valor del proceso (150000)');
assert.match(experienceExtra[0].detail, /136565\.79/, 'el detalle debe incluir el valor corporativo (136565.79)');
assert.equal(baseValorReason(higherExperienceRequirement).points, 6, 'la experiencia opcional no debe cambiar los puntos del eje valor');

const lowerExperienceRequirement = evaluateTenderFit(
  baseTender('FISICA', { value: atFloor('FISICA'), required_experience_smmlv: 100000 }), { nowIso: NOW },
);
assert.deepEqual(experienceReasons(lowerExperienceRequirement), [], 'experiencia requerida por debajo de la capacidad corporativa no debe agregar la razón');

const noExperienceField = evaluateTenderFit(baseTender('FISICA', { value: atFloor('FISICA') }), { nowIso: NOW });
assert.deepEqual(experienceReasons(noExperienceField), [], 'sin el campo opcional no debe agregarse la razón de experiencia');
assert.equal(CORPORATE_EXPERIENCE_CAPACITY_SMMLV, 136565.79);

// ---------------------------------------------------------------------------
// 7. Ninguna de las dos banderas opcionales oculta la fila ni cambia el band
//    por sí sola de forma impredecible: el resultado completo sigue existiendo
//    y sigue siendo un objeto con score/band/reasons (contrato de totalidad).
// ---------------------------------------------------------------------------
for (const result of [lowerDebtLimit, higherExperienceRequirement, aboveCapacityThreshold]) {
  assert.equal(typeof result.score, 'number');
  assert.equal(typeof result.band, 'string');
  assert.ok(Array.isArray(result.reasons));
}

console.log('tender-fit-v2-value-axis: OK');
