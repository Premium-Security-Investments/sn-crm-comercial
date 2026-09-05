import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. Regresión estática: el puente gobernado AGT-002 no cambia con AGT-003.
// ---------------------------------------------------------------------------

const AGT002_INVARIANTS = [
  ['agt002-hetzner-bridge-server.js', [
    "const BRIDGE_PATH = '/v1/agt002-preview/run';",
    'export const AGT002_BRIDGE_MAX_BODY_BYTES = 1_048_576;',
    'AGT002_CODEX_TIMEOUT: 504,',
    'AGT002_CODEX_LOGIN_REQUIRED: 503,',
    "AGT002_BRIDGE_METHOD_NOT_ALLOWED'",
  ]],
  ['agt002-hetzner-bridge-auth.js', [
    "const REQUIRED_HEADERS = ['x-agt002-timestamp', 'x-agt002-nonce', 'x-agt002-signature'];",
    "code: 'AGT002_BRIDGE_AUTH_INVALID'",
  ]],
  ['agt002-bridge-host.js', [
    "export const AGT002_BRIDGE_HOST = 'agt002.5-78-140-24.sslip.io';",
    '/v1/agt002-preview/run',
  ]],
  ['agt002-hetzner-bridge-signing.js', [
    'export function buildCanonicalString({ method, path, bodySha256Hex, timestamp, nonce })',
    'createHmac(\'sha256\', secret)',
  ]],
  ['ops/agt002-hetzner-bridge/Caddyfile', [
    'agt002.5-78-140-24.sslip.io {',
    'reverse_proxy 127.0.0.1:8787',
  ]],
  ['ops/agt002-hetzner-bridge/agt002-bridge.service', [
    'User=agt002-bridge',
    'Environment=CLAUDE_CONFIG_DIR=/opt/agt002-bridge/.claude',
    'Environment=HOME=/opt/agt002-bridge',
    'ExecStart=/usr/bin/node /opt/agt002-bridge/ops/agt002-hetzner-bridge/run-server.mjs',
  ]],
  ['ops/agt002-hetzner-bridge/run-server.mjs', [
    "requireEnv('AGT002_BRIDGE_HMAC_SECRET')",
    "requireEnv('AGT002_BRIDGE_LISTEN_PORT')",
    'createAgt002ClaudeClient',
  ]],
];

// Archivos AGT-002 que legítimamente pasaron a nombrar a Claude como su propio
// proveedor tras el corte de Codex a Claude Sonnet. Ninguno de ellos puede
// mencionar AGT-003 ni su puerto dedicado (comprobado más abajo igual que el
// resto), pero sí pueden decir "claude".
const AGT002_CLAUDE_OWNING_FILES = new Set([
  'agt002-claude-client.js',
  'agt002-hetzner-bridge-server.js',
  'ops/agt002-hetzner-bridge/run-server.mjs',
  'ops/agt002-hetzner-bridge/agt002-bridge.service',
  'ops/agt002-hetzner-bridge/env.example',
]);

function testAgt002ContractsAreIntact() {
  for (const [path, needles] of AGT002_INVARIANTS) {
    const source = read(path);
    for (const needle of needles) {
      assert.ok(source.includes(needle), `${path} debe conservar intacto: ${needle}`);
    }
  }
}

// AGT-002 no debe adquirir ninguna dependencia ni ruta de AGT-003, ni compartir
// su puerto dedicado. Puede, en cambio, nombrar a Claude como SU PROPIO
// proveedor (tras el corte de Codex a Claude Sonnet) en los archivos que ahora
// lo poseen — nunca en el resto.
function testAgt002NeverReferencesAgt003OrClaude() {
  const files = [
    ...AGT002_INVARIANTS.map(([path]) => path),
    'agt002-preview-codex-client.js',
    'agt002-hetzner-bridge-log.js',
    'agt002-hetzner-bridge-nonce-store.js',
    'agt002-hetzner-bridge-client.js',
    'agt002-claude-client.js',
    'ops/agt002-hetzner-bridge/env.example',
  ];
  for (const path of files) {
    const source = read(path).toLowerCase();
    assert.equal(source.includes('agt003'), false, `${path} nunca debe referenciar AGT-003`);
    assert.equal(source.includes('8788'), false, `${path} nunca debe usar el puerto dedicado de AGT-003`);
    if (!AGT002_CLAUDE_OWNING_FILES.has(path)) {
      assert.equal(source.includes('claude'), false, `${path} nunca debe referenciar el proveedor de AGT-003`);
    }
  }
}

