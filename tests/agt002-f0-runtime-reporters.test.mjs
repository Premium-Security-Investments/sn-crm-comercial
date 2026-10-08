import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  SURFACE_NAMES,
  buildAgt002ControlPlaneIdentity,
} from '../agt002-control-plane-identity.js';
import { observeAgt002Surfaces } from '../agt002-control-plane-observe.js';
import { getAgt002VercelControlPlaneIdentity } from '../agt002-vercel-control-plane-identity.js';
import {
  buildRadarPipelineIdentity,
  buildReanalysisWorkerIdentity,
  buildWorkbenchSchedulerIdentity,
} from '../agt002-control-plane-surface-builders.js';
import {
  AGT002_RELEASES_ROOT,
  AGT002_RELEASE_VERSION_FILE_NAME,
  resolveAgt002ReleaseArtifactEvidence,
} from '../agt002-control-plane-runtime-evidence.js';
import { createAgt002BridgeServer } from '../agt002-hetzner-bridge-server.js';
import { sha256Hex, buildCanonicalString, signCanonicalString } from '../agt002-hetzner-bridge-signing.js';
import { generateAgt002ReleaseReceipt } from '../scripts/agt002-generate-release-receipt.mjs';

const SECRET = 'a'.repeat(32);
const PREVIEW_PATH = '/v1/agt002-preview/run';
const CONTROL_PLANE_PATH = '/v1/agt002/control-plane';

