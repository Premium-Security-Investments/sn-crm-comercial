import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';
import { PUBLIC_ACTUATION_TYPES, assertPublicActuationType } from '../tender-actuation-types.js';

// El vocabulario licitatorio público es fijo y no incluye tipos comerciales/privados.
assert.deepEqual(PUBLIC_ACTUATION_TYPES, [
  'requirement_pending',
  'information_requested',
  'addendum_reviewed',
  'observation_recorded',
  'internal_meeting',
  'case_note',
]);

for (const type of PUBLIC_ACTUATION_TYPES) {
  assert.doesNotThrow(() => assertPublicActuationType(type), `${type} debe ser un tipo público válido`);
}

for (const type of ['llamada', 'correo', 'whatsapp', 'nota', 'cambio_estado', 'reunion', 'bogus']) {
  assert.throws(() => assertPublicActuationType(type), /tipo de actuaci[oó]n/i, `${type} debe rechazarse`);
}

const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const serverBuffer = readFileSync(new URL('../server/index.js', import.meta.url));
const apiBuffer = readFileSync(new URL('../api/[...path].js', import.meta.url));

function extractRouteHandler(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `no se encontró la ruta ${marker}`);
  const braceStart = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(markerIndex, i + 1);
    }
  }
  throw new Error(`no se pudo balancear el handler de ${marker}`);
}

function assertBackend(source, label) {
  assert.match(source, /import \{ assertPublicActuationType, PUBLIC_ACTUATION_TYPES \} from '\.\.\/tender-actuation-types\.js';/, `${label}: debe importar el módulo tipado`);
  const handler = extractRouteHandler(source, "app.post('/api/tender-actuation'");
  assert.match(handler, /assertPublicActuationType\(/, `${label}: debe validar el tipo con el módulo puro`);
  assert.match(handler, /actor_kind:\s*'human'|p_actor_kind:\s*'human'/, `${label}: el actor debe ser humano fijo`);
  assert.match(handler, /currentProfile\.id/, `${label}: el actor debe ser el perfil autenticado actual`);
  assert.match(handler, /psi_append_tender_tracking_event/, `${label}: debe escribir vía la RPC de eventos`);
  assert.doesNotMatch(handler, /req\.body\.actor|req\.body\?\.actor|req\.body\.created_by/, `${label}: el actor no debe ser elegible por el cliente`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-actuation-types passed');
}
run();
