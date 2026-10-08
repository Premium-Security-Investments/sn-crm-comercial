import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  SURFACE_NAMES,
  buildAgt002ControlPlaneIdentity,
} from '../agt002-control-plane-identity.js';
import { observeAgt002Surfaces } from '../agt002-control-plane-observe.js';
import { getAgt002VercelControlPlaneIdentity } from '../agt002-vercel-control-plane-identity.js';
import {
  buildRadarPipelineIdentity,
  buildReanalysisWorkerIdentity,
} from '../agt002-control-plane-surface-builders.js';
import { generateAgt002ReleaseReceipt } from '../scripts/agt002-generate-release-receipt.mjs';
import { AGT002_HOST_ROUTE_GRACE_UNTIL_UTC, checkAgt002Drift } from '../scripts/agt002-check-drift.mjs';
import { collectAgt002SurfaceObservations, buildAgt002ObserveSurfacesResult } from '../scripts/agt002-observe-surfaces.mjs';
import {
  AGT002_PINNED_SURFACE_NAMES,
  RADAR_MONOLITH_MODULES,
  collectAgt002SurfaceCodePaths,
  computeAgt002PinnedSurfaceMinShas,
} from '../agt002-control-plane-surface-paths.js';

// --- identity builders: version is only ever an explicit immutable input, never inferred ---

test('buildAgt002ControlPlaneIdentity: forces version to null when sha is null, even if a version is passed', () => {
  const identity = buildAgt002ControlPlaneIdentity({ surface: 'radar_pipeline', version: '1.2.3' });
  assert.equal(identity.sha, null);
  assert.equal(identity.version, null);
  assert.equal(identity.source, 'unobserved');
});

test('buildAgt002ControlPlaneIdentity: a non-string version collapses to null', () => {
  const identity = buildAgt002ControlPlaneIdentity({
    surface: 'bridge',
    sha: 'abc123',
    version: 42,
    source: 'bridge_release_sha',
  });
  assert.equal(identity.sha, 'abc123');
  assert.equal(identity.version, null);
});

test('buildRadarPipelineIdentity: version flows through only from the explicit headSha+version inputs', () => {
  const unobserved = buildRadarPipelineIdentity({ version: '1.2.3' });
  assert.equal(unobserved.sha, null);
  assert.equal(unobserved.version, null, 'a version with no headSha must never surface');

  const observed = buildRadarPipelineIdentity({ headSha: 'radar-sha', version: '1.2.3' });
  assert.equal(observed.sha, 'radar-sha');
  assert.equal(observed.version, '1.2.3');
  assert.equal(observed.source, 'radar_pipeline_git_head');

  const missingVersion = buildRadarPipelineIdentity({ headSha: 'radar-sha' });
  assert.equal(missingVersion.sha, 'radar-sha');
  assert.equal(missingVersion.version, null, 'a missing version must stay null, never inferred');
});

test('buildReanalysisWorkerIdentity: version flows through only from the explicit releaseSha+version inputs', () => {
  const observed = buildReanalysisWorkerIdentity({ releaseSha: 'reanalysis-sha', version: '1.2.3' });
  assert.equal(observed.sha, 'reanalysis-sha');
  assert.equal(observed.version, '1.2.3');
  assert.equal(observed.source, 'reanalysis_worker_release_sha');

  const missingVersion = buildReanalysisWorkerIdentity({ releaseSha: 'reanalysis-sha' });
  assert.equal(missingVersion.version, null);
});

test('getAgt002VercelControlPlaneIdentity: reports AGT002_DEPLOYED_VERSION alongside either sha source', () => {
  const viaVercelSha = getAgt002VercelControlPlaneIdentity({
    env: { VERCEL_GIT_COMMIT_SHA: 'vercel-sha', AGT002_DEPLOYED_VERSION: '1.2.3' },
  });
  assert.equal(viaVercelSha.sha, 'vercel-sha');
  assert.equal(viaVercelSha.version, '1.2.3');

  const viaGithubSha = getAgt002VercelControlPlaneIdentity({
    env: { GITHUB_SHA: 'github-sha', AGT002_DEPLOYED_VERSION: '1.2.3' },
  });
  assert.equal(viaGithubSha.sha, 'github-sha');
  assert.equal(viaGithubSha.version, '1.2.3');

  const noSha = getAgt002VercelControlPlaneIdentity({ env: { AGT002_DEPLOYED_VERSION: '1.2.3' } });
  assert.equal(noSha.sha, null);
  assert.equal(noSha.version, null, 'a version with no observed sha must never surface');
});

// --- ops runners: --control-plane never trusts an env/config claim as identity; sha/version
// only ever come from canonical release-artifact realpath evidence, never from disk-adjacent
// AGT002_DEPLOYED_GIT_SHA/AGT002_DEPLOYED_VERSION env vars (see agt002-control-plane-runtime-
// evidence.js and tests/agt002-f0-runtime-reporters.test.mjs for the resolver's direct coverage) ---

const RADAR_RUNNER = new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url).pathname;
const REANALYSIS_RUNNER = new URL(
  '../ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs',
  import.meta.url,
).pathname;

