import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unit = readFileSync(new URL('../ops/agt002-hetzner-bridge/agt002-bridge.service', import.meta.url), 'utf8');
const caddyfile = readFileSync(new URL('../ops/agt002-hetzner-bridge/Caddyfile', import.meta.url), 'utf8');

function serviceLines(unitText) {
  return unitText.split('\n').map(line => line.trim()).filter(Boolean);
}

function testPrivateTmpIsEnabled() {
  const lines = serviceLines(unit);
  assert.ok(lines.includes('PrivateTmp=true'), 'La unidad debe aislar /tmp con PrivateTmp=true.');
}

function testClaudeConfigDirIsPinnedUnderOptNotHome() {
  assert.match(unit, /^Environment=CLAUDE_CONFIG_DIR=\/opt\/agt002-bridge\/\.claude$/m, 'CLAUDE_CONFIG_DIR debe fijarse explícitamente bajo /opt/agt002-bridge, no depender de $HOME.');
}

function testHomeIsPinnedUnderOpt() {
  assert.match(unit, /^Environment=HOME=\/opt\/agt002-bridge$/m, 'HOME debe fijarse a /opt/agt002-bridge para que el CLI de Claude pueda escribir bajo ProtectHome=true.');
}

function testReadWritePathsCoversClaudeConfigDirAndVar() {
  const readWriteLine = serviceLines(unit).find(line => line.startsWith('ReadWritePaths='));
  assert.ok(readWriteLine, 'La unidad debe declarar ReadWritePaths.');
  const paths = readWriteLine.slice('ReadWritePaths='.length).split(/\s+/).filter(Boolean);
  assert.ok(paths.includes('/opt/agt002-bridge/.claude'), 'ReadWritePaths debe permitir escritura en /opt/agt002-bridge/.claude (sesión OAuth de Claude Code).');
  assert.ok(paths.includes('/opt/agt002-bridge/var'), 'ReadWritePaths debe permitir escritura en /opt/agt002-bridge/var.');
}

function testCodexHomeIsNoLongerReferenced() {
  assert.doesNotMatch(unit, /CODEX_HOME/, 'la unidad ya no debe referenciar CODEX_HOME: AGT-002 dejó de invocar Codex.');
}

function testMemoryMaxAccountsForClaudeTurns() {
  const lines = serviceLines(unit);
  assert.ok(lines.includes('MemoryMax=1G'), 'un turno de Claude con salida larga sostiene picos por encima de 512 MiB.');
}

function testProtectSystemStrictStillPresent() {
  const lines = serviceLines(unit);
  assert.ok(lines.includes('ProtectSystem=strict'), 'ProtectSystem=strict debe permanecer: el endurecimiento no debe relajarse, solo abrirse explícitamente donde hace falta.');
  assert.ok(lines.includes('ProtectHome=true'), 'ProtectHome=true debe permanecer.');
}

function testCaddyUsesTheFixedLoopbackPort() {
  assert.match(caddyfile, /^\s*reverse_proxy 127\.0\.0\.1:8787\s*$/m, 'Caddy debe apuntar al puerto loopback fijo del bridge.');
  assert.doesNotMatch(caddyfile, /AGT002_BRIDGE_LISTEN_PORT/, 'Caddy no debe depender de una variable que su unidad systemd no recibe.');
}

// AGT-002 cut over from Codex to Claude Sonnet: the systemd unit no longer needs an
// ExecStartPre capability gate for a Codex binary it never spawns anymore.
function testNoExecStartPreRemainsForARemovedCodexGate() {
  const lines = serviceLines(unit);
  const execStartPre = lines.find(line => line.startsWith('ExecStartPre='));
  assert.equal(execStartPre, undefined, 'La unidad no debe declarar un ExecStartPre para un gate de Codex que ya no existe.');
}

testPrivateTmpIsEnabled();
testClaudeConfigDirIsPinnedUnderOptNotHome();
testHomeIsPinnedUnderOpt();
testReadWritePathsCoversClaudeConfigDirAndVar();
testCodexHomeIsNoLongerReferenced();
testMemoryMaxAccountsForClaudeTurns();
testProtectSystemStrictStillPresent();
testCaddyUsesTheFixedLoopbackPort();
testNoExecStartPreRemainsForARemovedCodexGate();
console.log('agt002-hetzner-bridge-service-artifact.test.mjs OK');
