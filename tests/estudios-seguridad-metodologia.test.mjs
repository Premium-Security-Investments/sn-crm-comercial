// Estudios de Seguridad Física — metodología oficial v1 (decisión de Juan, 2026-11-04).
//
// La prueba dorada es la matriz de Cancha Horizontes (CANCHA_HORIZONTES_MATRIZ_RIESGOS_2026.xlsx, sha256
// 6f1ef67c…e206d): con la metodología histórica, los 25 riesgos tienen que dar exactamente lo que el Excel trae
// escrito. Con la v1 cambia sólo el nombre del nivel, porque el Excel tiene un solo impacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  METODOLOGIA_V1,
  MATRIZ_HISTORICA,
  MATRIZ_HISTORICA_CONTROL_DOBLE,
  efectividadControl,
  nivelDeMagnitud,
  riesgoDesdeMatrizHistorica,
  valorarRiesgo,
} from '../verticales/estudios-seguridad/metodologia.js';

// [código, P, I, P actual, magnitud actual, nivel actual, P residual, magnitud residual, nivel residual], tal como
// están en HOJA DE TRABAJO filas 3 a 27. Los 25 tienen control actual 2/2/2 y propuesto 4/4/4.
const CANCHA_HORIZONTES = [
  ['R1', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R2', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R3', 4, 3, 4, 12, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R4', 2, 2, 2, 4, 'ACEPTABLE', 1, 2, 'ACEPTABLE'],
  ['R5', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R6', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R7', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R8', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R9', 4, 3, 4, 12, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R10', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R11', 4, 3, 4, 12, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R12', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R13', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R14', 4, 3, 4, 12, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R15', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R16', 4, 3, 4, 12, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R17', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R18', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R19', 3, 2, 3, 6, 'ACEPTABLE', 2, 4, 'ACEPTABLE'],
  ['R20', 2, 2, 2, 4, 'ACEPTABLE', 1, 2, 'ACEPTABLE'],
  ['R21', 4, 4, 4, 16, 'INACEPTABLE', 2, 8, 'TOLERABLE'],
  ['R22', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R23', 3, 4, 3, 12, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R24', 3, 2, 3, 6, 'ACEPTABLE', 2, 4, 'ACEPTABLE'],
  ['R25', 3, 3, 3, 9, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
];
const ACTUAL = { calidad: 2, eficacia: 2, eficiencia: 2 };
const PROPUESTO = { calidad: 4, eficacia: 4, eficiencia: 4 };

test('la metodología histórica reproduce los 25 riesgos de Cancha Horizontes', () => {
  for (const [codigo, p, i, pActual, mActual, nActual, pResidual, mResidual, nResidual] of CANCHA_HORIZONTES) {
    const v = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: p, impacto: i, controlActual: ACTUAL, controlPropuesto: PROPUESTO }), MATRIZ_HISTORICA);
    assert.deepEqual(
      [v.actual.probabilidad, v.actual.magnitud, v.actual.nivel, v.residual.probabilidad, v.residual.magnitud, v.residual.nivel],
      [pActual, mActual, nActual.toLowerCase(), pResidual, mResidual, nResidual.toLowerCase()],
      codigo,
    );
  }
});

test('con la v1 Cancha Horizontes conserva las magnitudes y cambia sólo el nombre del nivel', () => {
  const r21 = CANCHA_HORIZONTES.find(([codigo]) => codigo === 'R21');
  const v = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: r21[1], impacto: r21[2], controlActual: ACTUAL, controlPropuesto: PROPUESTO }));
  assert.equal(v.metodologia, 'instalaciones-fisicas-v1');
  assert.deepEqual([v.actual.magnitud, v.actual.nivel, v.residual.magnitud, v.residual.nivel], [16, 'critico', 8, 'moderado']);

  for (const [codigo, p, i, , mActual, , , mResidual] of CANCHA_HORIZONTES) {
    const v1 = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: p, impacto: i, controlActual: ACTUAL, controlPropuesto: PROPUESTO }));
    assert.deepEqual([v1.actual.magnitud, v1.residual.magnitud], [mActual, mResidual], codigo);
  }
});

test('el impacto que cuenta es el mayor entre empresa y personas', () => {
  const v = valorarRiesgo({ probabilidad: 3, impactoEmpresa: 2, impactoPersonas: 5, controlActual: null, controlPropuesto: null });
  assert.equal(v.impacto, 5);
  assert.deepEqual(v.inherente, { magnitud: 15, nivel: 'alto' });
  assert.equal(v.residual.magnitud, 15, 'sin controles el residual es el inherente');
});