function runControlPlaneScript(scriptPath, env) {
  return spawnSync(process.execPath, [scriptPath, '--control-plane'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

function soleJsonLine(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `expected exactly one stdout line, got: ${JSON.stringify(lines)}`);
  return JSON.parse(lines[0]);
}

test('radar pipeline runner: --control-plane ignores AGT002_DEPLOYED_GIT_SHA/AGT002_DEPLOYED_VERSION spoofing and stays unobserved from this checkout', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'radar-deployed-sha',
    AGT002_DEPLOYED_VERSION: '1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, null, 'env/config spoof inputs must never produce identity outside the canonical release path');
  assert.equal(payload.version, null);
});

test('radar pipeline runner: --control-plane with only a sha spoofed (no version) still stays unobserved, never partially trusted', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, { AGT002_DEPLOYED_GIT_SHA: 'radar-deployed-sha' });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null, 'a missing version must stay null, never inferred');
});

test('reanalysis worker runner: --control-plane ignores AGT002_DEPLOYED_GIT_SHA/AGT002_DEPLOYED_VERSION spoofing and stays unobserved from this checkout', () => {
  const result = runControlPlaneScript(REANALYSIS_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'reanalysis-deployed-sha',
    AGT002_DEPLOYED_VERSION: '1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, null, 'env/config spoof inputs must never produce identity outside the canonical release path');
  assert.equal(payload.version, null);
});

// --- release receipt: a single canonical desired {sha, version} every surface is compared to ---

test('generateAgt002ReleaseReceipt: desired.sha/version come from explicit inputs, never from disk', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123', version: '1.2.3' });
  assert.equal(receipt.desired.sha, 'abc123');
  assert.equal(receipt.desired.version, '1.2.3');
  assert.equal(receipt.control_plane_reconciled, false);
});

test('generateAgt002ReleaseReceipt: a missing version leaves desired.version null instead of inventing one', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });
  assert.equal(receipt.desired.sha, 'abc123');
  assert.equal(receipt.desired.version, null);
});

test('generateAgt002ReleaseReceipt: an empty-string version is treated as missing, not a literal empty version', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123', version: '' });
  assert.equal(receipt.desired.version, null);
});

// --- checkAgt002Drift: the watched surfaces are the live ones; retired ones are gone ---

test('checkAgt002Drift: SURFACE_NAMES is exactly the live watched surfaces', () => {
  assert.deepEqual(SURFACE_NAMES, [
    'origin_main',
    'vercel_production',
    'bridge',
    'initial_analysis_worker',
    'auto_initial',
    'radar_daily_import',
    'radar_daily_scan',
    'radar_daily_reconciliation',
    'radar_daily_top5',
    'radar_requests',
  ]);
});

test('checkAgt002Drift: retired surfaces are neither watched, receipted, nor reported', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123', version: 'f0-abc123', surface_last_change: () => null });
  const result = checkAgt002Drift({ receipt, observed: { surfaces: {} }, isAncestor: () => false });
  for (const retired of ['radar_pipeline', 'reanalysis_worker', 'workbench_scheduler']) {
    assert.equal(SURFACE_NAMES.includes(retired), false, retired);
    assert.equal(Object.hasOwn(receipt.surfaces, retired), false, retired);
    assert.equal(Object.hasOwn(receipt.desired.pinned_surfaces, retired), false, retired);
    assert.equal([...result.issues, ...result.warnings].some((entry) => entry.surface === retired), false, retired);
  }
});

test('checkAgt002Drift: a receipt produced by generateAgt002ReleaseReceipt with no version never passes drift', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });
  const observed = { surfaces: {} };
  for (const surface of SURFACE_NAMES) {
    observed.surfaces[surface] = { sha: 'abc123', version: 'irrelevant-because-desired-is-null', source: 'test' };
  }
  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'missing_desired_version'));
});

// --- observation collector: explicit env/file/URL inputs only, no invented data, no real network ---

test('collectAgt002SurfaceObservations: explicit env sha/version/source per surface, no network call attempted', async () => {
  let fetchCalled = false;
  const observations = await collectAgt002SurfaceObservations({
    env: {
      AGT002_OBSERVE_BRIDGE_SHA: 'bridge-sha',
      AGT002_OBSERVE_BRIDGE_VERSION: '1.2.3',
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('must not be called when no URL is configured');
    },
  });
  assert.equal(observations.bridge.sha, 'bridge-sha');
  assert.equal(observations.bridge.version, '1.2.3');
  assert.equal(observations.bridge.source, 'bridge_explicit_env');
  assert.equal(fetchCalled, false);
  for (const surface of SURFACE_NAMES) {
    if (surface === 'bridge') continue;
    assert.deepEqual(observations[surface], { observation_status: 'not_configured' }, `${surface} must stay unobserved with no configured input`);
  }
});

test('collectAgt002SurfaceObservations: a configured URL is fetched with the injected fetchImpl only', async () => {
  const calls = [];
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_VERCEL_PRODUCTION_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        json: async () => ({ surface: 'vercel_production', sha: 'vercel-sha', version: '1.2.3', source: 'vercel_git_commit_sha' }),
      };
    },
  });
  assert.deepEqual(calls, ['https://example.invalid/control-plane']);
  assert.equal(observations.vercel_production.sha, 'vercel-sha');
  assert.equal(observations.vercel_production.version, '1.2.3');
});

