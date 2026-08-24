import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../ops/agt003-claude-bridge/${name}`, import.meta.url), 'utf8');

const unit = read('agt003-bridge.service');
const caddyfile = read('Caddyfile');
const envExample = read('env.example');
const runServer = read('run-server.mjs');
const readme = read('README.md');

const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);

function testUnitRunsAsTheDedicatedUser() {
  const unitLines = lines(unit);
  assert.ok(unitLines.includes('User=agt003-bridge'), 'la unidad debe correr como el usuario dedicado agt003-bridge');
  assert.ok(unitLines.includes('Group=agt003-bridge'), 'la unidad debe correr con el grupo dedicado agt003-bridge');
  assert.equal(unit.includes('agt002-bridge'), false, 'la unidad AGT-003 nunca debe reutilizar la identidad del puente AGT-002');
}

function testUnitIsHardened() {
  const unitLines = lines(unit);
  for (const directive of ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict', 'ProtectHome=true']) {
    assert.ok(unitLines.includes(directive), `la unidad debe declarar ${directive}`);
  }
  assert.match(unit, /^MemoryMax=/m, 'la unidad debe acotar memoria');
  assert.match(unit, /^CPUQuota=/m, 'la unidad debe acotar CPU');
}

// La sesión OAuth de Claude Code vive en un directorio propio bajo /opt, no en
// $HOME: ProtectHome=true haría ilegible cualquier credencial ubicada allí.
function testClaudeConfigDirIsPinnedUnderOpt() {
  assert.match(unit, /^Environment=CLAUDE_CONFIG_DIR=\/opt\/agt003-bridge\/\.claude$/m, 'CLAUDE_CONFIG_DIR debe fijarse bajo /opt/agt003-bridge');
  const readWriteLine = lines(unit).find(line => line.startsWith('ReadWritePaths='));
  assert.ok(readWriteLine, 'la unidad debe declarar ReadWritePaths');
  const paths = readWriteLine.slice('ReadWritePaths='.length).split(/\s+/).filter(Boolean);
  assert.ok(paths.includes('/opt/agt003-bridge/.claude'), 'ReadWritePaths debe permitir escritura en la sesión OAuth de Claude Code');
  assert.ok(paths.includes('/opt/agt003-bridge/var'), 'ReadWritePaths debe permitir escritura en /opt/agt003-bridge/var');
}

// `claude` y sus dependencias escriben en $HOME aunque CLAUDE_CONFIG_DIR esté
// fijado. Si el servicio hereda un HOME ajeno (o vacío) con ProtectHome=true,
// el subproceso falla con un error de escritura que no dice nada útil: HOME
// debe apuntar al mismo directorio que ya es ReadWritePaths.
function testHomeIsPinnedToTheServiceDirectory() {
  assert.match(unit, /^Environment=HOME=\/opt\/agt003-bridge$/m, 'la unidad debe fijar HOME=/opt/agt003-bridge');
}

// Un turno del proveedor con salida larga sostiene picos por encima de 512 MiB;
// con MemoryMax bajo el OOM killer mata el subproceso a media respuesta y el
// llamador recibe un fallo indistinguible de un error del modelo.
function testMemoryCeilingLeavesRoomForATurn() {
  assert.match(unit, /^MemoryMax=1G$/m, 'la unidad debe acotar memoria en 1G');
}

function testUnitExecutesTheDedicatedServer() {
  assert.match(unit, /^ExecStart=.*ops\/agt003-claude-bridge\/run-server\.mjs$/m, 'la unidad debe ejecutar el servidor dedicado AGT-003');
  assert.match(unit, /^EnvironmentFile=\/etc\/agt003-bridge\/agt003-bridge\.env$/m, 'la unidad debe leer su EnvironmentFile propio');
  assert.equal(unit.includes('agt002-hetzner-bridge'), false, 'la unidad nunca debe apuntar a artefactos AGT-002');
}

function testUnitNeverInjectsApiKeys() {
  for (const forbidden of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
    assert.equal(unit.includes(forbidden), false, `la unidad nunca debe declarar ${forbidden}`);
  }
}

function testCaddyPublishesTheDedicatedVhost() {
  assert.match(caddyfile, /^agt003\.5-78-140-24\.sslip\.io \{$/m, 'el vhost dedicado debe ser agt003.5-78-140-24.sslip.io');
  assert.match(caddyfile, /^\s*reverse_proxy 127\.0\.0\.1:8788\s*$/m, 'Caddy debe apuntar al puerto loopback fijo 8788');
  assert.equal(caddyfile.includes('8787'), false, 'el vhost AGT-003 nunca debe apuntar al puerto del puente AGT-002');
  assert.equal(caddyfile.includes('agt002'), false, 'el vhost AGT-003 nunca debe mencionar el host AGT-002');
}

function testEnvExampleCarriesNoSecrets() {
  const entries = lines(envExample).filter(line => !line.startsWith('#') && line.includes('='));
  const byKey = new Map(entries.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(byKey.get('AGT003_BRIDGE_HMAC_SECRET'), '', 'el ejemplo nunca debe traer un secreto HMAC real');
  assert.equal(byKey.get('AGT003_BRIDGE_LISTEN_PORT'), '8788', 'el puerto dedicado debe estar declarado');
  for (const [key, value] of byKey) {
    if (/SECRET|TOKEN|KEY|PASSWORD/i.test(key)) assert.equal(value, '', `${key} debe quedar vacío en el ejemplo`);
  }
  for (const forbidden of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'sk-ant-']) {
    assert.equal(envExample.includes(forbidden), false, `el ejemplo nunca debe mencionar ${forbidden}`);
  }
}

function testRunServerWiresOnlyDedicatedModules() {
  assert.ok(runServer.includes("from '../../agt003-claude-bridge-server.js'"), 'el runner debe montar el servidor dedicado');
  assert.ok(runServer.includes("from '../../agt003-claude-client.js'"), 'el runner debe inyectar el cliente Claude dedicado');
  assert.ok(runServer.includes("'127.0.0.1'"), 'el puente sólo debe escuchar en loopback detrás de Caddy');
  assert.ok(runServer.includes('8788'), 'el runner debe usar el puerto dedicado 8788');
  assert.ok(runServer.includes('AGT003_BRIDGE_HMAC_SECRET'), 'el runner debe exigir el secreto HMAC propio');
  assert.equal(/agt002/i.test(runServer), false, 'el runner AGT-003 nunca debe importar ni nombrar artefactos AGT-002');
  assert.equal(runServer.includes('ANTHROPIC_API_KEY'), false, 'el runner nunca debe manipular API keys');
}

// Los tres techos operativos del puente (concurrencia, timeout y modelos
// admitidos) deben poder fijarse en el EnvironmentFile del servidor, sin tocar
// el código, y con valores por defecto seguros ya declarados en la plantilla.
function testEnvExampleDeclaresTheOperationalCeilings() {
  const entries = lines(envExample).filter(line => !line.startsWith('#') && line.includes('='));
  const byKey = new Map(entries.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(byKey.get('AGT003_BRIDGE_MAX_CONCURRENCY'), '1', 'el puente debe declarar un solo turno simultáneo por defecto');
  assert.equal(byKey.get('AGT003_BRIDGE_MAX_TIMEOUT_MS'), '120000', 'el techo del timeout por petición debe estar declarado');
  assert.equal(byKey.get('AGT003_BRIDGE_ALLOWED_MODELS'), 'sonnet', 'la allowlist de modelos debe estar declarada');
}

function testRunServerAppliesTheOperationalCeilings() {
  for (const key of ['AGT003_BRIDGE_MAX_CONCURRENCY', 'AGT003_BRIDGE_MAX_TIMEOUT_MS', 'AGT003_BRIDGE_ALLOWED_MODELS']) {
    assert.ok(runServer.includes(key), `el runner debe leer ${key} del entorno`);
  }
  for (const option of ['maxConcurrency', 'maxTimeoutMs', 'allowedModels']) {
    assert.ok(runServer.includes(option), `el runner debe pasar ${option} al servidor dedicado`);
  }
}

// Los techos de socket son distintos de los techos de turno: acotan lo que un
// cliente puede retener del proceso *antes* de que exista un turno, de modo que
// nadie pueda agotar los descriptores del puente abriendo conexiones ociosas.
function testEnvExampleDeclaresTheSocketCeilings() {
  const entries = lines(envExample).filter(line => !line.startsWith('#') && line.includes('='));
  const byKey = new Map(entries.map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  assert.equal(byKey.get('AGT003_BRIDGE_MAX_CONNECTIONS'), '16', 'el techo de conexiones simultáneas debe estar declarado');
  assert.equal(byKey.get('AGT003_BRIDGE_HEADERS_TIMEOUT_MS'), '10000', 'el techo de cabeceras debe estar declarado');
  assert.equal(byKey.get('AGT003_BRIDGE_REQUEST_TIMEOUT_MS'), '15000', 'el techo de petición completa debe estar declarado');
}

function testRunServerAppliesTheSocketCeilings() {
  // Fail-closed y con el mismo parser entero positivo que los techos de turno:
  // una variable presente pero inválida no debe arrancar el servicio.
  for (const key of ['AGT003_BRIDGE_MAX_CONNECTIONS', 'AGT003_BRIDGE_HEADERS_TIMEOUT_MS', 'AGT003_BRIDGE_REQUEST_TIMEOUT_MS']) {
    assert.ok(runServer.includes(`positiveIntEnv('${key}'`), `el runner debe leer ${key} como entero positivo fail-closed`);
  }
  // Y aplicados sobre el servidor HTTP ya creado, no sólo leídos.
  for (const property of ['maxConnections', 'headersTimeout', 'requestTimeout']) {
    assert.match(runServer, new RegExp(`^\\s*server\\.${property}\\s*=`, 'm'), `el runner debe aplicar server.${property}`);
  }
}

// Caddy debe cortar el cuerpo excesivo en el borde, antes de reenviarlo: si el
// límite viviera sólo en el puente, cada cuerpo enorme se transferiría entero
// por el loopback para acabar rechazado con 413 de todas formas.
function testCaddyLimitsTheRequestBodyBeforeProxying() {
  assert.match(caddyfile, /request_body/, 'el vhost debe declarar request_body');
  assert.match(caddyfile, /max_size\s+(1MB|1MiB|1048576)\b/, 'el vhost debe acotar el cuerpo en 1 MiB, igual que el puente');
  assert.ok(
    caddyfile.indexOf('request_body') < caddyfile.indexOf('reverse_proxy'),
    'el límite de cuerpo debe declararse antes del reverse_proxy',
  );
}

function testReadmeDocumentsTheOperationalCeilings() {
  assert.ok(readme.includes('AGT003_BRIDGE_MAX_CONCURRENCY'), 'el README debe documentar el techo de concurrencia');
  assert.ok(readme.includes('AGT003_BRIDGE_MAX_TIMEOUT_MS'), 'el README debe documentar el techo de timeout');
  assert.ok(readme.includes('AGT003_BRIDGE_ALLOWED_MODELS'), 'el README debe documentar la allowlist de modelos');
  assert.ok(readme.includes('AGT003_BRIDGE_BUSY'), 'el README debe documentar el rechazo por saturación');
  assert.ok(readme.includes('AGT003_CLAUDE_SCHEMA_TOO_LARGE'), 'el README debe documentar el techo del outputSchema');
}

// El home del usuario y el HOME que fija la unidad deben ser el mismo
// directorio: si el alta crea el usuario con el home por defecto (/home/...),
// ProtectHome=true lo vuelve ilegible y el turno falla en el primer spawn.
function testReadmeCreatesTheUserWithTheServiceHome() {
  assert.match(
    readme,
    /(useradd|adduser)[^\n]*(--home-dir|--home|-d)\s+\/opt\/agt003-bridge\b/,
    'el README debe crear el usuario con home /opt/agt003-bridge',
  );
}

// Guarda de regresión: el puerto dedicado no se publica nunca por sí mismo, la
// exposición pública es siempre a través del vhost de Caddy.
function testReadmeKeepsThePortOnLoopback() {
  const portLines = readme.split('\n').filter(line => line.includes('8788'));
  assert.ok(portLines.length > 0, 'el README debe mencionar el puerto dedicado 8788');
  assert.ok(
    portLines.some(line => /127\.0\.0\.1:8788/.test(line) && /(s[óo]lo|only)/i.test(line)),
    'el README debe declarar que 8788 escucha sólo en 127.0.0.1',
  );
}

function testReadmeDocumentsTheManualOperation() {
  assert.ok(readme.includes('agt003.5-78-140-24.sslip.io'), 'el README debe documentar el vhost dedicado');
  assert.ok(readme.includes('8788'), 'el README debe documentar el puerto dedicado');
  assert.ok(readme.includes('AGT003_COPILOT_WIRE_PROTOCOL=agt003'), 'el README debe documentar la variable de Vercel que activa este puente');
  assert.ok(/claude\s+\/login|claude setup-token|\/login/i.test(readme), 'el README debe documentar el login OAuth manual de Claude Code');
  assert.ok(/no (instala|aplica|despliega)/i.test(readme), 'el README debe declarar que estos artefactos no se aplican automáticamente');
}

testUnitRunsAsTheDedicatedUser();
testUnitIsHardened();
testClaudeConfigDirIsPinnedUnderOpt();
testHomeIsPinnedToTheServiceDirectory();
testMemoryCeilingLeavesRoomForATurn();
testUnitExecutesTheDedicatedServer();
testUnitNeverInjectsApiKeys();
testCaddyPublishesTheDedicatedVhost();
testEnvExampleCarriesNoSecrets();
testRunServerWiresOnlyDedicatedModules();
testEnvExampleDeclaresTheOperationalCeilings();
testRunServerAppliesTheOperationalCeilings();
testEnvExampleDeclaresTheSocketCeilings();
testRunServerAppliesTheSocketCeilings();
testCaddyLimitsTheRequestBodyBeforeProxying();
testReadmeDocumentsTheOperationalCeilings();
testReadmeCreatesTheUserWithTheServiceHome();
testReadmeKeepsThePortOnLoopback();
testReadmeDocumentsTheManualOperation();
console.log('agt003-claude-bridge-ops-artifact.test.mjs OK');
