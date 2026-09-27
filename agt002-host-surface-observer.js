import { execFile as defaultExecFile } from 'node:child_process';
import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export const AGT002_HOST_SURFACE_UNITS = Object.freeze({
  radar_pipeline: 'agt002-radar-pipeline.service',
  reanalysis_worker: 'agt002-reanalysis-worker.service',
  workbench_scheduler: 'agt002-workbench-scheduler.service',
});

// Each allowlisted surface's own immutable runner identity: the exact interpreter (or none, for
// a directly-executed script) and the exact path -- relative to a release checkout -- that unit's
// ExecStart must invoke. Never derived from a request, an environment variable, or another
// surface's identity.
const AGT002_HOST_SURFACE_RUNNERS = Object.freeze({
  radar_pipeline: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs',
  }),
  reanalysis_worker: Object.freeze({
    interpreter: '/usr/bin/node',
    relativePath: 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs',
  }),
  workbench_scheduler: Object.freeze({
    interpreter: null,
    relativePath: 'ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh',
  }),
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
  return runner.interpreter ? `${runner.interpreter} ${scriptPath}` : scriptPath;
}

// The only path from raw systemd unit fields to a trusted sha/version: a unique, well-formed sha
// and version in Environment, AND an ExecStart that names -- with byte-exact equality, never a
// prefix/substring/normalized match -- that same surface's allowlisted runner under the release
// directory for that exact sha. Any missing, malformed, duplicate, or mismatched piece nulls out
// the whole identity; nothing here is ever reported partially.
function deriveObservedIdentity(surface, fields) {
  const environment = collectEnvironmentValues(fields.Environment);
  const sha = uniqueEnvironmentValue(environment, ENV_SHA_KEY);
  if (typeof sha !== 'string' || !SHA_PATTERN.test(sha)) return null;

  const version = uniqueEnvironmentValue(environment, ENV_VERSION_KEY);
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;

  const argv = extractExecStartArgv(fields.ExecStart);
  if (argv === null || argv !== expectedExecStartCommand(surface, sha)) return null;

  return { sha, version };
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
      source: observed ? 'agt002_host_surface_systemd_unit_observed' : 'unobserved',
      now,
    });

    return Object.freeze({ ...identity, unit_status });
  };
}
