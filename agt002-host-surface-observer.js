import { execFile as defaultExecFile } from 'node:child_process';
import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export const AGT002_HOST_SURFACE_UNITS = Object.freeze({
  initial_analysis_worker: 'agt002-initial-analysis-worker.service',
  auto_initial: 'agt002-auto-initial.service',
  radar_daily_import: 'agt002-radar-import-daily.service',
  radar_daily_scan: 'agt002-radar-scan.service',
  radar_daily_reconciliation: 'agt002-radar-reconciliation.service',
  radar_daily_top5: 'agt002-radar-top5.service',
  radar_requests: 'agt002-radar-requests.service',
});

// Each allowlisted surface's own immutable runner identity: the exact interpreter (or none, for
// a directly-executed script), the exact path -- relative to a release checkout -- and the exact
// arguments that unit's ExecStart must invoke. Never derived from a request, an environment
// variable, or another surface's identity.
const RADAR_IMPORT_RUNNER = 'ops/agt002-radar-daily/run-agt002-radar-import.mjs';
export const AGT002_HOST_SURFACE_RUNNERS = Object.freeze({
  initial_analysis_worker: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-initial-analysis-worker/run-agt002-initial-analysis-worker.mjs',
    args: '',
  }),
  auto_initial: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-auto-initial/run-agt002-auto-initial.mjs',
    args: '',
  }),
  radar_daily_import: Object.freeze({ interpreter: '/usr/bin/node', relativePath: RADAR_IMPORT_RUNNER, args: '--daily' }),
  radar_daily_scan: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-radar-scan/run-agt002-radar-scan.mjs',
    args: '',
  }),
  radar_daily_reconciliation: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-radar-reconciliation/run-agt002-radar-reconciliation.mjs',
    args: '',
  }),
  radar_daily_top5: Object.freeze({ interpreter: '/usr/bin/node', relativePath: RADAR_IMPORT_RUNNER, args: '--top5' }),
  radar_requests: Object.freeze({ interpreter: '/usr/bin/node', relativePath: RADAR_IMPORT_RUNNER, args: '--requests' }),
});

const AGT002_RELEASES_ROOT = '/opt/psi-comercial/releases';
const ENV_SHA_KEY = 'AGT002_DEPLOYED_GIT_SHA';
const ENV_VERSION_KEY = 'AGT002_DEPLOYED_VERSION';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
// Conservative nonempty token: no whitespace, slashes, quotes, or shell metacharacters -- only
// what a real semver/build-tag string ever legitimately needs.
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const SYSTEMCTL_PATH = '/usr/bin/systemctl';
const SHOW_PROPERTY_NAMES = Object.freeze(['ActiveState', 'SubState', 'Result', 'ExecStart', 'Environment']);
const UNIT_STATUS_PROPERTIES = Object.freeze(['ActiveState', 'SubState', 'Result']);

function unavailableUnitStatus() {
  return Object.freeze({ available: false, active_state: null, sub_state: null, result: null });
}

