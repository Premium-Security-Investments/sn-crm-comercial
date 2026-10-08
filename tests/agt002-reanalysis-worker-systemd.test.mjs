import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const ops = path.join(root, 'ops/agt002-reanalysis-worker');
const read = name => fs.readFileSync(path.join(ops, name), 'utf8');

for (const name of ['run-agt002-reanalysis-worker.mjs', 'agt002-reanalysis-worker.service',
  'run-agt002-incremental-dispatch-server.mjs', 'agt002-incremental-dispatch.service',
  'run-agt002-incremental-recovery.mjs', 'agt002-incremental-recovery.service', 'env.example', 'README.md']) {
  assert.ok(fs.existsSync(path.join(ops, name)), `${name} must exist`);
}

const runner = read('run-agt002-reanalysis-worker.mjs');
assert.match(runner, /createAgt002ReanalysisWorker/);
assert.match(runner, /runOnce\(\)/);
assert.doesNotMatch(runner, /fetch\(|https?:\/\/|curl|setInterval|setTimeout/);

const service = read('agt002-reanalysis-worker.service');
assert.match(service, /Type=oneshot/);
assert.match(service, /EnvironmentFile=/);
assert.match(service, /ExecStart=\/usr\/bin\/node .*run-agt002-reanalysis-worker\.mjs/);
assert.match(service, /TimeoutStartSec=(?:[6-9]\d\d|\d{4,})/);
assert.match(service, /NoNewPrivileges=true/);
assert.match(service, /PrivateTmp=true/);
assert.match(service, /ProtectSystem=(?:strict|full)/);
assert.doesNotMatch(service, /MemoryDenyWriteExecute=true/);
assert.match(service, /RestrictAddressFamilies=.*AF_UNIX/);
assert.match(service, /RestrictAddressFamilies=.*AF_NETLINK/);
assert.match(service, /RestrictAddressFamilies=.*AF_INET(?:\s|$)/m);
assert.match(service, /RestrictAddressFamilies=.*AF_INET6/);
assert.doesNotMatch(service, /curl|wget|https?:\/\//);

assert.equal(fs.existsSync(path.join(ops, 'agt002-reanalysis-worker.timer')), false, 'continuous polling timer must be removed');
assert.match(read('agt002-incremental-dispatch.service'), /Type=simple/);
assert.match(read('agt002-incremental-recovery.service'), /Type=oneshot/);

const env = read('env.example');
assert.match(env, /SUPABASE_URL=/);
assert.match(env, /SUPABASE_SERVICE_ROLE_KEY=/);
assert.match(env, /AGT002_HETZNER_BRIDGE_URL=/);
assert.match(env, /AGT002_HETZNER_BRIDGE_HMAC_SECRET=/);
assert.match(env, /AGT002_REANALYSIS_TARGET_JOB_ID=/);
assert.doesNotMatch(env, /AGT002_PREVIEW_BRIDGE_/);
assert.doesNotMatch(env, /eyJ|https:\/\/[a-z0-9-]+\.supabase\.co/);

const readme = read('README.md');
assert.match(readme, /no instala|instalación manual|No ejecut/i);
assert.match(readme, /job UUID exacto/i);
assert.match(readme, /sin reintento|no reintenta/i);
assert.doesNotMatch(readme, /curl .*api|Vercel.*worker endpoint/i);
assert.match(runner, /AGT002_REANALYSIS_TARGET_JOB_ID/);
assert.match(runner, /claimAgt002ReanalysisJobById/);

console.log('AGT-002 direct systemd worker artifact contract passed');
