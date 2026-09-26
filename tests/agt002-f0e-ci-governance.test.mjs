import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW_PATH = new URL('../.github/workflows/agt002-control-plane.yml', import.meta.url);

const RELEASE_RECEIPT_MODULE_SPECIFIER = '../scripts/agt002-generate-release-receipt.mjs';
const DRIFT_MODULE_SPECIFIER = '../scripts/agt002-check-drift.mjs';

test('agt002-control-plane.yml workflow file exists', () => {
  assert.ok(
    existsSync(fileURLToPath(WORKFLOW_PATH)),
    `expected ${REPO_ROOT}.github/workflows/agt002-control-plane.yml to exist`,
  );
});

test('workflow triggers on pull_request and push to main', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflowText, /pull_request/);
  assert.match(workflowText, /push/);
  assert.match(workflowText, /main/);
});

test('workflow declares the required AGT-002 F0-E governance jobs', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const jobName of [
    'f0_suite',
    'backend_parity',
    'production_build',
    'migration_static',
    'grants_security',
    'release_receipt',
  ]) {
    assert.match(
      workflowText,
      new RegExp(jobName),
      `expected workflow to reference job ${jobName}`,
    );
  }
});

test('workflow does not reference raw secrets.* interpolation', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.doesNotMatch(workflowText, /secrets\./);
});

test('package.json declares the AGT-002 F0-E governance scripts', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const scripts = packageJson.scripts ?? {};
  for (const scriptName of [
    'test:agt002-f0',
    'check:agt002-grants',
    'agt002:release-receipt',
    'check:agt002-drift',
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(scripts, scriptName),
      `expected package.json scripts to declare ${scriptName}`,
    );
  }
});

test('workflow declares a drift_alert job', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflowText, /drift_alert:/);
});

test('drift_alert job downloads the agt002-release-receipt artifact', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /actions\/download-artifact/);
  assert.match(driftAlertSection, /name:\s*agt002-release-receipt/);
});

test('drift_alert job runs check:agt002-drift with --receipt agt002-release-receipt.json', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /check:agt002-drift.*--receipt\s+agt002-release-receipt\.json/);
});

test('generateAgt002ReleaseReceipt sets origin_main from an explicit git_sha', async () => {
  const { generateAgt002ReleaseReceipt } = await import(RELEASE_RECEIPT_MODULE_SPECIFIER);
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });

  assert.equal(receipt.surfaces.origin_main.sha, 'abc123');
  assert.equal(receipt.surfaces.origin_main.source, 'github_sha');
  assert.equal(receipt.control_plane_reconciled, false);

  for (const surface of [
    'vercel_production',
    'bridge',
    'radar_pipeline',
    'reanalysis_worker',
    'workbench_scheduler',
  ]) {
    assert.equal(receipt.surfaces[surface].sha, null);
    assert.equal(receipt.surfaces[surface].source, 'unobserved');
  }
});

test('generateAgt002ReleaseReceipt keeps origin_main unobserved with no git_sha and no GITHUB_SHA', async () => {
  const { generateAgt002ReleaseReceipt } = await import(RELEASE_RECEIPT_MODULE_SPECIFIER);
  const previousGithubSha = process.env.GITHUB_SHA;
  delete process.env.GITHUB_SHA;
  try {
    const receipt = generateAgt002ReleaseReceipt();
    assert.equal(receipt.surfaces.origin_main.sha, null);
    assert.equal(receipt.surfaces.origin_main.source, 'unobserved');
  } finally {
    if (previousGithubSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = previousGithubSha;
    }
  }
});

test('checkAgt002Drift reports a drift when origin_main SHAs differ', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { surfaces: { origin_main: { sha: 'abc123', source: 'github_sha' } } };
  const observed = { surfaces: { origin_main: { sha: 'def456' } } };

  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
  assert.equal(result.drifts.length, 1);
  assert.equal(result.drifts[0].surface, 'origin_main');
});

test('checkAgt002Drift reports ok:true when origin_main SHAs match', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { surfaces: { origin_main: { sha: 'abc123', source: 'github_sha' } } };
  const observed = { surfaces: { origin_main: { sha: 'abc123' } } };

  const result = checkAgt002Drift({ receipt, observed });
  assert.deepEqual(result, { ok: true, drifts: [] });
});

test('checkAgt002Drift fails when receipt.control_plane_reconciled is true', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { control_plane_reconciled: true, surfaces: {} };
  const observed = { surfaces: {} };

  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
});

test('drift_alert job writes observed surfaces and runs check:agt002-drift with --receipt and --observed', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /agt002-observed-surfaces\.json/);
  assert.match(
    driftAlertSection,
    /check:agt002-drift.*--receipt\s+agt002-release-receipt\.json\s+--observed\s+agt002-observed-surfaces\.json/,
  );
});

test('checkAgt002Drift returns ok:false when GITHUB_SHA differs from receipt origin_main sha, even with no observed origin_main', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const previousGithubSha = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = 'ci-actual-sha';
  try {
    const receipt = { surfaces: { origin_main: { sha: 'receipt-recorded-sha', source: 'github_sha' } } };

    const resultWithMissingObserved = checkAgt002Drift({ receipt, observed: undefined });
    assert.equal(resultWithMissingObserved.ok, false);
    assert.ok(resultWithMissingObserved.drifts.some((drift) => drift.surface === 'origin_main'));

    const resultWithEmptyObserved = checkAgt002Drift({ receipt, observed: { surfaces: {} } });
    assert.equal(resultWithEmptyObserved.ok, false);
    assert.ok(resultWithEmptyObserved.drifts.some((drift) => drift.surface === 'origin_main'));
  } finally {
    if (previousGithubSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = previousGithubSha;
    }
  }
});

test('checkAgt002Drift returns ok:true when GITHUB_SHA matches receipt origin_main sha', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const previousGithubSha = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = 'matching-sha';
  try {
    const receipt = {
      control_plane_reconciled: false,
      surfaces: { origin_main: { sha: 'matching-sha', source: 'github_sha' } },
    };

    const result = checkAgt002Drift({ receipt, observed: undefined });
    assert.deepEqual(result, { ok: true, drifts: [] });
  } finally {
    if (previousGithubSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = previousGithubSha;
    }
  }
});