test('collectAgt002SurfaceObservations: host surfaces are observed through a URL fetch, not a static configured sha/version', async () => {
  for (const surface of ['initial_analysis_worker', 'auto_initial', 'radar_daily_scan', 'radar_requests']) {
    const prefix = `AGT002_OBSERVE_${surface.toUpperCase()}`;
    const calls = [];
    const observations = await collectAgt002SurfaceObservations({
      env: { [`${prefix}_URL`]: 'https://example.invalid/control-plane' },
      fetchImpl: async (url) => {
        calls.push(url);
        return {
          ok: true,
          json: async () => ({ surface, sha: `${surface}-sha`, version: '1.2.3', source: `${surface}_url_fetch` }),
        };
      },
    });
    assert.deepEqual(calls, ['https://example.invalid/control-plane']);
    assert.equal(observations[surface].sha, `${surface}-sha`);
    assert.equal(observations[surface].version, '1.2.3');
  }
});

test('collectAgt002SurfaceObservations: host surfaces default to the bridge URL plus /<surface>, with no variable of their own', async () => {
  const calls = [];
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://bridge.invalid/v1/agt002/control-plane/' },
    fetchImpl: async (url) => {
      calls.push(url);
      const surface = url.endsWith('/control-plane/') ? 'bridge' : url.split('/').pop();
      return { ok: true, json: async () => ({ surface, sha: `${surface}-sha`, version: 'f0-x', source: 'test' }) };
    },
  });
  const hostSurfaces = SURFACE_NAMES.filter((name) => !['origin_main', 'vercel_production', 'bridge'].includes(name));
  assert.deepEqual(calls, [
    'https://bridge.invalid/v1/agt002/control-plane/',
    ...hostSurfaces.map((surface) => `https://bridge.invalid/v1/agt002/control-plane/${surface}`),
  ]);
  for (const surface of hostSurfaces) assert.equal(observations[surface].sha, `${surface}-sha`);
  assert.deepEqual(observations.vercel_production, { observation_status: 'not_configured' }, 'vercel never rides on the bridge URL');
});

test('collectAgt002SurfaceObservations: a failed fetch collapses to unobserved instead of throwing', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => {
      throw new Error('network unreachable');
    },
  });
  assert.deepEqual(observations.bridge, { observation_status: 'fetch_failed' });
});

test('collectAgt002SurfaceObservations: a non-2xx response collapses to unobserved', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => ({ ok: false }),
  });
  assert.deepEqual(observations.bridge, { observation_status: 'http_error', http_status: null });
});

// --- trust-boundary fix: a URL response's `surface` must exactly match the surface it was fetched for ---

test('collectAgt002SurfaceObservations: a response whose surface exactly matches the requested surface is trusted', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_RADAR_DAILY_SCAN_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ surface: 'radar_daily_scan', sha: 'radar-sha', version: '1.2.3', source: 'radar_daily_scan_url_fetch' }),
    }),
  });
  assert.equal(observations.radar_daily_scan.sha, 'radar-sha');
  assert.equal(observations.radar_daily_scan.version, '1.2.3');
});

test('collectAgt002SurfaceObservations: a bridge response served from a radar_daily_scan-configured URL must not be relabeled as radar_daily_scan', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_RADAR_DAILY_SCAN_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ surface: 'bridge', sha: 'bridge-sha', version: '1.2.3', source: 'bridge_url_fetch' }),
    }),
  });
  assert.deepEqual(observations.radar_daily_scan, { observation_status: 'surface_mismatch' }, 'a mismatched surface label must collapse to unobserved, never relabeled');
});

test('collectAgt002SurfaceObservations: a response missing the surface field entirely collapses to unobserved', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_RADAR_DAILY_TOP5_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ sha: 'top5-sha', version: '1.2.3', source: 'radar_daily_top5_url_fetch' }),
    }),
  });
  assert.deepEqual(observations.radar_daily_top5, { observation_status: 'surface_mismatch' }, 'a missing surface field must never be trusted as a match');
});

test('collectAgt002SurfaceObservations: explicit env sha takes precedence over a configured URL', async () => {
  const fetchedUrls = [];
  const observations = await collectAgt002SurfaceObservations({
    env: {
      AGT002_OBSERVE_BRIDGE_SHA: 'from-env',
      AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane',
    },
    fetchImpl: async (url) => {
      fetchedUrls.push(url);
      return { ok: true, json: async () => ({ surface: 'bridge', sha: 'from-url', version: null, source: 'bridge_url_fetch' }) };
    },
  });
  assert.equal(observations.bridge.sha, 'from-env');
  // Only the host-surface routes under the bridge URL are fetched, never the bridge's own route.
  assert.equal(fetchedUrls.includes('https://example.invalid/control-plane'), false);
});

