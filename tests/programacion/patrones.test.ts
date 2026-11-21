// Pruebas del generador de turnos tipo (datos sintéticos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desfaseEntre, diaDesdeCeldas, generarTurnos, horasDelDia, inferirCiclo, inferirCicloConExcepciones, inferirSemanal, revisarDias, unirGrupos, type DiaPatron, type Patron } from '../../src/programacion/motor/patrones.ts';
import { construirBloque, diasDelPeriodo, periodoConCorte } from '../../src/programacion/motor/periodo.ts';
import { calcularBloqueLegado } from '../../src/programacion/motor/legado-pereira.ts';

const { inicio, fin } = periodoConCorte(2026, 8, 23);
const dias = diasDelPeriodo(inicio, fin, ['2026-08-07', '2026-08-17']);
const D: DiaPatron = { tramos: [] };
const DIA: DiaPatron = { tramos: [{ inicio: '06:00', fin: '18:00' }] };
const NOCHE: DiaPatron = { tramos: [{ inicio: '18:00', fin: '06:00' }] };

test('lee la noche partida del Excel (18-24 y 00-06) como un solo turno', () => {
  assert.deepEqual(diaDesdeCeldas([0.75, 1, 0, 0.25, null, null]), NOCHE);
  assert.deepEqual(diaDesdeCeldas(['D', null]), D);
  assert.deepEqual(diaDesdeCeldas(['I', null]), { letra: 'I' });
});

test('detecta el ciclo de 6 días (2 descansos, 2 días, 2 noches)', () => {
  const seq = Array.from({ length: 31 }, (_, i) => [D, D, DIA, DIA, NOCHE, NOCHE][i % 6]);
  assert.equal(inferirCiclo(seq), 6);
});

test('detecta un ciclo con pocas excepciones', () => {
  const seq = Array.from({ length: 31 }, (_, i) => [D, D, DIA, DIA, NOCHE, NOCHE][i % 6]);
  seq[10] = { tramos: [{ inicio: '18:00', fin: '07:00' }] };
  const r = inferirCicloConExcepciones(seq);
  assert.equal(r?.ciclo, 6);
  assert.deepEqual(r?.excepciones, [10]);
});

test('el turno tipo genera el mes y el cálculo coincide con el ejemplo del Excel', () => {
  const g1: Patron = { tipo: 'rotativo', codigo: 'G1', cicloDias: 6, dias: [D, D, DIA, DIA, NOCHE, NOCHE] };
  const turnos = generarTurnos(g1, inicio, dias);
  assert.equal(turnos.length, 20);
  assert.equal(turnos[0].inicio, '2026-07-26T06:00');
  assert.equal(turnos[2].fin, '2026-07-29T06:00');
  const r = calcularBloqueLegado(construirBloque(dias, turnos));
  assert.equal(r.totales.horasOrdinarias + r.totales.horasFestivas, 240);
});

test('horario semanal con horario de festivo', () => {
  const p: Patron = { tipo: 'semanal', codigo: 'L:V', dias: [DIA, DIA, DIA, DIA, DIA, D, D], horarioFestivo: D };
  const t = generarTurnos(p, inicio, dias);
  assert.ok(!t.some((x) => x.inicio.startsWith('2026-08-07')), 'el festivo no se trabaja');
  assert.ok(t.some((x) => x.inicio.startsWith('2026-08-06')));
  assert.equal(t.length, 19); // 21 días hábiles menos 2 festivos
});

test('reconoce un horario fijo por día de la semana', () => {
  const seq = dias.map((d) => (d.letra === 'S' || d.letra === 'D' || d.letra === 'F' ? D : DIA));
  const p = inferirSemanal(seq, dias.map((d) => d.letra), 'x');
  assert.equal(p?.tipo, 'semanal');
});

test('grupos: G2 y G3 son la misma rotación corrida 2 y 4 días y se unen en un solo turno tipo', () => {
  const g1 = [D, D, DIA, DIA, NOCHE, NOCHE];
  const g2 = [DIA, DIA, NOCHE, NOCHE, D, D];
  const g3 = [NOCHE, NOCHE, D, D, DIA, DIA];
  assert.equal(desfaseEntre(g1, g2), 2);
  assert.deepEqual(unirGrupos([g1, g2, g3]), { desfase: 2 });
  assert.deepEqual(unirGrupos([g1, g3, g2]), { desfase: 4 }); // en otro orden también es rotación pareja
  assert.ok('error' in unirGrupos([g1, g2, g2]));
  assert.ok('error' in unirGrupos([g1, [DIA, D, D, DIA, NOCHE, NOCHE]]));
  // El turno unido con grupo 2 genera exactamente lo mismo que el antiguo G2.
  const unido: Patron = { tipo: 'rotativo', codigo: 'U', cicloDias: 6, dias: g1, grupos: 3, desfaseGrupos: 2 };
  const viejoG2: Patron = { tipo: 'rotativo', codigo: 'G2', cicloDias: 6, dias: g2 };
  assert.deepEqual(generarTurnos(unido, inicio, dias, 2), generarTurnos(viejoG2, inicio, dias));
  assert.deepEqual(generarTurnos(unido, inicio, dias, 3), generarTurnos({ ...viejoG2, dias: g3 }, inicio, dias));
});

test('revisión del ciclo antes de guardar', () => {
  assert.deepEqual(revisarDias([D, D, DIA, DIA, NOCHE, NOCHE], false), []);
  assert.ok(revisarDias([D, D, D, D, D, D, D], true).some((e) => e.includes('ningún día')));
  assert.ok(revisarDias([DIA], true).some((e) => e.includes('7 días')));
  assert.ok(revisarDias([{ tramos: [{ inicio: '6:00', fin: '14:00' }] }], false).some((e) => e.includes('06:00')));
  assert.ok(revisarDias([{ tramos: [{ inicio: '06:00', fin: '14:00' }, { inicio: '13:00', fin: '18:00' }] }], false).some((e) => e.includes('cruzan')));
  assert.equal(horasDelDia(NOCHE), 12);
  assert.equal(horasDelDia({ tramos: [{ inicio: '06:00', fin: '06:00' }] }), 24);
});
