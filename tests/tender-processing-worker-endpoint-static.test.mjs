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
  assert.ok(source.includes("app.post('/api/internal/tender-processing-worker'"), `${label}: falta la ruta interna del worker`);
  const handler = extractRouteHandler(source, "app.post('/api/internal/tender-processing-worker'");
  assert.ok(handler.includes('timingSafeEqual'), `${label}: debe comparar el secreto en tiempo constante`);
  assert.ok(!handler.includes('TENDER_WORKER_SCHEDULER_SECRET ==='), `${label}: no debe comparar el secreto directamente con === (no es tiempo constante)`);
  assert.ok(!/x-tender-worker-secret'\]\s*===/.test(handler), `${label}: no debe comparar el header del secreto directamente con === (no es tiempo constante)`);
  assert.ok(!handler.includes('getAuthContext'), `${label}: no debe requerir sesión de navegador`);
  assert.ok(handler.includes('requireDb()'), `${label}: debe usar el cliente de service role`);
  assert.ok(!handler.includes('req.body.opportunity_id') && !handler.includes('req.body?.opportunity_id'), `${label}: no debe aceptar un expediente arbitrario del cliente`);
  assert.ok(handler.includes('isTenderDurablePipelineEnabled'), `${label}: debe estar detrás del flag durable`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-processing-worker-endpoint-static passed');
}
run();
