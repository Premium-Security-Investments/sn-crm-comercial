import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unit = readFileSync(new URL('../ops/agt002-hetzner-bridge/agt002-bridge.service', import.meta.url), 'utf8');

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

testPrivateTmpIsEnabled();
testCodexHomeIsPinnedUnderOptNotHome();
testReadWritePathsCoversCodexHomeAndVar();
testProtectSystemStrictStillPresent();
console.log('agt002-hetzner-bridge-service-artifact.test.mjs OK');
