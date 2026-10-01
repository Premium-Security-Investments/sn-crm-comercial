// Contrato RED (TDD) del eje C (Territorio) de tender-fit-v2.
// Evaluado a través de `evaluateTenderFit(tender, { nowIso })` completo; se extrae
// `reasons.filter(r => r.axis === 'territorio')` para inspeccionar la razón base y
// las razones adicionales (cobertura nacional).
import assert from 'node:assert/strict';
import { evaluateTenderFit } from '../tender-fit-policy.js';
import { TERRITORY_NATIONAL_COVERAGE_PHRASES } from '../tender-fit-v2-parameters.js';

const NOW = '2026-09-20T15:00:00.000Z';

function baseTender(o = {}) {
  return {
    title: 'Vigilancia armada', description: '', value: 500_000_000, deadline_at: '2026-12-31', ...o,
  };
}

function territorioReasons(result) {
  return result.reasons.filter(r => r.axis === 'territorio');
}
function baseTerritorioReason(result) {
  const reasons = territorioReasons(result);
  assert.ok(reasons.length >= 1, 'debe haber al menos una razón del eje territorio');
  return reasons[0];
}
function points(city, dept, extra = {}) {
  return baseTerritorioReason(evaluateTenderFit(baseTender({ city, dept, ...extra }), { nowIso: NOW })).points;
}

// ---------------------------------------------------------------------------
// 1. Ciudades exactas = 15
// ---------------------------------------------------------------------------
for (const city of ['Bogotá', 'Medellín', 'Cali', 'Pereira', 'Barranquilla']) {
  assert.equal(points(city, ''), 15, `${city} debe dar 15 puntos`);
}
// Normalización de mayúsculas/tildes
assert.equal(points('bogota', ''), 15, 'sin tilde y en minúsculas debe seguir dando 15');
assert.equal(points('BOGOTÁ', ''), 15, 'en mayúsculas debe seguir dando 15');
assert.equal(points('  Medellín  ', ''), 15, 'con espacios alrededor debe seguir dando 15');

// ---------------------------------------------------------------------------
// 2. Ciudades exactas = 10
// ---------------------------------------------------------------------------
for (const city of ['Cartagena', 'Manizales', 'Armenia']) {
  assert.equal(points(city, ''), 10, `${city} debe dar 10 puntos`);
}
assert.equal(points('cartagena', ''), 10);
assert.equal(points('MANIZALES', ''), 10);

// ---------------------------------------------------------------------------
// 3. Otros municipios de los 11 departamentos de foco = 5 (coincidencia exacta de
//    ciudad en la lista 15/10 nunca ocurre aquí: Soacha/Envigado/Palmira/
//    Dosquebradas NO están en esas listas, solo su departamento está en foco)
// ---------------------------------------------------------------------------
const MUNICIPALITY_IN_FOCUS_DEPT = [
  ['Soacha', 'Cundinamarca'],
  ['Envigado', 'Antioquia'],
  ['Palmira', 'Valle del Cauca'],
  ['Dosquebradas', 'Risaralda'],
];
for (const [city, dept] of MUNICIPALITY_IN_FOCUS_DEPT) {
  assert.equal(points(city, dept), 5, `${city}/${dept} debe dar 5 puntos (regla de municipio en departamento de foco)`);
}
// Las 11 departamentos de foco explícitos, con un municipio genérico desconocido en cada uno
for (const dept of [
  'Cundinamarca', 'Antioquia', 'Valle del Cauca', 'Risaralda', 'Caldas',
  'Quindío', 'Caquetá', 'Cauca', 'Huila', 'Nariño', 'Tolima',
]) {
  assert.equal(points('Municipio Genérico Desconocido', dept), 5, `departamento de foco ${dept} debe dar 5 puntos`);
}
// Normalización también aplica al departamento
assert.equal(points('Municipio X', 'valle del cauca'), 5, 'departamento sin tildes/minúsculas debe normalizar igual');

// ---------------------------------------------------------------------------
// 4. Exactitud de la regla de ciudad exacta: ninguna coincidencia parcial/contains
// ---------------------------------------------------------------------------
assert.notEqual(points('Bogotá D.C. Zona Norte', ''), 15, 'un string que contiene "Bogotá" pero no es exactamente la ciudad no debe dar 15 por contención');