test('buildAgt002ObserveSurfacesResult: an explicit input file/JSON observation wins over env collection', async () => {
  const result = await buildAgt002ObserveSurfacesResult({
    inputJson: JSON.stringify({ surfaces: { bridge: { sha: 'from-file', version: '9.9.9', source: 'bridge_from_file' } } }),
    env: { AGT002_OBSERVE_BRIDGE_SHA: 'from-env' },
  });
  assert.equal(result.surfaces.bridge.sha, 'from-file');
  assert.equal(result.surfaces.bridge.version, '9.9.9');
});

test('buildAgt002ObserveSurfacesResult: --git-sha sets origin_main sha without requiring a file entry', async () => {
  const result = await buildAgt002ObserveSurfacesResult({ gitSha: 'ci-sha', env: {} });
  assert.equal(result.surfaces.origin_main.sha, 'ci-sha');
  assert.equal(result.surfaces.origin_main.source, 'github_sha');
});

test('observe-surfaces CLI: AGT002_OBSERVE_ORIGIN_MAIN_VERSION with no env sha is only bound once --git-sha supplies a real sha', () => {
  const result = runNodeScript(OBSERVE_SURFACES_SCRIPT, ['--git-sha', 'wired-sha'], {
    AGT002_OBSERVE_ORIGIN_MAIN_VERSION: '3.4.5',
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.surfaces.origin_main.sha, 'wired-sha');
  assert.equal(observed.surfaces.origin_main.version, '3.4.5');
});

test('buildAgt002ObserveSurfacesResult: a version-only env observation never counts as observed until gitSha supplies the sha', async () => {
  const versionOnlyEnv = { AGT002_OBSERVE_ORIGIN_MAIN_VERSION: '3.4.5' };

  const withoutGitSha = await buildAgt002ObserveSurfacesResult({ env: versionOnlyEnv });
  assert.equal(withoutGitSha.surfaces.origin_main.sha, null);
  assert.equal(withoutGitSha.surfaces.origin_main.version, null, 'version alone must never surface without a sha');

  const withGitSha = await buildAgt002ObserveSurfacesResult({ gitSha: 'wired-sha', env: versionOnlyEnv });
  assert.equal(withGitSha.surfaces.origin_main.sha, 'wired-sha');
  assert.equal(withGitSha.surfaces.origin_main.version, '3.4.5');
});

test('buildAgt002ObserveSurfacesResult: never invents an observation for a surface with no input at all', async () => {
  const result = await buildAgt002ObserveSurfacesResult({ env: {} });
  for (const surface of SURFACE_NAMES) {
    assert.equal(result.surfaces[surface].sha, null, `${surface} must stay unobserved`);
  }
});

test('buildAgt002ObserveSurfacesResult feeding checkAgt002Drift end to end: every surface on the release passes, one drifted surface fails closed with a structured issue', async () => {
  const receipt = generateAgt002ReleaseReceipt({
    git_sha: 'release-sha',
    version: '2.0.0',
    surface_last_change: () => 'min-sha',
  });
  const env = {};
  for (const surface of SURFACE_NAMES) {
    const prefix = `AGT002_OBSERVE_${surface.toUpperCase()}`;
    env[`${prefix}_SHA`] = 'release-sha';
    env[`${prefix}_VERSION`] = '2.0.0';
  }
  const matching = await buildAgt002ObserveSurfacesResult({ env });
  const matchingResult = checkAgt002Drift({ receipt, observed: matching, isAncestor: () => false });
  assert.deepEqual(matchingResult, { ok: true, issues: [], warnings: [] });

  env.AGT002_OBSERVE_BRIDGE_SHA = 'stale-sha';
  env.AGT002_OBSERVE_BRIDGE_VERSION = 'f0-stale-s';
  const drifted = await buildAgt002ObserveSurfacesResult({ env });
  const driftedResult = checkAgt002Drift({ receipt, observed: drifted, isAncestor: () => false });
  assert.equal(driftedResult.ok, false);
  assert.ok(
    driftedResult.issues.some(
      (issue) => issue.type === 'sha_mismatch' && issue.surface === 'bridge' && issue.observed_sha === 'stale-sha',
    ),
  );
});

// --- PR deadlock fix: desired sha must never be the synthetic PR merge sha, and receipt/observer
// must bind to the exact same explicit desired sha rather than independently reading GITHUB_SHA ---

const RELEASE_RECEIPT_SCRIPT = new URL('../scripts/agt002-generate-release-receipt.mjs', import.meta.url).pathname;
const OBSERVE_SURFACES_SCRIPT = new URL('../scripts/agt002-observe-surfaces.mjs', import.meta.url).pathname;

function runNodeScript(scriptPath, cliArgs, env) {
  return spawnSync(process.execPath, [scriptPath, ...cliArgs], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

test('release-receipt CLI: --git-sha binds desired.sha explicitly, taking precedence over GITHUB_SHA', () => {
  const result = runNodeScript(RELEASE_RECEIPT_SCRIPT, ['--git-sha', 'pr-base-sha', '--version', '1.2.3'], {
    GITHUB_SHA: 'synthetic-pr-merge-sha',
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.git_sha, 'pr-base-sha');
  assert.equal(receipt.desired.sha, 'pr-base-sha');
  assert.notEqual(receipt.desired.sha, 'synthetic-pr-merge-sha');
});

test('observe-surfaces CLI: --desired-sha alone binds origin_main.sha, without needing --git-sha or GITHUB_SHA', () => {
  const result = runNodeScript(OBSERVE_SURFACES_SCRIPT, ['--desired-sha', 'pr-base-sha'], {
    GITHUB_SHA: 'synthetic-pr-merge-sha',
  });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.surfaces.origin_main.sha, 'pr-base-sha');
  assert.notEqual(observed.surfaces.origin_main.sha, 'synthetic-pr-merge-sha');
});

test('observe-surfaces CLI: an explicit --git-sha still wins over --desired-sha', () => {
  const result = runNodeScript(OBSERVE_SURFACES_SCRIPT, ['--desired-sha', 'pr-base-sha', '--git-sha', 'explicit-sha']);
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.surfaces.origin_main.sha, 'explicit-sha');
});

test('PR scenario end to end: receipt and observer bound to the same base sha pass drift, never the synthetic merge sha', async () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'pr-base-sha', version: '2.0.0' });
  const env = {};
  for (const surface of SURFACE_NAMES) {
    if (surface === 'origin_main') continue;
    const prefix = `AGT002_OBSERVE_${surface.toUpperCase()}`;
    env[`${prefix}_SHA`] = 'pr-base-sha';
    env[`${prefix}_VERSION`] = '2.0.0';
  }

  const observedAtBaseSha = observeAgt002Surfaces({
    desiredSha: 'pr-base-sha',
    desiredVersion: '2.0.0',
    observations: {
      ...(await collectAgt002SurfaceObservations({ env })),
      origin_main: { sha: 'pr-base-sha', version: '2.0.0', source: 'github_sha' },
    },
  });
  assert.deepEqual(checkAgt002Drift({ receipt, observed: observedAtBaseSha }), { ok: true, issues: [], warnings: [] });

  const observedAtMergeSha = observeAgt002Surfaces({
    desiredSha: 'pr-base-sha',
    desiredVersion: '2.0.0',
    observations: {
      ...(await collectAgt002SurfaceObservations({ env })),
      origin_main: { sha: 'synthetic-pr-merge-sha', version: '2.0.0', source: 'github_sha' },
    },
  });
  const driftedResult = checkAgt002Drift({ receipt, observed: observedAtMergeSha });
  assert.equal(driftedResult.ok, false);
  assert.ok(
    driftedResult.issues.some((issue) => issue.type === 'sha_mismatch' && issue.surface === 'origin_main'),
    'binding origin_main to the synthetic merge sha instead of the base sha must fail drift',
  );
});

