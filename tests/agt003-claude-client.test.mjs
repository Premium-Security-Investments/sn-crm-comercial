import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import {
  AGT003_CLAUDE_FORBIDDEN_ENV_KEYS,
  AGT003_CLAUDE_MAX_SCHEMA_BYTES,
  AGT003_CLAUDE_MAX_STDOUT_BYTES,
  createAgt003ClaudeClient,
} from '../agt003-claude-client.js';

/**
 * Linux limita cada argumento de `execve` a MAX_ARG_STRLEN = 32 páginas
 * (131072 bytes). El `--json-schema` viaja como un único argumento, así que un
 * esquema grande no produce un error legible sino un E2BIG del kernel al hacer
 * spawn. El techo del cliente debe quedar holgadamente por debajo.
 */
const LINUX_MAX_ARG_STRLEN = 131_072;

const MODEL = 'claude-sonnet-4-6';
const POLICY = 'Política AGT-003: devuelve exclusivamente el objeto JSON solicitado.';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } };
const INPUT = { opportunity_id: 'opp-1', notes: 'texto no confiable del CRM' };

function fakeChild() {
  const child = new EventEmitter();
  child.stdinChunks = [];
  child.stdinEnded = false;
  child.stdin = {
    write(chunk) { child.stdinChunks.push(String(chunk)); return true; },
    end() { child.stdinEnded = true; },
    on() {},
    destroy() {},
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.signals = [];
  child.kill = signal => { child.signals.push(signal || 'SIGTERM'); child.killed = true; return true; };
  return child;
}

function harness({ command, cwd, env } = {}) {
  const calls = [];
  const children = [];
  const spawn = (spawnCommand, args, options) => {
    const child = fakeChild();
    children.push(child);
    calls.push({ command: spawnCommand, args, options });
    return child;
  };
  const client = createAgt003ClaudeClient({ spawn, ...(command ? { command } : {}), ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) });
  return { client, calls, children };
}

function successPayload(overrides = {}) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    structured_output: { summary: 'borrador seguro' },
    usage: { input_tokens: 120, output_tokens: 45 },
    ...overrides,
  });
}

async function settleSoon(fn) {
  await new Promise(resolve => setImmediate(resolve));
  fn();
}

async function testSpawnContractAndStdin() {
  const { client, calls, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, idempotencyKey: 'idem-1' });
  await settleSoon(() => {
    children[0].stdout.emit('data', Buffer.from(successPayload(), 'utf8'));
    children[0].emit('exit', 0, null);
  });
  await pending;

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, 'claude');
  assert.deepEqual(call.args, [
    '-p',
    '--model', MODEL,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--tools', '',
    '--no-session-persistence',
    '--safe-mode',
    '--system-prompt', POLICY,
  ], 'la invocación debe ser exactamente el contrato acordado');
  assert.equal(call.args.includes('--bare'), false, '--bare impediría leer las credenciales OAuth de Claude Code');
  assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);

  // La entrada (dato no confiable del CRM) viaja sólo por stdin, nunca por argv.
  assert.equal(children[0].stdinChunks.join(''), JSON.stringify(INPUT));
  assert.equal(children[0].stdinEnded, true, 'stdin debe cerrarse para que el proveedor termine el turno');
  assert.equal(call.args.some(arg => String(arg).includes('opp-1')), false, 'la entrada nunca debe aparecer en argv');
  assert.equal(call.args.some(arg => String(arg).includes('texto no confiable')), false, 'la entrada nunca debe aparecer en argv');
}

async function testFixedSafeCwd() {
  const { client, calls, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, cwd: '/etc' });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;
  assert.equal(calls[0].options.cwd, tmpdir(), 'el cwd es fijo y el caller nunca puede redirigirlo');

  const pinned = harness({ cwd: '/opt/agt003-bridge/var/run' });
  const second = pinned.client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    pinned.children[0].stdout.emit('data', successPayload());
    pinned.children[0].emit('exit', 0, null);
  });
  await second;
  assert.equal(pinned.calls[0].options.cwd, '/opt/agt003-bridge/var/run');
  assert.throws(() => createAgt003ClaudeClient({ spawn: () => fakeChild(), cwd: 'relativo/no/absoluto' }), /cwd/i);
}

