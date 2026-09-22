import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGT002_CLAUDE_FORBIDDEN_ENV_KEYS,
  AGT002_CLAUDE_MAX_SCHEMA_BYTES,
  AGT002_CLAUDE_MAX_STDOUT_BYTES,
  createAgt002ClaudeClient,
} from '../agt002-claude-client.js';

const MODEL = 'sonnet';
const POLICY = 'Política AGT-002: devuelve exclusivamente el objeto JSON solicitado.';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['summary'], properties: { summary: { type: 'string' } } };
const INPUT = { opportunity_id: 'opp-1', notes: 'texto no confiable del CRM/tender' };

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
  const client = createAgt002ClaudeClient({ spawn, ...(command ? { command } : {}), ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) });
  return { client, calls, children };
}

function successPayload(overrides = {}) {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    structured_output: { summary: 'resultado seguro' },
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

  const pinned = harness({ cwd: '/opt/agt002-bridge' });
  const second = pinned.client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    pinned.children[0].stdout.emit('data', successPayload());
    pinned.children[0].emit('exit', 0, null);
  });
  await second;
  assert.equal(pinned.calls[0].options.cwd, '/opt/agt002-bridge');
  assert.throws(() => createAgt002ClaudeClient({ spawn: () => fakeChild(), cwd: 'relativo/no/absoluto' }), /cwd/i);
}

async function testApiKeysNeverReachTheProvider() {
  const env = {
    PATH: '/usr/bin',
    HOME: '/opt/agt002-bridge',
    CLAUDE_CONFIG_DIR: '/opt/agt002-bridge/.claude',
    ANTHROPIC_API_KEY: 'sk-ant-no-debe-propagarse',
    ANTHROPIC_AUTH_TOKEN: 'token-no-debe-propagarse',
    ANTHROPIC_BASE_URL: 'https://proxy.no-autorizado.test',
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_USE_VERTEX: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-no-debe-propagarse',
  };
  const { client, calls, children } = harness({ env });
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;

  const childEnv = calls[0].options.env;
  for (const key of AGT002_CLAUDE_FORBIDDEN_ENV_KEYS) {
    assert.equal(Object.hasOwn(childEnv, key), false, `${key} nunca debe llegar al subproceso`);
  }
  assert.equal(JSON.stringify(childEnv).includes('sk-ant-'), false, 'ninguna API key puede filtrarse al subproceso');
  assert.equal(childEnv.CLAUDE_CONFIG_DIR, '/opt/agt002-bridge/.claude', 'la sesión OAuth debe seguir siendo legible');
  assert.equal(childEnv.HOME, '/opt/agt002-bridge');
  assert.equal(childEnv.PATH, '/usr/bin');
}

async function testStructuredOutputParsed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload().slice(0, 30));
    children[0].stdout.emit('data', successPayload().slice(30));
    children[0].emit('exit', 0, null);
  });
  const result = await pending;
  assert.deepEqual(result, {
    content: JSON.stringify({ summary: 'resultado seguro' }),
    usage: { input_tokens: 120, output_tokens: 45 },
    rate_limit: null,
  });
  assert.equal(JSON.parse(result.content).summary, 'resultado seguro');
}

async function testTimeoutKillsTheSubprocess() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 20 });
  await assert.rejects(pending, error => error.code === 'AGT002_CLAUDE_TIMEOUT');
  assert.ok(children[0].signals.includes('SIGTERM'), 'un turno vencido debe terminar el subproceso');
}

async function testAbortCancelsTheRun() {
  const controller = new AbortController();
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, signal: controller.signal });
  await settleSoon(() => controller.abort());
  await assert.rejects(pending, error => error.code === 'AGT002_CLAUDE_CANCELLED');
  assert.ok(children[0].signals.includes('SIGTERM'));
}

async function testPreAbortedSignalNeverSpawns() {
  const controller = new AbortController();
  controller.abort();
  const { client, calls } = harness();
  await assert.rejects(
    client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, signal: controller.signal }),
    error => error.code === 'AGT002_CLAUDE_CANCELLED',
  );
  assert.equal(calls.length, 0, 'una ejecución ya cancelada nunca debe lanzar el proveedor');
}

