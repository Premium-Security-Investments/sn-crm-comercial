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

// El wiring debe ser un literal apagado, sin lectura de variables de entorno.
assert.match(server, /const AGT002_WORKBENCH_RUNTIME_ENABLED\s*=\s*false;/, 'falta el kill switch literal');
const flagLine = server.split('\n').find(line => line.includes('AGT002_WORKBENCH_RUNTIME_ENABLED ='));
assert.ok(flagLine && !/process\.env/.test(flagLine), 'el kill switch no puede leer variables de entorno');
const wiringCount = (server.match(/enabled:\s*AGT002_WORKBENCH_RUNTIME_ENABLED/g) || []).length;
assert.equal(wiringCount, 4, 'las 4 rutas deben usar el literal AGT002_WORKBENCH_RUNTIME_ENABLED, no otra fuente');

// No debe exponerse un endpoint interno de worker (reclamo de trabajos) en este lote.
assert.ok(!/tender-dossier-workbench\/jobs\/claim/.test(server), 'no debe registrarse un endpoint interno de worker');

console.log('AGT-002 workbench endpoint static checks passed');
