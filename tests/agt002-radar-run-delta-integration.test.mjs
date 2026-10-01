// Chequeos de integración estática (sin red/sin DB) para el wiring de AGT-002 Radar run delta
// (Corte 3) en server/index.js y su réplica api/[...path].js: paridad entre ambos archivos, la ruta
// de sólo lectura nueva con la misma autorización que GET /api/tenders, y que el snapshot del Corte
// 3 nunca se intenta grabar en el camino fatal de persistTenderRadar (donde `diagnostics` puede
// seguir en `[]` y no hay forma confiable de construir un snapshot válido para esa corrida).
//
// RED deliberado: hoy ninguna de estas condiciones se cumple porque la ruta y el wiring del Corte 3
// todavía no existen en ninguno de los dos archivos backend.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buffersAreEqual } from '../scripts/check_backend_parity.mjs';

const serverSrc = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const apiSrc = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function extractFunction(src, name) {
  // Busca `function ${name}(` sin exigir el prefijo `async `, para que sirva tanto con funciones
  // async (persistTenderRadar) como con funciones síncronas (buildAgt002RadarRunSnapshotReceiptFromRun):
  // la subcadena `function ${name}(` aparece igual en ambas declaraciones.
  const marker = `function ${name}(`;
  const headIdx = src.indexOf(marker);
  assert.ok(headIdx !== -1, `${name} not found`);
  // Escanea paréntesis balanceados desde el `(` de la firma: los parámetros pueden traer su propia
  // desestructuración (p. ej. `{ runId, finishedAt, ... }`), cuya `{` no debe confundirse con el
  // inicio del cuerpo de la función.
  const parenStart = headIdx + marker.length - 1;
  let parenDepth = 1;
  let j = parenStart + 1;
  for (; j < src.length && parenDepth > 0; j += 1) {
    if (src[j] === '(') parenDepth += 1;
    else if (src[j] === ')') parenDepth -= 1;
  }
  const bodyStart = src.indexOf('{', j);
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

// 1. Paridad general: server/index.js y api/[...path].js deben seguir siendo byte-idénticos (mismo
//    checker que `npm run check:backend-parity`), así que basta razonar sobre server/index.js para
//    el resto de estas aserciones.
assert.ok(buffersAreEqual(serverSrc, apiSrc), 'server/index.js y api/[...path].js deben ser byte-idénticos');

// 2. La ruta de sólo lectura nueva /api/tenders/radar-runs/delta debe existir idéntica en ambos
//    archivos y exigir exactamente la misma autorización que GET /api/tenders.
const tendersGetRoute = extractRoute(serverSrc, '/api/tenders');
const authGuardLine = tendersGetRoute.match(/if \(!canViewTenders\(currentProfile\)\) \{ const error = new Error\('[^']+'\); error\.status = 403; throw error; \}/)[0];
const serverDeltaRoute = extractRoute(serverSrc, '/api/tenders/radar-runs/delta');
const apiDeltaRoute = extractRoute(apiSrc, '/api/tenders/radar-runs/delta');
assert.equal(serverDeltaRoute, apiDeltaRoute, '/api/tenders/radar-runs/delta debe replicarse exactamente entre server/index.js y api/[...path].js');
assert.ok(serverDeltaRoute.includes(authGuardLine), '/api/tenders/radar-runs/delta debe exigir exactamente la misma autorización que GET /api/tenders');

// 3. El snapshot del Corte 3 nunca se graba dentro del catch fatal de persistTenderRadar: ahí
//    `diagnostics` puede seguir en `[]` (fallo antes de que el pipeline reporte nada por fuente), sin
//    datos confiables de candidatos con los que construir un snapshot válido para esa corrida.
const serverPersist = extractFunction(serverSrc, 'persistTenderRadar');
const catchIdx = serverPersist.indexOf('} catch (fatalError)');
assert.ok(catchIdx !== -1, 'persistTenderRadar debe tener un catch (fatalError)');
const tryBody = serverPersist.slice(0, catchIdx);
const catchBody = serverPersist.slice(catchIdx);
assert.match(tryBody, /recordAgt002RadarRunSnapshot\(/, 'el snapshot del Corte 3 debe grabarse en el camino feliz/parcial de persistTenderRadar');
assert.doesNotMatch(catchBody, /recordAgt002RadarRunSnapshot\(/, 'el snapshot del Corte 3 nunca debe intentarse grabar en el camino fatal (sin datos confiables de candidatos)');

// 4. buildAgt002RadarRunSnapshotReceiptFromRun debe calcular, por fila, una sola fecha canónica con
//    resolveCanonicalTenderDeadline(row) —la misma autoridad de raw.deadline YYYY-MM-DD del fix #264
//    que ya usa dbTenderToPublic— y reusar ese mismo resultado tanto para canonicalRadarSnapshotDeadline
//    como para el deadline_at que recibe evaluateTenderFit, de modo que el fit del snapshot del Corte 3
//    nunca diverja del fit que ve la UI (dbTenderToPublic) para la misma fila. La paridad server/api de
//    esta función ya la cubre la aserción 1 (byte-idénticos), así que basta razonar sobre server/index.js.
const serverSnapshotReceiptFn = extractFunction(serverSrc, 'buildAgt002RadarRunSnapshotReceiptFromRun');

assert.match(
  serverSnapshotReceiptFn,
  /const (?<canon>\w+)\s*=\s*resolveCanonicalTenderDeadline\(row\);[\s\S]*?canonicalRadarSnapshotDeadline\(\k<canon>\)/,
  'canonicalRadarSnapshotDeadline debe aplicarse sobre la fecha canónica resuelta con resolveCanonicalTenderDeadline(row), no sobre row.deadline_at directamente (pierde la autoridad de raw.deadline del fix #264)'
);

assert.match(
  serverSnapshotReceiptFn,
  /const (?<canon>\w+)\s*=\s*resolveCanonicalTenderDeadline\(row\);[\s\S]*?evaluateTenderFit\(\{\s*\.\.\.row,\s*deadline_at:\s*\k<canon>\s*\},\s*\{\s*nowIso\s*\}\)/,
  'evaluateTenderFit debe recibir deadline_at igual a la fecha canónica del snapshot (igual que dbTenderToPublic), para que el fit del snapshot no diverja del que ve la UI'
);

// 5. El build+record del snapshot del Corte 3 debe vivir en su propio try/catch LOCAL, después de la
//    llamada feliz/parcial a recordAgt002RadarRunReceipt y antes de leer/retornar el Radar. Si no tiene
//    su propio catch, una falla auxiliar al grabar el snapshot (p. ej. un error transitorio de DB) cae
//    al catch fatal exterior de persistTenderRadar, que vuelve a llamar recordAgt002RadarRunReceipt con
//    un recibo 'failed' y sobrescribe el recibo exitoso que ya se grabó unas líneas antes. El catch
//    local tampoco debe relanzar (el snapshot es best-effort, igual que el recibo fatal lo es en el
//    catch exterior) ni volver a llamar recordAgt002RadarRunReceipt.
function skipBalancedCall(src, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  for (; i < src.length && depth > 0; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') depth -= 1;
  }
  return i;
}

function skipBalancedBlock(src, openBraceIdx) {
  let depth = 1;
  let i = openBraceIdx + 1;
  for (; i < src.length && depth > 0; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return i;
}

const happyReceiptMarker = 'await recordAgt002RadarRunReceipt(';
const happyReceiptIdx = tryBody.indexOf(happyReceiptMarker);
assert.ok(happyReceiptIdx !== -1, 'persistTenderRadar debe grabar el recibo feliz/parcial con recordAgt002RadarRunReceipt dentro del try');
const happyReceiptOpenParenIdx = happyReceiptIdx + happyReceiptMarker.length - 1;
const happyReceiptCallEndIdx = skipBalancedCall(tryBody, happyReceiptOpenParenIdx);
const afterHappyReceiptSemiIdx = tryBody.indexOf(';', happyReceiptCallEndIdx);
const afterHappyReceiptCall = tryBody.slice(afterHappyReceiptSemiIdx + 1);

const localTryIdx = afterHappyReceiptCall.indexOf('try {');
assert.ok(
  localTryIdx !== -1,
  'el build+record del snapshot del Corte 3 debe vivir en un try local propio, después de recordAgt002RadarRunReceipt'
);
const localTryBraceIdx = afterHappyReceiptCall.indexOf('{', localTryIdx);
const localTryEndIdx = skipBalancedBlock(afterHappyReceiptCall, localTryBraceIdx);
const localTryBody = afterHappyReceiptCall.slice(localTryBraceIdx, localTryEndIdx);

const afterLocalTry = afterHappyReceiptCall.slice(localTryEndIdx);
const catchMatch = afterLocalTry.match(/^\s*catch\s*(\([^)]*\))?\s*\{/);
assert.ok(
  catchMatch,
  'el try local del Corte 3 debe tener su propio catch inmediatamente después (no debe depender del catch fatal exterior)'
);
const localCatchBraceIdx = catchMatch[0].length - 1;
const localCatchEndIdx = skipBalancedBlock(afterLocalTry, localCatchBraceIdx);
const localCatchBody = afterLocalTry.slice(localCatchBraceIdx, localCatchEndIdx);
const afterLocalCatch = afterLocalTry.slice(localCatchEndIdx);

assert.match(
  localTryBody,
  /recordAgt002RadarRunSnapshot\(/,
  'el build+record del snapshot del Corte 3 debe estar dentro de su try local'
);
assert.doesNotMatch(
  localCatchBody,
  /throw/,
  'el catch local del Corte 3 nunca debe relanzar (el snapshot es best-effort, no debe tumbar una corrida ya exitosa)'
);
assert.doesNotMatch(
  localCatchBody,
  /recordAgt002RadarRunReceipt\(/,
  'el catch local del Corte 3 nunca debe volver a llamar recordAgt002RadarRunReceipt (pisaría el recibo exitoso ya grabado)'
);

const readPersistedIdx = afterLocalCatch.indexOf('readPersistedTenderRadar(');
assert.ok(
  readPersistedIdx !== -1,
  'la lectura del Radar persistido debe seguir después del try/catch local del Corte 3'
);
const returnIdx = afterLocalCatch.indexOf('return', readPersistedIdx);
assert.ok(
  returnIdx !== -1,
  'el return del Radar debe seguir después del try/catch local del Corte 3 y de leer el Radar persistido'
);

console.log('AGT-002 radar run delta server/api parity + fatal-path structural checks (Corte 3) — expected to fail until the /delta route and its wiring exist');