// --- observeAgt002Surfaces: desiredVersion/match_desired_version, additive to the existing contract ---

test('observeAgt002Surfaces: match_desired_version is true/false/null exactly as match_desired is for sha', () => {
  const result = observeAgt002Surfaces({
    desiredSha: 'c0ffee',
    desiredVersion: '1.2.3',
    observations: {
      bridge: { sha: 'c0ffee', version: '1.2.3', source: 'bridge_observed' },
      radar_daily_scan: { sha: 'c0ffee', version: '9.9.9', source: 'radar_observed' },
      origin_main: {},
    },
  });
  assert.equal(result.surfaces.bridge.match_desired_version, true);
  assert.equal(result.surfaces.radar_daily_scan.match_desired_version, false);
  assert.equal(result.surfaces.origin_main.match_desired_version, null);
  assert.equal(result.control_plane_reconciled, false);
});

// --- pinned surfaces (bridge + host jobs): compared against the newest commit that changed the
// code they run, not against the tip of main ---

// A tiny fake history on main: c1 <- c2 <- c3 <- c4 (tip). `hotfix` is not on main.
const MAIN_HISTORY = ['c1', 'c2', 'c3', 'c4'];
function fakeIsAncestor(ancestor, descendant) {
  const a = MAIN_HISTORY.indexOf(ancestor);
  const d = MAIN_HISTORY.indexOf(descendant);
  return a >= 0 && d >= 0 && a <= d;
}

// Every watched surface observed at the tip (c4) unless overridden: a sha string observes the
// surface at that sha; an object is used verbatim (e.g. an unobserved collector result).
function observedAt(overrides) {
  const surfaces = {};
  for (const surface of SURFACE_NAMES) surfaces[surface] = { sha: 'c4', version: 'f0-c4', source: 'test' };
  for (const [surface, value] of Object.entries(overrides)) {
    surfaces[surface] =
      typeof value === 'string' ? { sha: value, version: `f0-${value.slice(0, 7)}`, source: 'test' } : value;
  }
  return { surfaces };
}

test('generateAgt002ReleaseReceipt: desired.pinned_surfaces holds a min_sha per pinned surface from its own code paths', () => {
  const seen = [];
  const receipt = generateAgt002ReleaseReceipt({
    git_sha: 'c4',
    version: 'f0-c4',
    surface_last_change: ({ ref, paths }) => {
      seen.push(ref);
      return paths.includes('ops/agt002-radar-scan/run-agt002-radar-scan.mjs') ? 'c3' : 'c2';
    },
  });
  assert.deepEqual(Object.keys(receipt.desired.pinned_surfaces), [...AGT002_PINNED_SURFACE_NAMES]);
  assert.equal(receipt.desired.pinned_surfaces.radar_daily_scan.min_sha, 'c3');
  assert.equal(receipt.desired.pinned_surfaces.bridge.min_sha, 'c2');
  assert.ok(seen.every((ref) => ref === 'c4'), 'the last change is always searched from the desired sha');
});