// El nuevo cliente de AGT-002 nunca debe compartir identidad de proceso con
// AGT-003 (usuario, config dir), aunque ambos hablen con el mismo CLI.
function testAgt002ClaudeClientNeverSharesAgt003Identity() {
  const source = read('agt002-claude-client.js');
  assert.equal(source.includes('agt003-bridge'), false, 'el cliente de AGT-002 nunca debe nombrar al usuario del sistema de AGT-003');
  assert.equal(source.includes('/opt/agt003-bridge'), false, 'el cliente de AGT-002 nunca debe nombrar el HOME/CLAUDE_CONFIG_DIR de AGT-003');
}

// El servidor de ejecución de AGT-002 debe construir el cliente Claude propio
// de AGT-002 y no debe seguir invocando el App Server de Codex.
function testAgt002RunServerUsesItsOwnClaudeClientNotCodex() {
  const source = read('ops/agt002-hetzner-bridge/run-server.mjs');
  assert.ok(source.includes("from '../../agt002-claude-client.js'"), 'run-server debe importar el cliente Claude de AGT-002');
  assert.equal(source.includes('createCodexAppServerClient'), false, 'run-server no debe seguir construyendo el cliente de Codex App Server');
  assert.equal(source.includes('agt002-preview-codex-client.js'), false, 'run-server no debe seguir importando el cliente de Codex');
  assert.equal(source.includes('AGT002_CODEX_APP_SERVER_BIN'), false, 'run-server no debe leer variables de configuración de Codex');
  assert.equal(source.includes('AGT002_CODEX_APP_SERVER_ARGS'), false, 'run-server no debe leer variables de configuración de Codex');
}

// ---------------------------------------------------------------------------
// 2. El puente dedicado AGT-003 no reutiliza el espacio de nombres AGT-002.
// ---------------------------------------------------------------------------

const AGT003_DEDICATED_MODULES = [
  'agt003-claude-bridge-signing.js',
  'agt003-claude-bridge-nonce-store.js',
  'agt003-claude-bridge-auth.js',
  'agt003-claude-bridge-log.js',
  'agt003-claude-bridge-server.js',
  'agt003-claude-bridge-host.js',
  'agt003-claude-client.js',
  'ops/agt003-claude-bridge/run-server.mjs',
  'ops/agt003-claude-bridge/agt003-bridge.service',
  'ops/agt003-claude-bridge/Caddyfile',
  'ops/agt003-claude-bridge/env.example',
];

function testAgt003ModulesNeverBorrowTheAgt002Namespace() {
  for (const path of AGT003_DEDICATED_MODULES) {
    const source = read(path).toLowerCase();
    assert.equal(source.includes('agt002'), false, `${path} nunca debe nombrar el espacio AGT-002`);
    assert.equal(source.includes('codex'), false, `${path} nunca debe nombrar el proveedor de AGT-002`);
    assert.equal(source.includes('8787'), false, `${path} nunca debe usar el puerto de AGT-002`);
  }
}

