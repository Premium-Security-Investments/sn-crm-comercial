import { spawn as defaultSpawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCodexEffortCapability, AGT002_CODEX_EFFORT_CAPABILITY_MISSING } from '../../agt002-codex-effort-capability.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../../agt002-preview-reasoning-effort.js';

// Deployment/runbook gate: verify the installed Codex App Server binary is actually compatible
// with the reasoning-effort hotfix, using only two separate non-billable, non-turn CLI checks:
//   A) it exposes v2 TurnStartParams.effort in its own generated protocol schema (turn-level,
//      defence-in-depth — accepted/echoed by the protocol, but not proof of actual application) —
//      `generate()`/`checkCodexEffortCapability`, below;
//   B) it recognizes the real CLI global override this fix actually pins reasoning effort with —
//      `--strict-config -c 'model_reasoning_effort="low"'` before the `app-server` subcommand — by
//      starting that exact long-running process and requiring a valid `initialize` response —
//      `verifyStrictConfigAppServerInitializes`, below.
// These must stay separate calls to the CLI: the real binary rejects `--strict-config` outright
// for `generate-json-schema` ("--strict-config is not supported for codex app-server
// generate-json-schema", exit 1) regardless of whether the config key itself is valid, so it can
// never be used to validate the override — only the actual `app-server` process can.
// Run this after any Codex CLI/App Server binary update and before routing traffic to it; a
// non-zero exit must block the deploy.
const command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex';
const AGT002_STRICT_CONFIG_INITIALIZE_TIMEOUT_MS = 5000;
const KILL_GRACE_MS = 200;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function listFilesRecursively(dir) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) files.push(...listFilesRecursively(fullPath));
    else files.push(fullPath);
  }
  return files;
}

// The installed CLI does not print the schema to stdout: it requires an --out directory and
// writes a bundle of files into it. Merge that bundle into a single text blob the shared,
// unit-tested lookup can search deterministically, without assuming an exact file layout —
// whether the CLI writes one type per file (e.g. `TurnStartParams.json` holding just that type's
// own schema, with no $defs wrapper of its own) or a single already-bundled schema document:
// - every JSON file is merged under one synthetic top-level $defs bundle, keyed by file name, so
//   the shared lookup's recursive $defs/definitions search finds *TurnStartParams regardless of
//   which file it landed in, or whether that file needed wrapping in the first place (wrapping an
//   already-bundled file just adds a harmless extra nesting level the same recursive search still
//   walks through);
// - a non-JSON (e.g. TypeScript bindings) bundle is concatenated instead, which the TS-bindings
//   lookup can scan for a TurnStartParams interface/type block anywhere in the combined text.
export function readGeneratedBundle(outDir) {
  const files = listFilesRecursively(outDir);
  if (files.length === 0) throw new Error('El binario de Codex App Server no generó ningún archivo de esquema.');

  const merged = { $defs: {} };
  for (const file of files) {
    try {
      merged.$defs[basename(file, extname(file))] = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return files.map(each => readFileSync(each, 'utf8')).join('\n');
    }
  }
  return JSON.stringify(merged);
}

// `command`/`spawn` are overridable purely so tests can exercise the real temp-dir-generate-
// inspect-cleanup sequence against a fake binary, without ever touching a real Codex install.
// Never pass --strict-config or a model_reasoning_effort override here: the real CLI rejects
// --strict-config outright for generate-json-schema (exit 1, "--strict-config is not supported
// for codex app-server generate-json-schema"), regardless of whether the config key itself is
// valid — verifying that override is verifyStrictConfigAppServerInitializes's job, below.
export function generate({ command: commandOverride = command, spawn = spawnSync } = {}) {
  const outDir = mkdtempSync(join(tmpdir(), 'agt002-codex-schema-'));
  try {
    const result = spawn(commandOverride, ['app-server', 'generate-json-schema', '--out', outDir], { encoding: 'utf8' });
    if (result.error || result.status !== 0) {
      throw new Error('No fue posible generar el esquema del protocolo de Codex App Server.');
    }
    return readGeneratedBundle(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/**
 * Check B: starts the real, long-running `codex --strict-config -c 'model_reasoning_effort="low"'
 * app-server` process — the exact process-startup shape this fix actually pins reasoning effort
 * with — and speaks ONLY the app-server `initialize` handshake over stdin. Never starts a thread
 * or a turn, never any provider generation. Resolves `true` only for a well-formed
 * JSON-RPC `initialize` result; resolves `false` (never throws/rejects) on a JSON-RPC error
 * response, a spawn error, a malformed or missing response, a stderr-only exit, or a bounded
 * timeout — always terminating and cleaning up the child process either way, never leaking a
 * process or a listener.
 */
export function verifyStrictConfigAppServerInitializes({
  command: commandOverride = command,
  spawn = defaultSpawn,
  effort = AGT002_PREVIEW_DEFAULT_REASONING_EFFORT,
  timeoutMs = AGT002_STRICT_CONFIG_INITIALIZE_TIMEOUT_MS,
} = {}) {
  return new Promise(resolve => {
    let settled = false;
    let buffer = '';
    const child = spawn(commandOverride, [
      '--strict-config',
      '-c',
      `model_reasoning_effort="${effort}"`,
      'app-server',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdout?.removeAllListeners?.('data'); } catch { /* best effort */ }
      try { child.stdin?.end?.(); } catch { /* best effort */ }
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch { /* best effort */ }
        const killer = setTimeout(() => { try { if (!child.killed) child.kill('SIGKILL'); } catch { /* best effort */ } }, KILL_GRACE_MS);
        killer.unref?.();
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    child.on('error', () => finish(false));
    child.on('exit', () => finish(false));
    child.stderr?.on?.('data', () => { /* provider/CLI detail is never surfaced to the caller */ });

    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (settled) return;
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!isPlainObject(message) || message.id !== 1) continue;
        finish(!message.error && Object.hasOwn(message, 'result'));
        return;
      }
    });

    try {
      child.stdin.write(`${JSON.stringify({
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'siio-agt002-capability-check', version: '1.0.0' } },
      })}\n`);
    } catch {
      finish(false);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const schemaResult = checkCodexEffortCapability({ generate });
    const strictConfigOk = await verifyStrictConfigAppServerInitializes();
    const ok = schemaResult.ok && strictConfigOk;
    const code = schemaResult.ok && !strictConfigOk ? AGT002_CODEX_EFFORT_CAPABILITY_MISSING : schemaResult.code;
    console.log(JSON.stringify({ event: 'agt002_bridge_capability', ok, code }));
    process.exitCode = ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ event: 'agt002_bridge_capability', ok: false, code: 'AGT002_CODEX_EFFORT_CAPABILITY_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
