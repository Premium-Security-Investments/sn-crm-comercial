import { strict as assert } from 'node:assert';
import { readFileSync, statSync } from 'node:fs';

const root = new URL('../ops/tender-worker-scheduler/', import.meta.url);
const script = readFileSync(new URL('run-tender-worker.sh', root), 'utf8');
const service = readFileSync(new URL('tender-worker-scheduler.service', root), 'utf8');
const timer = readFileSync(new URL('tender-worker-scheduler.timer', root), 'utf8');

assert.ok(script.includes('set -euo pipefail'), 'script must fail closed');
assert.ok(script.includes('${TENDER_WORKER_URL:?'), 'script must require URL');
assert.ok(script.includes('${TENDER_WORKER_SECRET:?'), 'script must require secret');
assert.ok(script.includes('--fail-with-body'), 'HTTP errors must fail the unit');
assert.ok(script.includes('--max-time 20'), 'request must have a bounded timeout');
assert.ok(script.includes('--request POST'), 'scheduler must use POST');
assert.ok(script.includes('x-tender-worker-secret:'), 'scheduler must send the dedicated secret header');
assert.equal(statSync(new URL('run-tender-worker.sh', root)).mode & 0o111, 0o111, 'script must be executable');

assert.ok(service.includes('Type=oneshot'), 'service must not overlap');
assert.ok(service.includes('User=tender-worker-scheduler'), 'service must use a dedicated user');
assert.ok(service.includes('EnvironmentFile=/etc/tender-worker-scheduler/env'), 'secret must stay outside the repo');
assert.ok(service.includes('TimeoutStartSec=25s'), 'systemd timeout must bound execution');
for (const guard of ['NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'CapabilityBoundingSet=']) {
  assert.ok(service.includes(guard), `missing systemd hardening: ${guard}`);
}
assert.ok(!service.includes('/opt/agt002-bridge'), 'scheduler must be isolated from AGT-002');

assert.ok(timer.includes('OnUnitInactiveSec=60s'), 'timer must run one minute after completion');
assert.ok(timer.includes('Persistent=false'), 'missed runs must not burst after downtime');
assert.ok(timer.includes('Unit=tender-worker-scheduler.service'), 'timer must target the scheduler service');

console.log('tender worker systemd scheduler contract passed');
