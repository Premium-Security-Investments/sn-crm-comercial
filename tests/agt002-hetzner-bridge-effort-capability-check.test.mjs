import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCodexEffortCapability, AGT002_CODEX_EFFORT_CAPABILITY_OK, AGT002_CODEX_EFFORT_CAPABILITY_MISSING } from '../agt002-codex-effort-capability.js';
import { generate, readGeneratedBundle, listFilesRecursively } from '../ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs';

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
console.log('agt002-hetzner-bridge-effort-capability-check.test.mjs OK');
