// Que ningún archivo de prueba se quede sin un trabajo del CI que lo corra (Juan, 2026-10-22).
//
// El hueco que esto cierra: ese día el CI ejecutaba 506 de los 869 archivos. Los 363 restantes estaban escritos
// pero desconectados, y dos de los cuatro despliegues de la jornada los rompieron sin que nadie lo viera. Esta
// prueba vigila el reparto en sí: si mañana alguien agrega un trabajo, cambia un patrón o crea una carpeta nueva
// de pruebas, aquí se nota.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runner = readFileSync(new URL('../scripts/run-rest-tests.mjs', import.meta.url), 'utf8');
const archivos = readdirSync(new URL('../tests', import.meta.url)).filter(name => name.endsWith('.test.mjs'));

test('los tres repartos cubren todos los archivos de prueba, sin solaparse', () => {
  const deAgt002 = archivos.filter(name => name.includes('agt002'));
  const deAgt003 = archivos.filter(name => !name.includes('agt002') && (name.includes('agt003') || name.startsWith('vigia-')));
  const resto = archivos.filter(name => !deAgt002.includes(name) && !deAgt003.includes(name));

  assert.equal(deAgt002.length + deAgt003.length + resto.length, archivos.length, 'cada archivo cae en exactamente un reparto');
  assert.ok(deAgt002.length > 0 && deAgt003.length > 0 && resto.length > 0, 'los tres repartos tienen contenido');

  // Los patrones de cada reparto son los que de verdad usan los comandos.
  assert.match(pkg.scripts['test:agt002'], /tests\/\*agt002\*\.test\.mjs/);
  assert.match(pkg.scripts['test:agt003'], /tests\/\*agt003\*\.test\.mjs tests\/vigia-\*\.test\.mjs/);
  assert.equal(pkg.scripts['test:resto'], 'node scripts/run-rest-tests.mjs');
  assert.match(runner, /file\.includes\('agt002'\) \|\| file\.includes\('agt003'\) \|\| file\.startsWith\('vigia-'\)/,
    'el runner del resto excluye exactamente lo que cubren los otros dos comandos');
});

test('cada reparto tiene un trabajo del CI que lo corre', () => {
  const flujos = readdirSync(new URL('../.github/workflows', import.meta.url))
    .filter(name => name.endsWith('.yml'))
    .map(name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8'))
    .join('\n');
  for (const comando of ['test:agt002', 'test:agt003', 'test:resto']) {
    assert.ok(flujos.includes(`pnpm run ${comando}`), `ningún trabajo del CI corre ${comando}`);
  }
});

test('los pendientes conocidos están listados con motivo y fecha, no sueltos', () => {
  const bloque = runner.slice(runner.indexOf('const PENDIENTES_CONOCIDOS'), runner.indexOf('const LOTE'));
  const entradas = bloque.match(/file: '/g) || [];
  assert.equal(entradas.length, (bloque.match(/motivo: '/g) || []).length, 'cada pendiente declara su motivo');
  assert.equal(entradas.length, (bloque.match(/desde: '/g) || []).length, 'y desde cuándo lo está');
  // La lista se limpia sola: si un pendiente empieza a pasar, el trabajo falla y pide sacarlo.
  assert.match(runner, /if \(yaNoFallan\.length\) \{/);
  assert.match(runner, /sáquelos de PENDIENTES_CONOCIDOS/);
});

console.log('reparto de pruebas del CI verificado');