test('computeAgt002PinnedSurfaceMinShas: a lookup failure yields null, never a guess', () => {
  const result = computeAgt002PinnedSurfaceMinShas({
    ref: 'c4',
    lastChange: () => {
      throw new Error('history unavailable');
    },
  });
  for (const surface of AGT002_PINNED_SURFACE_NAMES) assert.equal(result[surface].min_sha, null);
});

test('collectAgt002SurfaceCodePaths: follows the runner import closure, adds the lockfile, never follows the API monolith', () => {
  const initial = collectAgt002SurfaceCodePaths('initial_analysis_worker');
  assert.ok(initial.includes('ops/agt002-initial-analysis-worker/run-agt002-initial-analysis-worker.mjs'));
  assert.ok(initial.includes('pnpm-lock.yaml'));
  assert.ok(initial.length > 2, 'the runner imports repo modules, so the closure is larger than the runner itself');

  const radarImport = collectAgt002SurfaceCodePaths('radar_daily_import');
  assert.ok(radarImport.includes('ops/agt002-radar-daily/run-agt002-radar-import.mjs'));
  assert.ok(radarImport.includes('tender-radar-deep-search.js'));
  assert.equal(radarImport.includes('api/[...path].js'), false);
  assert.equal(radarImport.includes('server/index.js'), false);
  assert.deepEqual(collectAgt002SurfaceCodePaths('radar_requests'), radarImport);

  assert.throws(() => collectAgt002SurfaceCodePaths('origin_main'), /Not a pinned AGT-002 surface/);
});

test('checkAgt002Drift: a host surface lagging main but at or after its last code change passes', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => 'c2' });
  const exactlyAtLastChange = checkAgt002Drift({
    receipt,
    observed: observedAt({ radar_daily_scan: 'c2' }),
    isAncestor: fakeIsAncestor,
  });
  assert.equal(exactlyAtLastChange.ok, true, JSON.stringify(exactlyAtLastChange.issues));

  const afterLastChange = checkAgt002Drift({
    receipt,
    observed: observedAt({ radar_daily_scan: 'c3', bridge: 'c2', auto_initial: 'c4' }),
    isAncestor: fakeIsAncestor,
  });
  assert.equal(afterLastChange.ok, true, JSON.stringify(afterLastChange.issues));
  assert.deepEqual(afterLastChange.issues, []);
});

test('checkAgt002Drift: a host surface older than the last change to its code is real drift and fails', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => 'c3' });
  const result = checkAgt002Drift({
    receipt,
    observed: observedAt({ radar_daily_reconciliation: 'c2' }),
    isAncestor: fakeIsAncestor,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      type: 'sha_mismatch',
      surface: 'radar_daily_reconciliation',
      reason: 'behind_last_change',
      desired_min_sha: 'c3',
      observed_sha: 'c2',
    },
  ]);
});

test('checkAgt002Drift: a pinned surface running a commit that is not on main fails even if it looks newer', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => 'c2' });
  const result = checkAgt002Drift({
    receipt,
    observed: observedAt({ bridge: 'hotfix' }),
    isAncestor: fakeIsAncestor,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.type === 'sha_mismatch' && issue.surface === 'bridge' && issue.reason === 'not_on_main'),
  );
});

test('checkAgt002Drift: a pinned surface must report its own release tag as version', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => 'c2' });
  const observed = observedAt({ auto_initial: 'c3' });
  observed.surfaces.auto_initial.version = 'f0-c4';
  const result = checkAgt002Drift({ receipt, observed, isAncestor: fakeIsAncestor });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    { type: 'version_mismatch', surface: 'auto_initial', desired_version: 'f0-c3', observed_version: 'f0-c4' },
  ]);
});

test('checkAgt002Drift: a pinned surface behind the tip with no computable min_sha fails closed', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => null });
  const result = checkAgt002Drift({ receipt, observed: observedAt({ bridge: 'c3' }), isAncestor: fakeIsAncestor });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'missing_desired_surface_sha' && issue.surface === 'bridge'));
});

test('checkAgt002Drift: vercel_production still has to sit exactly on the tip of main', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'c4', version: 'f0-c4', surface_last_change: () => 'c1' });
  const observed = observedAt({});
  observed.surfaces.vercel_production = { sha: 'c3', version: 'f0-c3', source: 'vercel_git_commit_sha' };
  const result = checkAgt002Drift({ receipt, observed, isAncestor: fakeIsAncestor });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'sha_mismatch' && issue.surface === 'vercel_production'));
});

// --- unobserved surfaces: failures, except a 404 host route from an outdated bridge in the grace window ---

