// Revisión previa (preflight) de Vig-IA retirada (puerta única de modelos, 2026-10-09).
// La ruta sigue autenticando, pero responde 410 sin construir el runtime, sin llamar al puente y sin consumir cupo.
// El motor (agt003-preflight-*.js) se conserva y mantiene sus propias pruebas unitarias.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

for (const [name, url] of [
  ['server', new URL('../server/index.js', import.meta.url)],
  ['vercel', new URL('../api/[...path].js', import.meta.url)],
]) {
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes("'POST /api/vigia/copilot/preflight': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]"), `${name} keeps preflight in the inventory`);
  assert.ok(source.includes("app.post('/api/vigia/copilot/preflight'"), `${name} still answers preflight`);
  assert.ok(source.includes("app.all('/api/vigia/copilot/preflight'"), `${name} rejects wrong methods`);
  assert.ok(source.includes("const AGT003_PREFLIGHT_RETIRED_MESSAGE = 'La revisión previa de Vig-IA está retirada.';"), `${name} has the retired message`);

  const start = source.indexOf("app.post('/api/vigia/copilot/preflight'");
  const end = source.indexOf("app.all('/api/vigia/copilot/preflight'", start);
  const route = source.slice(start, end);
  assert.ok(route.indexOf('getAuthContext(req)') > -1, `${name} authenticates before answering`);
  assert.ok(route.indexOf('getAuthContext(req)') < route.indexOf('res.status(410)'), `${name} answers 410 after authentication`);
  assert.ok(route.includes('res.status(410).json({ error: AGT003_PREFLIGHT_RETIRED_MESSAGE })'), `${name} answers 410 with the retired message`);
  assert.doesNotMatch(route, /preflight\(|createRuntime|Runtime|claim|requireDb|rpc\(/, `${name} never builds the runtime, calls the bridge nor claims quota`);

  assert.ok(!source.includes('createBackendAgt003PreflightApi'), `${name} no longer wires the preflight API`);
  assert.ok(!source.includes("from '../agt003-preflight-api.js'"), `${name} no longer imports the preflight API`);
  assert.ok(!source.includes("from '../agt003-preflight-runtime.js'"), `${name} no longer imports the preflight runtime`);
  assert.ok(!source.includes('AGT003_PREFLIGHT_API_KEY'), `${name} never receives a provider key`);
}

for (const file of ['agt003-preflight-api.js', 'agt003-preflight-engine.js', 'agt003-preflight-runtime.js', 'agt003-preflight-contract.js', 'agt003-preflight-input.js']) {
  assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} (motor) se conserva`);
}

const server = readFileSync(new URL('../server/index.js', import.meta.url));
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url));
assert.deepEqual(server, vercel, 'backend entrypoints remain byte-identical');

console.log('AGT-003 preflight retirement contract passed');