// Copied from tests/agt002-hetzner-bridge-server.test.mjs so this file does not depend on
// (or risk perturbing) that file's local helper.
async function withServer(codexClient, fn, options = {}) {
  const server = createServer(createAgt002BridgeServer({ hmacSecret: SECRET, codexClient, ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function signedHeaders(body, path, { timestamp = String(Math.floor(Date.now() / 1000)), nonce = 'n'.repeat(16), secret = SECRET } = {}) {
  const canonical = buildCanonicalString({ method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
  return {
    'content-type': 'application/json',
    'x-agt002-timestamp': timestamp,
    'x-agt002-nonce': nonce,
    'x-agt002-signature': signCanonicalString(secret, canonical),
  };
}

const fakeCodexClient = { run: async () => ({ content: '{"ok":true}', usage: { input_tokens: 1, output_tokens: 2 }, rate_limit: null }) };

test('SURFACE_NAMES matches the exact live watched surfaces', () => {
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
  assert.equal(Object.isFrozen(SURFACE_NAMES), true);
});

test('buildAgt002ControlPlaneIdentity: unobserved identity when no sha is given', () => {
  const identity = buildAgt002ControlPlaneIdentity({ surface: 'origin_main' });
  assert.equal(identity.surface, 'origin_main');
  assert.equal(identity.sha, null);
  assert.equal(identity.source, 'unobserved');
  assert.match(identity.observed_at_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('buildAgt002ControlPlaneIdentity: observed identity from explicit injected inputs', () => {
  const fixedNow = () => new Date('2026-09-26T00:00:00.000Z');
  const identity = buildAgt002ControlPlaneIdentity({
    surface: 'radar_pipeline',
    sha: 'deadbeef',
    version: '1.2.3',
    source: 'radar_pipeline_git_head',
    now: fixedNow,
  });
  assert.deepEqual(identity, {
    surface: 'radar_pipeline',
    sha: 'deadbeef',
    version: '1.2.3',
    source: 'radar_pipeline_git_head',
    observed_at_utc: '2026-09-26T00:00:00.000Z',
  });
});

test('buildAgt002ControlPlaneIdentity: empty sha collapses to sha=null, source=unobserved', () => {
  const identity = buildAgt002ControlPlaneIdentity({ surface: 'bridge', sha: '', source: 'bridge_release_sha' });
  assert.equal(identity.sha, null);
  assert.equal(identity.source, 'unobserved');
});

test('buildAgt002ControlPlaneIdentity: invalid surface throws', () => {
  assert.throws(() => buildAgt002ControlPlaneIdentity({ surface: 'not_a_real_surface' }));
});

test('buildAgt002ControlPlaneIdentity: non-empty sha requires a non-empty, non-"unobserved" source', () => {
  assert.throws(() => buildAgt002ControlPlaneIdentity({ surface: 'bridge', sha: 'abc123' }));
  assert.throws(() => buildAgt002ControlPlaneIdentity({ surface: 'bridge', sha: 'abc123', source: '' }));
  assert.throws(() => buildAgt002ControlPlaneIdentity({ surface: 'bridge', sha: 'abc123', source: 'unobserved' }));
});

test('observeAgt002Surfaces: always includes all six surfaces, missing ones stay unobserved', () => {
  const result = observeAgt002Surfaces({ observations: { bridge: { sha: 'abc123', source: 'bridge_release_sha' } } });
  assert.equal(result.control_plane_reconciled, false);
  assert.deepEqual(Object.keys(result.surfaces).sort(), [...SURFACE_NAMES].sort());
  assert.equal(result.surfaces.bridge.sha, 'abc123');
  for (const surface of SURFACE_NAMES) {
    if (surface === 'bridge') continue;
    assert.equal(result.surfaces[surface].sha, null, `${surface} must stay unobserved`);
    assert.equal(result.surfaces[surface].source, 'unobserved');
  }
});

test('observeAgt002Surfaces: control_plane_reconciled is always false, even when every surface matches desiredSha', () => {
  const desiredSha = 'c0ffee';
  const observations = {};
  for (const surface of SURFACE_NAMES) {
    observations[surface] = { sha: desiredSha, source: `${surface}_observed` };
  }
  const result = observeAgt002Surfaces({ desiredSha, observations });
  assert.equal(result.control_plane_reconciled, false);
  for (const surface of SURFACE_NAMES) {
    assert.equal(result.surfaces[surface].match_desired, true);
  }
});

test('observeAgt002Surfaces: never invents a sha for a surface with no observation', () => {
  const result = observeAgt002Surfaces({ desiredSha: 'c0ffee', observations: {} });
  for (const surface of SURFACE_NAMES) {
    assert.equal(result.surfaces[surface].sha, null);
  }
});

test('observeAgt002Surfaces: match_desired is true, false, or null as specified', () => {
  const result = observeAgt002Surfaces({
    desiredSha: 'c0ffee',
    observations: {
      bridge: { sha: 'c0ffee', source: 'bridge_observed' },
      radar_daily_scan: { sha: 'other-sha', source: 'radar_observed' },
      origin_main: {},
    },
  });
  assert.equal(result.surfaces.bridge.match_desired, true);
  assert.equal(result.surfaces.radar_daily_scan.match_desired, false);
  assert.equal(result.surfaces.origin_main.match_desired, null, 'a null sha must produce a null match_desired');
});

test('getAgt002VercelControlPlaneIdentity: prefers VERCEL_GIT_COMMIT_SHA over GITHUB_SHA', () => {
  const identity = getAgt002VercelControlPlaneIdentity({
    env: { VERCEL_GIT_COMMIT_SHA: 'vercel-sha', GITHUB_SHA: 'github-sha' },
  });
  assert.equal(identity.surface, 'vercel_production');
  assert.equal(identity.sha, 'vercel-sha');
  assert.equal(identity.source, 'vercel_git_commit_sha');
});

test('getAgt002VercelControlPlaneIdentity: falls back to GITHUB_SHA', () => {
  const identity = getAgt002VercelControlPlaneIdentity({ env: { GITHUB_SHA: 'github-sha' } });
  assert.equal(identity.sha, 'github-sha');
  assert.equal(identity.source, 'github_sha');
});

test('getAgt002VercelControlPlaneIdentity: falls back to AGT002_DEPLOYED_GIT_SHA when neither VERCEL_GIT_COMMIT_SHA nor GITHUB_SHA is set', () => {
  const identity = getAgt002VercelControlPlaneIdentity({ env: { AGT002_DEPLOYED_GIT_SHA: 'deployed-sha' } });
  assert.equal(identity.sha, 'deployed-sha');
  assert.equal(identity.source, 'agt002_deployed_git_sha');
});

test('getAgt002VercelControlPlaneIdentity: VERCEL_GIT_COMMIT_SHA and GITHUB_SHA both take precedence over AGT002_DEPLOYED_GIT_SHA', () => {
  const vercelWins = getAgt002VercelControlPlaneIdentity({
    env: { VERCEL_GIT_COMMIT_SHA: 'vercel-sha', GITHUB_SHA: 'github-sha', AGT002_DEPLOYED_GIT_SHA: 'deployed-sha' },
  });
  assert.equal(vercelWins.sha, 'vercel-sha');
  assert.equal(vercelWins.source, 'vercel_git_commit_sha');

  const githubWins = getAgt002VercelControlPlaneIdentity({
    env: { GITHUB_SHA: 'github-sha', AGT002_DEPLOYED_GIT_SHA: 'deployed-sha' },
  });
  assert.equal(githubWins.sha, 'github-sha');
  assert.equal(githubWins.source, 'github_sha');
});

test('getAgt002VercelControlPlaneIdentity: unobserved when neither env var is set', () => {
  const identity = getAgt002VercelControlPlaneIdentity({ env: {} });
  assert.equal(identity.sha, null);
  assert.equal(identity.source, 'unobserved');
});

test('getAgt002VercelControlPlaneIdentity: a native Vercel full 40-hex sha derives version f0-<first 7 chars> when AGT002_DEPLOYED_VERSION is absent', () => {
  const sha = 'a'.repeat(40);
  const identity = getAgt002VercelControlPlaneIdentity({ env: { VERCEL_GIT_COMMIT_SHA: sha } });
  assert.equal(identity.sha, sha);
  assert.equal(identity.version, `f0-${sha.slice(0, 7)}`);
});

test('getAgt002VercelControlPlaneIdentity: an explicit AGT002_DEPLOYED_VERSION still wins over a derivable full 40-hex sha', () => {
  const sha = 'b'.repeat(40);
  const identity = getAgt002VercelControlPlaneIdentity({
    env: { VERCEL_GIT_COMMIT_SHA: sha, AGT002_DEPLOYED_VERSION: 'v9.9.9' },
  });
  assert.equal(identity.sha, sha);
  assert.equal(identity.version, 'v9.9.9');
});

test('getAgt002VercelControlPlaneIdentity: an invalid/short sha never derives a version', () => {
  const uppercase = getAgt002VercelControlPlaneIdentity({
    env: { VERCEL_GIT_COMMIT_SHA: 'C'.repeat(40) },
  });
  assert.equal(uppercase.version, null);

  const shortSha = getAgt002VercelControlPlaneIdentity({ env: { GITHUB_SHA: 'c0ffee' } });
  assert.equal(shortSha.version, null);

  const nonHex = getAgt002VercelControlPlaneIdentity({
    env: { AGT002_DEPLOYED_GIT_SHA: 'z'.repeat(40) },
  });
  assert.equal(nonHex.version, null);
});

test('static: api/[...path].js exposes an unauthenticated GET /api/agt002/control-plane route', () => {
  const source = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/agt002\/control-plane'/);
});

test('pure builders: radar_pipeline, reanalysis_worker, workbench_scheduler', () => {
  const unobservedRadar = buildRadarPipelineIdentity({});
  assert.equal(unobservedRadar.surface, 'radar_pipeline');
  assert.equal(unobservedRadar.sha, null);

  const observedRadar = buildRadarPipelineIdentity({ headSha: 'radar-sha', dirtyCount: 0 });
  assert.equal(observedRadar.sha, 'radar-sha');
  assert.notEqual(observedRadar.source, 'unobserved');

  const unobservedReanalysis = buildReanalysisWorkerIdentity({});
  assert.equal(unobservedReanalysis.sha, null);
  const observedReanalysis = buildReanalysisWorkerIdentity({ releaseSha: 'reanalysis-sha' });
  assert.equal(observedReanalysis.sha, 'reanalysis-sha');

  const unobservedWorkbench = buildWorkbenchSchedulerIdentity({});
  assert.equal(unobservedWorkbench.sha, null);
  const observedWorkbench = buildWorkbenchSchedulerIdentity({ checkoutSha: 'workbench-sha', runnerSha256: 'runner-hash' });
  assert.equal(observedWorkbench.sha, 'workbench-sha');
  assert.equal(observedWorkbench.version, 'runner-hash');
});

test('bridge: GET /v1/agt002/control-plane returns the injected identity for surface bridge', async () => {
  await withServer(fakeCodexClient, async (base) => {
    const response = await fetch(`${base}${CONTROL_PLANE_PATH}`, { method: 'GET' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.surface, 'bridge');
    assert.equal(payload.sha, 'bridge-sha');
    assert.equal(payload.source, 'bridge_release_sha');
  }, { controlPlaneIdentity: { sha: 'bridge-sha', source: 'bridge_release_sha' } });
});

test('bridge: GET /v1/agt002/control-plane is unobserved by default (no identity injected)', async () => {
  await withServer(fakeCodexClient, async (base) => {
    const response = await fetch(`${base}${CONTROL_PLANE_PATH}`, { method: 'GET' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sha, null);
    assert.equal(payload.source, 'unobserved');
  });
});

test('bridge: GET /v1/agt002-preview/run still returns 405 AGT002_BRIDGE_METHOD_NOT_ALLOWED', async () => {
  await withServer(fakeCodexClient, async (base) => {
    const response = await fetch(`${base}${PREVIEW_PATH}`, { method: 'GET' });
    assert.equal(response.status, 405);
    const payload = await response.json();
    assert.equal(payload.error.code, 'AGT002_BRIDGE_METHOD_NOT_ALLOWED');
  });
});

test('bridge: POST /v1/agt002-preview/run still works unaffected by the new GET route', async () => {
  await withServer(fakeCodexClient, async (base) => {
    const payload = { model: 'sonnet', policy: 'p', input: {}, outputSchema: {}, timeoutMs: 5000, idempotencyKey: 'idem-reporters-1' };
    const body = JSON.stringify(payload);
    const response = await fetch(`${base}${PREVIEW_PATH}`, { method: 'POST', headers: signedHeaders(body, PREVIEW_PATH), body });
    assert.equal(response.status, 200);
  });
});

test('generateAgt002ReleaseReceipt: still forces control_plane_reconciled false and nulls unobserved surfaces', () => {
  const receipt = generateAgt002ReleaseReceipt({ git_sha: null });
  assert.equal(receipt.control_plane_reconciled, false);
  for (const surface of SURFACE_NAMES) {
    if (surface === 'origin_main') continue;
    assert.equal(receipt.surfaces[surface].sha, null, `${surface} must be null unless input.surfaces provides it`);
    assert.equal(receipt.surfaces[surface].source, 'unobserved');
  }
});

test('generateAgt002ReleaseReceipt: control_plane_reconciled=true in input is rejected', () => {
  assert.throws(() => generateAgt002ReleaseReceipt({ control_plane_reconciled: true }));
});

// --- F0 runtime-reporters wiring: bridge runner, radar pipeline runner, reanalysis worker
// runner, workbench scheduler script. Each surface below must (a) never infer identity from a
// configuration/env claim -- only from canonical evidence of the effective executable/script
// runtime path, (b) require no secret/network/business call to report it, (c) leave the
// existing frozen builders/contract untouched.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The bridge (run-server.mjs) surface is intentionally out of scope for this correction: it is
// wired directly by a human-controlled systemd EnvironmentFile at deploy time, not by a oneshot
// --control-plane reporter inferring its own runtime path, so it is unaffected here.
test('run-server.mjs (bridge): wires controlPlaneIdentity from AGT002_DEPLOYED_GIT_SHA/AGT002_DEPLOYED_VERSION, never from disk', () => {
  const source = readFileSync(new URL('../ops/agt002-hetzner-bridge/run-server.mjs', import.meta.url), 'utf8');
  assert.match(source, /AGT002_DEPLOYED_GIT_SHA/);
  assert.match(source, /AGT002_DEPLOYED_VERSION/);
  assert.match(source, /createAgt002BridgeServer\(\{[^}]*controlPlaneIdentity/);
  // Never reads git or other mutable disk state to infer identity.
  assert.doesNotMatch(source, /child_process|execSync|spawnSync|git\s+rev-parse|readFileSync/);
});

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

const RADAR_RUNNER = new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url).pathname;
const REANALYSIS_RUNNER = new URL('../ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs', import.meta.url).pathname;
const WORKBENCH_SCRIPT = new URL('../ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh', import.meta.url).pathname;

// --- Shared helper (agt002-control-plane-runtime-evidence.js): the single canonical parser
// every one of the three oneshot reporters below is required to defer to -- exercised directly
// with real filesystem fixtures (mkdtemp) rather than divergent per-surface logic.

function buildReleaseFixture({ relativePath, version } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agt002-release-'));
  const sha = '1'.repeat(40);
  const scriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, '// fixture release artifact\n');
  if (version !== undefined) {
    writeFileSync(join(root, sha, AGT002_RELEASE_VERSION_FILE_NAME), version);
  }
  return { root, sha, scriptPath };
}

test('resolveAgt002ReleaseArtifactEvidence: a canonical immutable release-path fixture reports the exact sha and its colocated version', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath, version: '2026.09.27-1\n' });
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, '2026.09.27-1');
});

test('resolveAgt002ReleaseArtifactEvidence: a fixture with no RELEASE_VERSION file reports the sha with a null version', () => {
  const relativePath = 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath });
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: an unsafe RELEASE_VERSION content nulls only the version, sha stays observed', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath, version: 'not a safe token!' });
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: a real file in the current dev worktree (not a release checkout) stays unobserved', () => {
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath: RADAR_RUNNER,
    relativePath: 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs',
  });
  assert.equal(evidence.sha, null);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: never trusts an env-var/config claim -- a non-canonical scriptPath stays unobserved even with AGT002_DEPLOYED_GIT_SHA/VERSION set', () => {
  process.env.AGT002_DEPLOYED_GIT_SHA = 'a'.repeat(40);
  process.env.AGT002_DEPLOYED_VERSION = 'v9.9.9';
  try {
    const evidence = resolveAgt002ReleaseArtifactEvidence({
      scriptPath: RADAR_RUNNER,
      relativePath: 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs',
    });
    assert.equal(evidence.sha, null);
    assert.equal(evidence.version, null);
  } finally {
    delete process.env.AGT002_DEPLOYED_GIT_SHA;
    delete process.env.AGT002_DEPLOYED_VERSION;
  }
});

test('resolveAgt002ReleaseArtifactEvidence: a symlink placed at a canonical-looking release path but pointing outside the release tree cannot spoof observed', () => {
  const relativePath = 'ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh';
  const root = mkdtempSync(join(tmpdir(), 'agt002-release-symlink-'));
  const sha = '2'.repeat(40);
  const scriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  const outsideTarget = join(root, 'outside-the-release-tree.sh');
  writeFileSync(outsideTarget, '# not a real release artifact\n');
  symlinkSync(outsideTarget, scriptPath);

  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, null, 'a symlink escaping the release tree must never be treated as canonical');
});

test('resolveAgt002ReleaseArtifactEvidence: a RELEASE_VERSION symlink escaping its own release directory is never trusted, sha stays observed but version stays null', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath });
  const outsideVersionFile = join(root, 'outside-version.txt');
  writeFileSync(outsideVersionFile, 'v9.9.9');
  symlinkSync(outsideVersionFile, join(root, sha, AGT002_RELEASE_VERSION_FILE_NAME));

  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: unsafe/malformed scriptPath and mismatched shapes collapse to unobserved without throwing', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const unsafeInputs = [
    null,
    undefined,
    '',
    '/nonexistent/path/does/not/exist.mjs',
    `${AGT002_RELEASES_ROOT}/not-a-sha/${relativePath}`,
    `${AGT002_RELEASES_ROOT}/${'g'.repeat(40)}/${relativePath}`,
    `${AGT002_RELEASES_ROOT}/${'3'.repeat(40)}/${relativePath}/../../../etc/passwd`,
  ];
  for (const scriptPath of unsafeInputs) {
    assert.doesNotThrow(() => {
      const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath });
      assert.equal(evidence.sha, null, `expected unobserved for scriptPath=${JSON.stringify(scriptPath)}`);
      assert.equal(evidence.version, null);
    });
  }
});

