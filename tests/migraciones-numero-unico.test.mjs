import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Guardia de colisión de números de migración.
//
// El 2026-10-24 dos agentes trabajando en paralelo abrieron PR con el mismo número de migración
// (el #427) y el choque sólo apareció en CI, tarde. Esta prueba lo caza en el primer `npm test`:
// dos archivos no pueden compartir el prefijo numérico, ni en `migrations` ni en `rollbacks`.
//
// No reorganiza nada: las migraciones siguen en una sola carpeta numerada.

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function numeroDe(nombre) {
  const coincidencia = /^(\d+)_/.exec(nombre);
  return coincidencia ? coincidencia[1] : null;
}

function archivosSql(carpeta) {
  return readdirSync(resolve(raiz, carpeta)).filter((nombre) => nombre.endsWith('.sql'));
}

for (const carpeta of ['supabase/migrations', 'supabase/rollbacks']) {
  test(`${carpeta}: ningún número de migración se repite`, () => {
    const porNumero = new Map();
    for (const nombre of archivosSql(carpeta)) {
      const numero = numeroDe(nombre);
      assert.ok(numero, `${carpeta}/${nombre}: el nombre debe empezar con el número y un guión bajo`);
      const previos = porNumero.get(numero) ?? [];
      previos.push(nombre);
      porNumero.set(numero, previos);
    }

    const repetidos = [...porNumero.entries()]
      .filter(([, nombres]) => nombres.length > 1)
      .map(([numero, nombres]) => `${numero}: ${nombres.join(', ')}`);

    assert.deepEqual(
      repetidos,
      [],
      `hay números de migración repetidos en ${carpeta}. Renumere el suyo al siguiente libre antes de abrir el PR:\n  ${repetidos.join('\n  ')}`,
    );
  });
}
