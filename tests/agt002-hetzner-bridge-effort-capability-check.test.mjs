import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCodexEffortCapability, AGT002_CODEX_EFFORT_CAPABILITY_OK, AGT002_CODEX_EFFORT_CAPABILITY_MISSING } from '../agt002-codex-effort-capability.js';
import {
  generate,
  readGeneratedBundle,
  listFilesRecursively,
  verifyStrictConfigAppServerInitializes,
} from '../ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

// Regression: the real installed `codex app-server generate-json-schema` command does not print
// JSON to stdout — it requires `--out <DIR>` and writes a bundle of files into that directory.
// A naive `spawnSync(command, [...]).stdout` read (the pre-fix implementation) always sees an
// empty stdout against the real binary and reports AGT002_CODEX_EFFORT_CAPABILITY_CHECK_FAILED,
// even on a fully capable install. These tests exercise the actual temp-dir-generate-inspect-
// cleanup sequence against a fake binary, never a real Codex install.

function makeScratchDir() {
  return mkdtempSync(join(tmpdir(), 'agt002-effort-capability-test-'));
}

function testReadGeneratedBundleFromASingleAlreadyBundledFile() {
  const dir = makeScratchDir();
  try {
    const schema = { $defs: { v2TurnStartParams: { type: 'object', properties: { effort: { type: 'string' } } } } };
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema));
    const merged = JSON.parse(readGeneratedBundle(dir));
    assert.deepEqual(merged.$defs.schema, schema, 'an already-bundled single file must survive intact, just nested one level deeper');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The installed CLI may write one type per file with no $defs wrapper of its own — e.g. a file
