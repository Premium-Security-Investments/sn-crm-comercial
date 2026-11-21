// Pruebas de la tabla de reglas legales y su comparación con los parámetros de cada ciudad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compararConLey, parametrosAplicables, proximoCambio, reglaVigente, type ReglaLegal } from '../../src/programacion/motor/reglas-legales.ts';

// Lee las filas de la migración para probar con los mismos valores que van a la base.
function reglasDeLaMigracion(): ReglaLegal[] {
  const sql = readFileSync(new URL('../../supabase/programacion-migrations/0020_reglas_legales.sql', import.meta.url), 'utf8');
  const filas = [...sql.matchAll(/\('([a-z_]+)', '(\d{4}-\d{2}-\d{2})', ([\d.]+), '([a-z_]+)', '([^']*)', '([a-z_]+)'/g)];
  return filas.map(([, tema, desde, valor, unidad, fuente, estado]) => ({ tema, vigente_desde: desde, valor, unidad, fuente, estado, nota: null }) as ReglaLegal);
}
const reglas = reglasDeLaMigracion();

const PEREIRA = {
  vigente_desde: '2026-07-24', jornada_semanal: '43', jornada_diaria_macro: '8', fin_diurno: '19:00:00', divisor_valor_hora: '210',
  factores: { hed: 1.25, hen: 1.75, rn: 0.35, dof_sin_compensatorio: 1.9, dof_con_compensatorio: 0.9, hed_dof: 2.15, hen_dof: 2.65 },
};
const MEDELLIN = {
  vigente_desde: '2026-08-01', jornada_semanal: '42', jornada_diaria_macro: null, fin_diurno: '19:00:00', divisor_valor_hora: '220',
  factores: { hed: 1.25, hen: 1.75, rn: 0.35, rdf: 0.8, rnf: 1.15, hed_dof: 2.05, hen_dof: 2.55 },
};

test('la migración trae el calendario completo', () => {
  assert.equal(reglas.length, 18);
  assert.deepEqual(reglas.filter((r) => r.tema === 'jornada_semanal').map((r) => Number(r.valor)), [48, 47, 46, 44, 42]);
});

test('jornada legal según la fecha (Ley 2101)', () => {
  assert.equal(Number(reglaVigente(reglas, 'jornada_semanal', '2026-07-14')?.valor), 44);
  assert.equal(Number(reglaVigente(reglas, 'jornada_semanal', '2026-07-15')?.valor), 42);
  assert.equal(Number(reglaVigente(reglas, 'jornada_semanal', '2024-12-01')?.valor), 46);
});

test('recargo de domingo o festivo por etapas y próximo cambio (Ley 2466, art. 14)', () => {
  assert.equal(Number(reglaVigente(reglas, 'recargo_descanso_obligatorio', '2026-06-30')?.valor), 0.8);
  assert.equal(Number(reglaVigente(reglas, 'recargo_descanso_obligatorio', '2026-08-15')?.valor), 0.9);
  const prox = proximoCambio(reglas, 'recargo_descanso_obligatorio', '2026-10-16');
  assert.equal(prox?.vigente_desde, '2027-07-01');
  assert.equal(Number(prox?.valor), 1);
});

test('Pereira (agosto 2026): jornada 43 y macro 48 no coinciden con 42; recargo 0,9 sí', () => {
  const c = Object.fromEntries(compararConLey(reglas, PEREIRA, '2026-08-23').map((x) => [x.clave, x]));
  assert.equal(c.jornada_formulas.coincide, false);
  assert.equal(c.jornada_formulas.ciudad, 43);
  assert.equal(c.jornada_macro.ciudad, 48);
  assert.equal(c.jornada_macro.coincide, false);
  assert.equal(c.inicio_nocturno.coincide, true);
  assert.equal(c.recargo_dof.coincide, true);
  assert.equal(c.recargo_dof_sin_compensatorio.coincide, true);
  assert.equal(c.hed_dof.coincide, true);
  assert.equal(c.divisor.legal, 210);
  assert.equal(c.divisor.coincide, true);
  assert.equal(c.divisor.estado, 'por_confirmar');
});

test('Medellín (agosto 2026): jornada 42 coincide; recargo 0,8 y divisor 220 no', () => {
  const c = Object.fromEntries(compararConLey(reglas, MEDELLIN, '2026-08-31').map((x) => [x.clave, x]));
  assert.equal(c.jornada_formulas.coincide, true);
  assert.equal(c.jornada_macro, undefined);
  assert.equal(c.recargo_dof.ciudad, 0.8);
  assert.equal(c.recargo_dof.coincide, false);
  assert.equal(c.hed_dof.coincide, false);
  assert.equal(c.divisor.coincide, false);
});

test('el mismo parámetro de Pereira comparado en julio de 2027 avisa el recargo del 100 %', () => {
  const c = Object.fromEntries(compararConLey(reglas, PEREIRA, '2027-07-10').map((x) => [x.clave, x]));
  assert.equal(c.recargo_dof.legal, 1);
  assert.equal(c.recargo_dof.coincide, false);
});

test('la regla de la ciudad tiene prioridad sobre la del resto del país', () => {
  const filas = [
    { id: 1, ciudad_id: 'pereira', vigente_desde: '2026-07-24' },
    { id: 2, ciudad_id: null, vigente_desde: '2026-09-01' },
    { id: 3, ciudad_id: 'pereira', vigente_desde: '2026-10-24' },
  ];
  assert.equal(parametrosAplicables(filas, 'pereira', '2026-10-01')?.id, 1);
  assert.equal(parametrosAplicables(filas, 'pereira', '2026-10-24')?.id, 3);
  assert.equal(parametrosAplicables(filas, 'bogota', '2026-10-01')?.id, 2);
  assert.equal(parametrosAplicables(filas, 'bogota', '2026-08-01'), null);
  assert.equal(parametrosAplicables(filas, null, '2026-10-01')?.id, 2);
});
