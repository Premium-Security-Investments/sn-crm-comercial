// Pruebas del alias de factores entre ciudades: Pereira nombra el domingo o festivo por el compensatorio y
// Medellín por la jornada. Usa los mismos valores que la migración 0002 lleva a la base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factorDe } from '../../src/programacion/motor/factores.ts';

// Lee los factores de cada ciudad de la migración para no probar con valores inventados.
function factoresDeLaMigracion(): Record<string, Record<string, number>> {
  const sql = readFileSync(new URL('../../supabase/programacion-migrations/0002_datos_base_pereira.sql', import.meta.url), 'utf8');
  const filas = [...sql.matchAll(/\('(pereira|medellin)', '\d{4}-\d{2}-\d{2}',[^{]*'(\{"hed[^']*\})'/g)];
  return Object.fromEntries(filas.map(([, ciudad, json]) => [ciudad, JSON.parse(json)]));
}
const { pereira: PEREIRA, medellin: MEDELLIN } = factoresDeLaMigracion();

test('la migración trae los factores de las dos ciudades', () => {
  assert.equal(PEREIRA.dof_con_compensatorio, 0.9);
  assert.equal(MEDELLIN.rdf, 0.8);
  assert.equal(MEDELLIN.dof_con_compensatorio, undefined);
});

test('los conceptos que las dos ciudades nombran igual salen directo', () => {
  for (const clave of ['hed', 'hen', 'rn', 'hed_dof', 'hen_dof']) {
    assert.equal(factorDe(PEREIRA, clave), PEREIRA[clave]);
    assert.equal(factorDe(MEDELLIN, clave), MEDELLIN[clave]);
  }
});

test('en Medellín el domingo o festivo con compensatorio sale del rdf', () => {
  assert.equal(factorDe(MEDELLIN, 'dof_con_compensatorio'), 0.8);
});

test('la clave propia de la ciudad tiene prioridad sobre el alias', () => {
  assert.equal(factorDe({ dof_con_compensatorio: 0.9, rdf: 0.8 }, 'dof_con_compensatorio'), 0.9);
});

test('lo que la ciudad no define devuelve null, no cero', () => {
  // Medellín no trae el domingo o festivo sin compensatorio: no se puede calcular su costo.
  assert.equal(factorDe(MEDELLIN, 'dof_sin_compensatorio'), null);
  assert.equal(factorDe(PEREIRA, 'dof_sin_compensatorio'), 1.9);
  assert.equal(factorDe(MEDELLIN, null), null);
  assert.equal(factorDe(null, 'hed'), null);
  assert.equal(factorDe({ hed: Number.NaN }, 'hed'), null);
});
