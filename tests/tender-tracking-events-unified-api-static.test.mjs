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
  const handler = extractRouteHandler(source, "app.get('/api/tender-tracking-events'");

  assert.match(handler, /\.order\('created_at', ?\{ ?ascending: ?false ?\}\)/, `${label}: debe ordenar por created_at desc`);
  assert.match(handler, /\.order\('id', ?\{ ?ascending: ?false ?\}\)/, `${label}: debe ordenar por id desc como desempate estable`);
  assert.match(handler, /req\.query\.cursor/, `${label}: debe leer el parámetro cursor`);
  assert.match(handler, /req\.query\.limit/, `${label}: debe leer el parámetro limit`);
  assert.match(handler, /next_cursor/, `${label}: debe devolver next_cursor`);
  assert.match(handler, /res\.json\(\{\s*events/, `${label}: la respuesta debe tener forma { events, next_cursor }`);
  assert.doesNotMatch(handler, /\.select\('\*'\)\.eq\('tender_id', tenderId\)\.order\('created_at', \{ ascending: false \}\)\)\s*\|\|\s*\[\]\);/, `${label}: no debe quedar la respuesta plana antigua (array sin paginar)`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-tracking-events-unified-api-static passed');
}
run();
