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
  assert.ok(!source.includes('Katherine'), `${label}: no debe hardcodear el nombre Katherine`);
  assert.ok(!source.includes('Juan Botero'), `${label}: no debe hardcodear el nombre Juan Botero`);

  const handler = extractRouteHandler(source, "app.post('/api/tender-analysis-authorize'");
  assert.ok(handler.includes('ACTIONS.AI_ANALYSIS_RUN'), `${label}: falta el guard de custodia AI_ANALYSIS_RUN`);
  assert.ok(handler.includes('psi_authorize_tender_analysis'), `${label}: debe llamar a psi_authorize_tender_analysis`);
  assert.ok(!handler.includes('go_no_go') && !handler.includes('GoNoGo') && !handler.includes('GO_NO_GO'), `${label}: no debe tocar el flujo GO/NO GO`);
}

function run() {
  assertBackend(serverSource, 'server/index.js');
  assertBackend(apiSource, 'api/[...path].js');
  assert.ok(buffersAreEqual(serverBuffer, apiBuffer), 'server/index.js y api/[...path].js deben ser byte-idénticos');
  console.log('tender-analysis-authorize-static passed');
}
run();
