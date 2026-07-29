import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
assert.equal(vercel, server, 'server/index.js y api/[...path].js deben ser byte-idénticos');

const importMatch = server.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/agt002-workbench-api\.js';/);
assert.ok(importMatch, 'falta import de agt002-workbench-api.js en server/index.js');
for (const name of [
  'getAgt002WorkbenchApi',
  'postAgt002MessageApi',
  'postAgt002RetryApi',
  'postAgt002LearningReviewApi',
]) {
  assert.ok(importMatch[1].includes(name), `falta import de ${name}`);
}

// Fase B2: el gate de la API humana y el del drain, y el propio drain, se importan
// del runtime en lugar de reimplementarse.
const runtimeImportMatch = server.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/agt002-workbench-runtime\.js';/s);
assert.ok(runtimeImportMatch, 'falta import de agt002-workbench-runtime.js en server/index.js');
for (const name of ['isAgt002WorkbenchApiEnabled', 'isAgt002WorkbenchDrainEnabled', 'createAgt002WorkbenchDrain']) {
  assert.ok(runtimeImportMatch[1].includes(name), `falta import de ${name}`);
}

const ROUTES = [
  { method: 'get', path: '/api/tender-dossier-workbench' },
  { method: 'post', path: '/api/tender-dossier-workbench/messages' },
  { method: 'post', path: '/api/tender-dossier-workbench/jobs/retry' },
  { method: 'post', path: '/api/tender-dossier-workbench/learning/review' },
];

for (const { method, path } of ROUTES) {
  assert.ok(server.includes(`app.${method}('${path}'`), `falta ruta ${method.toUpperCase()} ${path}`);
  const allIndex = server.indexOf(`app.all('${path}'`);
  assert.notEqual(allIndex, -1, `falta app.all 405 para ${path}`);
  const snippet = server.slice(allIndex, allIndex + 220);
  assert.match(snippet, /status\(405\)/, `app.all de ${path} no responde 405`);
}

// El wiring de las 4 rutas humanas ya no es un literal apagado: usa el gate exacto
// de motor importado del runtime, evaluado en vivo por solicitud. No debe quedar
// ningún rastro del antiguo literal `false` cableado a mano.
assert.doesNotMatch(server, /AGT002_WORKBENCH_RUNTIME_ENABLED/, 'el antiguo literal apagado a mano debe eliminarse por completo');
const wiringCount = (server.match(/enabled:\s*isAgt002WorkbenchApiEnabled\(process\.env\)/g) || []).length;
assert.equal(wiringCount, 4, 'las 4 rutas humanas deben usar el gate exacto de motor evaluado en vivo, no otra fuente');

// --- Fase B2: endpoint acotado y protegido por secreto para el drain ---
const WORKER_ROUTE = '/api/tender-dossier-workbench/worker/run';
assert.ok(server.includes(`app.post('${WORKER_ROUTE}'`), `falta la ruta POST ${WORKER_ROUTE}`);
assert.ok(!server.includes(`app.get('${WORKER_ROUTE}'`), 'el endpoint del drain debe ser exclusivamente POST, sin compatibilidad GET');
const workerAllIndex = server.indexOf(`app.all('${WORKER_ROUTE}'`);
assert.notEqual(workerAllIndex, -1, `falta app.all 405 para ${WORKER_ROUTE}`);
assert.match(server.slice(workerAllIndex, workerAllIndex + 220), /status\(405\)/, 'app.all del drain no responde 405');

// Sólo debe existir una definición de secretMatches (reutilizada, no reimplementada).
const secretMatchesDefs = (server.match(/function secretMatches\(/g) || []).length;
assert.equal(secretMatchesDefs, 1, 'secretMatches no debe reimplementarse; debe reutilizarse la única definición existente');

// El autorizador del drain: mismo patrón probado que el worker de licitaciones.
const authFnStart = server.indexOf('function isAgt002WorkbenchWorkerAuthorized');
assert.notEqual(authFnStart, -1, 'falta el autorizador dedicado del drain de la Mesa Vig-IA');
const authFnEnd = server.indexOf('\n}', authFnStart);
const authBlock = server.slice(authFnStart, authFnEnd);
assert.match(authBlock, /secretMatches\(/, 'el autorizador debe reutilizar secretMatches (comparación en tiempo constante)');
assert.match(authBlock, /AGT002_WORKBENCH_WORKER_SECRET/, 'debe autenticar contra AGT002_WORKBENCH_WORKER_SECRET');
assert.match(authBlock, /x-agt002-workbench-secret/, 'debe leer el header dedicado x-agt002-workbench-secret');
assert.match(authBlock, /CRON_SECRET/, 'debe aceptar también CRON_SECRET como bearer, igual que el patrón probado del worker de licitaciones');
assert.match(authBlock, /req\.headers\.authorization/, 'debe leer Authorization Bearer para CRON_SECRET');

// El handler del drain: sin sesión, sin actor_id, cupo de una sola corrida, salida saneada.
const handlerStart = server.indexOf(`app.post('${WORKER_ROUTE}'`);
const handlerEnd = server.indexOf(`app.all('${WORKER_ROUTE}'`);
const handlerBlock = server.slice(Math.max(0, handlerStart - 1500), handlerStart).concat(server.slice(handlerStart, handlerEnd));
assert.ok(!handlerBlock.includes('getAuthContext'), 'el endpoint del drain no debe requerir sesión de navegador');
assert.ok(!/req\.body\??\.actor_id/.test(handlerBlock) && !/req\.query\??\.actor_id/.test(handlerBlock), 'el endpoint del drain nunca debe leer/aceptar actor_id');
assert.match(handlerBlock, /createAgt002WorkbenchDrain\(/, 'el handler debe construir el drain de la Mesa Vig-IA');
assert.match(handlerBlock, /\.runOnce\(\)/, 'el handler debe invocar runOnce exactamente una vez');
assert.equal((handlerBlock.match(/\.runOnce\(\)/g) || []).length, 1, 'el handler no debe invocar runOnce más de una vez por solicitud');
assert.match(handlerBlock, /isAgt002WorkbenchDrainEnabled\(/, 'el handler debe re-chequear el gate del drain antes de nada más');
assert.match(handlerBlock, /status\(404\)|error\.status\s*=\s*404/, 'el gate apagado/ inválido debe responder 404');
assert.match(handlerBlock, /status\(403\)|error\.status\s*=\s*403/, 'la autenticación fallida debe responder 403');
assert.match(handlerBlock, /status\(503\)/, 'los fallos inesperados deben mapearse a 503 saneado');
assert.match(handlerBlock, /AGT002_WORKBENCH_WORKER_UNAVAILABLE/, 'el 503 debe llevar un código estable');

// El 503 nunca debe filtrar el error crudo (ni mensaje de la BD ni del modelo).
const unavailableIndex = handlerBlock.indexOf('AGT002_WORKBENCH_WORKER_UNAVAILABLE');
const unavailableLine = handlerBlock.slice(Math.max(0, unavailableIndex - 200), unavailableIndex + 50);
assert.ok(!/error\.message|error\?\.message|String\(error\)/.test(unavailableLine), 'el 503 no debe interpolar el error crudo');

// No debe exponerse un endpoint interno de reclamo de trabajos por HTTP: la única
// superficie de ejecución del drain es el endpoint acotado y protegido por secreto
// añadido en la Fase B2 (una sola corrida por invocación), no un endpoint de claim
// arbitrario.
assert.ok(!/tender-dossier-workbench\/jobs\/claim/.test(server), 'no debe registrarse un endpoint interno de claim de trabajos');

console.log('AGT-002 workbench endpoint static checks passed');
