// AGT-002 P0-05 remainder — initial-analysis ops artifact contract (docs/agt002/initial-analysis/
// CURRENT.md). Pins the durable worker runner + its systemd unit files: fail-closed kill
// switches ahead of any Supabase client, no reanalysis operational coupling, and declarative
// (not self-installing) unit files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ops = path.join(root, 'ops/agt002-initial-analysis-worker');
const read = name => fs.readFileSync(path.join(ops, name), 'utf8');

const RUNNER_NAME = 'run-agt002-initial-analysis-worker.mjs';
const SERVICE_NAME = 'agt002-initial-analysis-worker.service';
const TIMER_NAME = 'agt002-initial-analysis-worker.timer';

for (const name of [RUNNER_NAME, SERVICE_NAME, TIMER_NAME]) {
  assert.ok(fs.existsSync(path.join(ops, name)), `${name} must exist`);
}

const runner = read(RUNNER_NAME);

assert.match(runner, /agt002-initial-analysis-worker\.js/);
assert.match(runner, /agt002-initial-analysis-executor\.js/);
assert.doesNotMatch(runner, /agt002-reanalysis-worker/);
assert.doesNotMatch(runner, /agt002-reanalysis-executor/);
assert.doesNotMatch(runner, /agt002-reanalysis-api/);

assert.match(runner, /AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED/);
assert.match(runner, /AGT002_MODEL_CALLS_ENABLED/);
// Fail-closed: a kill-switch check must appear before any Supabase client construction.
const killSwitchIndex = runner.search(/AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED/);
const createClientIndex = runner.search(/createClient\(/);
assert.ok(killSwitchIndex >= 0, 'runner must reference the admission kill switch');
assert.ok(createClientIndex >= 0, 'runner must create a supabase client');
assert.ok(killSwitchIndex < createClientIndex, 'kill switch check must run before the supabase client is created');
assert.match(runner, /process\.exit\(1\)/);

for (const name of [SERVICE_NAME, TIMER_NAME]) {
  const unit = read(name);
  assert.doesNotMatch(unit, /systemctl enable/);
  assert.doesNotMatch(unit, /\[Install\]/);
}

const allOpsFiles = fs.readdirSync(ops);
for (const name of allOpsFiles) {
  const content = fs.readFileSync(path.join(ops, name), 'utf8');
  assert.doesNotMatch(content, /psi_agt002_reanalysis_jobs/, `${name} must not reference the reanalysis jobs table`);
}

console.log('AGT-002 initial-analysis worker ops artifact contract passed');
