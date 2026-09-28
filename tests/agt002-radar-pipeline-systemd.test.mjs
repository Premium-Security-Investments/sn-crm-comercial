import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const base = new URL('../ops/agt002-radar-pipeline/', import.meta.url);
const files = ['run-agt002-radar-pipeline.mjs', 'agt002-radar-pipeline.service', 'agt002-radar-pipeline.timer'];
for (const file of files) assert.equal(existsSync(new URL(file, base)), true, file);
const read = file => readFileSync(new URL(file, base), 'utf8');
const runner = read(files[0]);
const service = read(files[1]);
const timer = read(files[2]);

// [Retirement, 2026-09-28] The AGT-002 AI radar pipeline is retired. The runner keeps only the
// side-effect-free --control-plane identity report; every other invocation must report the
// retirement and do nothing else -- no queue claim, no provider/bridge call, no Supabase client,
// no secret, no env read.
assert.match(runner, /process\.argv\.includes\('--control-plane'\)/);
assert.match(runner, /buildRadarPipelineIdentity/);
assert.match(runner, /resolveAgt002ReleaseArtifactEvidence/);
assert.match(runner, /from\s+'\.\.\/\.\.\/agt002-control-plane-surface-builders\.js'/);
assert.match(runner, /from\s+'\.\.\/\.\.\/agt002-control-plane-runtime-evidence\.js'/);
assert.match(runner, /status:\s*'retired'/);
assert.match(runner, /AGT002_RADAR_AI_RETIRED/);

// Absence: worker.
assert.doesNotMatch(runner, /createAgt002RadarWorker/);
assert.doesNotMatch(runner, /agt002-radar-worker(\.js)?/);
assert.doesNotMatch(runner, /\brunOnce\(/);
// Absence: model.
assert.doesNotMatch(runner, /AGT002_RADAR_PREANALYSIS_MODEL/);
assert.doesNotMatch(runner, /AGT002_RADAR_PREANALYSIS_TIMEOUT_MS/);
// Absence: bridge.
assert.doesNotMatch(runner, /AGT002_HETZNER_BRIDGE_URL/);
assert.doesNotMatch(runner, /AGT002_HETZNER_BRIDGE_HMAC_SECRET/);
// Absence: Supabase.
assert.doesNotMatch(runner, /@supabase\/supabase-js/);
assert.doesNotMatch(runner, /createClient\(/);
assert.doesNotMatch(runner, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/);
// Absence: secret (the HMAC bridge secret and the Supabase service-role key, above, are the only
// secrets this entrypoint ever read).
// Absence: env (no configuration or credential is read).
assert.doesNotMatch(runner, /process\.env/);

assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)|fetch\(|https?:\/\//);

// Service and timer: tombstone, not startable, no active env/secret/schedule.
assert.match(service, /Type=oneshot/);
assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/psi-comercial\/app\/ops\/agt002-radar-pipeline\/run-agt002-radar-pipeline\.mjs/);
assert.match(service, /RefuseManualStart=true/);
// No EnvironmentFile: the tombstone reads no secret and no configuration.
assert.doesNotMatch(service, /EnvironmentFile=/);
assert.doesNotMatch(service, /AGT002_HETZNER_BRIDGE_URL|AGT002_HETZNER_BRIDGE_HMAC_SECRET/);
assert.doesNotMatch(service, /AGT002_RADAR_PREANALYSIS_MODEL|AGT002_RADAR_PREANALYSIS_TIMEOUT_MS/);
assert.doesNotMatch(service, /SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);

assert.match(timer, /Unit=agt002-radar-pipeline\.service/);
assert.match(timer, /RefuseManualStart=true/);
// Permanently inert: an impossible condition gates the unit regardless of any trigger.
assert.match(timer, /ConditionPathExists=\/run\/agt002-radar-ai-retired-do-not-create/);
// A trigger directive is present only because systemd requires one syntactically; it must not
// be treated as an active schedule -- the Condition above is what keeps this unit inert.
assert.match(timer, /OnCalendar=|OnBootSec=|OnUnitActiveSec=|OnActiveSec=/);
assert.match(timer, /Persistent=false/);
// No [Install] section: this tombstone must never be enabled to run at boot/login.
assert.doesNotMatch(timer, /WantedBy=timers\.target/);
assert.doesNotMatch(timer, /\[Install\]/);

for (const file of files) {
  assert.equal(read(file).includes('systemctl '), false);
  assert.equal(read(file).includes('--apply'), false);
}

// [Retirement, 2026-09-28, issue #247] env.example must accept zero configuration: no variable
// assignment of any kind, no secret, no URL, no model name -- only retirement comments.
const envExample = read('env.example');
for (const line of envExample.split('\n')) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  assert.fail(`env.example must contain only comments/blank lines, found: ${line}`);
}
assert.match(envExample, /no configuration accepted/i);
assert.doesNotMatch(envExample, /https?:\/\//);

// README.md is the local tombstone, not an operational runbook: short, states the retirement, and
// forbids installing/enabling/activating the tombstone unit.
const readme = read('README.md');
assert.match(readme, /RETIRED/);
assert.match(readme, /issue #247/);
assert.match(readme, /AGT002_RADAR_AI_RETIRED/);
assert.match(readme, /--control-plane/);
assert.match(readme, /docs\/runbooks\/agt002-radar-pipeline\.md/);
for (const forbidden of [
  'AGT002_RADAR_GATE=', 'AGT002_RADAR_VISIBILITY=', 'AGT002_RADAR_PREANALYSIS_MODEL',
  'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET',
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
]) assert.equal(readme.includes(forbidden), false, forbidden);

console.log('AGT-002 Radar AI pipeline is retired: no worker/model/bridge/Supabase/secret/env, tombstone unit not startable with no active schedule, control-plane identity preserved, README/env.example carry no historical pins');
