import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: after the Codex -> Claude Sonnet cutover, `run-server.mjs` (ExecStart) imports
// `agt002-claude-client.js` instead of the Codex App Server client, and the unit has no
// ExecStartPre. The runbook must enumerate every file this entrypoint needs to boot, so an
// operator copying artifacts before a restart cannot miss one.
const runbook = readFileSync(new URL('../docs/runbooks/agt002-hetzner-bridge-effort-capability.md', import.meta.url), 'utf8');

const REQUIRED_DEPLOYED_FILES = [
  'agt002-claude-client.js',
  'agt002-hetzner-bridge-server.js',
  'agt002-hetzner-bridge-auth.js',
  'agt002-hetzner-bridge-signing.js',
  'agt002-hetzner-bridge-nonce-store.js',
  'agt002-hetzner-bridge-log.js',
  'agt002-preview-reasoning-effort.js',
  'agt002-bridge-host.js',
  'ops/agt002-hetzner-bridge/run-server.mjs',
  'ops/agt002-hetzner-bridge/agt002-bridge.service',
];

function testRunbookListsEveryFileTheCutoverTouches() {
  for (const file of REQUIRED_DEPLOYED_FILES) {
    assert.ok(runbook.includes(file), `el runbook debe listar '${file}' como requerido en /opt/agt002-bridge antes de reiniciar`);
  }
}

// Regression: `run-server.mjs` is the unit's ExecStart entrypoint and imports repo-root modules with
// '../../'. Every one of those must be in the manifest too — a missing one is not a degraded feature
// but an unresolvable import, so ExecStart dies at boot.
function testRunbookListsEveryRootImportOfTheExecStartEntrypoint() {
  const entrypoint = readFileSync(new URL('../ops/agt002-hetzner-bridge/run-server.mjs', import.meta.url), 'utf8');
  const imported = [...entrypoint.matchAll(/from\s+'\.\.\/\.\.\/([\w-]+\.js)'/g)].map(match => match[1]);
  assert.ok(imported.length > 0, 'run-server.mjs debe importar módulos de la raíz del repo con ../../');
  for (const file of imported) {
    assert.ok(runbook.includes(file), `el runbook debe listar '${file}' como requerido en /opt/agt002-bridge: 'ops/agt002-hetzner-bridge/run-server.mjs' (ExecStart) lo importa directamente`);
  }
}

function testRunbookStatesProviderIsClaudeSonnet() {
  assert.match(runbook, /Claude Sonnet/, 'el runbook debe declarar que el proceso Hetzner es Claude Sonnet');
  assert.ok(runbook.includes('agt002-claude-client.js'), 'el runbook debe nombrar agt002-claude-client.js como cliente del proveedor');
}

// Regression: the unit no longer declares ExecStartPre, so a runbook that still treats it as the
// authoritative pre-start gate describes a service that does not exist on disk. The runbook must say
// so explicitly, and the unit file itself must have none, as a live cross-check.
function testRunbookHasNoExecStartPreGate() {
  const service = readFileSync(new URL('../ops/agt002-hetzner-bridge/agt002-bridge.service', import.meta.url), 'utf8');
  assert.doesNotMatch(service, /ExecStartPre/, 'la unidad no debe declarar ExecStartPre (regresión: verificación viva contra el archivo real)');
  assert.match(runbook, /no (hay|declara|tiene) .*ExecStartPre/i, 'el runbook debe documentar explícitamente que la unidad ya no declara ExecStartPre');
  assert.doesNotMatch(runbook, /CODEX_HOME/, 'el runbook no debe seguir mencionando CODEX_HOME: el proveedor ya no es Codex');
  assert.doesNotMatch(runbook, /check-codex-effort-capability\.mjs/, 'el runbook no debe invocar un script de capacidad de Codex que la unidad ya no ejecuta');
  assert.doesNotMatch(runbook, /generate-json-schema/, 'el runbook no debe seguir describiendo el chequeo de esquema del App Server de Codex');
  assert.match(runbook, /CLAUDE_CONFIG_DIR=\/opt\/agt002-bridge\/\.claude/, 'el runbook debe nombrar el CLAUDE_CONFIG_DIR real de la unidad');
}

// Regression: the manual pre-restart check must match what actually boots the service: the
// agt002-bridge user, CLAUDE_CONFIG_DIR/HOME the unit declares, and the claude CLI the service
// user can actually run — never an invented Codex capability script.
function testRunbookDocumentsRealPreRestartCheck() {
  assert.match(runbook, /User=agt002-bridge/, 'el runbook debe confirmar el User= real de la unidad en el chequeo previo al reinicio');
  assert.match(runbook, /HOME=\/opt\/agt002-bridge/, 'el runbook debe confirmar el HOME= real de la unidad');
  assert.match(runbook, /AGT002_CLAUDE_CLI_BIN/, 'el runbook debe mencionar la variable que permite fijar el binario de claude');
}

// Regression: the Vercel client still requires effort_ack or it throws AGT002_BRIDGE_STALE_EFFORT_ACK,
// but the Claude CLI print mode ignores `effort` entirely — the runbook must document both facts so an
// operator does not conclude effort is applied to the model.
function testRunbookDocumentsEffortAckWithoutApplication() {
  assert.match(runbook, /effort_ack/, 'el runbook debe documentar que la respuesta sigue trayendo effort_ack');
  assert.match(runbook, /AGT002_BRIDGE_STALE_EFFORT_ACK/, 'el runbook debe explicar por qué effort_ack se sigue emitiendo (evitar AGT002_BRIDGE_STALE_EFFORT_ACK)');
  assert.match(runbook, /ignora\s+`effort`|no aplica\s+`effort`/, 'el runbook debe aclarar que `effort` no se aplica al CLI de Claude');
}

function testRunbookClarifiesBridgeClientIsNotDeployedToTheHost() {
  assert.ok(runbook.includes('agt002-hetzner-bridge-client.js'), 'el runbook debe mencionar agt002-hetzner-bridge-client.js');
  assert.ok(runbook.includes('no se copia a `/opt/agt002-bridge`'), 'el runbook debe aclarar que agt002-hetzner-bridge-client.js corre del lado del llamador, no en el host Hetzner');
}

function testRunbookNeverMentionsAgt003() {
  assert.doesNotMatch(runbook.toLowerCase(), /agt-003|agt003/, 'el runbook de AGT-002 nunca debe mencionar a AGT-003');
}

testRunbookListsEveryFileTheCutoverTouches();
testRunbookListsEveryRootImportOfTheExecStartEntrypoint();
testRunbookStatesProviderIsClaudeSonnet();
testRunbookHasNoExecStartPreGate();
testRunbookDocumentsRealPreRestartCheck();
testRunbookDocumentsEffortAckWithoutApplication();
testRunbookClarifiesBridgeClientIsNotDeployedToTheHost();
testRunbookNeverMentionsAgt003();
console.log('agt002-hetzner-bridge-effort-capability-runbook.test.mjs OK');
