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

// Regression: `run-server.mjs` is the unit's ExecStart entrypoint and imports repo-root modules with
// '../../'. Every one of those must be in the manifest too — a missing one is not a degraded feature
// but an unresolvable import, so ExecStart dies at boot exactly like a missing ExecStartPre file.
function testRunbookListsEveryRootImportOfTheExecStartEntrypoint() {
  const entrypoint = readFileSync(new URL('../ops/agt002-hetzner-bridge/run-server.mjs', import.meta.url), 'utf8');
  const imported = [...entrypoint.matchAll(/from\s+'\.\.\/\.\.\/([\w-]+\.js)'/g)].map(match => match[1]);
  assert.ok(imported.length > 0, 'run-server.mjs debe importar módulos de la raíz del repo con ../../');
  for (const file of imported) {
    assert.ok(runbook.includes(file), `el runbook debe listar '${file}' como requerido en /opt/agt002-bridge: 'ops/agt002-hetzner-bridge/run-server.mjs' (ExecStart) lo importa directamente`);
  }
}

// Regression: the manual pre-deploy gate is only meaningful if it runs in the SAME context systemd
// gives ExecStartPre — the agt002-bridge service user, CODEX_HOME=/opt/agt002-bridge/.codex and the
// Codex binary actually installed for that user. Run as the operator/root with their own CODEX_HOME
// it validates a different Codex install and a different session, so it can pass while the real
// service start still fails (or the reverse).
function testRunbookManualCommandRunsInTheRealServiceContext() {
  const flattened = runbook.replace(/\\\n\s*/g, ' ');
  const manual = flattened.match(/^sudo -u agt002-bridge env [^\n]*check-codex-effort-capability\.mjs\s*$/m);
  assert.ok(manual, 'el runbook debe ejecutar el gate manual como el usuario del servicio (sudo -u agt002-bridge env ...)');
  assert.match(manual[0], /CODEX_HOME=\/opt\/agt002-bridge\/\.codex/, 'el comando manual debe fijar el CODEX_HOME real del servicio, no el del operador/root');
  assert.match(manual[0], /AGT002_CODEX_APP_SERVER_BIN=\/opt\/agt002-bridge\/\.local\/node_modules\/\.bin\/codex/, 'el comando manual debe apuntar al binario real de Codex instalado para el servicio');
  assert.match(manual[0], /\/opt\/agt002-bridge\/ops\/agt002-hetzner-bridge\/check-codex-effort-capability\.mjs/, 'el comando manual debe usar la ruta desplegada del script, no una ruta relativa al checkout');
  assert.doesNotMatch(
    runbook,
    /^\s*node ops\/agt002-hetzner-bridge\/check-codex-effort-capability\.mjs\s*$/m,
    'el runbook no debe ofrecer la invocación relativa que corre con el CODEX_HOME del operador/root',
  );
}

function testRunbookMentionsExecStartPreBlocksTheWholeService() {
  assert.match(runbook, /ExecStartPre/, 'el runbook debe explicar que ExecStartPre bloquea el arranque completo del servicio');
}

function testRunbookClarifiesBridgeClientIsNotDeployedToTheHost() {
  assert.ok(runbook.includes('agt002-hetzner-bridge-client.js'), 'el runbook debe mencionar agt002-hetzner-bridge-client.js');
  assert.ok(runbook.includes('no se copia a `/opt/agt002-bridge`'), 'el runbook debe aclarar que agt002-hetzner-bridge-client.js corre del lado del llamador, no en el host Hetzner');
}

// Regression: the real `codex --strict-config ... app-server generate-json-schema` call fails
// unconditionally (exit 1, "--strict-config is not supported for codex app-server
// generate-json-schema"). The runbook must document that this is two SEPARATE checks — schema
// generation without --strict-config, and a separate real app-server initialize handshake with
// --strict-config — never a single combined generate-json-schema call with --strict-config.
function testRunbookDocumentsTwoSeparateChecks() {
  assert.match(runbook, /--strict-config is not supported for codex app-server generate-json-schema/, 'el runbook debe documentar el fallo real de --strict-config contra generate-json-schema');
  assert.match(runbook, /initialize/, 'el runbook debe documentar que la verificación B usa el handshake initialize del App Server');
  assert.doesNotMatch(
    runbook,
    /codex --strict-config -c 'model_reasoning_effort="low"' app-server generate-json-schema/,
    'el runbook no debe describir --strict-config aplicado a generate-json-schema como un procedimiento válido',
  );
}

testRunbookListsEveryFileTheHotfixTouches();
testRunbookListsEveryRootImportOfTheExecStartEntrypoint();
testRunbookManualCommandRunsInTheRealServiceContext();
testRunbookMentionsExecStartPreBlocksTheWholeService();
testRunbookClarifiesBridgeClientIsNotDeployedToTheHost();
testRunbookDocumentsTwoSeparateChecks();
console.log('agt002-hetzner-bridge-effort-capability-runbook.test.mjs OK');
