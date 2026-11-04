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

test('rechaza calificaciones fuera de la escala de 1 a 5', () => {
  assert.throws(() => valorarRiesgo({ probabilidad: 0, impactoEmpresa: 3, impactoPersonas: 3 }), /probabilidad/);
  assert.throws(() => valorarRiesgo({ probabilidad: 3, impactoEmpresa: 6, impactoPersonas: 3 }), /impactoEmpresa/);
  assert.throws(() => valorarRiesgo({ probabilidad: 3, impactoEmpresa: 3, impactoPersonas: 2.5 }), /impactoPersonas/);
  assert.throws(() => efectividadControl({ calidad: 2, eficacia: 2 }), /eficiencia/);
});
