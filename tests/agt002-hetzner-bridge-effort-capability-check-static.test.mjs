import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const file = new URL('../ops/agt002-hetzner-bridge/check-codex-effort-capability.mjs', import.meta.url);
assert.equal(existsSync(file), true, 'the deployment capability check script must exist');
const source = readFileSync(file, 'utf8');

assert.match(source, /import\s*\{\s*checkCodexEffortCapability\s*\}\s*from\s*'\.\.\/\.\.\/agt002-codex-effort-capability\.js'/, 'must reuse the shared, unit-tested capability logic rather than reimplementing parsing');
assert.match(source, /generate-json-schema/, 'must invoke the real, documented Codex App Server schema generator, not the live agent protocol');
assert.doesNotMatch(source, /turn\/start|thread\/start|account\/read|account\/login|item\/completed/, 'the deployment check must never perform a live model call');
assert.match(source, /spawnSync/, 'schema generation must be synchronous and deterministic for a pre-deploy gate, never an async live call');
assert.match(source, /--out/, 'the installed generate-json-schema command writes its bundle to a directory, not stdout, and must be invoked with --out');
assert.match(source, /mkdtempSync/, 'must generate the schema bundle into a fresh, unpredictable temp directory rather than a fixed/shared path');
assert.match(source, /rmSync/, 'must clean up the generated schema bundle temp directory after inspecting it');
assert.match(source, /process\.exitCode\s*=\s*1|process\.exit\(1\)/, 'must fail the deploy step (non-zero exit) when the capability is missing');
assert.match(source, /agt002_bridge_capability/, 'must emit the safe, allowlisted capability telemetry event name');
assert.doesNotMatch(source, /policy|baseInstructions|prompt/i, 'must never reference prompt/policy content');

console.log('agt002-hetzner-bridge-effort-capability-check-static.test.mjs OK');
