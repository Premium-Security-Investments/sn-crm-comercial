import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: ExecStartPre (agt002-bridge.service) makes a missing file on /opt/agt002-bridge fail
// the *entire* service start, not just the capability gate. The runbook must enumerate every file
// this hotfix touches or adds, so an operator copying artifacts before a restart cannot miss one.
const runbook = readFileSync(new URL('../docs/runbooks/agt002-hetzner-bridge-effort-capability.md', import.meta.url), 'utf8');

const REQUIRED_DEPLOYED_FILES = [
  'agt002-codex-effort-capability.js',
  'ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs',
  'agt002-hetzner-bridge-server.js',
  'agt002-hetzner-bridge-log.js',
  'agt002-preview-codex-client.js',
  'agt002-preview-reasoning-effort.js',
  'ops/agt002-hetzner-bridge/run-server.mjs',
  'ops/agt002-hetzner-bridge/agt002-bridge.service',
];

function testRunbookListsEveryFileTheHotfixTouches() {
  for (const file of REQUIRED_DEPLOYED_FILES) {
    assert.ok(runbook.includes(file), `el runbook debe listar '${file}' como requerido en /opt/agt002-bridge antes de reiniciar`);
  }
}

function testRunbookMentionsExecStartPreBlocksTheWholeService() {
  assert.match(runbook, /ExecStartPre/, 'el runbook debe explicar que ExecStartPre bloquea el arranque completo del servicio');
}

function testRunbookClarifiesBridgeClientIsNotDeployedToTheHost() {
  assert.ok(runbook.includes('agt002-hetzner-bridge-client.js'), 'el runbook debe mencionar agt002-hetzner-bridge-client.js');
  assert.ok(runbook.includes('no se copia a `/opt/agt002-bridge`'), 'el runbook debe aclarar que agt002-hetzner-bridge-client.js corre del lado del llamador, no en el host Hetzner');
}

testRunbookListsEveryFileTheHotfixTouches();
testRunbookMentionsExecStartPreBlocksTheWholeService();
testRunbookClarifiesBridgeClientIsNotDeployedToTheHost();
console.log('agt002-hetzner-bridge-effort-capability-runbook.test.mjs OK');
