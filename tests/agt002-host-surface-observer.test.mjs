import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGT002_HOST_SURFACE_UNITS,
  createAgt002HostSurfaceObserver,
} from '../agt002-host-surface-observer.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const VERSION = '1.4.2';

const RUNNERS = Object.freeze({
  radar_daily_scan: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-radar-scan/run-agt002-radar-scan.mjs',
    args: '',
  }),
  initial_analysis_worker: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-initial-analysis-worker/run-agt002-initial-analysis-worker.mjs',
    args: '',
  }),
  radar_daily_top5: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-radar-daily/run-agt002-radar-import.mjs',
    args: '--top5',
  }),
});

function scriptPathFor(surface, sha) {
  return `/opt/psi-comercial/releases/${sha}/${RUNNERS[surface].relativePath}`;
}

function execStartBlock({ path, argv }) {
  return `{ path=${path} ; argv[]=${argv} ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }`;
}

function validExecStartFor(surface, sha) {
  const { interpreter, args } = RUNNERS[surface];
  const scriptPath = scriptPathFor(surface, sha);
  const command = interpreter ? `${interpreter} ${scriptPath}` : scriptPath;
  const argv = args ? `${command} ${args}` : command;
  const path = interpreter || scriptPath;
  return execStartBlock({ path, argv });
}

function environmentField(pairs) {
  return pairs.map(([key, value]) => `${key}=${value}`).join(' ');
}

function buildStdout({
  activeState = 'active',
  subState = 'running',
  result = 'success',
  execStart,
  environment,
} = {}) {
  const lines = [`ActiveState=${activeState}`, `SubState=${subState}`, `Result=${result}`];
  if (execStart !== undefined) lines.push(`ExecStart=${execStart}`);
  if (environment !== undefined) lines.push(`Environment=${environment}`);
  return `${lines.join('\n')}\n`;
}

function validStdoutFor(surface, { sha = SHA_A, version = VERSION } = {}) {
  return buildStdout({
    execStart: validExecStartFor(surface, sha),
    environment: environmentField([
      ['AGT002_DEPLOYED_GIT_SHA', sha],
      ['AGT002_DEPLOYED_VERSION', version],
      ['PATH', '/usr/bin:/bin'],
    ]),
  });
}

function fakeExecFile(calls, { stdout = '', error = null } = {}) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(error, stdout);
  };
}

function fakeExecFileByUnit(calls, stdoutByUnit) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    const unitName = args[1];
    callback(null, stdoutByUnit[unitName] ?? '');
  };
}

// --- allowlist mapping ---

test('AGT002_HOST_SURFACE_UNITS: fixed allowlist maps exactly the live host surfaces to their unit names', () => {
  assert.deepEqual(AGT002_HOST_SURFACE_UNITS, {
    initial_analysis_worker: 'agt002-initial-analysis-worker.service',
    auto_initial: 'agt002-auto-initial.service',
    radar_daily_import: 'agt002-radar-import-daily.service',
    radar_daily_scan: 'agt002-radar-scan.service',
    radar_daily_reconciliation: 'agt002-radar-reconciliation.service',
    radar_daily_top5: 'agt002-radar-top5.service',
    radar_requests: 'agt002-radar-requests.service',
  });
});

test('AGT002_HOST_SURFACE_UNITS: retired host surfaces are no longer observable', () => {
  for (const retired of ['radar_pipeline', 'reanalysis_worker', 'workbench_scheduler']) {
    assert.equal(Object.prototype.hasOwnProperty.call(AGT002_HOST_SURFACE_UNITS, retired), false, retired);
  }
});

// --- exact systemctl invocation ---

test('observeAgt002HostSurface: invokes /usr/bin/systemctl with fixed argv, shell:false, and no caller-controlled unit/property/path', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_scan') }),
  });

  await observe({ surface: 'radar_daily_scan' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    command: '/usr/bin/systemctl',
    args: ['show', 'agt002-radar-scan.service', '--property=ActiveState,SubState,Result,ExecStart,Environment'],
    options: { shell: false },
  });
});

test('observeAgt002HostSurface: extra call args (e.g. an attempted sha/version/unit override) never change the systemctl invocation', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_scan') }),
  });

  await observe({
    surface: 'radar_daily_scan',
    sha: 'attacker-controlled-sha',
    unit: 'evil.service',
    property: 'MemoryHigh',
  });

  assert.deepEqual(calls[0].args, ['show', 'agt002-radar-scan.service', '--property=ActiveState,SubState,Result,ExecStart,Environment']);
});

test('observeAgt002HostSurface: resolves the unit name for each allowlisted surface', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('initial_analysis_worker') }),
  });

  await observe({ surface: 'initial_analysis_worker' });
  await observe({ surface: 'radar_daily_top5' });

  assert.equal(calls[0].args[1], 'agt002-initial-analysis-worker.service');
  assert.equal(calls[1].args[1], 'agt002-radar-top5.service');
});

// --- unknown surface fails before any exec ---

