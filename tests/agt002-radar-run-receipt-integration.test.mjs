// Chequeos de integración estática (sin red/sin DB) para el wiring de AGT-002 Radar run receipt en
// server/index.js y su réplica api/[...path].js: paridad entre ambos archivos (reusando el mismo
// checker que `npm run check:backend-parity`), el fallo fatal ocurrido dentro de
// fetchPublicTenderRadar queda dentro del try/catch, y los nombres de los módulos/rutas retirados
// no quedan colgando en ninguno de los dos archivos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSrc = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSrc = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function extractFunction(src, name) {
  const headIdx = src.indexOf(`async function ${name}(`);
  assert.ok(headIdx !== -1, `${name} not found`);
  // The body opens after the parameter list, which may itself contain `{ … }` option destructuring.
  const bodyStart = src.indexOf(') {', headIdx) + 2;
  let depth = 1;
  let i = bodyStart + 1;
  for (; i < src.length && depth > 0; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return src.slice(headIdx, i);
}

function extractRoute(src, routePath) {
  const marker = `app.get('${routePath}'`;
  const idx = src.indexOf(marker);
  assert.ok(idx !== -1, `route ${routePath} not found`);
  const end = src.indexOf('\n});', idx) + 4;
  return src.slice(idx, end);
}

// 1. Paridad: server/index.js y api/[...path].js deben ser byte-idénticos (mismo checker que
//    `npm run check:backend-parity`), así que basta razonar sobre server/index.js para el resto.
assert.ok(buffersAreEqual(serverSrc, apiSrc), 'server/index.js y api/[...path].js deben ser byte-idénticos');

// 2. Fatal-before-fetch: fetchPublicTenderRadar y tenderTableAvailable deben quedar DENTRO del
//    try/catch de persistTenderRadar, y `diagnostics` debe inicializarse de forma segura ANTES del
//    try para que el catch pueda construir un recibo 'failed' aunque el fallo ocurra antes de que
//    el pipeline reporte nada por fuente.
const serverPersist = extractFunction(serverSrc, 'persistTenderRadar');
const tryIdx = serverPersist.indexOf('try {');
const catchIdx = serverPersist.indexOf('} catch (fatalError)');
assert.ok(tryIdx !== -1, 'persistTenderRadar debe tener un try');
assert.ok(catchIdx !== -1 && catchIdx > tryIdx, 'persistTenderRadar debe tener un catch (fatalError) después del try');
const beforeTry = serverPersist.slice(0, tryIdx);
const tryBody = serverPersist.slice(tryIdx, catchIdx);
assert.match(beforeTry, /let diagnostics = \[\];/, 'diagnostics debe inicializarse en [] antes del try (default seguro si el fetch nunca llega a reportar nada)');
assert.doesNotMatch(beforeTry, /await fetchPublicTenderRadar\((\{ deep \})?\)/, 'fetchPublicTenderRadar no debe llamarse antes del try');
assert.match(tryBody, /await fetchPublicTenderRadar\((\{ deep \})?\)/, 'fetchPublicTenderRadar debe quedar dentro del try/catch');
assert.match(tryBody, /await tenderTableAvailable\(database\)/, 'tenderTableAvailable debe quedar dentro del try/catch');
const catchBody = serverPersist.slice(catchIdx);
assert.match(catchBody, /buildAgt002RadarRunReceipt\(\{[\s\S]*?fatalError,?\s*\}\)/, 'el catch debe construir el recibo fatal con fatalError');
assert.match(catchBody, /throw fatalError;/, 'el catch nunca debe enmascarar el error original');

// 3. Las rutas read-only nuevas (/api/tenders/radar-runs/latest y /history) deben ser idénticas
//    entre server/index.js y api/[...path].js, y reusar la misma autorización que GET /api/tenders.
const tendersGetRoute = extractRoute(serverSrc, '/api/tenders');
const authGuardLine = tendersGetRoute.match(/if \(!canViewTenders\(currentProfile\)\) \{ const error = new Error\('[^']+'\); error\.status = 403; throw error; \}/)[0];
for (const routePath of ['/api/tenders/radar-runs/latest', '/api/tenders/radar-runs/history']) {
  const serverRoute = extractRoute(serverSrc, routePath);
  const apiRoute = extractRoute(apiSrc, routePath);
  assert.equal(serverRoute, apiRoute, `${routePath} debe replicarse exactamente entre server/index.js y api/[...path].js`);
  assert.ok(serverRoute.includes(authGuardLine), `${routePath} debe exigir exactamente la misma autorización que GET /api/tenders`);
}

// 4. Las rutas/retiradas y el módulo puro duplicado no deben quedar colgando en ninguno de los dos
//    archivos (sin imports muertos, sin wiring huérfano).
for (const src of [serverSrc, apiSrc]) {
  assert.ok(!src.includes(`'/api/tender-radar-run-receipt'`), 'la ruta retirada /api/tender-radar-run-receipt no debe seguir montada');
  assert.ok(!src.includes(`'/api/tender-radar-run-receipts'`), 'la ruta retirada /api/tender-radar-run-receipts no debe seguir montada');
  assert.ok(!src.includes('tender-radar-run-receipt.js'), 'el módulo puro duplicado no debe seguir importado');
}

console.log('AGT-002 radar run receipt server/api parity + fatal-before-fetch structural checks passed');