test('ningún control elimina el riesgo: tope de 0,9 en la v1', () => {
  const perfecto = { calidad: 5, eficacia: 5, eficiencia: 5 };
  assert.equal(efectividadControl(perfecto), 0.9);
  assert.equal(efectividadControl(perfecto, MATRIZ_HISTORICA), 1);
  const v = valorarRiesgo({ probabilidad: 5, impactoEmpresa: 5, impactoPersonas: 5, controlActual: perfecto, controlPropuesto: perfecto });
  assert.equal(v.actual.probabilidad, 1);
  assert.equal(v.residual.probabilidad, 1, 'la probabilidad nunca baja de 1');
  assert.deepEqual(v.residual, { probabilidad: 1, efectividadControl: 0.9, magnitud: 5, nivel: 'bajo' });
});

test('los cuatro niveles de la v1 tienen sus límites en 5, 10, 15 y 25', () => {
  assert.deepEqual([1, 5, 6, 10, 11, 15, 16, 25].map(m => nivelDeMagnitud(m)),
    ['bajo', 'bajo', 'moderado', 'moderado', 'alto', 'alto', 'critico', 'critico']);
  assert.equal(METODOLOGIA_V1.niveles.length, 4);
  assert.ok(Object.isFrozen(METODOLOGIA_V1) && Object.isFrozen(METODOLOGIA_V1.niveles[0]));
});