function testAgt003ResponsesUseTheirOwnCodes() {
  const server = read('agt003-claude-bridge-server.js');
  for (const code of ['AGT003_BRIDGE_AUTH_INVALID', 'AGT003_BRIDGE_BAD_REQUEST', 'AGT003_BRIDGE_PAYLOAD_TOO_LARGE', 'AGT003_BRIDGE_INTERNAL', 'AGT003_CLAUDE_TIMEOUT']) {
    assert.ok(server.includes(code), `el servidor dedicado debe emitir ${code}`);
  }
  assert.ok(read('agt003-claude-bridge-host.js').includes('agt003.5-78-140-24.sslip.io'), 'el host dedicado debe estar declarado');
  assert.ok(read('agt003-claude-bridge-host.js').includes('/v1/agt003-copilot/run'), 'la ruta dedicada debe estar declarada');
}

// ---------------------------------------------------------------------------
// 3. Preservación del lado Vercel ya existente (AGT003_COPILOT_*).
// ---------------------------------------------------------------------------

function testVercelSideStillSupportsTheDedicatedWireProtocol() {
  const runtime = read('agt003-copilot-runtime.js');
  assert.ok(runtime.includes('AGT003_COPILOT_WIRE_PROTOCOL'), 'el runtime debe seguir leyendo el protocolo wire');
  assert.ok(runtime.includes("['agt002', 'agt003'].includes(resolved.wireProtocol)"), 'ambos protocolos wire deben seguir soportados');
  assert.ok(runtime.includes('AGT003_COPILOT_BRIDGE_URL'), 'el runtime debe seguir aceptando URL propia');
  assert.ok(runtime.includes('AGT003_COPILOT_HMAC_SECRET'), 'el runtime debe seguir aceptando secreto HMAC propio');
  assert.ok(runtime.includes('AGT003_COPILOT_MODEL'), 'el runtime debe seguir aceptando modelo propio');

  const client = read('agt003-copilot-bridge-client.js');
  assert.ok(client.includes("wireProtocol = 'agt003'"), 'el cliente debe seguir usando el puente dedicado por defecto');
  assert.ok(client.includes('X-${headerNamespace}-Signature'), 'el cliente debe seguir firmando con el espacio de nombres del protocolo');

  const envExample = read('.env.local.example');
  assert.ok(envExample.includes('AGT003_COPILOT_WIRE_PROTOCOL=agt003'), 'el ejemplo de entorno debe conservar el protocolo dedicado');
  assert.ok(envExample.includes('/v1/agt003-copilot/run'), 'el ejemplo de entorno debe conservar la ruta dedicada');
}

// El cliente de Vercel y el puente de Hetzner deben firmar exactamente igual;
// si divergen, ninguna petición legítima se autenticaría.
async function testVercelClientAndBridgeShareTheCanonicalFormat() {
  const [vercel, bridge] = await Promise.all([
    import('../agt002-hetzner-bridge-signing.js'),
    import('../agt003-claude-bridge-signing.js'),
  ]);
  const secret = 'c'.repeat(32);
  const canonicalArgs = { method: 'POST', path: '/v1/agt003-copilot/run', bodySha256Hex: bridge.sha256Hex('{"a":1}'), timestamp: '1000', nonce: 'n'.repeat(16) };
  assert.equal(bridge.sha256Hex('{"a":1}'), vercel.sha256Hex('{"a":1}'));
  assert.equal(bridge.buildCanonicalString(canonicalArgs), vercel.buildCanonicalString(canonicalArgs));
  assert.equal(
    bridge.signCanonicalString(secret, bridge.buildCanonicalString(canonicalArgs)),
    vercel.signCanonicalString(secret, vercel.buildCanonicalString(canonicalArgs)),
  );
}

testAgt002ContractsAreIntact();
testAgt002NeverReferencesAgt003OrClaude();
testAgt002ClaudeClientNeverSharesAgt003Identity();
testAgt002RunServerUsesItsOwnClaudeClientNotCodex();
testAgt003ModulesNeverBorrowTheAgt002Namespace();
testAgt003ResponsesUseTheirOwnCodes();
testVercelSideStillSupportsTheDedicatedWireProtocol();
await testVercelClientAndBridgeShareTheCanonicalFormat();
console.log('agt003-claude-bridge-isolation-static.test.mjs OK');