test('resolveAgt002ReleaseArtifactEvidence: a mismatched relativePath (wrong surface) stays unobserved even under a real release sha', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, scriptPath } = buildReleaseFixture({ relativePath });
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath,
    relativePath: 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs',
    releasesRoot: root,
  });
  assert.equal(evidence.sha, null);
});

test('resolveAgt002ReleaseArtifactEvidence: an uppercase-hex sha fails closed, only lowercase 40-hex is trusted', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const root = mkdtempSync(join(tmpdir(), 'agt002-release-'));
  const sha = 'A'.repeat(40);
  const scriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, '// fixture release artifact\n');
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, null, 'an uppercase-hex sha must never be trusted as canonical');
});

test('resolveAgt002ReleaseArtifactEvidence: a short (39-char) sha fails closed', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const root = mkdtempSync(join(tmpdir(), 'agt002-release-'));
  const sha = '1'.repeat(39);
  const scriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, '// fixture release artifact\n');
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, null, 'a short sha must never be trusted as canonical');
});

test('resolveAgt002ReleaseArtifactEvidence: a prefix-confusion sibling root (e.g. "<root>-evil") fails closed even though it string-prefixes the real root', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const root = mkdtempSync(join(tmpdir(), 'agt002-release-'));
  const sha = '1'.repeat(40);
  const confusedRoot = `${root}-evil`;
  const scriptPath = join(confusedRoot, sha, relativePath);
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, '// fixture release artifact\n');
  const evidence = resolveAgt002ReleaseArtifactEvidence({ scriptPath, relativePath, releasesRoot: root });
  assert.equal(evidence.sha, null, 'a sibling directory sharing the root as a string prefix must never be trusted as inside it');
});