// Los dos estudios reales que Juan compartió el 2026-11-04 (MATRIZ_HADA_COMPLETA_7.0.xlsx, sha256 50f6e03f…603f, y
// EXCO_COLOMBIANA_SEPT._2026_2.0.xls, sha256 4d945977…bb7). [código, P, I, control actual, control propuesto,
// P actual, magnitud actual, nivel actual, P residual, magnitud residual, nivel residual], de HOJA DE TRABAJO.
const HADA = [
  ['R1', 3, 4, [3, 3, 3], [5, 5, 4], 3, 10, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R2', 3, 3, [3, 3, 3], [5, 4, 4], 3, 8, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R3', 3, 3, [3, 3, 3], [5, 4, 4], 3, 8, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R4', 4, 4, [3, 4, 3], [4, 4, 4], 3, 9, 'TOLERABLE', 2, 8, 'TOLERABLE'],
  ['R5', 4, 5, [3, 3, 3], [5, 5, 4], 4, 16, 'INACEPTABLE', 1, 5, 'ACEPTABLE'],
  ['R6', 4, 4, [3, 3, 4], [4, 5, 5], 3, 9, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R7', 4, 3, [3, 3, 3], [5, 4, 4], 4, 10, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R8', 2, 5, [3, 4, 4], [5, 5, 4], 2, 7, 'TOLERABLE', 1, 5, 'ACEPTABLE'],
  ['R9', 2, 5, [4, 3, 4], [5, 5, 4], 2, 7, 'TOLERABLE', 1, 5, 'ACEPTABLE'],
  ['R10', 3, 3, [4, 4, 4], [5, 5, 4], 2, 3, 'ACEPTABLE', 1, 3, 'ACEPTABLE'],
  ['R11', 3, 2, [4, 4, 4], [5, 5, 4], 2, 2, 'ACEPTABLE', 1, 2, 'ACEPTABLE'],
  ['R12', 4, 5, [3, 3, 3], [5, 5, 4], 4, 16, 'INACEPTABLE', 1, 5, 'ACEPTABLE'],
  ['R13', 4, 4, [3, 3, 4], [5, 5, 4], 3, 9, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R14', 3, 4, [3, 3, 3], [5, 5, 4], 3, 10, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R15', 4, 3, [4, 4, 4], [4, 4, 4], 2, 3, 'ACEPTABLE', 1, 3, 'ACEPTABLE'],
  ['R16', 4, 3, [4, 4, 4], [5, 5, 4], 2, 3, 'ACEPTABLE', 1, 3, 'ACEPTABLE'],
  ['R17', 3, 4, [3, 3, 3], [5, 4, 5], 3, 10, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R18', 4, 4, [3, 3, 3], [5, 5, 4], 4, 13, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R19', 4, 3, [3, 3, 3], [4, 5, 5], 4, 10, 'TOLERABLE', 1, 3, 'ACEPTABLE'],
  ['R20', 3, 4, [4, 3, 3], [4, 5, 5], 3, 9, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R21', 3, 5, [3, 4, 4], [5, 5, 4], 2, 7, 'TOLERABLE', 1, 5, 'ACEPTABLE'],
  ['R22', 5, 3, [3, 3, 3], [4, 4, 4], 4, 10, 'TOLERABLE', 2, 6, 'ACEPTABLE'],
  ['R23', 3, 3, [4, 4, 4], [5, 5, 4], 2, 3, 'ACEPTABLE', 1, 3, 'ACEPTABLE'],
];
// R3 queda fuera a propósito: ver la prueba de abajo.
const EXCO = [
  ['R1', 4, 4, [4, 4, 3], [5, 5, 4], 3, 8, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R2', 4, 4, [4, 4, 4], [5, 5, 4], 2, 4, 'ACEPTABLE', 1, 4, 'ACEPTABLE'],
  ['R4', 4, 4, [4, 3, 3], [5, 5, 4], 3, 9, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R5', 4, 4, [1, 1, 1], [4, 4, 4], 4, 16, 'INACEPTABLE', 2, 8, 'TOLERABLE'],
  ['R6', 4, 4, [4, 4, 3], [5, 5, 4], 3, 8, 'TOLERABLE', 1, 4, 'ACEPTABLE'],
  ['R7', 4, 5, [4, 4, 3], [5, 5, 4], 3, 10, 'TOLERABLE', 1, 5, 'ACEPTABLE'],
];
const control = ([calidad, eficacia, eficiencia]) => ({ calidad, eficacia, eficiencia });

test('la variante con control doble reproduce los estudios reales de HADA (23) y EXCO (6)', () => {
  for (const [codigo, p, i, ca, cp, pActual, mActual, nActual, pResidual, mResidual, nResidual] of [...HADA, ...EXCO]) {
    const v = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: p, impacto: i, controlActual: control(ca), controlPropuesto: control(cp) }), MATRIZ_HISTORICA_CONTROL_DOBLE);
    assert.deepEqual(
      [v.actual.probabilidad, v.actual.magnitud, v.actual.nivel, v.residual.probabilidad, v.residual.magnitud, v.residual.nivel],
      [pActual, mActual, nActual.toLowerCase(), pResidual, mResidual, nResidual.toLowerCase()],
      codigo,
    );
  }
});

test('EXCO R3: la probabilidad actual se tecleó encima de la fórmula y sube por encima de la inherente', () => {
  // El Excel trae P 4 → P actual 5 y magnitud 16 inaceptable. Un control no puede subir la probabilidad: con su
  // propia fórmula da 4 y 13 tolerable. Es justo lo que el importador tiene que avisar.
  const v = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: 4, impacto: 4, controlActual: control([3, 3, 3]), controlPropuesto: control([5, 4, 4]) }), MATRIZ_HISTORICA_CONTROL_DOBLE);
  assert.deepEqual([v.actual.probabilidad, v.actual.magnitud, v.actual.nivel], [4, 13, 'tolerable']);
});

test('la v1 no descuenta el control dos veces: el riesgo actual de HADA sube y el residual no cambia', () => {
  let criticos = 0;
  for (const [codigo, p, i, ca, cp, , mActual, , , mResidual] of HADA) {
    const v1 = valorarRiesgo(riesgoDesdeMatrizHistorica({ probabilidad: p, impacto: i, controlActual: control(ca), controlPropuesto: control(cp) }));
    assert.ok(v1.actual.magnitud >= mActual, codigo);
    assert.equal(v1.residual.magnitud, mResidual, codigo);
    if (v1.actual.nivel === 'critico') criticos += 1;
  }
  assert.equal(criticos, 3, 'R5, R12 y R18; el Excel sólo marca inaceptables R5 y R12');
});

test('rechaza calificaciones fuera de la escala de 1 a 5', () => {
  assert.throws(() => valorarRiesgo({ probabilidad: 0, impactoEmpresa: 3, impactoPersonas: 3 }), /probabilidad/);
  assert.throws(() => valorarRiesgo({ probabilidad: 3, impactoEmpresa: 6, impactoPersonas: 3 }), /impactoEmpresa/);
  assert.throws(() => valorarRiesgo({ probabilidad: 3, impactoEmpresa: 3, impactoPersonas: 2.5 }), /impactoPersonas/);
  assert.throws(() => efectividadControl({ calidad: 2, eficacia: 2 }), /eficiencia/);
});
