import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WRAPPER = new URL('../ops/agt002-radar-scan/run-agt002-radar-daily-export.sh', import.meta.url).pathname;

function makeExecutable(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}

// Fake export: a plain script (not systemctl-gated), always readable via AGT002_RADAR_EXPORT_CMD.
// Writes to stdout/stderr so the wrapper's passthrough can be asserted, then exits with the code
// the test asked for via EXPORT_EXIT_CODE.
function makeFakeExport(dir) {
  return makeExecutable(dir, 'fake-export.sh', [
    '#!/usr/bin/env bash',
    'echo "export-stdout-marker"',
    'echo "export-stderr-marker" >&2',
    'exit "${EXPORT_EXIT_CODE:-0}"',
    '',
  ].join('\n'));
}

// Fake systemctl: prepended to PATH so the wrapper's literal, un-overridden
// `systemctl start agt002-radar-scan.service` / `systemctl start agt002-radar-pipeline.service`
// calls resolve to this double instead of touching the real systemd. Records every invocation
// (verb + unit) to LOG_FILE in call order, and exits per-unit according to env-configured codes.
function makeFakeSystemctl(dir) {
  return makeExecutable(dir, 'systemctl', [
    '#!/usr/bin/env bash',
    'echo "$1 $2" >> "$LOG_FILE"',
    'if [ "$2" = "agt002-radar-scan.service" ]; then exit "${SYSTEMCTL_SCAN_EXIT:-0}"; fi',
    'if [ "$2" = "agt002-radar-pipeline.service" ]; then exit "${SYSTEMCTL_WORKER_EXIT:-0}"; fi',
    'exit 0',
    '',
  ].join('\n'));
}

function run({ exportExit = 0, scanExit = 0, workerExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agt002-radar-wrapper-'));
  try {
    const logFile = join(dir, 'systemctl-log.txt');
    writeFileSync(logFile, '');
    const exportCmd = makeFakeExport(dir);
    makeFakeSystemctl(dir);
    const env = {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      LOG_FILE: logFile,
      AGT002_RADAR_EXPORT_CMD: exportCmd,
      EXPORT_EXIT_CODE: String(exportExit),
      SYSTEMCTL_SCAN_EXIT: String(scanExit),
      SYSTEMCTL_WORKER_EXIT: String(workerExit),
    };
    const result = spawnSync('bash', [WRAPPER], { env, encoding: 'utf8' });
    const invoked = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    const statusLine = result.stdout.trim().split('\n').filter(Boolean).pop();
    const status = statusLine ? JSON.parse(statusLine) : null;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, invoked, statusJson: status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1. Export fails -> stage=export, sources_persisted:false, exit 10, systemctl NEVER invoked.
{
  const { status, invoked, statusJson, stdout } = run({ exportExit: 3 });
  assert.equal(status, 10);
  assert.deepEqual(invoked, []);
  assert.equal(statusJson.stage, 'export');
  assert.equal(statusJson.sources_persisted, false);
  assert.equal(statusJson.exit_code, 3);
  assert.match(stdout, /export-stdout-marker/, 'export stdout must pass through before the status line');
  assert.ok(stdout.indexOf('export-stdout-marker') < stdout.indexOf('"stage":"export"'), 'export output precedes the wrapper status line');
}

// 2. Export ok, scan fails -> stage=scan, sources_persisted:true, scan_completed:false, exit 20,
//    worker NEVER invoked (only one systemctl call, for the scan unit).
{
  const { status, invoked, statusJson } = run({ scanExit: 5 });
  assert.equal(status, 20);
  assert.deepEqual(invoked, ['start agt002-radar-scan.service']);
  assert.equal(statusJson.stage, 'scan');
  assert.equal(statusJson.sources_persisted, true);
  assert.equal(statusJson.scan_completed, false);
  assert.equal(statusJson.exit_code, 5);
}

// 3. Export+scan ok, worker kick fails -> stage=worker_kick, explicit warning, sources_persisted
//    and scan_completed both true, timer_fallback:true, but the wrapper still exits 0 (the 15-min
//    .timer is the durable safety net for a missed kick).
{
  const { status, invoked, statusJson } = run({ workerExit: 7 });
  assert.equal(status, 0);
  assert.deepEqual(invoked, ['start agt002-radar-scan.service', 'start agt002-radar-pipeline.service']);
  assert.equal(statusJson.stage, 'worker_kick');
  assert.equal(statusJson.level, 'warning');
  assert.equal(statusJson.sources_persisted, true);
  assert.equal(statusJson.scan_completed, true);
  assert.equal(statusJson.timer_fallback, true);
  assert.equal(statusJson.exit_code, 7);
}

// 4. All three stages succeed -> exit 0, stage=completed, all flags true, exact invocation order.
{
  const { status, invoked, statusJson } = run({});
  assert.equal(status, 0);
  assert.deepEqual(invoked, ['start agt002-radar-scan.service', 'start agt002-radar-pipeline.service']);
  assert.equal(statusJson.stage, 'completed');
  assert.equal(statusJson.sources_persisted, true);
  assert.equal(statusJson.scan_completed, true);
  assert.equal(statusJson.worker_kick_completed, true);
  assert.equal(statusJson.exit_code, 0);
}

// 5. The versioned wrapper must be directly executable, since the production cron command
//    invokes it directly rather than via `bash <path>`.
{
  const mode = statSync(WRAPPER).mode;
  assert.ok((mode & 0o111) !== 0, 'wrapper must have at least one executable bit set');
}

// 6. Forbidden operations / secrets / direct node, on the script text itself.
const source = readFileSync(new URL('../ops/agt002-radar-scan/run-agt002-radar-daily-export.sh', import.meta.url), 'utf8');
assert.match(source, /set -u/);
assert.doesNotMatch(source, /\beval\b/);
assert.doesNotMatch(source, /\|\|\s*true/, 'no silent || true anywhere');
assert.doesNotMatch(source, /systemctl\s+(enable|disable|daemon-reload|link|mask|edit|reenable|stop)\b/);
assert.doesNotMatch(source, /\/etc\/systemd\//);
assert.match(source, /systemctl start agt002-radar-scan\.service/, 'unit name is a fixed literal, not interpolated');
assert.match(source, /systemctl start agt002-radar-pipeline\.service/, 'unit name is a fixed literal, not interpolated');
assert.doesNotMatch(source, /AGT002_RADAR_SCAN_CMD|AGT002_RADAR_WORKER_KICK_CMD/, 'only the export step is overridable; scan/worker are fixed systemctl invocations');
assert.doesNotMatch(source, /\bnode\b/, 'the wrapper never invokes node directly');
assert.doesNotMatch(source, /\bsource\s+\/|^\s*\.\s+\//m, 'the wrapper never sources an env file');
assert.doesNotMatch(source, /\/etc\/psi-comercial/, 'no environment-file path, no secret, appears in the wrapper');
assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|HMAC_SECRET/);
assert.doesNotMatch(source, /--apply/);
assert.doesNotMatch(source, /\brm\s+-rf\b/);

console.log('AGT-002 Radar daily export -> scan -> worker-kick wrapper: all four outcome paths and forbidden-operation invariants passed');
