import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SURFACE_NAMES } from '../agt002-control-plane-identity.js';
import { AGT002_PINNED_SURFACE_NAMES } from '../agt002-control-plane-surface-paths.js';

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

// Failures (`issues`) are real problems: a bad receipt, or an observed surface running the wrong
// code. A surface nobody could observe (no URL configured, endpoint down, unit not readable) is a
// `warnings` entry instead: it says nothing about drift, so it must not turn the watchdog red.
export function checkAgt002Drift({ receipt, observed, isAncestor = gitIsAncestor } = {}) {
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

  for (const surface of SURFACE_NAMES) {
    const entry = observedSurfaces[surface];
    const observedSha = entry && typeof entry === 'object' ? nonEmptyString(entry.sha) : null;
    if (!observedSha) {
      warnings.push({ type: 'unobserved', surface });
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
  // Unobserved surfaces show up as annotations on the run without failing it.
  if (process.env.GITHUB_ACTIONS === 'true') {
    for (const warning of result.warnings) {
      console.log(`::warning title=AGT-002 surface unobserved::${warning.surface} could not be observed; drift was not checked for it.`);
    }
  }
  process.exit(result.ok ? 0 : 1);
}