const BEFORE_GRACE_END = () => new Date(Date.parse(AGT002_HOST_ROUTE_GRACE_UNTIL_UTC) - 60_000);
const AFTER_GRACE_END = () => new Date(Date.parse(AGT002_HOST_ROUTE_GRACE_UNTIL_UTC) + 60_000);
const ROUTE_UNKNOWN = { observation_status: 'route_unknown', http_status: 404 };
const HOST_SURFACES = SURFACE_NAMES.filter((surface) => !['origin_main', 'vercel_production', 'bridge'].includes(surface));

function graceReceipt() {
  // bridge's last code change is c4: a bridge on c3 is an outdated (pre-PR) bridge.
  return generateAgt002ReleaseReceipt({
    git_sha: 'c4',
    version: 'f0-c4',
    surface_last_change: ({ paths }) => (paths.includes('ops/agt002-hetzner-bridge/run-server.mjs') ? 'c4' : 'c1'),
  });
}

test('checkAgt002Drift: origin_main observed and everything else unobserved fails (bridge down never turns CI green)', () => {
  const receipt = graceReceipt();
  const observed = { surfaces: { origin_main: { sha: 'c4', version: 'f0-c4', source: 'github_sha' } } };
  const result = checkAgt002Drift({ receipt, observed, isAncestor: fakeIsAncestor, now: BEFORE_GRACE_END });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'unobserved').map((issue) => issue.surface),
    SURFACE_NAMES.filter((surface) => surface !== 'origin_main'),
  );
  assert.deepEqual(result.warnings, []);
});

for (const surface of ['bridge', 'vercel_production']) {
  for (const unreachable of [
    { observation_status: 'not_configured' },
    { observation_status: 'fetch_failed' },
    { observation_status: 'http_error', http_status: 503 },
    { observation_status: 'route_unknown', http_status: 404 },
    { observation_status: 'identity_underivable' },
  ]) {
    test(`checkAgt002Drift: ${surface} ${unreachable.observation_status} is a failure, never a warning`, () => {
      const result = checkAgt002Drift({
        receipt: graceReceipt(),
        observed: observedAt({ [surface]: unreachable }),
        isAncestor: fakeIsAncestor,
        now: BEFORE_GRACE_END,
      });
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some(
          (issue) => issue.type === 'unobserved' && issue.surface === surface && issue.observation_status === unreachable.observation_status,
        ),
      );
      assert.equal(result.warnings.some((warning) => warning.surface === surface), false);
    });
  }
}

for (const unreachable of [
  { observation_status: 'fetch_failed' },
  { observation_status: 'http_error', http_status: 503 },
  { observation_status: 'unit_unavailable', unit_status: { available: false } },
  // e.g. 10-release.conf removed: the unit exists and runs from /opt/psi-comercial/app, so no release sha.
  { observation_status: 'identity_underivable', unit_status: { available: true } },
  { observation_status: 'surface_mismatch' },
  { observation_status: 'not_configured' },
]) {
  test(`checkAgt002Drift: a host surface ${unreachable.observation_status} is a failure even inside the grace window`, () => {
    const result = checkAgt002Drift({
      receipt: graceReceipt(),
      observed: observedAt({ bridge: 'c3', auto_initial: unreachable }),
      isAncestor: fakeIsAncestor,
      now: BEFORE_GRACE_END,
    });
    assert.ok(
      result.issues.some(
        (issue) => issue.type === 'unobserved' && issue.surface === 'auto_initial' && issue.observation_status === unreachable.observation_status,
      ),
    );
    assert.equal(result.warnings.length, 0);
  });
}

test('checkAgt002Drift: a host route 404 from an outdated bridge is only a warning before the grace date', () => {
  const overrides = { bridge: 'c3' };
  for (const surface of HOST_SURFACES) overrides[surface] = ROUTE_UNKNOWN;
  const result = checkAgt002Drift({
    receipt: graceReceipt(),
    observed: observedAt(overrides),
    isAncestor: fakeIsAncestor,
    now: BEFORE_GRACE_END,
  });
  assert.deepEqual(result.warnings.map((warning) => warning.surface), HOST_SURFACES);
  assert.ok(result.warnings.every((warning) => warning.grace_until_utc === AGT002_HOST_ROUTE_GRACE_UNTIL_UTC));
  // The outdated bridge itself is still a failure.
  assert.deepEqual(result.issues.map((issue) => issue.surface), ['bridge']);
  assert.equal(result.ok, false);
});

test('checkAgt002Drift: a host route 404 fails after the grace date', () => {
  const result = checkAgt002Drift({
    receipt: graceReceipt(),
    observed: observedAt({ bridge: 'c3', radar_requests: ROUTE_UNKNOWN }),
    isAncestor: fakeIsAncestor,
    now: AFTER_GRACE_END,
  });
  assert.ok(result.issues.some((issue) => issue.surface === 'radar_requests' && issue.observation_status === 'route_unknown'));
  assert.deepEqual(result.warnings, []);
});

test('checkAgt002Drift: a host route 404 from an up-to-date bridge fails (the new bridge must know every route)', () => {
  const result = checkAgt002Drift({
    receipt: graceReceipt(),
    observed: observedAt({ radar_requests: ROUTE_UNKNOWN }),
    isAncestor: fakeIsAncestor,
    now: BEFORE_GRACE_END,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ type: 'unobserved', surface: 'radar_requests', observation_status: 'route_unknown', http_status: 404 }]);
});