async function testMalformedOutputsFailClosed() {
  const cases = [
    ['no es json', 'AGT002_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ is_error: false, usage: { input_tokens: 1, output_tokens: 1 } }), 'AGT002_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: 'texto libre', usage: { input_tokens: 1, output_tokens: 1 } }), 'AGT002_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' } }), 'AGT002_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' }, usage: { input_tokens: -1, output_tokens: 1 } }), 'AGT002_CLAUDE_INVALID_RESPONSE'],
    [JSON.stringify({ structured_output: { summary: 'x' }, usage: { input_tokens: 1.5, output_tokens: 1 } }), 'AGT002_CLAUDE_INVALID_RESPONSE'],
    ['', 'AGT002_CLAUDE_INVALID_RESPONSE'],
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
    [{ is_error: true, subtype: 'login_required' }, 'AGT002_CLAUDE_LOGIN_REQUIRED', undefined],
    [{ is_error: true, subtype: 'authentication_error' }, 'AGT002_CLAUDE_LOGIN_REQUIRED', undefined],
    [{ is_error: true, subtype: 'overloaded_error' }, 'AGT002_CLAUDE_PROVIDER_ERROR', 'overloaded_error'],
    [{ is_error: true, subtype: 'Detalle Muy Largo Con Espacios' }, 'AGT002_CLAUDE_PROVIDER_ERROR', undefined],
    // A provider structured-output-retry-exhaustion subtype/error.type must not collapse into the
    // generic AGT002_CODEX_PROVIDER_ERROR: tender-semantic-discovery.js only retries
    // AGT002_CODEX_TIMEOUT, so this condition needs its OWN dedicated native safe code so the wire
    // layer and the batch retry can single it out.
    [{ is_error: true, subtype: 'error_max_structured_output_retries' }, 'AGT002_CLAUDE_STRUCTURED_OUTPUT_RETRY_EXHAUSTED', 'error_max_structured_output_retries'],
    [{ is_error: true, subtype: 'success', error: { type: 'error_max_structured_output_retries' } }, 'AGT002_CLAUDE_STRUCTURED_OUTPUT_RETRY_EXHAUSTED', 'error_max_structured_output_retries'],
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

async function testSessionLimitMapsToItsOwnCode() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', JSON.stringify({ is_error: true, subtype: 'success', result: "You've hit your session limit · resets 9:20pm (UTC)" }));
    children[0].emit('exit', 0, null);
  });
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'AGT002_CLAUDE_SESSION_LIMIT');
    const serialized = `${error.message} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    assert.equal(serialized.includes('9:20pm'), false, 'la hora libre del proveedor no se propaga');
    return true;
  });
}

async function testOversizedStdoutFailsClosed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', 'x'.repeat(AGT002_CLAUDE_MAX_STDOUT_BYTES + 1));
  });
  await assert.rejects(pending, error => error.code === 'AGT002_CLAUDE_OUTPUT_TOO_LARGE' && !error.message.includes('xxxx'));
  assert.ok(children[0].signals.includes('SIGTERM'), 'una salida desbordada debe terminar el subproceso');
}

async function testStderrIsNeverSurfaced() {
  const { client, children } = harness();
  const secret = 'stderr con rutas internas y tokens';
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stderr.emit('data', secret);
    children[0].emit('exit', 1, null);
  });
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'AGT002_CLAUDE_TRANSPORT_ERROR');
    const serialized = `${error.message} ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    assert.equal(serialized.includes(secret), false, 'stderr nunca debe llegar al caller');
    return true;
  });
}

async function testSpawnFailureFailsClosed() {
  const { client, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => children[0].emit('error', new Error('ENOENT /usr/local/bin/claude')));
  await assert.rejects(pending, error => error.code === 'AGT002_CLAUDE_TRANSPORT_ERROR' && !error.message.includes('ENOENT'));
}

