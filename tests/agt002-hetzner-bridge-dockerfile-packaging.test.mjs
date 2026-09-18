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
  'agt002-claude-client.js',
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

function testDockerfileCopiesAgt002BridgeHostModule() {
  const copied = dockerfileCopiedRootFiles();
  assert.ok(copied.has('agt002-bridge-host.js'), "el Dockerfile debe COPY 'agt002-bridge-host.js' porque run-server.mjs lo importa");
}

function testDockerfileFixesContainerListenHostToWildcard() {
  assert.match(dockerfile, /^ENV AGT002_BRIDGE_LISTEN_HOST=0\.0\.0\.0$/m, "el Dockerfile debe fijar ENV AGT002_BRIDGE_LISTEN_HOST=0.0.0.0 para aceptar conexiones dentro del contenedor");
}

function testEnvExampleDocumentsBareMetalDefaultAndDockerPublishing() {
  const envExample = read('ops/agt002-hetzner-bridge/env.example');
  assert.match(envExample, /127\.0\.0\.1/, 'env.example debe documentar el default bare-metal 127.0.0.1');
  assert.match(envExample, /127\.0\.0\.1:\$\{HOST_PORT\}:\$\{CONTAINER_PORT\}/, 'env.example debe documentar la publicación Docker limitada a loopback del host');
  const bareWildcardLines = envExample.split('\n').filter(
    line => /-p \$\{HOST_PORT\}:\$\{CONTAINER_PORT\}/.test(line) && !line.includes('127.0.0.1'),
  );
  for (const line of bareWildcardLines) {
    assert.match(line, /nunca/i, `toda mención de publicar el puerto sin loopback debe marcarse explícitamente como prohibida: "${line}"`);
  }
}

testDockerfileCopiesEveryDirectLocalImportOfBridgeRuntimeFiles();
testRunbookRequiredFilesCoverEveryDirectLocalImportOfBridgeRuntimeFiles();
testDockerfileCopiesAgt002BridgeHostModule();
testDockerfileFixesContainerListenHostToWildcard();
testEnvExampleDocumentsBareMetalDefaultAndDockerPublishing();
console.log('agt002-hetzner-bridge-dockerfile-packaging.test.mjs OK');