test('collectAgt002SurfaceObservations + observe: every unreachable shape keeps its reason through to the observed file', async () => {
  const responses = {
    'https://bridge.invalid/cp': { ok: true, status: 200, json: async () => ({ surface: 'bridge', sha: 'b'.repeat(40), version: 'f0-bbbbbbb' }) },
    'https://bridge.invalid/cp/initial_analysis_worker': { ok: false, status: 404 },
    'https://bridge.invalid/cp/auto_initial': { ok: false, status: 503 },
    'https://bridge.invalid/cp/radar_daily_import': {
      ok: true,
      status: 200,
      json: async () => ({ surface: 'radar_daily_import', sha: null, unit_status: { available: true } }),
    },
    'https://bridge.invalid/cp/radar_daily_scan': {
      ok: true,
      status: 200,
      json: async () => ({ surface: 'radar_daily_scan', sha: null, unit_status: { available: false } }),
    },
  };
  const result = await buildAgt002ObserveSurfacesResult({
    gitSha: 'c4',
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://bridge.invalid/cp' },
    fetchImpl: async (url) => {
      if (responses[url]) return responses[url];
      throw new Error('unreachable');
    },
  });
  assert.equal(result.surfaces.origin_main.observation_status, 'observed');
  assert.equal(result.surfaces.bridge.observation_status, 'observed');
  assert.equal(result.surfaces.vercel_production.observation_status, 'not_configured');
  assert.equal(result.surfaces.initial_analysis_worker.observation_status, 'route_unknown');
  assert.equal(result.surfaces.initial_analysis_worker.http_status, 404);
  assert.equal(result.surfaces.auto_initial.observation_status, 'http_error');
  assert.equal(result.surfaces.auto_initial.http_status, 503);
  assert.equal(result.surfaces.radar_daily_import.observation_status, 'identity_underivable');
  assert.equal(result.surfaces.radar_daily_scan.observation_status, 'unit_unavailable');
  assert.equal(result.surfaces.radar_requests.observation_status, 'fetch_failed');
});

// --- code paths: runtime-read files and the monolith's Radar module imports ---

test('collectAgt002SurfaceCodePaths: includes runtime-read schemas and the lockfile, not package.json', () => {
  const initial = collectAgt002SurfaceCodePaths('initial_analysis_worker');
  assert.ok(initial.includes('schemas/agt002'), 'agt002-pre-go-analysis-v2.js reads schemas/agt002/*.json at runtime');
  for (const surface of AGT002_PINNED_SURFACE_NAMES) {
    const paths = collectAgt002SurfaceCodePaths(surface);
    assert.equal(paths.includes('package.json'), false, `${surface}: script-only package.json edits are not code changes`);
    assert.ok(paths.includes('pnpm-lock.yaml'), surface);
  }
});

// Best effort: re-derive, from the monolith source, which repo modules the Radar functions
// (persistTenderRadar / fetchPublicTenderRadar / readPersistedTenderRadar and the top-level
// functions they call, transitively) use, and require every one of them in RADAR_MONOLITH_MODULES.
// Only top-level `function` declarations closed by a column-0 `}` and named `import { ... } from
// '../x.js'` imports are recognized.
test('RADAR_MONOLITH_MODULES covers every module the monolith Radar functions import (best effort)', () => {
  // Comments are stripped first so a word in prose (e.g. "can") is never mistaken for a call.
  const source = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
  const importedFrom = new Map();
  for (const match of source.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'\.\.\/([^']+)'/gm)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) importedFrom.set(name, match[2]);
    }
  }
  const bodies = new Map();
  const starts = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)];
  for (const start of starts) {
    const end = source.indexOf('\n}\n', start.index);
    bodies.set(start[1], source.slice(start.index, end < 0 ? undefined : end));
  }
  const roots = ['persistTenderRadar', 'fetchPublicTenderRadar', 'readPersistedTenderRadar'];
  for (const root of roots) assert.ok(bodies.has(root), `expected ${root} in the monolith`);

  const seen = new Set();
  const modules = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name) || !bodies.has(name)) continue;
    seen.add(name);
    for (const identifier of new Set(bodies.get(name).match(/[A-Za-z_$][A-Za-z0-9_$]*/g))) {
      if (importedFrom.has(identifier)) modules.add(importedFrom.get(identifier));
      if (bodies.has(identifier)) pending.push(identifier);
    }
  }
  const missing = [...modules].filter((module) => !RADAR_MONOLITH_MODULES.includes(module));
  assert.deepEqual(missing, [], `add these to RADAR_MONOLITH_MODULES: ${missing.join(', ')}`);
});

test('collectAgt002SurfaceObservations: every fetch carries an abort signal so a hung endpoint cannot hang CI', async () => {
  const options = [];
  await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://bridge.invalid/cp' },
    fetchImpl: async (url, init) => {
      options.push(init);
      throw new Error('unreachable');
    },
  });
  assert.ok(options.length > 0);
  assert.ok(options.every((init) => init?.signal instanceof AbortSignal));
});
