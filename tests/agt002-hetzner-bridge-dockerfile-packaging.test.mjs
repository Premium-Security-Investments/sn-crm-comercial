import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression: the bridge Dockerfile COPYs the bridge runtime/capability files by name into a flat
// /opt/agt002-bridge, so any direct local ('./foo.js') import those files make must also be present
// in the COPY list — otherwise `node` cannot resolve the import and the packaged bridge never boots.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const dockerfile = read('ops/agt002-hetzner-bridge/Dockerfile');
const runbook = read('docs/runbooks/agt002-hetzner-bridge-effort-capability.md');

const BRIDGE_RUNTIME_FILES = [
  'agt002-hetzner-bridge-signing.js',
  'agt002-hetzner-bridge-nonce-store.js',
  'agt002-hetzner-bridge-log.js',
  'agt002-hetzner-bridge-auth.js',
  'agt002-hetzner-bridge-server.js',
  'agt002-preview-codex-client.js',
  'agt002-codex-effort-capability.js',
];

function dockerfileCopiedRootFiles() {
  const copyLine = dockerfile.split('\n').find(line => line.startsWith('COPY ') && line.includes('agt002-hetzner-bridge-server.js'));
  assert.ok(copyLine, 'el Dockerfile debe tener una línea COPY para los módulos raíz del bridge');
  const tokens = copyLine.replace('COPY ', '').trim().split(/\s+/);
  return new Set(tokens.slice(0, -1));
}

function directLocalImports(source) {
  return [...source.matchAll(/from\s+'\.\/([\w-]+\.js)'/g)].map(m => m[1]);
}

function testDockerfileCopiesEveryDirectLocalImportOfBridgeRuntimeFiles() {
  const copied = dockerfileCopiedRootFiles();
  for (const file of BRIDGE_RUNTIME_FILES) {
    const source = read(file);
    for (const imported of directLocalImports(source)) {
      assert.ok(
        copied.has(imported),
        `el Dockerfile debe COPY '${imported}' porque '${file}' lo importa directamente`,
      );
    }
  }
}

function testRunbookRequiredFilesCoverEveryDirectLocalImportOfBridgeRuntimeFiles() {
  for (const file of BRIDGE_RUNTIME_FILES) {
    const source = read(file);
    for (const imported of directLocalImports(source)) {
      assert.ok(
        runbook.includes(imported),
        `el runbook debe listar '${imported}' como requerido porque '${file}' lo importa directamente`,
      );
    }
  }
}

testDockerfileCopiesEveryDirectLocalImportOfBridgeRuntimeFiles();
testRunbookRequiredFilesCoverEveryDirectLocalImportOfBridgeRuntimeFiles();
console.log('agt002-hetzner-bridge-dockerfile-packaging.test.mjs OK');