test('resolveAgt002ReleaseArtifactEvidence: a realpath error on the script path itself fails closed without throwing', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, scriptPath } = buildReleaseFixture({ relativePath, version: '1.2.3' });
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath,
    relativePath,
    releasesRoot: root,
    realpath: () => { throw new Error('realpath failed'); },
  });
  assert.equal(evidence.sha, null);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: a realpath error while resolving RELEASE_VERSION nulls only the version, sha stays observed', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath, version: '1.2.3' });
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath,
    relativePath,
    releasesRoot: root,
    realpath: (candidate) => {
      if (candidate.endsWith(AGT002_RELEASE_VERSION_FILE_NAME)) throw new Error('realpath failed');
      return realpathSync(candidate);
    },
  });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, null);
});

test('resolveAgt002ReleaseArtifactEvidence: a readFile error on an otherwise-valid RELEASE_VERSION file nulls only the version, sha stays observed', () => {
  const relativePath = 'ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs';
  const { root, sha, scriptPath } = buildReleaseFixture({ relativePath, version: '1.2.3' });
  const evidence = resolveAgt002ReleaseArtifactEvidence({
    scriptPath,
    relativePath,
    releasesRoot: root,
    readFile: () => { throw new Error('read failed'); },
  });
  assert.equal(evidence.sha, sha);
  assert.equal(evidence.version, null);
});

