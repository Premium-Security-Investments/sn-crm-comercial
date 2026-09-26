import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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
  buildWorkbenchSchedulerIdentity,
} from '../agt002-control-plane-surface-builders.js';
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

test('SURFACE_NAMES matches the exact six required surfaces', () => {
  assert.deepEqual(SURFACE_NAMES, [
    'origin_main',
    'vercel_production',
    'bridge',
    'radar_pipeline',
    'reanalysis_worker',
    'workbench_scheduler',
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
      radar_pipeline: { sha: 'other-sha', source: 'radar_observed' },
      origin_main: {},
    },
  });
  assert.equal(result.surfaces.bridge.match_desired, true);
  assert.equal(result.surfaces.radar_pipeline.match_desired, false);
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

test('getAgt002VercelControlPlaneIdentity: unobserved when neither env var is set', () => {
  const identity = getAgt002VercelControlPlaneIdentity({ env: {} });
  assert.equal(identity.sha, null);
  assert.equal(identity.source, 'unobserved');
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
// runner, workbench scheduler script. Each surface below must (a) never infer identity from
// mutable disk state, (b) require no secret/network/business call to report it, (c) leave the
// existing frozen builders/contract untouched.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

test('radar pipeline runner: --control-plane is gated by the shared builder before the Supabase client, and never reads git/disk', () => {
  const source = readFileSync(RADAR_RUNNER, 'utf8');
  assert.match(source, /buildRadarPipelineIdentity/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-surface-builders\.js'/);
  const controlPlaneIndex = source.indexOf("'--control-plane'");
  const clientIndex = source.indexOf('createClient(');
  assert.ok(controlPlaneIndex >= 0, '--control-plane check must be present');
  assert.ok(clientIndex > controlPlaneIndex, '--control-plane must be checked before the Supabase client is constructed');
  assert.doesNotMatch(source, /execSync|spawnSync|git\s+rev-parse/);
});

test('radar pipeline runner: --control-plane is observed from AGT002_DEPLOYED_GIT_SHA, needs no Supabase secret, exactly one JSON line, exit 0', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, { AGT002_DEPLOYED_GIT_SHA: 'radar-deployed-sha' });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'radar_pipeline');
  assert.equal(payload.sha, 'radar-deployed-sha');
  assert.equal(payload.source, 'radar_pipeline_git_head');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('radar pipeline runner: --control-plane is unobserved with no AGT002_DEPLOYED_GIT_SHA, still needs no Supabase secret, exit 0', () => {
  const result = runControlPlaneScript(RADAR_RUNNER, {});
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'radar_pipeline');
  assert.equal(payload.sha, null);
  assert.equal(payload.source, 'unobserved');
});

test('radar pipeline runner: normal mode (no --control-plane) is unchanged and still fails closed without Supabase config', () => {
  const result = spawnSync(process.execPath, [RADAR_RUNNER], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /AGT002_RADAR_ENTRYPOINT_CONFIG_INVALID/);
});

test('reanalysis worker runner: --control-plane is gated by the shared builder before the Supabase client, and never reads git/disk', () => {
  const source = readFileSync(REANALYSIS_RUNNER, 'utf8');
  assert.match(source, /buildReanalysisWorkerIdentity/);
  assert.match(source, /from\s+'\.\.\/\.\.\/agt002-control-plane-surface-builders\.js'/);
  const controlPlaneIndex = source.indexOf("'--control-plane'");
  const clientIndex = source.indexOf('createClient(');
  assert.ok(controlPlaneIndex >= 0, '--control-plane check must be present');
  assert.ok(clientIndex > controlPlaneIndex, '--control-plane must be checked before the Supabase client is constructed');
  assert.doesNotMatch(source, /execSync|spawnSync|git\s+rev-parse/);
});

test('reanalysis worker runner: --control-plane is observed from AGT002_DEPLOYED_GIT_SHA, needs no Supabase secret, exactly one JSON line, exit 0', () => {
  const result = runControlPlaneScript(REANALYSIS_RUNNER, { AGT002_DEPLOYED_GIT_SHA: 'reanalysis-deployed-sha' });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'reanalysis_worker');
  assert.equal(payload.sha, 'reanalysis-deployed-sha');
  assert.equal(payload.source, 'reanalysis_worker_release_sha');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('reanalysis worker runner: --control-plane is unobserved with no AGT002_DEPLOYED_GIT_SHA, still needs no Supabase secret, exit 0', () => {
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

const WORKBENCH_SCRIPT = new URL('../ops/agt002-workbench-scheduler/run-agt002-workbench-worker.sh', import.meta.url).pathname;

function runWorkbenchScript(args, env) {
  return spawnSync('bash', [WORKBENCH_SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

test('workbench worker script: --control-plane is gated before the worker secret/URL requirement and before curl', () => {
  const source = readFileSync(WORKBENCH_SCRIPT, 'utf8');
  const controlPlaneIndex = source.indexOf('--control-plane');
  const secretIndex = source.indexOf('AGT002_WORKBENCH_WORKER_URL:?');
  const curlIndex = source.indexOf('exec curl');
  assert.ok(controlPlaneIndex >= 0, '--control-plane check must be present');
  assert.ok(secretIndex > controlPlaneIndex, '--control-plane must precede the required-secret check');
  assert.ok(curlIndex > secretIndex, 'the network call must remain after the secret check');
});

test('workbench worker script: --control-plane is observed from explicit env, needs no worker secret, exactly one JSON line, exit 0', () => {
  const result = runWorkbenchScript(['--control-plane'], {
    AGT002_DEPLOYED_GIT_SHA: 'workbench-deployed-sha',
    AGT002_DEPLOYED_VERSION: 'v1.2.3',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, 'workbench-deployed-sha');
  assert.equal(payload.version, 'v1.2.3');
  assert.equal(payload.source, 'workbench_scheduler_deployed_git_sha');
  assert.match(payload.observed_at_utc, ISO_UTC);
});

test('workbench worker script: --control-plane is unobserved with no explicit env, needs no worker secret, exit 0', () => {
  const result = runWorkbenchScript(['--control-plane'], {});
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.surface, 'workbench_scheduler');
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
});

test('workbench worker script: an unsafe/injecting sha collapses to unobserved instead of emitting broken JSON', () => {
  const injected = '"};echo pwned;{"x":"';
  const result = runWorkbenchScript(['--control-plane'], {
    AGT002_DEPLOYED_GIT_SHA: injected,
    AGT002_DEPLOYED_VERSION: injected,
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, null);
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'unobserved');
});

test('workbench worker script: a valid sha with an unsafe version keeps sha observed and nulls only the version', () => {
  const result = runWorkbenchScript(['--control-plane'], {
    AGT002_DEPLOYED_GIT_SHA: 'cafebabe',
    AGT002_DEPLOYED_VERSION: 'not a safe token!',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = soleJsonLine(result.stdout);
  assert.equal(payload.sha, 'cafebabe');
  assert.equal(payload.version, null);
  assert.equal(payload.source, 'workbench_scheduler_deployed_git_sha');
});

test('workbench worker script: normal mode (no --control-plane) is unchanged and still requires the worker URL/secret env vars', () => {
  const result = runWorkbenchScript([], {});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AGT002_WORKBENCH_WORKER_URL/);
});