// OAuth de Claude Code: el subproceso debe leer su propia sesión. Ninguna
// API key puede llegar al proveedor, ni siquiera si está en el entorno del host.
async function testApiKeysNeverReachTheProvider() {
  const env = {
    PATH: '/usr/bin',
    HOME: '/opt/agt003-bridge',
    CLAUDE_CONFIG_DIR: '/opt/agt003-bridge/.claude',
    ANTHROPIC_API_KEY: 'sk-ant-no-debe-propagarse',
    ANTHROPIC_AUTH_TOKEN: 'token-no-debe-propagarse',
    ANTHROPIC_BASE_URL: 'https://proxy.no-autorizado.test',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
  };
  const { client, calls, children } = harness({ env });
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;

  const childEnv = calls[0].options.env;
  for (const key of AGT003_CLAUDE_FORBIDDEN_ENV_KEYS) {
    assert.equal(Object.hasOwn(childEnv, key), false, `${key} nunca debe llegar al subproceso`);
  }
  assert.equal(JSON.stringify(childEnv).includes('sk-ant-'), false, 'ninguna API key puede filtrarse al subproceso');
  assert.equal(childEnv.CLAUDE_CONFIG_DIR, '/opt/agt003-bridge/.claude', 'la sesión OAuth debe seguir siendo legible');
  assert.equal(childEnv.HOME, '/opt/agt003-bridge');
  assert.equal(childEnv.PATH, '/usr/bin');
}

async function testStructuredOutputParsed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    // La salida puede llegar fragmentada: sólo se interpreta al cerrar el proceso.
    children[0].stdout.emit('data', successPayload().slice(0, 30));
    children[0].stdout.emit('data', successPayload().slice(30));
    children[0].emit('exit', 0, null);
  });
  const result = await pending;
  assert.deepEqual(result, {
    content: JSON.stringify({ summary: 'borrador seguro' }),
    usage: { input_tokens: 120, output_tokens: 45 },
    rate_limit: null,
  });
  assert.equal(JSON.parse(result.content).summary, 'borrador seguro');
}

async function testTimeoutKillsTheSubprocess() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 20 });
  await assert.rejects(pending, error => error.code === 'AGT003_CLAUDE_TIMEOUT');
  assert.ok(children[0].signals.includes('SIGTERM'), 'un turno vencido debe terminar el subproceso');
}

async function testAbortCancelsTheRun() {
  const controller = new AbortController();
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, signal: controller.signal });
  await settleSoon(() => controller.abort());
  await assert.rejects(pending, error => error.code === 'AGT003_CLAUDE_CANCELLED');
  assert.ok(children[0].signals.includes('SIGTERM'));
}

async function testPreAbortedSignalNeverSpawns() {
  const controller = new AbortController();
  controller.abort();
  const { client, calls } = harness();
  await assert.rejects(
    client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, signal: controller.signal }),
    error => error.code === 'AGT003_CLAUDE_CANCELLED',
  );
  assert.equal(calls.length, 0, 'una ejecución ya cancelada nunca debe lanzar el proveedor');
}

async function testMalformedOutputsFailClosed() {
  const cases = [
    ['no es json', 'AGT003_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ is_error: false, usage: { input_tokens: 1, output_tokens: 1 } }), 'AGT003_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: 'texto libre', usage: { input_tokens: 1, output_tokens: 1 } }), 'AGT003_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' } }), 'AGT003_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' }, usage: { input_tokens: -1, output_tokens: 1 } }), 'AGT003_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' }, usage: { input_tokens: 1.5, output_tokens: 1 } }), 'AGT003_CLAUDE_INVALID_RESPONSE'],
    ['', 'AGT003_CLAUDE_INVALID_RESPONSE'],
  ];
  for (const [stdout, expected] of cases) {
    const { client, children } = harness();
    const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
    await settleSoon(() => {
      if (stdout) children[0].stdout.emit('data', stdout);
      children[0].emit('exit', 0, null);
    });
    await assert.rejects(pending, error => error.code === expected, `salida: ${stdout.slice(0, 40)}`);
  }
}