test('observeAgt002HostSurface: an unknown surface rejects and never invokes execFile', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_scan') }),
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
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_scan') }),
  });

  await assert.rejects(() => observe({ surface: undefined }));
  assert.equal(calls.length, 0);
});

// --- unit_status states, independent of identity derivation ---

test('observeAgt002HostSurface: reports available unit_status parsed from ActiveState/SubState/Result', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({ activeState: 'failed', subState: 'failed', result: 'exit-code' }),
    }),
  });

  const result = await observe({ surface: 'initial_analysis_worker' });

  assert.deepEqual(result.unit_status, {
    available: true,
    active_state: 'failed',
    sub_state: 'failed',
    result: 'exit-code',
  });
  assert.equal(result.sha, null);
  assert.equal(result.source, 'unobserved');
});

test('observeAgt002HostSurface: reports available unit_status for an active/running/success unit', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_top5') }),
  });

  const result = await observe({ surface: 'radar_daily_top5' });

  assert.deepEqual(result.unit_status, {
    available: true,
    active_state: 'active',
    sub_state: 'running',
    result: 'success',
  });
});

test('observeAgt002HostSurface: an execFile error yields a deterministic unavailable status with no details, and an unobserved identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { error: new Error('secret-path /run/systemd/private leaked here') }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
  assert.equal(result.sha, null);
  assert.equal(result.version, null);
  assert.equal(result.source, 'unobserved');
  assert.equal(JSON.stringify(result).includes('secret-path'), false);
});

test('observeAgt002HostSurface: malformed/incomplete stdout yields the same deterministic unavailable status', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'not-a-systemctl-show-line' }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
});

test('observeAgt002HostSurface: stdout missing one of the three required status properties is unavailable', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: 'ActiveState=active\nSubState=running\n' }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.deepEqual(result.unit_status, {
    available: false,
    active_state: null,
    sub_state: null,
    result: null,
  });
});

// --- identity: each exact allowlisted path succeeds ---

for (const surface of ['radar_daily_scan', 'initial_analysis_worker', 'radar_daily_top5']) {
  test(`observeAgt002HostSurface: derives sha/version for ${surface} from its own unique env + exact allowlisted ExecStart`, async () => {
    const calls = [];
    const observe = createAgt002HostSurfaceObserver({
      execFile: fakeExecFile(calls, { stdout: validStdoutFor(surface) }),
    });
    const now = () => new Date('2026-01-01T00:00:00.000Z');

    const result = await observe({ surface, now });

    assert.equal(result.surface, surface);
    assert.equal(result.sha, SHA_A);
    assert.equal(result.version, VERSION);
    assert.equal(result.source, 'agt002_host_surface_systemd_unit_observed');
    assert.equal(result.observed_at_utc, '2026-01-01T00:00:00.000Z');
  });
}

// --- bridge identity must never leak through / observer takes no sha input at all ---

test('observeAgt002HostSurface: the surface\'s own unit config always wins even when the caller tries to pass a different sha/version (bridge identity)', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, { stdout: validStdoutFor('radar_daily_scan', { sha: SHA_A, version: VERSION }) }),
  });

  const result = await observe({ surface: 'radar_daily_scan', sha: 'bridge-own-sha', version: 'bridge-own-version' });

  assert.equal(result.sha, SHA_A);
  assert.equal(result.version, VERSION);
  assert.notEqual(result.sha, 'bridge-own-sha');
  assert.notEqual(result.version, 'bridge-own-version');
});

test('observeAgt002HostSurface: each surface derives an independent identity even when unit stdouts differ across surfaces', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFileByUnit(calls, {
      'agt002-radar-scan.service': validStdoutFor('radar_daily_scan', { sha: SHA_A, version: '1.0.0' }),
      'agt002-initial-analysis-worker.service': validStdoutFor('initial_analysis_worker', { sha: SHA_B, version: '2.0.0' }),
    }),
  });

  const scan = await observe({ surface: 'radar_daily_scan' });
  const initial = await observe({ surface: 'initial_analysis_worker' });

  assert.equal(scan.sha, SHA_A);
  assert.equal(scan.version, '1.0.0');
  assert.equal(initial.sha, SHA_B);
  assert.equal(initial.version, '2.0.0');
});

// --- missing / malformed env ---

test('observeAgt002HostSurface: missing AGT002_DEPLOYED_GIT_SHA yields a null identity (sha, version both null, source unobserved)', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([['AGT002_DEPLOYED_VERSION', VERSION]]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
  assert.equal(result.source, 'unobserved');
});

test('observeAgt002HostSurface: missing AGT002_DEPLOYED_VERSION nulls the whole identity, sha included', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([['AGT002_DEPLOYED_GIT_SHA', SHA_A]]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
  assert.equal(result.source, 'unobserved');
});

test('observeAgt002HostSurface: a unit with no deployed sha/version env is identified by its exact release ExecStart path', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_top5', SHA_A),
        environment: environmentField([['AGT002_RADAR_STATE_DIR', '/var/lib/agt002-radar']]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_top5' });

  assert.equal(result.sha, SHA_A);
  assert.equal(result.version, `f0-${SHA_A.slice(0, 7)}`);
  assert.equal(result.source, 'agt002_host_surface_systemd_release_path');
});

