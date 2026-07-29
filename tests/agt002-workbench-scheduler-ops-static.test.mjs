import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../ops/agt002-workbench-scheduler/', import.meta.url);
const script = readFileSync(new URL('run-agt002-workbench-worker.sh', root), 'utf8');
const service = readFileSync(new URL('agt002-workbench-scheduler.service', root), 'utf8');
const timer = readFileSync(new URL('agt002-workbench-scheduler.timer', root), 'utf8');

// --- script: fail-closed, dedicated secret/URL, bounded, POST, dedicated header ---
assert.ok(script.includes('set -euo pipefail'), 'script must fail closed');
assert.ok(script.includes('${AGT002_WORKBENCH_WORKER_URL:?'), 'script must require its own dedicated URL var');
assert.ok(script.includes('${AGT002_WORKBENCH_WORKER_SECRET:?'), 'script must require its own dedicated secret var');
assert.ok(script.includes('--fail-with-body'), 'HTTP errors must fail the unit (fail closed)');
assert.ok(/--max-time \d+/.test(script), 'request must have a bounded timeout');
assert.ok(script.includes('--request POST'), 'scheduler must use POST');
assert.ok(script.includes('x-agt002-workbench-secret:'), 'scheduler must send the dedicated AGT-002 workbench secret header');
assert.ok(!script.includes('x-tender-worker-secret'), 'must not reuse the tender worker header');
assert.equal(statSync(new URL('run-agt002-workbench-worker.sh', root)).mode & 0o111, 0o111, 'script must be executable');

// No secret VALUES anywhere in the committed artifact — only variable names/refs.
for (const source of [script, service, timer]) {
  assert.doesNotMatch(source, /AGT002_WORKBENCH_WORKER_SECRET\s*=\s*['"a-zA-Z0-9]/, 'must never hardcode a secret value');
  assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1)[^\s'"]*\.(com|io|net)/i, 'must not embed a real hardcoded endpoint');
}

// --- service: oneshot (no overlap), dedicated user, secret stays outside the repo ---
assert.ok(service.includes('Type=oneshot'), 'service must not overlap (singleton run)');
assert.ok(service.includes('User=agt002-workbench-scheduler'), 'service must use a dedicated, least-privilege user');
assert.ok(service.includes('EnvironmentFile=/etc/agt002-workbench-scheduler/env'), 'secret must stay outside the repo, in a dedicated env file');
assert.match(service, /TimeoutStartSec=\d+s/, 'systemd must bound execution above the HTTP timeout');
for (const guard of ['NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'CapabilityBoundingSet=']) {
  assert.ok(service.includes(guard), `missing systemd hardening: ${guard}`);
}
assert.ok(!service.includes('/opt/agt002-bridge'), 'scheduler must not touch the Hetzner bridge service/artifacts');
assert.ok(!service.includes('/opt/tender-worker-scheduler'), 'scheduler must be isolated from the tender worker scheduler');

// --- timer: bounded cadence, no burst-on-recovery, targets the right unit, never enabled by this repo ---
assert.match(timer, /OnUnitInactiveSec=15min/, 'timer must wait 15 minutes after the previous run finished (no overlap)');
assert.ok(timer.includes('Persistent=false'), 'missed runs must not burst after downtime');
assert.ok(timer.includes('Unit=agt002-workbench-scheduler.service'), 'timer must target the AGT-002 workbench scheduler service');

// This repository never applies/enables the unit: the script is a reference
// artifact for manual review and application on the Hetzner host, exactly like
// ops/tender-worker-scheduler/run-tender-worker.sh. No code path in this repo calls
// `systemctl enable`/`systemctl start` on it (verified below across the whole tree).
assert.match(script, /no aplicad[oa] ni ejecutad[oa] por este cambio/i, 'script must document that it is not applied/enabled by this repository');

// Nothing in this repository actually enables/starts the unit automatically.
function allFiles(directory, ignored = new Set(['.git', 'dist', 'node_modules'])) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(full, ignored));
    else files.push(full);
  }
  return files;
}
const repoRoot = new URL('..', import.meta.url).pathname;
for (const file of allFiles(repoRoot)) {
  if (/\.(md|example)$/i.test(file)) continue;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  if (/systemctl\s+(enable|start)\s+agt002-workbench-scheduler/.test(text)) {
    assert.fail(`${file} enables/starts the AGT-002 workbench scheduler unit automatically; it must remain a manual-apply artifact`);
  }
}

console.log('agt002 workbench scheduler ops artifact contract passed');