// --- radar_pipeline oneshot reporter

test('radar pipeline runner: --control-plane is gated by the shared builder + shared runtime-evidence resolver, never reads git, never trusts AGT002_DEPLOYED_GIT_SHA/VERSION, and the AI preanalysis pipeline is retired so the script never constructs a Supabase client at all', () => {
  const source = readFileSync(RADAR_RUNNER, 'utf8');
  assert.match(source, /buildRadarPipelineIdentity/);
  assert.match(source, /resolveAgt002ReleaseArtifactEvidence/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-surface-builders\.js'/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-runtime-evidence\.js'/);
  assert.ok(source.indexOf("'--control-plane'") >= 0, '--control-plane check must be present');
  assert.doesNotMatch(source, /createClient\(/, 'the retired radar pipeline runner must never construct a Supabase client');
  assert.doesNotMatch(source, /@supabase\/supabase-js/, 'the retired radar pipeline runner must never import the Supabase client');
  assert.doesNotMatch(source, /execSync|spawnSync|git\s+rev-parse/);
  assert.doesNotMatch(source, /AGT002_DEPLOYED_GIT_SHA|AGT002_DEPLOYED_VERSION/, 'must never treat the deployed-sha/version env vars as identity evidence');
  assert.match(source, /AGT002_RADAR_AI_RETIRED/, 'normal mode must report the deterministic retirement code');
});

test('radar pipeline runner: --control-plane ignores AGT002_DEPLOYED_GIT_SHA/VERSION spoofing -- stays unobserved from the dev worktree, needs no Supabase secret, exactly one JSON line, exit 0', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'a'.repeat(40),
    AGT002_DEPLOYED_VERSION: 'v1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'radar_pipeline');
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('radar pipeline runner: --control-plane with no env at all is unobserved too (env was never the trust boundary), still needs no Supabase secret, exit 0', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, {});
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'radar_pipeline');
  assert.equal(payload.sha, null);
  assert.equal(payload.source, 'unobserved');
});

