import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const file = new URL('../ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs', import.meta.url);
assert.equal(existsSync(file), true, 'the deployment capability check script must exist');
const source = readFileSync(file, 'utf8');

assert.match(source, /import\s*\{\s*checkCodexEffortCapability\s*(?:,\s*[^}]+)?\}\s*from\s*'\.\.\/\.\.\/agt002-codex-effort-capability\.js'/, 'must reuse the shared, unit-tested capability logic rather than reimplementing parsing');
assert.match(source, /generate-json-schema/, 'must invoke the real, documented Codex App Server schema generator, not the live agent protocol');
assert.doesNotMatch(source, /turn\/start|thread\/start|account\/read|account\/login|item\/completed/, 'the deployment check must never perform a live model call');
assert.match(source, /spawnSync/, 'schema generation must be synchronous and deterministic for a pre-deploy gate, never an async live call');
assert.match(source, /--out/, 'the installed generate-json-schema command writes its bundle to a directory, not stdout, and must be invoked with --out');
assert.match(source, /mkdtempSync/, 'must generate the schema bundle into a fresh, unpredictable temp directory rather than a fixed/shared path');
assert.match(source, /rmSync/, 'must clean up the generated schema bundle temp directory after inspecting it');
assert.match(source, /process\.exitCode\s*=\s*1|process\.exit\(1\)/, 'must fail the deploy step (non-zero exit) when the capability is missing');
assert.match(source, /agt002_bridge_capability/, 'must emit the safe, allowlisted capability telemetry event name');
assert.doesNotMatch(source, /policy|baseInstructions|prompt/i, 'must never reference prompt/policy content');

// AGT-002 hotfix: turn/start.params.effort is accepted/echoed by the protocol but is not proof
// the subprocess actually applies it (production evidence: Codex's own internal tracing recorded
// reasoning_effort=medium for a turn whose turn/start carried effort='low'). This deployment gate
// must also validate the installed CLI recognizes the real process-startup override this fix pins
// reasoning effort with — via a SEPARATE check against the actual app-server process, never via
// generate-json-schema (the real CLI rejects --strict-config outright for that subcommand: exit 1,
// "--strict-config is not supported for codex app-server generate-json-schema", regardless of
// whether the config key itself is valid).
assert.match(source, /--strict-config/, 'must validate the installed CLI with --strict-config so an unrecognized config key fails closed');
assert.match(source, /model_reasoning_effort/, 'must validate the installed CLI recognizes the model_reasoning_effort override');
assert.match(
  source,
  /import\s*\{\s*AGT002_PREVIEW_DEFAULT_REASONING_EFFORT\s*\}\s*from\s*'\.\.\/\.\.\/agt002-preview-reasoning-effort\.js'/,
  'must derive the tested override value from the shared allowlisted reasoning-effort module, never a free-form string',
);

// Regression guard: the generate() function (schema generation via spawnSync) must never carry
// --strict-config/model_reasoning_effort — only the separate long-running app-server initialize
// check may.
{
  const generateBody = source.match(/export function generate\(([\s\S]*?)\n\}/);
  assert.ok(generateBody, 'must be able to locate the generate() function body');
  assert.doesNotMatch(generateBody[1], /--strict-config/, 'generate() (generate-json-schema) must never pass --strict-config — the real CLI rejects it outright for that subcommand');
  assert.doesNotMatch(generateBody[1], /model_reasoning_effort/, 'generate() (generate-json-schema) must never pass a model_reasoning_effort override');
}

// Check B: verifyStrictConfigAppServerInitializes must start the real app-server process (async
// spawn, not spawnSync) and speak only `initialize`, bounded by a timeout, never a live turn.
assert.match(source, /export (?:async )?function verifyStrictConfigAppServerInitializes/, 'must export a separate check that verifies the real app-server process against --strict-config');
{
  const strictConfigBody = source.match(/export function verifyStrictConfigAppServerInitializes\(([\s\S]*?)\n\}\n/);
  assert.ok(strictConfigBody, 'must be able to locate the verifyStrictConfigAppServerInitializes() function body');
  assert.doesNotMatch(strictConfigBody[1], /generate-json-schema/, 'the strict-config process check must never invoke generate-json-schema');
  assert.match(strictConfigBody[1], /'initialize'/, 'must send the app-server initialize request');
  assert.doesNotMatch(strictConfigBody[1], /thread\/start|turn\/start|account\/read|account\/login|item\/completed/, 'the strict-config process check must never speak the live turn protocol');
  assert.match(strictConfigBody[1], /timeoutMs/, 'must bound the wait for a response with a timeout');
  assert.match(strictConfigBody[1], /\.kill\(/, 'must terminate the child process, never leak it');
}
assert.match(source, /AGT002_STRICT_CONFIG_INITIALIZE_TIMEOUT_MS\s*=\s*5000/, 'the strict-config initialize check must be bounded to a short, fixed timeout');

// The deployment script's main entrypoint must await both checks and combine them into the single
// existing safe telemetry line — no separate/extra stdout lines, no raw config or payload fields.
{
  const mainBlock = source.match(/if \(process\.argv\[1\][\s\S]*$/);
  assert.ok(mainBlock, 'must be able to locate the script main entrypoint');
  assert.match(mainBlock[0], /checkCodexEffortCapability\(/, 'main must run check A (schema/effort)');
  assert.match(mainBlock[0], /await verifyStrictConfigAppServerInitializes\(/, 'main must await check B (strict-config app-server initialize)');
  assert.equal((mainBlock[0].match(/console\.log/g) || []).length, 2, 'main must emit exactly one telemetry line per branch (success/failure), never raw config or payload output');
}

console.log('agt002-hetzner-bridge-effort-capability-check-static.test.mjs OK');