// literally named TurnStartParams.json whose entire content is that one type's schema. The shared
// lookup only recognizes a *TurnStartParams entry inside a $defs/definitions bucket, so this file
// must be found via the filename-keyed $defs wrapper, not by its own (nonexistent) bucket.
function testReadGeneratedBundleFromASingleUnwrappedTypeFile() {
  const dir = makeScratchDir();
  try {
    writeFileSync(join(dir, 'TurnStartParams.json'), JSON.stringify({ type: 'object', properties: { effort: { type: 'string' } } }));
    const merged = JSON.parse(readGeneratedBundle(dir));
    assert.ok(merged.$defs.TurnStartParams, 'a lone, unwrapped per-type file must still be reachable through the synthetic $defs bundle');
    assert.ok(merged.$defs.TurnStartParams.properties.effort, 'the original per-type schema content must be preserved verbatim');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testReadGeneratedBundleMergesMultipleJsonFilesDeterministically() {
  const dir = makeScratchDir();
  try {
    writeFileSync(join(dir, 'ThreadStartParams.json'), JSON.stringify({ type: 'object', properties: { cwd: { type: 'string' } } }));
    writeFileSync(join(dir, 'TurnStartParams.json'), JSON.stringify({ type: 'object', properties: { effort: { type: 'string' } } }));
    const merged = JSON.parse(readGeneratedBundle(dir));
    assert.ok(merged.$defs.TurnStartParams, 'the merged bundle must expose each file under $defs');
    assert.deepEqual(Object.keys(merged.$defs).sort(), ['ThreadStartParams', 'TurnStartParams']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testReadGeneratedBundleWalksNestedDirectories() {
  const dir = makeScratchDir();
  try {
    mkdirSync(join(dir, 'v2'));
    writeFileSync(join(dir, 'v2', 'TurnStartParams.json'), JSON.stringify({ type: 'object', properties: { effort: { type: 'string' } } }));
    writeFileSync(join(dir, 'v2', 'AccountReadParams.json'), JSON.stringify({ type: 'object', properties: {} }));
    assert.deepEqual(listFilesRecursively(dir), [join(dir, 'v2', 'AccountReadParams.json'), join(dir, 'v2', 'TurnStartParams.json')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testReadGeneratedBundleFallsBackToConcatenationForNonJsonBundles() {
  const dir = makeScratchDir();
  try {
    writeFileSync(join(dir, 'a.ts'), 'export interface ThreadStartParams { cwd: string; }');
    writeFileSync(join(dir, 'b.ts'), "export interface TurnStartParams {\n  threadId: string;\n  effort?: 'low' | 'medium' | 'high';\n}");
    const bundle = readGeneratedBundle(dir);
    assert.match(bundle, /TurnStartParams/);
    assert.match(bundle, /effort/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testReadGeneratedBundleThrowsOnEmptyDirectory() {
  const dir = makeScratchDir();
  try {
    assert.throws(() => readGeneratedBundle(dir), /esquema/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeSpawnThatWrites(files) {
  let capturedOutDir = null;
  const spawn = (command, args) => {
    const outIndex = args.indexOf('--out');
    assert.ok(outIndex !== -1, 'generate() must invoke the real CLI with --out, since it never prints to stdout');
    capturedOutDir = args[outIndex + 1];
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(capturedOutDir, name), contents);
    return { status: 0, error: null };
  };
  return { spawn, getCapturedOutDir: () => capturedOutDir };
}

function testGenerateWritesToAFreshTempDirAndCleansItUpOnSuccess() {
  const { spawn, getCapturedOutDir } = fakeSpawnThatWrites({
    'schema.json': JSON.stringify({ $defs: { v2TurnStartParams: { type: 'object', properties: { effort: {} } } } }),
  });
  const text = generate({ command: 'fake-codex', spawn });
  assert.match(text, /effort/);
  const outDir = getCapturedOutDir();
  assert.ok(outDir.startsWith(tmpdir()), 'the schema bundle must be generated under the OS temp dir, never a fixed/shared path');
  assert.equal(existsSync(outDir), false, 'generate() must remove the temp directory after inspecting it');
}

function testGenerateCleansUpTempDirEvenWhenTheCommandFails() {
  let capturedOutDir = null;
  const spawn = (command, args) => {
    capturedOutDir = args[args.indexOf('--out') + 1];
    return { status: 1, error: null };
  };
  assert.throws(() => generate({ command: 'fake-codex', spawn }));
  assert.equal(existsSync(capturedOutDir), false, 'a failed generation must still clean up its temp directory');
}

function testGenerateCleansUpTempDirEvenWhenSpawnItselfErrors() {
  let capturedOutDir = null;
  const spawn = (command, args) => {
    capturedOutDir = args[args.indexOf('--out') + 1];
    return { status: null, error: new Error('spawn fake-codex ENOENT') };
  };
  assert.throws(() => generate({ command: 'fake-codex', spawn }));
  assert.equal(existsSync(capturedOutDir), false, 'a missing binary must still clean up its temp directory');
}

function testEndToEndCapableBundleReportsOk() {
  const { spawn } = fakeSpawnThatWrites({
    'TurnStartParams.json': JSON.stringify({ type: 'object', properties: { threadId: { type: 'string' }, effort: { type: 'string', enum: ['low', 'medium', 'high'] } } }),
  });
  const result = checkCodexEffortCapability({ generate: () => generate({ command: 'fake-codex', spawn }) });
  assert.deepEqual(result, { ok: true, code: AGT002_CODEX_EFFORT_CAPABILITY_OK });
}

function testEndToEndStaleBundleReportsMissing() {
  const { spawn } = fakeSpawnThatWrites({
    'TurnStartParams.json': JSON.stringify({ type: 'object', properties: { threadId: { type: 'string' } } }),
  });
  const result = checkCodexEffortCapability({ generate: () => generate({ command: 'fake-codex', spawn }) });
  assert.deepEqual(result, { ok: false, code: AGT002_CODEX_EFFORT_CAPABILITY_MISSING });
}

// Regression (real binary): `codex --strict-config -c 'model_reasoning_effort="low"' app-server
// generate-json-schema --out <DIR>` exits 1 with "--strict-config is not supported for codex
// app-server generate-json-schema" — generate-json-schema itself rejects --strict-config
// unconditionally, regardless of whether the config key is valid. generate() must therefore never
// pass --strict-config or the model_reasoning_effort override to generate-json-schema; verifying
// the CLI recognizes that override is check B's job (verifyStrictConfigAppServerInitializes),
// against the real long-running app-server process, never generate-json-schema.
function testGenerateInvokesCliWithoutStrictConfig() {
  let capturedArgs = null;
  const spawn = (command, args) => {
    capturedArgs = args;
    const outIndex = args.indexOf('--out');
    const outDir = args[outIndex + 1];
    writeFileSync(join(outDir, 'TurnStartParams.json'), JSON.stringify({ type: 'object', properties: { effort: { type: 'string' } } }));
    return { status: 0, error: null };
  };
  generate({ command: 'fake-codex', spawn });
  assert.deepEqual(
    capturedArgs,
    ['app-server', 'generate-json-schema', '--out', capturedArgs[capturedArgs.indexOf('--out') + 1]],
    'schema generation must never carry --strict-config or a model_reasoning_effort override — the real CLI rejects --strict-config outright for generate-json-schema',
  );
  assert.doesNotMatch(capturedArgs.join(' '), /--strict-config|model_reasoning_effort/);
}

// --- Check B: the real long-running `codex --strict-config -c 'model_reasoning_effort="low"'
// app-server` process, speaking ONLY `initialize` over stdin — never thread/start or turn/start,
// never a provider generation. Verifies the installed CLI actually accepts the strict-config
// override at process startup, since generate-json-schema itself cannot be used for that (see
// testGenerateInvokesCliWithoutStrictConfig above).

function fakeAppServerProcess({ respond = 'ok', exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.stdin = { write: (data) => { queueMicrotask(() => onWrite(data)); }, end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  const sentMethods = [];
  function onWrite(data) {
    const message = JSON.parse(String(data).trim());
    sentMethods.push(message.method);
    if (respond === 'ok') {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, result: { codexHome: '/tmp', platformFamily: 'unix', platformOs: 'linux', userAgent: 'fake/1.0' } })}\n`));
    } else if (respond === 'error') {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ id: message.id, error: { message: 'unrecognized config key' } })}\n`));
    } else if (respond === 'malformed') {
      child.stdout.emit('data', Buffer.from('not json at all\n'));
      child.emit('exit', exitCode);
    } else if (respond === 'stderr-only') {
      child.stderr.emit('data', Buffer.from('fatal: unrecognized configuration key model_reasoning_effort\n'));
      child.emit('exit', exitCode);
    } else if (respond === 'silent') {
      // never responds, never exits — exercised only against a short timeoutMs
    }
  }
  return { child, sentMethods };
}

async function testVerifyStrictConfigSpawnsWithExactArgvOrdering() {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  const { child } = fakeAppServerProcess({ respond: 'ok' });
  const spawn = (command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return child;
  };
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(capturedCommand, 'fake-codex');
  assert.deepEqual(capturedArgs, ['--strict-config', '-c', `model_reasoning_effort="${AGT002_PREVIEW_DEFAULT_REASONING_EFFORT}"`, 'app-server']);
  assert.equal(capturedOptions?.stdio?.[0], 'pipe');
  assert.equal(ok, true);
}

async function testVerifySendsOnlyInitializeAndNeverThreadOrTurnStart() {
  const { child, sentMethods } = fakeAppServerProcess({ respond: 'ok' });
  const spawn = () => child;
  await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.deepEqual(sentMethods, ['initialize'], 'the check must send only initialize, never thread/start or turn/start, never a provider generation');
}

async function testVerifyResolvesTrueAndCleansUpOnAValidInitializeResponse() {
  const { child } = fakeAppServerProcess({ respond: 'ok' });
  const spawn = () => child;
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(ok, true);
  assert.equal(child.killed, true, 'the child process must be terminated after a successful initialize handshake, never left running');
  assert.equal(child.stdout.listenerCount('data'), 0, 'stdout data listeners must be removed on cleanup');
}

async function testVerifyFailsClosedOnAJsonRpcErrorResponse() {
  const { child } = fakeAppServerProcess({ respond: 'error' });
  const spawn = () => child;
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(ok, false);
  assert.equal(child.killed, true);
}

async function testVerifyFailsClosedOnSpawnError() {
  const child = new EventEmitter();
  child.stdin = { write: () => {}, end() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  const spawn = () => {
    queueMicrotask(() => child.emit('error', new Error('spawn fake-codex ENOENT')));
    return child;
  };
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(ok, false);
}

async function testVerifyFailsClosedOnMalformedResponse() {
  const { child } = fakeAppServerProcess({ respond: 'malformed', exitCode: 1 });
  const spawn = () => child;
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(ok, false);
}

async function testVerifyFailsClosedOnStderrOnlyExit() {
  const { child } = fakeAppServerProcess({ respond: 'stderr-only', exitCode: 1 });
  const spawn = () => child;
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn });
  assert.equal(ok, false);
}

async function testVerifyFailsClosedOnTimeoutAndKillsTheProcess() {
  const { child } = fakeAppServerProcess({ respond: 'silent' });
  const spawn = () => child;
  const started = Date.now();
  const ok = await verifyStrictConfigAppServerInitializes({ command: 'fake-codex', spawn, timeoutMs: 50 });
  assert.equal(ok, false);
  assert.ok(Date.now() - started < 1000, 'the timeout must be bounded, never wait indefinitely');
  assert.equal(child.killed, true, 'a timed-out process must still be terminated, never leaked');
}

testReadGeneratedBundleFromASingleAlreadyBundledFile();
testReadGeneratedBundleFromASingleUnwrappedTypeFile();
testReadGeneratedBundleMergesMultipleJsonFilesDeterministically();
testReadGeneratedBundleWalksNestedDirectories();
testReadGeneratedBundleFallsBackToConcatenationForNonJsonBundles();
testReadGeneratedBundleThrowsOnEmptyDirectory();
testGenerateWritesToAFreshTempDirAndCleansItUpOnSuccess();
testGenerateCleansUpTempDirEvenWhenTheCommandFails();
testGenerateCleansUpTempDirEvenWhenSpawnItselfErrors();
testEndToEndCapableBundleReportsOk();
testEndToEndStaleBundleReportsMissing();
testGenerateInvokesCliWithoutStrictConfig();
await testVerifyStrictConfigSpawnsWithExactArgvOrdering();
await testVerifySendsOnlyInitializeAndNeverThreadOrTurnStart();
await testVerifyResolvesTrueAndCleansUpOnAValidInitializeResponse();
await testVerifyFailsClosedOnAJsonRpcErrorResponse();
await testVerifyFailsClosedOnSpawnError();
await testVerifyFailsClosedOnMalformedResponse();
await testVerifyFailsClosedOnStderrOnlyExit();
await testVerifyFailsClosedOnTimeoutAndKillsTheProcess();
console.log('agt002-hetzner-bridge-effort-capability-check.test.mjs OK');