test('radar pipeline runner: normal mode (no --control-plane) is retired -- the AI preanalysis pipeline is off, exits 0 with no Supabase config needed, and reports exactly the retirement JSON', () => {
  const result = spawnSync(process.execPath, [RADAR_RUNNER], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.deepEqual(payload, { status: 'retired', code: 'AGT002_RADAR_AI_RETIRED' });
});

// --- reanalysis_worker oneshot reporter

test('reanalysis worker runner: --control-plane is gated by the shared builder + shared runtime-evidence resolver before the Supabase client, never reads git and never trusts AGT002_DEPLOYED_GIT_SHA/VERSION', () => {
  const source = readFileSync(REANALYSIS_RUNNER, 'utf8');
  assert.match(source, /buildReanalysisWorkerIdentity/);
  assert.match(source, /resolveAgt002ReleaseArtifactEvidence/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-surface-builders\.js'/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-runtime-evidence\.js'/);
  const controlPlaneIndex = source.indexOf("'--control-plane'");
  const clientIndex = source.indexOf('createClient(');
  assert.ok(controlPlaneIndex >= 0, '--control-plane check must be present');
  assert.ok(clientIndex > controlPlaneIndex, '--control-plane must be checked before the Supabase client is constructed');
  assert.doesNotMatch(source, /execSync|spawnSync|git\s+rev-parse/);
  assert.doesNotMatch(source, /AGT002_DEPLOYED_GIT_SHA|AGT002_DEPLOYED_VERSION/, 'must never treat the deployed-sha/version env vars as identity evidence');
});

test('reanalysis worker runner: --control-plane ignores AGT002_DEPLOYED_GIT_SHA/VERSION spoofing -- stays unobserved from the dev worktree, needs no Supabase secret, exactly one JSON line, exit 0', () => {
  const result = runControlPlaneScript(REANALYSIS_RUNNER, {
    AGT002_DEPLOYED_GIT_SHA: 'b'.repeat(40),
    AGT002_DEPLOYED_VERSION: 'v1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'reanalysis_worker');
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('reanalysis worker runner: --control-plane with no env at all is unobserved too (env was never the trust boundary), still needs no Supabase secret, exit 0', () => {
  const result = runControlPlaneScript(REANALYSIS_RUNNER, {});
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'reanalysis_worker');
  assert.equal(payload.sha, null);
  assert.equal(payload.source, 'unobserved');
});

test('reanalysis worker runner: normal mode (no --control-plane) is unchanged and still fails closed without Supabase config', () => {
  const result = spawnSync(process.execPath, [REANALYSIS_RUNNER], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFIG_MISSING/);
});

// --- workbench_scheduler oneshot reporter (bash)

function runWorkbenchScript(args, env, scriptPath = WORKBENCH_SCRIPT) {
  return spawnSync('bash', [scriptPath, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

test('workbench worker script: --control-plane derives sha/version only from realpath release-tree evidence, never from AGT002_DEPLOYED_GIT_SHA/VERSION, and remains gated before the worker secret/URL requirement and curl', () => {
  const source = readFileSync(WORKBENCH_SCRIPT, 'utf8');
  const controlPlaneIndex = source.indexOf('--control-plane');
  const secretIndex = source.indexOf('AGT002_WORKBENCH_WORKER_URL:?');
  const curlIndex = source.indexOf('exec curl');
  assert.ok(controlPlaneIndex >= 0, '--control-plane check must be present');
  assert.ok(secretIndex > controlPlaneIndex, '--control-plane must precede the required-secret check');
  assert.ok(curlIndex > secretIndex, 'the network call must remain after the secret check');
  assert.match(source, /realpath/);
  assert.doesNotMatch(source, /AGT002_DEPLOYED_GIT_SHA|AGT002_DEPLOYED_VERSION/, 'must never treat the deployed-sha/version env vars as identity evidence');
});

test('workbench worker script: --control-plane ignores AGT002_DEPLOYED_GIT_SHA/VERSION spoofing -- stays unobserved from the dev worktree checkout, needs no worker secret, exactly one JSON line, exit 0', () => {
  const result = runWorkbenchScript(['--control-plane'], {
    AGT002_DEPLOYED_GIT_SHA: 'c'.repeat(40),
    AGT002_DEPLOYED_VERSION: 'v1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('workbench worker script: --control-plane with no env at all is unobserved too (env was never the trust boundary), needs no worker secret, exit 0', () => {
  const result = runWorkbenchScript(['--control-plane'], {});
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
});

// The production releases_root ('/opt/psi-comercial/releases') is a real host path this sandbox
// cannot (and must not) write to, so these two fixtures run the exact same script text with only
// that one hardcoded literal textually patched to a throwaway mkdtemp root -- proving the actual
// realpath/regex algorithm (unchanged) correctly reports/rejects a canonical release checkout,
// without ever touching a real host path or making the production root configurable at runtime.
function patchedWorkbenchScriptSource(releasesRoot) {
  const source = readFileSync(WORKBENCH_SCRIPT, 'utf8');
  const patched = source.replace("releases_root='/opt/psi-comercial/releases'", `releases_root='${releasesRoot}'`);
  assert.notEqual(patched, source, 'expected to patch the hardcoded releases_root for this fixture-only copy');
  return patched;
}

test('workbench worker script: (fixture) the realpath/regex algorithm reports the exact sha and its colocated version from a canonical release-path checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'agt002-workbench-release-'));
  const sha = '4'.repeat(40);
  const relativePath = 'ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh';
  const fixtureScriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(fixtureScriptPath), { recursive: true });
  writeFileSync(fixtureScriptPath, patchedWorkbenchScriptSource(root), { mode: 0o755 });
  writeFileSync(join(root, sha, 'RELEASE_VERSION'), '2026.09.27-1\n');

  const result = runWorkbenchScript(['--control-plane'], {}, fixtureScriptPath);
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, sha);
  assert.equal(payload.version, '2026.09.27-1');
  assert.equal(payload.source, 'workbench_scheduler_checkout_sha');
});

test('workbench worker script: (fixture) a symlink at a canonical-looking release path pointing outside the release tree cannot spoof observed', () => {
  const root = mkdtempSync(join(tmpdir(), 'agt002-workbench-release-symlink-'));
  const sha = '5'.repeat(40);
  const relativePath = 'ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh';
  const fixtureScriptPath = join(root, sha, relativePath);
  mkdirSync(dirname(fixtureScriptPath), { recursive: true });
  const outsideCopyPath = join(root, 'outside-the-release-tree.sh');
  writeFileSync(outsideCopyPath, patchedWorkbenchScriptSource(root), { mode: 0o755 });
  symlinkSync(outsideCopyPath, fixtureScriptPath);

  const result = runWorkbenchScript(['--control-plane'], {}, fixtureScriptPath);
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, null, 'a symlink escaping the release tree must never be treated as canonical');
  assert.equal(payload.source, 'unobserved');
});

test('workbench worker script: --control-plane output stays a single well-formed JSON line even when invoked through a maliciously-named symlink', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'agt002-workbench-symlink-'));
  const maliciousPath = join(tmpDir, '"};echo pwned;{"x":"".sh');
  symlinkSync(WORKBENCH_SCRIPT, maliciousPath);
  const result = runWorkbenchScript(['--control-plane'], {}, maliciousPath);
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, null);
  assert.equal(payload.source, 'unobserved');
});

test('workbench worker script: normal mode (no --control-plane) is unchanged and still requires the worker URL/secret env vars', () => {
  const result = runWorkbenchScript([], {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AGT002_WORKBENCH_WORKER_URL/);
});
