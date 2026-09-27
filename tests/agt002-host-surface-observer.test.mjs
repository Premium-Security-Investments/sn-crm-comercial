import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_HOST_SURFACE_UNITS,
  createAgt002HostSurfaceObserver,
} from '../agt002-host-surface-observer.js';

function fakeExecFile(calls, { stdout = '', error = null } = {}) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(error, stdout);
  };
}

// --- allowlist mapping ---

test('AGT002_HOST_SURFACE_UNITS: fixed allowlist maps exactly the three host surfaces to their unit names', () => {
  assert.deepEqual(AGT002_HOST_SURFACE_UNITS, {
    radar_pipeline: 'agt002-radar-pipeline.service',
    reanalysis_worker: 'agt002-reanalysis-worker.service',
    workbench_scheduler: 'agt002-workbench-scheduler.service',
  });
});

// --- exact systemctl invocation ---

test('observeAgt002HostSurface: invokes /usr/bin/systemctl with fixed argv and shell:false', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  await observe({ surface: 'radar_pipeline' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    command: '/usr/bin/systemctl',
    args: ['show', 'agt002-radar-pipeline.service', '--property=ActiveState,SubState,Result'],
    options: { shell: false },
  });
});

test('observeAgt002HostSurface: resolves the unit name for each allowlisted surface', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  await observe({ surface: 'reanalysis_worker' });
  await observe({ surface: 'workbench_scheduler' });

  assert.equal(calls[0].args[1], 'agt002-reanalysis-worker.service');
  assert.equal(calls[1].args[1], 'agt002-workbench-scheduler.service');
});

// --- identity ---

test('observeAgt002HostSurface: builds identity from explicit sha/version/now', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });
  const now = () => new Date('2026-01-01T00:00:00.000Z');

  const result = await observe({ surface: 'radar_pipeline', sha: 'abc123', version: '1.2.3', now });

  assert.equal(result.surface, 'radar_pipeline');
  assert.equal(result.sha, 'abc123');
  assert.equal(result.version, '1.2.3');
  assert.equal(result.source, 'agt002_host_surface_observed_sha');
  assert.equal(result.observed_at_utc, '2026-01-01T00:00:00.000Z');
});

test('observeAgt002HostSurface: missing sha yields a null identity (sha, version both null, source unobserved)', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  const result = await observe({ surface: 'radar_pipeline' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
  assert.equal(result.source, 'unobserved');
});

test('observeAgt002HostSurface: a version without a sha never leaks through', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  const result = await observe({ surface: 'radar_pipeline', version: '9.9.9' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
});

// --- unknown surface fails before any exec ---

test('observeAgt002HostSurface: an unknown surface rejects and never invokes execFile', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  await assert.rejects(
    () => observe({ surface: 'bridge' }),
    /Unknown AGT-002 host surface: bridge/,
  );
  assert.equal(calls.length, 0);
});

test('observeAgt002HostSurface: an undefined surface rejects and never invokes execFile', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  await assert.rejects(() => observe({ surface: undefined }));
  assert.equal(calls.length, 0);
});

// --- unit_status states ---

test('observeAgt002HostSurface: reports available unit_status parsed from ActiveState/SubState/Result', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=failed\nSubState=failed\nResult=exit-code\n' }),
  });

  const result = await observe({ surface: 'reanalysis_worker' });

  assert.deepEqual(result.unit_status, {
    available: true,
    active_state: 'failed',
    sub_state: 'failed',
    result: 'exit-code',
  });
});

test('observeAgt002HostSurface: reports available unit_status for an active/running/success unit', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\nResult=success\n' }),
  });

  const result = await observe({ surface: 'workbench_scheduler' });

  assert.deepEqual(result.unit_status, {
    available: true,
    active_state: 'active',
    sub_state: 'running',
    result: 'success',
  });
});

// --- error / malformed output redaction ---

test('observeAgt002HostSurface: an execFile error yields a deterministic unavailable status with no details', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { error: new Error('secret-path /run/systemd/private leaked here') }),
  });

  const result = await observe({ surface: 'radar_pipeline' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
  assert.equal(JSON.stringify(result.unit_status).includes('secret-path'), false);
});

test('observeAgt002HostSurface: malformed/incomplete stdout yields the same deterministic unavailable status', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'not-a-systemctl-show-line' }),
  });

  const result = await observe({ surface: 'radar_pipeline' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
});

test('observeAgt002HostSurface: stdout missing one of the three required properties is unavailable', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\n' }),
  });

  const result = await observe({ surface: 'radar_pipeline' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
});
