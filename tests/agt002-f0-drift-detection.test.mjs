import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { checkAgt002Drift } from '../scripts/agt002-check-drift.mjs';
import { collectAgt002SurfaceObservations, buildAgt002ObserveSurfacesResult } from '../scripts/agt002-observe-surfaces.mjs';

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

// --- ops runners: AGT002_DEPLOYED_VERSION flows through --control-plane, never from disk ---

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

test('radar pipeline runner: --control-plane reports AGT002_DEPLOYED_VERSION alongside AGT002_DEPLOYED_GIT_SHA', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'radar-deployed-sha',
    AGT002_DEPLOYED_VERSION: '1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, 'radar-deployed-sha');
  assert.equal(payload.version, '1.2.3');
});

test('radar pipeline runner: --control-plane with a sha but no version reports version:null, never inferred', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, { AGT002_DEPLOYED_GIT_SHA: 'radar-deployed-sha' });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, 'radar-deployed-sha');
  assert.equal(payload.version, null);
});

test('reanalysis worker runner: --control-plane reports AGT002_DEPLOYED_VERSION alongside AGT002_DEPLOYED_GIT_SHA', () => {
  const result = runControlPlaneScript(REANALYSIS_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'reanalysis-deployed-sha',
    AGT002_DEPLOYED_VERSION: '1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, 'reanalysis-deployed-sha');
  assert.equal(payload.version, '1.2.3');
});

// --- release receipt: a single canonical desired {sha, version} every surface is compared to ---

test('generateAgt002ReleaseReceipt: desired.sha/version come from explicit inputs, never from disk', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123', version: '1.2.3' });
  assert.deepEqual(receipt.desired, { sha: 'abc123', version: '1.2.3' });
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

// --- checkAgt002Drift: fail closed unless all six surfaces show a non-empty sha+version match ---

test('checkAgt002Drift: SURFACE_NAMES is the exact six-surface contract checked', () => {
  assert.deepEqual(SURFACE_NAMES, [
    'origin_main',
    'vercel_production',
    'bridge',
    'radar_pipeline',
    'reanalysis_worker',
    'workbench_scheduler',
  ]);
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
    assert.deepEqual(observations[surface], {}, `${surface} must stay unobserved with no configured input`);
  }
});

test('collectAgt002SurfaceObservations: a configured URL is fetched with the injected fetchImpl only', async () => {
  const calls = [];
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_VERCEL_PRODUCTION_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ sha: 'vercel-sha', version: '1.2.3', source: 'vercel_git_commit_sha' }) };
    },
  });
  assert.deepEqual(calls, ['https://example.invalid/control-plane']);
  assert.equal(observations.vercel_production.sha, 'vercel-sha');
  assert.equal(observations.vercel_production.version, '1.2.3');
});

test('collectAgt002SurfaceObservations: radar_pipeline, reanalysis_worker, and workbench_scheduler are observed through a URL fetch, not a static configured sha/version', async () => {
  for (const surface of ['radar_pipeline', 'reanalysis_worker', 'workbench_scheduler']) {
    const prefix = `AGT002_OBSERVE_${surface.toUpperCase()}`;
    const calls = [];
    const observations = await collectAgt002SurfaceObservations({
      env: { [`${prefix}_URL`]: 'https://example.invalid/control-plane' },
      fetchImpl: async (url) => {
        calls.push(url);
        return { ok: true, json: async () => ({ sha: `${surface}-sha`, version: '1.2.3', source: `${surface}_url_fetch` }) };
      },
    });
    assert.deepEqual(calls, ['https://example.invalid/control-plane']);
    assert.equal(observations[surface].sha, `${surface}-sha`);
    assert.equal(observations[surface].version, '1.2.3');
  }
});

test('collectAgt002SurfaceObservations: a failed fetch collapses to unobserved instead of throwing', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => {
      throw new Error('network unreachable');
    },
  });
  assert.deepEqual(observations.bridge, {});
});

test('collectAgt002SurfaceObservations: a non-2xx response collapses to unobserved', async () => {
  const observations = await collectAgt002SurfaceObservations({
    env: { AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane' },
    fetchImpl: async () => ({ ok: false }),
  });
  assert.deepEqual(observations.bridge, {});
});

test('collectAgt002SurfaceObservations: explicit env sha takes precedence over a configured URL', async () => {
  let fetchCalled = false;
  const observations = await collectAgt002SurfaceObservations({
    env: {
      AGT002_OBSERVE_BRIDGE_SHA: 'from-env',
      AGT002_OBSERVE_BRIDGE_URL: 'https://example.invalid/control-plane',
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return { ok: true, json: async () => ({ sha: 'from-url', version: null, source: 'bridge_url_fetch' }) };
    },
  });
  assert.equal(observations.bridge.sha, 'from-env');
  assert.equal(fetchCalled, false);
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

test('buildAgt002ObserveSurfacesResult feeding checkAgt002Drift end to end: fully matching six surfaces pass, one drifted surface fails closed with a structured issue', async () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'release-sha', version: '2.0.0' });
  const env = {};
  for (const surface of SURFACE_NAMES) {
    const prefix = `AGT002_OBSERVE_${surface.toUpperCase()}`;
    env[`${prefix}_SHA`] = 'release-sha';
    env[`${prefix}_VERSION`] = '2.0.0';
  }
  const matching = await buildAgt002ObserveSurfacesResult({ env });
  const matchingResult = checkAgt002Drift({ receipt, observed: matching });
  assert.deepEqual(matchingResult, { ok: true, issues: [] });

  env.AGT002_OBSERVE_BRIDGE_SHA = 'stale-sha';
  const drifted = await buildAgt002ObserveSurfacesResult({ env });
  const driftedResult = checkAgt002Drift({ receipt, observed: drifted });
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
  assert.deepEqual(checkAgt002Drift({ receipt, observed: observedAtBaseSha }), { ok: true, issues: [] });

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
      radar_pipeline: { sha: 'c0ffee', version: '9.9.9', source: 'radar_observed' },
      origin_main: {},
    },
  });
  assert.equal(result.surfaces.bridge.match_desired_version, true);
  assert.equal(result.surfaces.radar_pipeline.match_desired_version, false);
  assert.equal(result.surfaces.origin_main.match_desired_version, null);
  assert.equal(result.control_plane_reconciled, false);
});