async function testInvalidArgumentsRejectedBeforeSpawn() {
  const { client, calls } = harness();
  const base = { model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 };
  for (const override of [{ model: '' }, { policy: '' }, { outputSchema: [] }, { outputSchema: null }, { timeoutMs: 0 }, { timeoutMs: 1.5 }, { input: 'texto' }]) {
    await assert.rejects(client.run({ ...base, ...override }), /AGT-002|no es válido|requiere/i, JSON.stringify(override));
  }
  assert.equal(calls.length, 0, 'ningún argumento inválido debe llegar a lanzar el proveedor');
}

// ---------------------------------------------------------------------------
// Esquemas grandes: Claude Code 2.1.263 sólo soporta --json-schema inline, no
// --json-schema-file ni archivos temporales. Por debajo o igual al techo
// seguro de argv (AGT002_CLAUDE_MAX_SCHEMA_BYTES = 120 000 bytes UTF-8, por
// debajo de MAX_ARG_STRLEN = 131072) el esquema viaja literal en argv; por
// encima, el turno se rechaza antes de invocar spawn.
// ---------------------------------------------------------------------------

function schemaOfExactBytes(targetBytes) {
  const schema = { type: 'object', properties: { pad: { type: 'string', description: '' } } };
  const overhead = Buffer.byteLength(JSON.stringify(schema), 'utf8');
  schema.properties.pad.description = 'x'.repeat(targetBytes - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(schema), 'utf8'), targetBytes);
  return schema;
}

async function testSchemaAboveOldFileCeilingStaysInlineNeverFile() {
  const schemaAround68KiB = schemaOfExactBytes(68 * 1024);
  const { client, calls, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: schemaAround68KiB, timeoutMs: 5000 });

  assert.equal(calls.length, 1, 'un esquema de ~68 KiB debe lanzar el proveedor');
  const [call] = calls;
  assert.equal(call.args.includes('--json-schema-file'), false, 'Claude Code 2.1.263 no soporta --json-schema-file: un esquema >65536B debe seguir viajando inline');
  const schemaFlagIndex = call.args.indexOf('--json-schema');
  assert.notEqual(schemaFlagIndex, -1, 'el esquema debe viajar por --json-schema literal en argv');
  assert.equal(call.args[schemaFlagIndex + 1], JSON.stringify(schemaAround68KiB), 'el esquema serializado debe viajar inline, tal cual, en argv');

  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;
}

async function testSchemaAtSafeInlineCapStaysOnArgv() {
  const { client, calls, children } = harness();
  const atCap = schemaOfExactBytes(AGT002_CLAUDE_MAX_SCHEMA_BYTES);
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: atCap, timeoutMs: 5000 });
  assert.equal(calls.length, 1, 'el techo exacto todavía debe lanzar el proveedor');
  assert.equal(calls[0].args.includes('--json-schema-file'), false, 'Claude Code 2.1.263 no soporta --json-schema-file');
  const schemaArg = calls[0].args[calls[0].args.indexOf('--json-schema') + 1];
  assert.equal(Buffer.byteLength(schemaArg, 'utf8'), AGT002_CLAUDE_MAX_SCHEMA_BYTES);
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  await pending;
}

async function testSchemaAboveSafeInlineCapFailsClosedBeforeSpawn() {
  const oversizedSchema = schemaOfExactBytes(AGT002_CLAUDE_MAX_SCHEMA_BYTES + 1);
  const { client, calls } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: oversizedSchema, timeoutMs: 5000 });
  assert.equal(calls.length, 0, 'un esquema por encima del techo seguro de argv nunca debe lanzar el proveedor');
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'AGT002_CLAUDE_SCHEMA_TOO_LARGE');
    assert.equal(JSON.stringify(error, Object.getOwnPropertyNames(error)).includes('"pad"'), false, 'el contenido del esquema nunca debe aparecer en el error');
    return true;
  });
}

