import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SURFACE_NAMES } from '../agt002-control-plane-identity.js';

const DEFAULT_RECEIPT_PATH = 'agt002-release-receipt.json';
const DEFAULT_OBSERVED_PATH = 'agt002-observed-surfaces.json';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// Fail closed by construction: every one of the six surfaces must show up in `observed` with a
// non-empty sha AND a non-empty version that both match receipt.desired, or an issue is raised
// for it. There is no code path that returns ok:true without having checked all six.
export function checkAgt002Drift({ receipt, observed } = {}) {
  const issues = [];

  if (receipt?.control_plane_reconciled === true) {
    issues.push({ type: 'control_plane_reconciled_true', surface: null });
  }

  const desiredSha = nonEmptyString(receipt?.desired?.sha);
  const desiredVersion = nonEmptyString(receipt?.desired?.version);
  if (!desiredSha) issues.push({ type: 'missing_desired_sha', surface: null });
  if (!desiredVersion) issues.push({ type: 'missing_desired_version', surface: null });

  const observedSurfaces = observed?.surfaces ?? {};

  for (const surface of SURFACE_NAMES) {
    const entry = observedSurfaces[surface];
    if (!entry || typeof entry !== 'object') {
      issues.push({ type: 'missing_surface', surface });
      continue;
    }

    const observedSha = nonEmptyString(entry.sha);
    const observedVersion = nonEmptyString(entry.version);

    if (!observedSha) issues.push({ type: 'missing_observed_sha', surface });
    if (!observedVersion) issues.push({ type: 'missing_observed_version', surface });

    if (desiredSha && observedSha && desiredSha !== observedSha) {
      issues.push({ type: 'sha_mismatch', surface, desired_sha: desiredSha, observed_sha: observedSha });
    }
    if (desiredVersion && observedVersion && desiredVersion !== observedVersion) {
      issues.push({
        type: 'version_mismatch',
        surface,
        desired_version: desiredVersion,
        observed_version: observedVersion,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const args = process.argv.slice(2);
  const readArg = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const receiptPath = readArg('--receipt', DEFAULT_RECEIPT_PATH);
  const observedPath = readArg('--observed', DEFAULT_OBSERVED_PATH);
  const outPath = readArg('--out', null);

  const receipt = existsSync(receiptPath) ? readJson(receiptPath) : {};
  const observed = existsSync(observedPath) ? readJson(observedPath) : { surfaces: {} };

  const result = checkAgt002Drift({ receipt, observed });
  const json = JSON.stringify(result, null, 2);

  if (outPath) {
    writeFileSync(outPath, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
  process.exit(result.ok ? 0 : 1);
}
