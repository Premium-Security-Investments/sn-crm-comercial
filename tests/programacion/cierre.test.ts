// Pruebas del cálculo de cierre por guarda (datos sintéticos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCierre, parametrosDesdeBase } from '../../src/programacion/motor/cierre.ts';
import { PARAMETROS_PEREIRA_2026_08 } from '../../src/programacion/motor/legado-pereira.ts';

test('los parámetros de la base equivalen a los del Excel de Pereira', () => {
  const p = parametrosDesdeBase({ jornada_semanal: '43', jornada_diaria_macro: '8', inicio_diurno: '06:00:00', fin_diurno: '19:00:00' }, 23);
  assert.deepEqual(p, PARAMETROS_PEREIRA_2026_08);
});

test('un resultado por guarda, sumando turnos de distintos puestos', () => {
  const r = calcularCierre({
    inicio: '2026-07-24', fin: '2026-08-23', festivos: ['2026-08-07', '2026-08-17'],
    parametros: PARAMETROS_PEREIRA_2026_08,
    empleados: [1, 2],
    turnos: [
      { empleado_id: 1, inicio: '2026-07-27 06:00:00', fin: '2026-07-27 18:00:00' },
      { empleado_id: 1, inicio: '2026-07-28T06:00', fin: '2026-07-28T14:00' },
    ],
    novedades: [{ empleado_id: 2, tipo: 'incapacidad', desde: '2026-07-27', hasta: '2026-07-29' }],
    reglaAntigua: new Set(),
  });
  assert.equal(r.length, 2);
  assert.equal(r[0].totales?.horasOrdinarias, 20);
  assert.equal(r[1].totales?.incapacidades, 3);
  assert.equal(r[1].totales?.horasOrdinarias, 0);
});

test('un guarda con datos imposibles se reporta sin detener el cierre', () => {
  const muchos = Array.from({ length: 6 }, (_, i) => ({ empleado_id: 1, inicio: `2026-07-27T0${i}:00`, fin: `2026-07-27T0${i}:30` }));
  const r = calcularCierre({
    inicio: '2026-07-24', fin: '2026-08-23', festivos: [], parametros: PARAMETROS_PEREIRA_2026_08,
    empleados: [1, 2], turnos: muchos, novedades: [], reglaAntigua: new Set(),
  });
  assert.match(r[0].error ?? '', /5 tramos/);
  assert.ok(r[1].totales);
});

test('un guarda sin turnos en el periodo queda con 0 días trabajados y 0 horas, y conserva sus novedades', () => {
  const r = calcularCierre({
    inicio: '2026-07-24', fin: '2026-08-23', festivos: ['2026-08-07', '2026-08-17'], parametros: PARAMETROS_PEREIRA_2026_08,
    empleados: [1, 2, 3],
    turnos: [{ empleado_id: 1, inicio: '2026-07-27T06:00', fin: '2026-07-27T18:00' }],
    novedades: [{ empleado_id: 3, tipo: 'vacaciones', desde: '2026-07-24', hasta: '2026-08-07' }],
    reglaAntigua: new Set(),
  });
  assert.equal(r[0].sinTurnos, undefined);
  assert.ok((r[0].totales?.diasLaborados ?? 0) > 0);
  for (const g of [r[1], r[2]]) {
    assert.equal(g.sinTurnos, true);
    assert.equal(g.totales?.diasLaborados, 0);
    assert.equal(g.totales?.hed, 0);
    assert.equal(g.totales?.dofSinCompensatorio, 0);
    assert.equal(g.totales?.dofConCompensatorio, 0);
  }
  assert.ok((r[2].totales?.vacaciones ?? 0) > 0); // los días de novedad siguen contando como en el Excel
});
