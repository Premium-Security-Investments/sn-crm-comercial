import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const base = new URL('../ops/agt002-radar-scan/', import.meta.url);
const files = ['run-agt002-radar-scan.mjs', 'agt002-radar-scan.service', 'env.example', 'README.md'];
// No 'agt002-radar-scan.timer' in this list on purpose: the scan has no timer of its own, it is
// only invoked from the daily wrapper (ops/agt002-radar-scan/run-agt002-radar-daily-export.sh) or
// by hand during QA.
for (const file of files) assert.equal(existsSync(new URL(file, base)), true, file);
const read = file => readFileSync(new URL(file, base), 'utf8');
const runner = read(files[0]), service = read(files[1]), env = read(files[2]), readme = read(files[3]);

assert.match(runner, /createAgt002RadarScan/);
assert.equal((runner.match(/\bscan\.runOnce\(\)/g) || []).length, 1);
assert.doesNotMatch(runner, /setInterval|setTimeout|while\s*\(|for\s*\(;;\)|claimAgt002RadarPreanalysisJob|runPreanalysis/);
assert.doesNotMatch(runner, /createAgt002RadarWorker|createAgt002RadarPipeline/);
assert.match(runner, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(runner, /process\.exitCode\s*=\s*1/);
// The scan runner exits non-zero on status 'unavailable' too (not only on config/exception): a
// silent exit 0 on an unavailable fetch/gate/ledger would look like a good day to systemctl and
// the wrapper, while nothing actually got enqueued -- and the next attempt would be tomorrow, not
// in 15 minutes. This is a deliberate asymmetry with the worker runner, which does not change its
// exit codes: stale_input is a normal outcome of draining, 96 times a day.
assert.match(runner, /status\s*===?\s*'unavailable'/);
// ESU direct-refresh now lives on this runner (moved off the 15-min worker runner).
assert.match(runner, /createSupabaseEsuDirectRefresher/);
assert.match(runner, /fetchEsuProcesses\(\s*\{\s*includeHistorical\s*:\s*true/);
assert.equal((runner.match(/\brefresher\.runOnce\(\)/g) || []).length, 1);
assert.match(runner, /import\s*\{\s*createAgt002RadarScan\s*\}\s*from\s*'\.\.\/\.\.\/agt002-radar-scan\.js'/);

assert.match(service, /Type=oneshot/);
assert.match(service, /EnvironmentFile=\/etc\/psi-comercial\/agt002-radar-scan\.env/);
assert.match(service, /User=psi-comercial/);
assert.match(service, /Group=psi-comercial/);
assert.match(service, /WorkingDirectory=\/opt\/psi-comercial\/app/);
assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/psi-comercial\/app\/ops\/agt002-radar-scan\/run-agt002-radar-scan\.mjs/);
assert.equal(existsSync(new URL('agt002-radar-scan.timer', base)), false, 'the scan must not have its own .timer');

assert.match(env, /^AGT002_RADAR_GATE=false$/m);
assert.match(env, /^SUPABASE_URL=/m);
assert.match(env, /^SUPABASE_SERVICE_ROLE_KEY=/m);
// Least privilege, verified by explicit absence: the scan never calls the provider or the bridge,
// so its environment file and unit must never declare any of these.
for (const forbidden of [/AGT002_HETZNER_BRIDGE_URL/, /AGT002_HETZNER_BRIDGE_HMAC_SECRET/,
                         /AGT002_RADAR_PREANALYSIS_MODEL/, /AGT002_RADAR_PREANALYSIS_TIMEOUT_MS/]) {
  assert.doesNotMatch(env, forbidden);
  assert.doesNotMatch(service, forbidden);
}
// No claim/model imports anywhere in this directory's runner.
assert.doesNotMatch(runner, /claimAgt002RadarPreanalysisJob|completeAgt002RadarPreanalysisJob|failAgt002RadarPreanalysisJob|AGT002_RADAR_PREANALYSIS_MODEL/);
// The worker keeps its own, separate environment file -- this unit never references it.
assert.doesNotMatch(service, /agt002-radar-pipeline\.env/);

// Nothing in this directory installs, enables, or reloads systemd units. `systemctl start` is a
// legitimate invocation the wrapper makes against already-installed units (Task 5); installing and
// enabling stay human acts (Task 8), never something a versioned artifact does on its own.
for (const file of files) {
  // `systemctl start` is a legitimate, sanctioned invocation (it is what the daily wrapper does
  // against an already-installed unit, and what README documents for manual QA); everything that
  // installs, enables, reloads, or otherwise mutates unit state stays forbidden in every file of
  // this directory, README prose included.
  assert.doesNotMatch(read(file), /systemctl\s+(enable|disable|daemon-reload|link|mask|edit|reenable|stop)\b/);
  assert.doesNotMatch(read(file), /\/etc\/systemd\//);
  assert.equal(read(file).includes('--apply'), false);
}
// The runner/service/env files never reference systemctl at all -- only README documents the
// sanctioned `systemctl start` invocation for manual QA.
for (const file of files.slice(0, 3)) assert.doesNotMatch(read(file), /systemctl/);
assert.match(readme, /autorizaci[oó]n separada/i);
assert.match(readme, /sin timer|on[- ]demand|bajo demanda/i);
assert.match(readme, /journalctl -u agt002-radar-scan\.service/);
assert.doesNotMatch(readme, /claimAgt002RadarPreanalysisJob|runPreanalysis\(/);

// Hardening parity with the same baseline ops/agt002-radar-pipeline/agt002-radar-pipeline.service
// already declares (tests/agt002-radar-pipeline-systemd.test.mjs, HARDENING_BASELINE) -- same
// rule, same "exactly once, exact value" discipline, applied to this unit.
const HARDENING_BASELINE = ['NoNewPrivileges=true', 'PrivateTmp=true', 'ProtectSystem=strict', 'ProtectHome=true',
  'ProtectKernelTunables=true', 'ProtectKernelModules=true', 'ProtectKernelLogs=true', 'ProtectControlGroups=true',
  'RestrictSUIDSGID=true', 'LockPersonality=true', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
  'RestrictAddressFamilies=AF_UNIX AF_NETLINK AF_INET AF_INET6', 'SystemCallArchitectures=native'];
const scanAssignments = service.split('\n').map(line => line.trim());
for (const rule of HARDENING_BASELINE) {
  const name = rule.slice(0, rule.indexOf('='));
  const assigned = scanAssignments.filter(line => line.startsWith(`${name}=`));
  assert.deepEqual(assigned, [rule], `${name} debe asignarse una sola vez y con el valor de la baseline`);
}
assert.doesNotMatch(service, /^[ \t]*CapabilityBoundingSet=[ \t]*\S/m, 'CapabilityBoundingSet debe quedar vacío');
assert.doesNotMatch(service, /^[ \t]*AmbientCapabilities=[ \t]*\S/m, 'AmbientCapabilities debe quedar vacío');
assert.doesNotMatch(service, /^\s*(User|Group)=root\s*$/m, 'la unidad no corre como root');
assert.doesNotMatch(service, /^\s*PermissionsStartOnly=/m, 'PermissionsStartOnly relaja el sandbox');
assert.doesNotMatch(service, /^\s*MemoryDenyWriteExecute=/m, 'MemoryDenyWriteExecute rompería el JIT de Node');

console.log('AGT-002 Radar daily scan on-demand systemd artifacts are present, hardened at worker parity, no timer, no claim/model surface');
