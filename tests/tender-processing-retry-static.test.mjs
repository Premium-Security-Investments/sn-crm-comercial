import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

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
  const handler = extractRouteHandler(source, "app.post('/api/tender-processing-retry'");
  assert.ok(handler.includes('ACTIONS.LICITACIONES_CONVERT'), `${label}: falta el guard de custodia`);
  assert.ok(handler.includes('idempotency_key'), `${label}: debe exigir idempotency_key`);
  assert.ok(handler.includes('psi_append_tender_tracking_event'), `${label}: debe insertar un evento de reintento`);
  assert.ok(handler.includes('cancelled'), `${label}: debe rechazar procesos cancelados/terminados`);
  assert.ok(handler.includes('psi_update_tender_processing_job'), `${label}: debe reactivar el job vía la RPC de actualización`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-processing-retry-static passed');
}
run();
