import { execFile as defaultExecFile } from 'node:child_process';
import { buildAgt002ControlPlaneIdentity } from './agt002-control-plane-identity.js';

export const AGT002_HOST_SURFACE_UNITS = Object.freeze({
  radar_pipeline: 'agt002-radar-pipeline.service',
  reanalysis_worker: 'agt002-reanalysis-worker.service',
  workbench_scheduler: 'agt002-workbench-scheduler.service',
});

const SYSTEMCTL_PATH = '/usr/bin/systemctl';
const SHOW_PROPERTIES = Object.freeze(['ActiveState', 'SubState', 'Result']);

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
  if (!SHOW_PROPERTIES.every((key) => typeof fields[key] === 'string' && fields[key].length > 0)) {
    return unavailableUnitStatus();
  }
  return Object.freeze({
    available: true,
    active_state: fields.ActiveState,
    sub_state: fields.SubState,
    result: fields.Result,
  });
}

export function createAgt002HostSurfaceObserver({ execFile = defaultExecFile } = {}) {
  function observeUnitStatus(unitName) {
    return new Promise((resolve) => {
      execFile(
        SYSTEMCTL_PATH,
        ['show', unitName, '--property=ActiveState,SubState,Result'],
        { shell: false },
        (error, stdout) => {
          // Any adapter failure (nonzero exit, spawn error, unparseable output) collapses to
          // the same unavailable shape: no error message/stderr is ever surfaced downstream.
          if (error) {
            resolve(unavailableUnitStatus());
            return;
          }
          resolve(toUnitStatus(parseSystemctlShowOutput(stdout)));
        },
      );
    });
  }

  return async function observeAgt002HostSurface({ surface, sha = null, version = null, now = () => new Date() } = {}) {
    if (!Object.prototype.hasOwnProperty.call(AGT002_HOST_SURFACE_UNITS, surface)) {
      throw new Error(`Unknown AGT-002 host surface: ${surface}`);
    }

    const identity = buildAgt002ControlPlaneIdentity({
      surface,
      sha,
      version,
      source: sha ? 'agt002_host_surface_observed_sha' : 'unobserved',
      now,
    });

    const unit_status = await observeUnitStatus(AGT002_HOST_SURFACE_UNITS[surface]);

    return Object.freeze({ ...identity, unit_status });
  };
}
