// Pruebas del motor legado con datos sintéticos (sin datos reales de personas).
// La prueba contra el Excel real está en scripts/comparar-excel-pereira.ts y usa
// un archivo privado que no se versiona.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularBloqueLegado } from '../../src/programacion/motor/legado-pereira.ts';
import { construirBloque, diasDelPeriodo, periodoConCorte, sumarDias, type Turno } from '../../src/programacion/motor/periodo.ts';

const FESTIVOS_2026 = ['2026-07-20', '2026-08-07', '2026-08-17'];
const { inicio, fin } = periodoConCorte(2026, 8, 23);
const dias = diasDelPeriodo(inicio, fin, FESTIVOS_2026);
const cerca = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

function dia(i: number) {
  return sumarDias(inicio, i);
}
function turnoDia(i: number): Turno {
  return { inicio: `${dia(i)}T06:00`, fin: `${dia(i)}T18:00` };
}
function turnoNoche(i: number): Turno {
  return { inicio: `${dia(i)}T18:00`, fin: `${dia(i + 1)}T06:00` };
}

test('periodo de Pereira: 24-jul a 23-ago-2026, 31 días, festivos 7 y 17 de agosto', () => {
  assert.equal(inicio, '2026-07-24');
  assert.equal(fin, '2026-08-23');
  assert.equal(dias.length, 31);
  assert.equal(dias.find((d) => d.fecha === '2026-08-07')?.letra, 'F');
  assert.equal(dias.find((d) => d.fecha === '2026-08-17')?.letra, 'F');
  assert.equal(dias.find((d) => d.fecha === '2026-08-23')?.letra, 'D');
});

// Caso verificado a mano en el análisis (docs/reglas-excel-pereira-medellin-bogota.md §4.3):
// rotación G1 de 24 h con incapacidad del 3 al 17 de agosto.
test('guarda con rotación G1 e incapacidad reproduce el ejemplo verificado', () => {
  const turnos: Turno[] = [
    turnoDia(2), turnoDia(3), turnoNoche(4), turnoNoche(5),
    turnoDia(8), turnoDia(9),
    turnoNoche(25), turnoNoche(26), turnoNoche(27), turnoNoche(28), turnoNoche(29),
  ];
  const bloque = construirBloque(dias, turnos, [{ tipo: 'incapacidad', desde: '2026-08-03', hasta: '2026-08-17' }]);
  const r = calcularBloqueLegado(bloque);
  const t = r.totales;
  assert.equal(t.diasHabiles, 13);
  cerca(t.horasALaborar, 13 * 43 / 6);
  assert.equal(t.horasOrdinarias, 102);
  cerca(t.saldoExtras, 102 - 13 * 43 / 6);
  cerca(t.hed, 1);
  cerca(t.hen, 7.83);
  cerca(t.recargoNocturno, 65.17);
  assert.equal(t.horasFestivas, 30);
  assert.equal(t.domingosTrabajados, 2);
  cerca(t.dofConCompensatorio, 18);
  assert.equal(t.dofSinCompensatorio, 0);
  assert.equal(t.hedDoF, 8);
  assert.equal(t.henDoF, 4);
  assert.equal(t.incapacidades, 11);
  assert.equal(t.diasLaborados, 20);
});

test('turno nocturno de sábado: las horas después de medianoche son dominicales', () => {
  const sabado = dias.findIndex((d) => d.fecha === '2026-07-25');
  const r = calcularBloqueLegado(construirBloque(dias, [turnoNoche(sabado)]));
  assert.equal(r.filas.horasT[sabado], 6);
  assert.equal(r.filas.horasFestivas[sabado + 1], 6);
  assert.equal(r.filas.recargoNocturno[sabado], 11);
  // Falla del Excel que se replica a propósito: el domingo ganado por un turno de
  // sábado en la noche se pierde si el periodo termina en domingo o festivo
  // (el 23-ago-2026 es domingo). Pregunta para nómina.
  assert.equal(r.totales.domingosTrabajados, 0);
});

test('el domingo del turno de sábado sí cuenta si el periodo termina en día hábil', () => {
  const corto = diasDelPeriodo('2026-07-24', '2026-07-27', FESTIVOS_2026); // termina lunes
  const r = calcularBloqueLegado(construirBloque(corto, [turnoNoche(1)]));
  assert.equal(r.totales.domingosTrabajados, 1);
});

test('turno nocturno de domingo hacia lunes hábil: las horas de la madrugada son ordinarias del lunes', () => {
  const domingo = dias.findIndex((d) => d.fecha === '2026-07-26');
  const r = calcularBloqueLegado(construirBloque(dias, [turnoNoche(domingo)]));
  assert.equal(r.filas.horasFestivas[domingo], 6);
  assert.equal(r.filas.horasT[domingo + 1], 6);
});

test('sin horas trabajadas no hay extras y el saldo es déficit', () => {
  const r = calcularBloqueLegado(construirBloque(dias, []));
  assert.equal(r.totales.horasOrdinarias, 0);
  assert.ok(r.totales.saldoExtras < 0);
  assert.equal(r.totales.hed + r.totales.hen, 0);
});

test('bandera 24 fuerza tres domingos y cero horas festivas iniciales', () => {
  const r = calcularBloqueLegado(construirBloque(dias, [turnoDia(2)], [], { bandera24: true }));
  assert.equal(r.totales.domingosTrabajados, 3);
  assert.equal(r.totales.horasFestivasPrimeras8, 0);
});

test('un texto no reconocido en la cuadrícula detiene el cálculo, como en el Excel', () => {
  const b = construirBloque(dias, []);
  b.dias[3].tramos[0] = 'NOCHE';
  assert.throws(() => calcularBloqueLegado(b), /no reconocido/);
});