// ---------------------------------------------------------------------------
// 5. Otra ciudad/departamento conocido pero fuera de foco = 0, sin brecha crítica
// ---------------------------------------------------------------------------
const confirmedOther = evaluateTenderFit(baseTender({ city: 'Leticia', dept: 'Amazonas' }), { nowIso: NOW });
assert.equal(baseTerritorioReason(confirmedOther).points, 0);
assert.equal(baseTerritorioReason(confirmedOther).critical, false, 'ubicación confirmada fuera de foco no es brecha crítica');

// ---------------------------------------------------------------------------
// 6. Ubicación ausente/no confiable = 0 + razón crítica territorio_indeterminado
// ---------------------------------------------------------------------------
for (const [city, dept] of [['', ''], [null, null], [undefined, undefined], ['   ', '   ']]) {
  const result = evaluateTenderFit(baseTender({ city, dept }), { nowIso: NOW });
  const reason = baseTerritorioReason(result);
  assert.equal(reason.points, 0, `ciudad/dept ${JSON.stringify([city, dept])} debe dar 0 puntos`);
  assert.equal(reason.code, 'territorio_indeterminado');
  assert.equal(reason.critical, true);
}

// ---------------------------------------------------------------------------
// 7. Cobertura nacional explícita: mantiene los puntos de ubicación pero agrega
//    una razón crítica adicional `cobertura_por_validar`.
// ---------------------------------------------------------------------------
function coverageReasons(result) {
  return territorioReasons(result).filter(r => r.code === 'cobertura_por_validar');
}

assert.ok(TERRITORY_NATIONAL_COVERAGE_PHRASES.length > 0);
const nationalCoveragePhrase = TERRITORY_NATIONAL_COVERAGE_PHRASES[0];
const nationalCoverageResult = evaluateTenderFit(
  baseTender({ title: `Servicio de vigilancia con ${nationalCoveragePhrase} para todas las sedes`, city: 'Bogotá', dept: 'Cundinamarca' }),
  { nowIso: NOW },
);
assert.equal(baseTerritorioReason(nationalCoverageResult).points, 15, 'cobertura nacional no debe cambiar los puntos de ubicación ya calculados (Bogotá=15)');
const coverageExtra = coverageReasons(nationalCoverageResult);
assert.equal(coverageExtra.length, 1, 'debe agregarse exactamente una razón de cobertura nacional');
assert.equal(coverageExtra[0].critical, true);

const noNationalCoverageResult = evaluateTenderFit(
  baseTender({ title: 'Servicio de vigilancia para una sede única', city: 'Bogotá', dept: 'Cundinamarca' }), { nowIso: NOW },
);
assert.deepEqual(coverageReasons(noNationalCoverageResult), [], 'sin lenguaje de cobertura nacional no debe agregarse la razón');

// Cobertura nacional combinada con ubicación ausente: la ubicación sigue en 0 +
// territorio_indeterminado, y además se agrega cobertura_por_validar (ambas razones coexisten).
const nationalCoverageNoLocation = evaluateTenderFit(
  baseTender({ title: `Servicio de vigilancia con ${nationalCoveragePhrase}`, city: '', dept: '' }), { nowIso: NOW },
);
assert.equal(baseTerritorioReason(nationalCoverageNoLocation).points, 0);
assert.equal(baseTerritorioReason(nationalCoverageNoLocation).code, 'territorio_indeterminado');
assert.equal(coverageReasons(nationalCoverageNoLocation).length, 1, 'cobertura nacional debe agregarse incluso sin ubicación reportada');

// ---------------------------------------------------------------------------
// 8. Totalidad: el resultado sigue devolviendo un objeto completo en todos los casos
// ---------------------------------------------------------------------------
for (const result of [confirmedOther, nationalCoverageResult, nationalCoverageNoLocation]) {
  assert.equal(typeof result.score, 'number');
  assert.equal(typeof result.band, 'string');
}

console.log('tender-fit-v2-territory-axis: OK');