test('observeAgt002HostSurface: missing Environment property entirely still requires the exact allowlisted release ExecStart', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({ execStart: validExecStartFor('radar_daily_scan', SHA_A) }),
    }),
  });
  assert.equal((await observe({ surface: 'radar_daily_scan' })).sha, SHA_A);

  const shortDirObserve = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: execStartBlock({
          path: '/usr/bin/node',
          argv: '/usr/bin/node /opt/psi-comercial/releases/aaaaaaa/ops/agt002-radar-scan/run-agt002-radar-scan.mjs',
        }),
      }),
    }),
  });
  const shortDir = await shortDirObserve({ surface: 'radar_daily_scan' });
  assert.equal(shortDir.sha, null, 'a release directory that is not a full 40-hex sha is never trusted');
  assert.equal(shortDir.version, null);
});

test('observeAgt002HostSurface: the same runner with another mode argument is a different surface and nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: execStartBlock({
          path: '/usr/bin/node',
          argv: `/usr/bin/node ${scriptPathFor('radar_daily_top5', SHA_A)} --daily`,
        }),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_top5' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: an uppercase sha is rejected (must be lowercase 40-hex)', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A.toUpperCase()],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: a short/non-hex sha is rejected', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', 'not-a-real-sha'],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: an empty version value is rejected', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: `AGT002_DEPLOYED_GIT_SHA=${SHA_A} AGT002_DEPLOYED_VERSION=`,
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
});

// --- duplicate / ambiguous env ---

test('observeAgt002HostSurface: a duplicate AGT002_DEPLOYED_GIT_SHA is ambiguous and nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_GIT_SHA', SHA_B],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: a duplicate AGT002_DEPLOYED_VERSION is ambiguous and nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
          ['AGT002_DEPLOYED_VERSION', '9.9.9'],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
});

// --- ExecStart / runner-path validation ---

test('observeAgt002HostSurface: ExecStart naming another surface\'s allowlisted runner (wrong runner) nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('initial_analysis_worker', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
});

test('observeAgt002HostSurface: ExecStart pointing at an arbitrary script outside the allowlist nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: execStartBlock({
          path: '/usr/bin/node',
          argv: '/usr/bin/node /opt/psi-comercial/releases/' + SHA_A + '/ops/evil/backdoor.mjs',
        }),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: a path-traversal ExecStart nulls the identity instead of resolving/normalizing it', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: execStartBlock({
          path: '/usr/bin/node',
          argv:
            '/usr/bin/node /opt/psi-comercial/releases/' +
            SHA_A +
            '/ops/agt002-radar-scan/../../../../etc/passwd',
        }),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: an ExecStart sha that mismatches the Environment sha nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_B),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
  assert.equal(result.version, null);
});

test('observeAgt002HostSurface: a missing interpreter prefix for a node-based surface nulls the identity', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: execStartBlock({
          path: scriptPathFor('radar_daily_scan', SHA_A),
          argv: scriptPathFor('radar_daily_scan', SHA_A),
        }),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: a missing/malformed ExecStart property nulls the identity even with valid env', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

test('observeAgt002HostSurface: multiple ExecStart directives (ambiguous) null the identity', async () => {
  const calls = [];
  const single = validExecStartFor('radar_daily_scan', SHA_A);
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: `${single} ; ${single}`,
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.equal(result.sha, null);
});

// --- unit_status is preserved regardless of identity outcome ---

test('observeAgt002HostSurface: unit_status stays available even when identity nulls out for malformed env', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([['AGT002_DEPLOYED_GIT_SHA', 'nope']]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.deepEqual(result.unit_status, {
    available: true,
    active_state: 'active',
    sub_state: 'running',
    result: 'success',
  });
  assert.equal(result.sha, null);
});

// --- no secret / raw systemd data leakage ---

test('observeAgt002HostSurface: the result never contains raw ExecStart/Environment content, only the derived surface/sha/version/source/observed_at_utc/unit_status shape', async () => {
  const calls = [];
  const observe = createAgt002HostSurfaceObserver({
    execFile: fakeExecFile(calls, {
      stdout: buildStdout({
        execStart: validExecStartFor('radar_daily_scan', SHA_A),
        environment: environmentField([
          ['AGT002_DEPLOYED_GIT_SHA', SHA_A],
          ['AGT002_DEPLOYED_VERSION', VERSION],
          ['SUPER_SECRET_TOKEN', 'do-not-leak-me'],
        ]),
      }),
    }),
  });

  const result = await observe({ surface: 'radar_daily_scan' });

  assert.deepEqual(Object.keys(result).sort(), ['observed_at_utc', 'sha', 'source', 'surface', 'unit_status', 'version']);
  assert.equal(JSON.stringify(result).includes('SUPER_SECRET_TOKEN'), false);
  assert.equal(JSON.stringify(result).includes('do-not-leak-me'), false);
  assert.equal(JSON.stringify(result).includes('argv[]'), false);
});
