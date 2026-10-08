import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SURFACE_NAMES } from '../agt002-control-plane-identity.js';
import { AGT002_PINNED_SURFACE_NAMES } from '../agt002-control-plane-surface-paths.js';
import { AGT002_HOST_SURFACE_UNITS } from '../agt002-host-surface-observer.js';

const DEFAULT_RECEIPT_PATH = 'agt002-release-receipt.json';
const DEFAULT_OBSERVED_PATH = 'agt002-observed-surfaces.json';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PINNED_SURFACE_SET = new Set(AGT002_PINNED_SURFACE_NAMES);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

// `git merge-base --is-ancestor a b`: true when a is b or an ancestor of it. Any git failure (an
// unknown commit, e.g. a hotfix sha that never reached main) is false, never a guess.
export function gitIsAncestor(ancestor, descendant, { root = REPO_ROOT } = {}) {
  try {
    execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function releaseVersionFor(sha) {
  return `f0-${sha.slice(0, 7)}`;
}

// origin_main and vercel_production deploy every main commit, so they must sit exactly on
// receipt.desired.{sha,version}.
function checkExactSurface({ surface, observedSha, observedVersion, desiredSha, desiredVersion, issues }) {
  if (desiredSha && desiredSha !== observedSha) {
    issues.push({ type: 'sha_mismatch', surface, desired_sha: desiredSha, observed_sha: observedSha });
  }
  if (desiredVersion && observedVersion && desiredVersion !== observedVersion) {
    issues.push({ type: 'version_mismatch', surface, desired_version: desiredVersion, observed_version: observedVersion });
  }
}

// The bridge and the host jobs run a pinned release that legitimately lags main while the code it
// runs is unchanged. They pass when the observed release is a main commit at or after min_sha --
// the newest commit that changed a file that surface runs -- and its version is that release's own
// f0-<first 7> tag. Observed == desired sha always passes (the tip contains every change).
function checkPinnedSurface({ surface, observedSha, observedVersion, desiredSha, desiredVersion, minSha, isAncestor, issues }) {
  const atTip = desiredSha !== null && observedSha === desiredSha;
  if (!atTip) {
    if (!minSha) {
      issues.push({ type: 'missing_desired_surface_sha', surface });
    } else if (observedSha !== minSha) {
      const onMain = desiredSha !== null && isAncestor(observedSha, desiredSha);
      if (!onMain || !isAncestor(minSha, observedSha)) {
        issues.push({
          type: 'sha_mismatch',
          surface,
          reason: onMain ? 'behind_last_change' : 'not_on_main',
          desired_min_sha: minSha,
          observed_sha: observedSha,
        });
      }
    }
  }
  const expectedVersion = atTip ? desiredVersion : releaseVersionFor(observedSha);
  if (expectedVersion && observedVersion && expectedVersion !== observedVersion) {
    issues.push({ type: 'version_mismatch', surface, desired_version: expectedVersion, observed_version: observedVersion });
  }
}

// The only tolerated way for a surface to be unobserved: a host-surface route that the deployed
// bridge does not know yet (HTTP 404), while that bridge itself is still behind the code that
// added the route. This is a transition window for the bridge redeploy, not a permanent state:
// after this date a 404 fails like any other unobserved surface. (PR #329; ~14 days.)
export const AGT002_HOST_ROUTE_GRACE_UNTIL_UTC = '2026-10-22T00:00:00.000Z';

const HOST_SURFACE_SET = new Set(Object.keys(AGT002_HOST_SURFACE_UNITS));

function unobservedEntry(surface, entry) {
  const status = entry && typeof entry === 'object' && typeof entry.observation_status === 'string'
    ? entry.observation_status
    : 'not_configured';
  return {
    type: 'unobserved',
    surface,
    observation_status: status === 'observed' ? 'not_configured' : status,
    ...(entry && Number.isInteger(entry.http_status) ? { http_status: entry.http_status } : {}),
  };
}

// Failures (`issues`) are real problems: a bad receipt, an observed surface running the wrong
// code, or a surface that could not be observed (bridge or Vercel unreachable, a URL that fails or
// answers non-2xx, a host unit whose release can no longer be identified, nothing configured).
// The single exception, reported in `warnings`, is a host-surface route the bridge does not know
// yet (404) while the bridge is itself behind and before AGT002_HOST_ROUTE_GRACE_UNTIL_UTC.
export function checkAgt002Drift({ receipt, observed, isAncestor = gitIsAncestor, now = () => new Date() } = {}) {
  const issues = [];
  const warnings = [];

  if (receipt?.control_plane_reconciled === true) {
    issues.push({ type: 'control_plane_reconciled_true', surface: null });
  }

  const desiredSha = nonEmptyString(receipt?.desired?.sha);
  const desiredVersion = nonEmptyString(receipt?.desired?.version);
  if (!desiredSha) issues.push({ type: 'missing_desired_sha', surface: null });
  if (!desiredVersion) issues.push({ type: 'missing_desired_version', surface: null });
  const pinnedDesired = receipt?.desired?.pinned_surfaces ?? {};

  const observedSurfaces = observed?.surfaces ?? {};
  const unobserved = [];

  for (const surface of SURFACE_NAMES) {
    const entry = observedSurfaces[surface];
    const observedSha = entry && typeof entry === 'object' ? nonEmptyString(entry.sha) : null;
    if (!observedSha) {
      unobserved.push(unobservedEntry(surface, entry));
      continue;
    }

    const observedVersion = nonEmptyString(entry.version);
    if (!observedVersion) issues.push({ type: 'missing_observed_version', surface });

    if (PINNED_SURFACE_SET.has(surface)) {
      checkPinnedSurface({
        surface,
        observedSha,
        observedVersion,
        desiredSha,
        desiredVersion,
        minSha: nonEmptyString(pinnedDesired[surface]?.min_sha),
        isAncestor,
        issues,
      });
    } else {
      checkExactSurface({ surface, observedSha, observedVersion, desiredSha, desiredVersion, issues });
    }
  }

  const bridgeObservedUpToDate =
    nonEmptyString(observedSurfaces.bridge?.sha) !== null && !issues.some((issue) => issue.surface === 'bridge');
  const withinGrace = now().getTime() < Date.parse(AGT002_HOST_ROUTE_GRACE_UNTIL_UTC);
  for (const entry of unobserved) {
    const tolerated =
      HOST_SURFACE_SET.has(entry.surface) &&
      entry.observation_status === 'route_unknown' &&
      !bridgeObservedUpToDate &&
      withinGrace;
    if (tolerated) {
      warnings.push({ ...entry, reason: 'host_route_unknown_on_outdated_bridge', grace_until_utc: AGT002_HOST_ROUTE_GRACE_UNTIL_UTC });
    } else {
      issues.push(entry);
    }
  }

  return { ok: issues.length === 0, issues, warnings };
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
  // Tolerated (grace-period) host routes show up as annotations on the run without failing it.
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const warning of result.warnings) {
      console.log(
        `::warning title=AGT-002 host route not deployed::${warning.surface} returned 404 from an outdated bridge; tolerated until ${warning.grace_until_utc}.`,
      );
    }
  }
  process.exit(result.ok ? 0 : 1);
}