async function testNoTempFileArtifactsEverForLargeSchemas() {
  const bigSchema = schemaOfExactBytes(AGT002_CLAUDE_MAX_SCHEMA_BYTES);
  // A private, exclusively-owned directory (never the shared OS tmpdir) so the no-artifact
  // assertions below can check for emptiness directly, with no risk of unrelated concurrent
  // processes writing into the same shared tmpdir racing the before/after diff.
  const cwd = mkdtempSync(join(tmpdir(), 'agt002-claude-client-test-'));
  try {
    const { client, calls, children } = harness({ cwd });
    const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: bigSchema, timeoutMs: 5000 });
    assert.equal(calls[0].args.includes('--json-schema-file'), false, 'la bandera --json-schema-file no existe en Claude Code 2.1.263');
    assert.deepEqual(readdirSync(cwd), [], 'ningún archivo temporal de esquema debe escribirse en el cwd');
    await settleSoon(() => {
      children[0].stdout.emit('data', successPayload());
      children[0].emit('exit', 0, null);
    });
    await pending;
    assert.deepEqual(readdirSync(cwd), [], 'ningún archivo temporal de esquema debe quedar tras el turno');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// effort: el bridge sólo puede confirmar un esfuerzo que realmente aplicó al
// proceso de Claude. Los valores no soportados fallan antes de crear el hijo.
// ---------------------------------------------------------------------------

async function testEffortIsForwardedToClaudeCliAndAckedWhenRequested() {
  const { client, calls, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, effort: 'low' });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  const result = await pending;
  const effortIndex = calls[0].args.indexOf('--effort');
  assert.notEqual(effortIndex, -1, 'un effort pedido debe llegar al CLI');
  assert.deepEqual(calls[0].args.slice(effortIndex, effortIndex + 2), ['--effort', 'low']);
  assert.equal(calls[0].args.filter(arg => arg === '--effort').length, 1, 'la bandera se pasa exactamente una vez');
  assert.equal(result.effort_ack, 'low', 'sólo se confirma el effort aplicado al CLI');
}

async function testUnsupportedEffortIsRejectedBeforeSpawn() {
  const { client, calls } = harness();
  await assert.rejects(
    client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000, effort: 'ultra' }),
    /effort|esfuerzo/i,
  );
  assert.equal(calls.length, 0, 'un effort no soportado nunca debe lanzar el proveedor');
}

async function testEffortOmittedNeverInventsAnAck() {
  const { client, calls, children } = harness();
  const pending = client.run({ model: MODEL, policy: POLICY, input: INPUT, outputSchema: SCHEMA, timeoutMs: 5000 });
  await settleSoon(() => {
    children[0].stdout.emit('data', successPayload());
    children[0].emit('exit', 0, null);
  });
  const result = await pending;
  assert.equal(calls[0].args.includes('--effort'), false, 'sin effort pedido no se debe agregar la bandera');
  assert.equal(Object.hasOwn(result, 'effort_ack'), false, 'sin effort pedido no debe inventarse una confirmación');
}

await testSpawnContractAndStdin();
await testFixedSafeCwd();
await testApiKeysNeverReachTheProvider();
await testStructuredOutputParsed();
console.log('agt002-claude-client.test.mjs Paso 1 OK');

await testTimeoutKillsTheSubprocess();
await testAbortCancelsTheRun();
await testPreAbortedSignalNeverSpawns();
await testMalformedOutputsFailClosed();
await testProviderErrorsMapToSafeCodes();
await testSessionLimitMapsToItsOwnCode();
await testOversizedStdoutFailsClosed();
await testStderrIsNeverSurfaced();
await testSpawnFailureFailsClosed();
await testInvalidArgumentsRejectedBeforeSpawn();
console.log('agt002-claude-client.test.mjs Paso 2 OK');

await testSchemaAboveOldFileCeilingStaysInlineNeverFile();
await testSchemaAtSafeInlineCapStaysOnArgv();
await testSchemaAboveSafeInlineCapFailsClosedBeforeSpawn();
await testNoTempFileArtifactsEverForLargeSchemas();
console.log('agt002-claude-client.test.mjs Paso 3 OK');

await testEffortIsForwardedToClaudeCliAndAckedWhenRequested();
await testUnsupportedEffortIsRejectedBeforeSpawn();
await testEffortOmittedNeverInventsAnAck();
console.log('agt002-claude-client.test.mjs Paso 4 OK');
