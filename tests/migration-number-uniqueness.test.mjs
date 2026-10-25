import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

const carpetas = {
  'supabase/migrations': new URL('../supabase/migrations/', import.meta.url),
  'supabase/rollbacks': new URL('../supabase/rollbacks/', import.meta.url),
};

// Colisiones ya fusionadas y aplicadas en producción. No se renumeran: el número quedó en el
// libro de migraciones de la base (`supabase_migrations.schema_migrations`), en los PR y en los
// handoffs, y renombrar el archivo sólo movería la inconsistencia de sitio. Esta lista es la
// excepción explícita; cualquier colisión nueva sigue fallando.
//
// - `154`: el 2026-10-24 dos agentes trabajando en paralelo usaron el mismo número
//   (`154_agt002_workbench_politica_v2` del PR #429 y `154_agt003_cierre_duracion_ultimo_dia`
//   del PR #430). Las dos se fusionaron y se aplicaron. Decidir si se renumera es de Juan.
const COLISIONES_ACEPTADAS = {
  'supabase/migrations': {
    154: ['154_agt002_workbench_politica_v2.sql', '154_agt003_cierre_duracion_ultimo_dia.sql'],
  },
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