async function testProviderErrorsMapToSafeCodes() {
  const cases = [
    [{ is_error: true, subtype: 'login_required' }, 'AGT003_CLAUDE_LOGIN_REQUIRED', undefined],
    [{ is_error: true, subtype: 'authentication_error' }, 'AGT003_CLAUDE_LOGIN_REQUIRED', undefined],
    [{ is_error: true, subtype: 'overloaded_error' }, 'AGT003_CLAUDE_PROVIDER_ERROR', 'overloaded_error'],
    [{ is_error: true, subtype: 'Detalle Muy Largo Con Espacios' }, 'AGT003_CLAUDE_PROVIDER_ERROR', undefined],
  ];
  for (const [payload, expectedCode, expectedAtom] of cases) {
    const { client, children } = harness();
    const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
    await settleSoon(() => {
      children[0].stdout.emit('data', JSON.stringify(payload));
      children[0].emit('exit', 1, null);
    });
    await assert.rejects(pending, error => {
      assert.equal(error.code, expectedCode, JSON.stringify(payload));
      assert.equal(error.providerErrorCode, expectedAtom);
      return true;
    });
  }
}

async function testOversizedStdoutFailsClosed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', 'x'.repeat(AGT003_CLAUDE_MAX_STDOUT_BYTES + 1));
  });
  await assert.rejects(pending, error => error.code === 'AGT003_CLAUDE_OUTPUT_TOO_LARGE' && !error.message.includes('xxxx'));
  assert.ok(children[0].signals.includes('SIGTERM'), 'una salida desbordada debe terminar el subproceso');
}

