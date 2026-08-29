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

function testCodexHomeIsPinnedUnderOptNotHome() {
  assert.match(unit, /^Environment=CODEX_HOME=\/opt\/agt002-bridge\/\.codex$/m, 'CODEX_HOME debe fijarse explícitamente bajo /opt/agt002-bridge, no depender de $HOME.');
}

function testReadWritePathsCoversCodexHomeAndVar() {
  const readWriteLine = serviceLines(unit).find(line => line.startsWith('ReadWritePaths='));
  assert.ok(readWriteLine, 'La unidad debe declarar ReadWritePaths.');
  const paths = readWriteLine.slice('ReadWritePaths='.length).split(/\s+/).filter(Boolean);
  assert.ok(paths.includes('/opt/agt002-bridge/.codex'), 'ReadWritePaths debe permitir escritura en /opt/agt002-bridge/.codex (sesión Codex).');
  assert.ok(paths.includes('/opt/agt002-bridge/var'), 'ReadWritePaths debe permitir escritura en /opt/agt002-bridge/var.');
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

// AGT-002 review blocker: the effort-capability gate must be mandatory, not a manual runbook step
// an operator can forget. A bridge whose installed Codex binary lacks v2 TurnStartParams.effort
// must fail to start at all, before it can ever route traffic with the stale reasoning-effort
// timeout bug reintroduced silently.
function testCapabilityCheckIsMandatoryBeforeStart() {
  const lines = serviceLines(unit);
  const execStartPre = lines.find(line => line.startsWith('ExecStartPre='));
  assert.ok(execStartPre, 'La unidad debe declarar ExecStartPre para el gate de capacidad de effort.');
  assert.equal(
    execStartPre,
    'ExecStartPre=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs',
    'ExecStartPre debe invocar el script de verificación de capacidad de effort con la ruta absoluta desplegada.',
  );
  const execStartPreIndex = lines.indexOf(execStartPre);
  const execStartIndex = lines.findIndex(line => line.startsWith('ExecStart='));
  assert.ok(execStartPreIndex < execStartIndex, 'ExecStartPre debe ejecutarse antes de ExecStart, para bloquear el arranque si el binario de Codex no es compatible.');
}

testPrivateTmpIsEnabled();
testCodexHomeIsPinnedUnderOptNotHome();
testReadWritePathsCoversCodexHomeAndVar();
testProtectSystemStrictStillPresent();
testCaddyUsesTheFixedLoopbackPort();
testCapabilityCheckIsMandatoryBeforeStart();
console.log('agt002-hetzner-bridge-service-artifact.test.mjs OK');
