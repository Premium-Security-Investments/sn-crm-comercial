import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const base = new URL('../ops/agt002-radar-reconciliation/', import.meta.url);
const files = ['run-agt002-radar-reconciliation.mjs', 'agt002-radar-reconciliation.service', 'env.example', 'README.md'];
// No 'agt002-radar-reconciliation.timer' in this list on purpose: reconciliation has no timer of
// its own, it is only invoked from the daily wrapper
// (ops/agt002-radar-scan/run-agt002-radar-daily-export.sh) or by hand during QA.
for (const file of files) assert.equal(existsSync(new URL(file, base)), true, file);
const read = file => readFileSync(new URL(file, base), 'utf8');
const runner = read(files[0]), service = read(files[1]), env = read(files[2]), readme = read(files[3]);

assert.match(runner, /createTenderSourceReconciliation/);
assert.equal((runner.match(/\breconciliation\.runOnce\(\)/g) || []).length, 1);
assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)|claimAgt002RadarPreanalysisJob|runPreanalysis/);
assert.doesNotMatch(runner, /createAgt002RadarWorker|createAgt002RadarPipeline|createAgt002RadarScan/);
assert.match(runner, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(runner, /process\.exitCode\s*=\s*1/);
assert.match(runner, /status\s*!==?\s*'success'/, 'the runner must fail closed on any non-success status');

assert.match(service, /Type=oneshot/);
assert.match(service, /EnvironmentFile=\/etc\/psi-comercial\/agt002-radar-reconciliation\.env/);
assert.match(service, /User=psi-comercial/);
assert.match(service, /Group=psi-comercial/);
assert.match(service, /WorkingDirectory=\/opt\/psi-comercial\/app/);
assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/psi-comercial\/app\/ops\/agt002-radar-reconciliation\/run-agt002-radar-reconciliation\.mjs/);
assert.equal(existsSync(new URL('agt002-radar-reconciliation.timer', base)), false, 'reconciliation must not have its own .timer');

assert.match(env, /^SUPABASE_URL=/m);
assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=/m);
// Least privilege, verified by explicit absence: reconciliation never calls the provider or the
// bridge, nor the preanalysis model, so its environment file and unit must never declare any of
// these.
for (const forbidden of [/AGT002_HETZNER_BRIDGE_URL/, /AGT002_HETZNER_BRIDGE_HMAC_SECRET/,
                         /AGT002_RADAR_PREANALYSIS_MODEL/, /AGT002_RADAR_PREANALYSIS_TIMEOUT_MS/,
                         /AGT002_RADAR_GATE/, /AGT002_RADAR_VISIBILITY/]) {
  assert.doesNotMatch(env, forbidden);
  assert.doesNotMatch(service, forbidden);
  assert.doesNotMatch(runner, forbidden);
}
// The worker and scan keep their own, separate environment files -- this unit never references
// them.
assert.doesNotMatch(service, /agt002-radar-pipeline\.env/);
assert.doesNotMatch(service, /agt002-radar-scan\.env/);

// Nothing in this directory installs, enables, or reloads systemd units. `systemctl start` is a
// legitimate invocation the wrapper makes against already-installed units; installing and enabling
// stay human acts, never something a versioned artifact does on its own.
for (const file of files) {
  assert.doesNotMatch(read(file), /systemctl\s+(enable|disable|daemon-reload|link|mask|edit|reenable|stop)\b/);
  assert.doesNotMatch(read(file), /\/etc\/systemd\//);
  assert.equal(read(file).includes('--apply'), false);
}
// The runner/service/env files never reference systemctl at all -- only README documents the
// sanctioned `systemctl start` invocation for manual QA.
for (const file of files.slice(0, 3)) assert.doesNotMatch(read(file), /systemctl/);
assert.match(readme, /autorizaci[oó]n separada/i);
assert.match(readme, /sin timer|on[- ]demand|bajo demanda/i);
assert.match(readme, /journalctl -u agt002-radar-reconciliation\.service/);
assert.doesNotMatch(readme, /claimAgt002RadarPreanalysisJob|runPreanalysis\(/);

// Hardening parity with the same baseline ops/agt002-radar-scan/agt002-radar-scan.service already
// declares (tests/agt002-radar-scan-systemd.test.mjs, HARDENING_BASELINE) -- same rule, same
// "exactly once, exact value" discipline, applied to this unit.
const HARDENING_BASELINE = ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict', 'ProtectHome=true',
  'ProtectKernelTunables=true', 'ProtectKernelModules=true', 'ProtectKernelLogs=true', 'ProtectControlGroups=true',
  'RestrictSUIDSGID=true', 'LockPersonality=true', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
  'RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6', 'SystemCallArchitectures=native'];
const assignments = service.split('\n').map(line => line.trim());
for (const rule of HARDENING_BASELINE) {
  const name = rule.slice(0, rule.indexOf('='));
  const assigned = assignments.filter(line => line.startsWith(`${name}=`));
  assert.deepEqual(assigned, [rule], `${name} debe asignarse una sola vez y con el valor de la baseline`);
}
assert.doesNotMatch(service, /^[ \t]*CapabilityBoundingSet=[ \t]*\S/m, 'CapabilityBoundingSet debe quedar vacío');
assert.doesNotMatch(service, /^[ \t]*AmbientCapabilities=[ \t]*\S/m, 'AmbientCapabilities debe quedar vacío');
assert.doesNotMatch(service, /^\s*(User|Group)=root\s*$/m, 'la unidad no corre como root');
assert.doesNotMatch(service, /^\s*PermissionsStartOnly=/m, 'PermissionsStartOnly relaja el sandbox');
assert.doesNotMatch(service, /^\s*MemoryDenyWriteExecute=/m, 'MemoryDenyWriteExecute rompería el JIT de Node');

console.log('AGT-002 Radar daily reconciliation on-demand systemd artifacts are present, hardened at scan parity, no timer, no claim/model surface');