function parseSystemctlShowOutput(stdout) {
  const fields = {};
  for (const line of String(stdout ?? '').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    fields[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return fields;
}

function toUnitStatus(fields) {
  if (!UNIT_STATUS_PROPERTIES.every((key) => typeof fields[key] === 'string' && fields[key].length > 0)) {
    return unavailableUnitStatus();
  }
  return Object.freeze({
    available: true,
    active_state: fields.ActiveState,
    sub_state: fields.SubState,
    result: fields.Result,
  });
}

// systemctl show's ExecStart property is a structured value, e.g.:
//   { path=/usr/bin/node ; argv[]=/usr/bin/node /opt/.../run.mjs ; ignore_errors=no ; ... }
// A unit with more than one ExecStart= directive (or a malformed/absent value) renders as zero or
// multiple `{ ... }` blocks -- both collapse to null rather than picking one ambiguously.
function extractExecStartArgv(rawExecStart) {
  if (typeof rawExecStart !== 'string') return null;
  const openBraceCount = (rawExecStart.match(/\{/g) || []).length;
  if (openBraceCount !== 1) return null;
  const match = rawExecStart.match(/argv\[\]=(.*?)\s;\s(?:ignore_errors|start_time)=/);
  if (!match) return null;
  const argv = match[1].trim();
  return argv.length > 0 ? argv : null;
}

// systemctl show's Environment property is a single space-separated `KEY=VALUE` list. A key that
// appears more than once (e.g. from two EnvironmentFile/Environment= directives colliding) is
// ambiguous, never "last one wins" -- callers must treat it exactly like a missing key.
function collectEnvironmentValues(rawEnvironment) {
  const values = new Map();
  if (typeof rawEnvironment !== 'string') return values;
  for (const token of rawEnvironment.trim().split(/\s+/).filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq === -1) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  }
  return values;
}

function uniqueEnvironmentValue(values, key) {
  const entries = values.get(key);
  return entries && entries.length === 1 ? entries[0] : null;
}

function expectedExecStartCommand(surface, sha) {
  const runner = AGT002_HOST_SURFACE_RUNNERS[surface];
  const scriptPath = `${AGT002_RELEASES_ROOT}/${sha}/${runner.relativePath}`;
  const command = runner.interpreter ? `${runner.interpreter} ${scriptPath}` : scriptPath;
  return runner.args ? `${command} ${runner.args}` : command;
}

// The release directory the ExecStart points at is itself named by the full commit sha, so it is
// the sha of the code the unit actually runs. Only a full 40-hex directory name is accepted; the
// byte-exact runner comparison below is still what makes it trusted.
function releaseShaFromExecStart(argv) {
  const prefix = `${AGT002_RELEASES_ROOT}/`;
  const start = argv.indexOf(prefix);
  if (start === -1) return null;
  const candidate = argv.slice(start + prefix.length, start + prefix.length + 40);
  return SHA_PATTERN.test(candidate) ? candidate : null;
}

// The only path from raw systemd unit fields to a trusted sha/version: an ExecStart that names --
// with byte-exact equality, never a prefix/substring/normalized match -- that same surface's
// allowlisted runner under the release directory for that exact sha. When the unit declares
// AGT002_DEPLOYED_GIT_SHA or AGT002_DEPLOYED_VERSION, both must be present, unique, well-formed and
// the sha must be that same release. When it declares neither (several live units only pin
// ExecStart in their 10-release.conf), the sha is the release directory and the version is its
// f0-<first 7> tag. Any missing, malformed, duplicate, or mismatched piece nulls out the whole
// identity; nothing is ever reported partially.
function deriveObservedIdentity(surface, fields) {
  const argv = extractExecStartArgv(fields.ExecStart);
  if (argv === null) return null;

  const environment = collectEnvironmentValues(fields.Environment);
  const envDeclaresIdentity = environment.has(ENV_SHA_KEY) || environment.has(ENV_VERSION_KEY);

  const sha = envDeclaresIdentity ? uniqueEnvironmentValue(environment, ENV_SHA_KEY) : releaseShaFromExecStart(argv);
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) return null;
  if (argv !== expectedExecStartCommand(surface, sha)) return null;

  const version = envDeclaresIdentity ? uniqueEnvironmentValue(environment, ENV_VERSION_KEY) : `f0-${sha.slice(0, 7)}`;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;

  return {
    sha,
    version,
    source: envDeclaresIdentity ? 'agt002_host_surface_systemd_unit_observed' : 'agt002_host_surface_systemd_release_path',
  };
}

function observeUnitFields(execFile, unitName) {
  return new Promise((resolve) => {
    execFile(
      SYSTEMCTL_PATH,
      ['show', unitName, `--property=${SHOW_PROPERTY_NAMES.join(',')}`],
      { shell: false },
      (error, stdout) => {
        // Any adapter failure (nonzero exit, spawn error) collapses to a single null: no error
        // message/stderr is ever surfaced downstream.
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseSystemctlShowOutput(stdout));
      },
    );
  });
}

export function createAgt002HostSurfaceObserver({ execFile = defaultExecFile } = {}) {
  return async function observeAgt002HostSurface({ surface, now = () => new Date() } = {}) {
    if (!Object.prototype.hasOwnProperty.call(AGT002_HOST_SURFACE_UNITS, surface)) {
      throw new Error(`Unknown AGT-002 host surface: ${surface}`);
    }

    const fields = await observeUnitFields(execFile, AGT002_HOST_SURFACE_UNITS[surface]);
    const unit_status = fields === null ? unavailableUnitStatus() : toUnitStatus(fields);
    const observed = fields === null ? null : deriveObservedIdentity(surface, fields);

    const identity = buildAgt002ControlPlaneIdentity({
      surface,
      sha: observed?.sha ?? null,
      version: observed?.version ?? null,
      source: observed?.source ?? 'unobserved',
      now,
    });

    return Object.freeze({ ...identity, unit_status });
  };
}
