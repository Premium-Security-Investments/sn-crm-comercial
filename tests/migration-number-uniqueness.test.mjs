import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

const carpetas = {
  'supabase/migrations': new URL('../supabase/migrations/', import.meta.url),
  'supabase/rollbacks': new URL('../supabase/rollbacks/', import.meta.url),
};

// No hay colisiones aceptadas. La del número 154 se resolvió renumerando la migración de la
// Mesa a 156 (2026-10-25): había quedado sin aplicar porque la herramienta vio el 154 del
// otro PR en el libro de migraciones y dio la suya por hecha.
const COLISIONES_ACEPTADAS = {
  'supabase/migrations': {},
  'supabase/rollbacks': {},
};

for (const [nombreCarpeta, url] of Object.entries(carpetas)) {
  test(`${nombreCarpeta}: ningún número de migración se repite`, async () => {
    const archivos = (await readdir(url)).filter((name) => name.endsWith('.sql'));

    for (const archivo of archivos) {
      assert.match(archivo, /^\d+[a-z]?_.+\.sql$/, `${nombreCarpeta}/${archivo}: el nombre debe empezar con el número y un guión bajo`);
    }

    const porPrefijo = new Map();
    for (const archivo of archivos) {
      const prefijo = /^(\d+)/.exec(archivo)[1];
      porPrefijo.set(prefijo, [...(porPrefijo.get(prefijo) ?? []), archivo]);
    }

    const aceptadas = COLISIONES_ACEPTADAS[nombreCarpeta] ?? {};
    const duplicados = Object.fromEntries(
      [...porPrefijo.entries()]
        .filter(([prefijo, nombres]) => {
          if (nombres.length <= 1) return false;
          const permitidos = aceptadas[Number(prefijo)];
          if (!permitidos) return true;
          return [...nombres].sort().join(',') !== [...permitidos].sort().join(',');
        }),
    );

    assert.deepEqual(
      duplicados,
      {},
      `hay números de migración repetidos en ${nombreCarpeta}. Renumere el suyo al siguiente libre antes de abrir el PR: ${JSON.stringify(duplicados)}`,
    );
  });
}