async function testStderrIsNeverSurfaced() {
  const { client, children } = harness();
  const secret = 'stderr con rutas internas y tokens';
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stderr.emit('data', secret);
    children[0].stderr.emit('data', 'y'.repeat(2_000_000));
    children[0].emit('exit', 1, null);
  });
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'AGT003_CLAUDE_TRANSPORT_ERROR');
    const serialized = `${error.message} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    assert.equal(serialized.includes(secret), false, 'stderr nunca debe llegar al caller');
    assert.equal(serialized.includes('yyyy'), false);
    return true;
  });
}

async function testSpawnFailureFailsClosed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => children[0].emit('error', new Error('ENOENT /usr/local/bin/claude')));
  await assert.rejects(pending, error => error.code === 'AGT003_CLAUDE_TRANSPORT_ERROR' && !error.message.includes('ENOENT'));
}

// ---------------------------------------------------------------------------
// Techo del outputSchema serializado (bloqueante: E2BIG en el spawn real).
// ---------------------------------------------------------------------------

function schemaOfExactBytes(targetBytes) {
  const schema = { type: 'object', properties: { pad: { type: 'string', description: '' } } };
  const overhead = Buffer.byteLength(JSON.stringify(schema), 'utf8');
  schema.properties.pad.description = 'x'.repeat(targetBytes - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(schema), 'utf8'), targetBytes);
  return schema;
}

function testSchemaCeilingIsSafelyBelowTheKernelLimit() {
  assert.equal(AGT003_CLAUDE_MAX_SCHEMA_BYTES, 65_536, 'el techo del esquema serializado es 64 KiB');
  assert.ok(
    AGT003_CLAUDE_MAX_SCHEMA_BYTES < LINUX_MAX_ARG_STRLEN,
    'el techo debe quedar por debajo de MAX_ARG_STRLEN para que el spawn nunca falle con E2BIG',
  );
}

async function testOversizedSchemaFailsClosedBeforeSpawn() {
  const { client, calls } = harness();
  const oversized = schemaOfExactBytes(AGT003_CLAUDE_MAX_SCHEMA_BYTES + 1);
  await assert.rejects(
    client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: oversized, timeoutMs: 5000 }),
    error => {
      assert.equal(error.code, 'AGT003_CLAUDE_SCHEMA_TOO_LARGE', 'un esquema desbordado tiene su propio código');
      assert.equal(error.message.includes('xxxx'), false, 'el error nunca debe citar el esquema rechazado');
      return true;
    },
  );
  assert.equal(calls.length, 0, 'un esquema fuera de techo nunca debe llegar al spawn');
}

async function testSchemaAtTheCeilingIsAccepted() {
  const { client, calls, children } = harness();
  const atLimit = schemaOfExactBytes(AGT003_CLAUDE_MAX_SCHEMA_BYTES);
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: atLimit, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;
  assert.equal(calls.length, 1, 'el techo exacto sigue siendo válido');
  const schemaArg = calls[0].args[calls[0].args.indexOf('--json-schema') + 1];
  assert.equal(Buffer.byteLength(schemaArg, 'utf8'), AGT003_CLAUDE_MAX_SCHEMA_BYTES);
  assert.ok(schemaArg.length < LINUX_MAX_ARG_STRLEN, 'ningún argumento puede acercarse al límite del kernel');
}

// El límite del kernel se mide en bytes, no en caracteres: un esquema con
// caracteres multibyte por debajo del techo en longitud puede desbordarlo.
async function testSchemaCeilingIsMeasuredInBytes() {
  const { client, calls } = harness();
  const multibyte = { type: 'object', properties: { pad: { type: 'string', description: 'á'.repeat(AGT003_CLAUDE_MAX_SCHEMA_BYTES - 100) } } };
  const serialized = JSON.stringify(multibyte);
  assert.ok(serialized.length < AGT003_CLAUDE_MAX_SCHEMA_BYTES, 'el caso de prueba debe estar bajo el techo en caracteres');
  assert.ok(Buffer.byteLength(serialized, 'utf8') > AGT003_CLAUDE_MAX_SCHEMA_BYTES, 'y por encima del techo en bytes');
  await assert.rejects(
    client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: multibyte, timeoutMs: 5000 }),
    error => error.code === 'AGT003_CLAUDE_SCHEMA_TOO_LARGE',
  );
  assert.equal(calls.length, 0, 'el techo debe medirse en bytes UTF-8, no en longitud de cadena');
}

async function testInvalidArgumentsRejectedBeforeSpawn() {
  const { client, calls } = harness();
  const base = { model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 };
  for (const override of [{ model: '' }, { policy: '' }, { outputSchema: [] }, { outputSchema: null }, { timeoutMs: 0 }, { timeoutMs: 1.5 }, { input: 'texto' }]) {
    await assert.rejects(client.run({ ...base, ...override }), /AGT-003|no es válido|requiere/i, JSON.stringify(override));
  }
  assert.equal(calls.length, 0, 'ningún argumento inválido debe llegar a lanzar el proveedor');
}

await testSpawnContractAndStdin();
await testFixedSafeCwd();
await testApiKeysNeverReachTheProvider();
await testStructuredOutputParsed();
console.log('agt003-claude-client.test.mjs Paso 1 OK');

await testTimeoutKillsTheSubprocess();
await testAbortCancelsTheRun();
await testPreAbortedSignalNeverSpawns();
await testMalformedOutputsFailClosed();
await testProviderErrorsMapToSafeCodes();
await testOversizedStdoutFailsClosed();
await testStderrIsNeverSurfaced();
await testSpawnFailureFailsClosed();
await testInvalidArgumentsRejectedBeforeSpawn();
console.log('agt003-claude-client.test.mjs Paso 2 OK');

testSchemaCeilingIsSafelyBelowTheKernelLimit();
await testOversizedSchemaFailsClosedBeforeSpawn();
await testSchemaAtTheCeilingIsAccepted();
await testSchemaCeilingIsMeasuredInBytes();
console.log('agt003-claude-client.test.mjs Paso 3 OK');
