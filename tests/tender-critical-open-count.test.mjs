import { strict as assert } from 'node:assert';
import { countTenderCriticalOpenUnits } from '../verticales/licitaciones/tender-critical-open-count.js';

// El conteo canónico de pendientes críticos abiertos (`psi_tender_analysis_runs.critical_open_count`).
// Caso real que lo motivó: Supersalud SNS-LP-2-2026, corrida v6 canónica del 2026-10-25, con dos
// pendientes críticos abiertos y uno resuelto, guardada con `critical_open_count = 0` porque el
// filtro corría sobre `result.questions`, que el esquema `pre_go_analysis.v2` no tiene.
// Prueba pura: sin producción, sin red, sin base de datos.

// 1. v3 manda cuando hay `questions`: la invariante gobernada no se toca.
assert.equal(
  countTenderCriticalOpenUnits({ questions: [{ critical: true }, { critical: false }, { critical: true }] }),
  2,
  'con `questions` el conteo sigue siendo el de v3',
);

// Un `questions` vacío es un hecho, no un hueco: cuenta 0 y NO cae a `open_items`.
assert.equal(
  countTenderCriticalOpenUnits({ questions: [], open_items: [{ critical: true, status: 'OPEN' }] }),
  0,
  '`questions` presente pero vacío manda sobre `open_items`',
);

// 2. `pre_go_analysis.v2`: los pendientes viven en `open_items`.
const v6OpenItems = [
  { open_item_id: 'OI-PLIEGO-DEFINITIVO', critical: true, status: 'OPEN' },
  { open_item_id: 'OI-CIERRE-FECHA', critical: true, status: 'OPEN' },
  { open_item_id: 'OI-CERT-ARMAS', critical: false, status: 'OPEN' },
  { open_item_id: 'OI-HORAS-EXTRA', critical: false, status: 'RESOLVED' },
];
assert.equal(countTenderCriticalOpenUnits({ open_items: v6OpenItems }), 2, 'cuenta los críticos abiertos de open_items');

// 3. Un crítico ya resuelto no cuenta: el campo mide lo que sigue abierto.
assert.equal(
  countTenderCriticalOpenUnits({ open_items: [{ critical: true, status: 'RESOLVED' }, { critical: true, status: 'CLOSED' }] }),
  0,
  'un crítico resuelto o cerrado no cuenta',
);

// 4. Fail-closed: un estado desconocido o ausente se considera abierto, nunca cerrado.
assert.equal(
  countTenderCriticalOpenUnits({ open_items: [{ critical: true }, { critical: true, status: 'EN_REVISION' }, { critical: true, status: '' }] }),
  3,
  'estado ausente o desconocido se cuenta como abierto',
);

// 5. `critical` tiene que ser exactamente true: ni verdadero por coerción ni por texto.
assert.equal(
  countTenderCriticalOpenUnits({ open_items: [{ critical: 'true', status: 'OPEN' }, { critical: 1, status: 'OPEN' }, { critical: null, status: 'OPEN' }] }),
  0,
  'sólo `critical === true` cuenta',
);

// 6. Entradas sin ninguna de las dos formas, y basura, dan 0 sin reventar.
for (const value of [null, undefined, {}, { open_items: null }, { open_items: 'nada' }, { questions: 'nada' }, []]) {
  assert.equal(countTenderCriticalOpenUnits(value), 0, `entrada sin pendientes cuenta 0: ${JSON.stringify(value)}`);
}

console.log('tender-critical-open-count: ok');
