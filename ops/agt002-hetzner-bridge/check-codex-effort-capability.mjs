import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCodexEffortCapability } from '../../agt002-codex-effort-capability.js';

// Deployment/runbook gate: verify the Codex App Server binary about to be (or already) installed
// on the Hetzner bridge host actually exposes v2 TurnStartParams.effort, using only the binary's
// own generated protocol schema — never a live turn. Run this after any Codex CLI/App Server
// binary update and before routing traffic to it; a non-zero exit must block the deploy.
const command = process.env.AGT002_CODEX_APP_SERVER_BIN || 'codex';

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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { ok, code } = checkCodexEffortCapability({ generate });
    console.log(JSON.stringify({ event: 'agt002_bridge_capability', ok, code }));
    process.exitCode = ok ? 0 : 1;
  } catch {
    console.log(JSON.stringify({ event: 'agt002_bridge_capability', ok: false, code: 'AGT002_CODEX_EFFORT_CAPABILITY_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
