import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW_PATH = new URL('../.github/workflows/agt002-control-plane.yml', import.meta.url);

const WATCHED_SURFACES = [
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
];

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

  for (const surface of WATCHED_SURFACES.filter((name) => name !== 'origin_main')) {
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

function fullyObservedSurfaces(sha, version) {
  const surfaces = {};
  for (const surface of WATCHED_SURFACES) {
    surfaces[surface] = { sha, version, source: `${surface}_test_source` };
  }
  return { surfaces };
}

test('checkAgt002Drift reports ok:true when every watched surface has a non-empty sha+version matching receipt.desired', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { desired: { sha: 'abc123', version: '1.2.3' } };
  const observed = fullyObservedSurfaces('abc123', '1.2.3');

  const result = checkAgt002Drift({ receipt, observed });
  assert.deepEqual(result, { ok: true, issues: [], warnings: [] });
});

test('checkAgt002Drift fails closed when a surface is entirely missing from observed', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { desired: { sha: 'abc123', version: '1.2.3' } };
  const observed = fullyObservedSurfaces('abc123', '1.2.3');
  delete observed.surfaces.bridge;

  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [{ type: 'unobserved', surface: 'bridge', observation_status: 'not_configured' }]);
  assert.deepEqual(result.warnings, []);
});

test('checkAgt002Drift distinguishes missing sha, missing version, sha mismatch, and version mismatch', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { desired: { sha: 'abc123', version: '1.2.3' } };
  const observed = fullyObservedSurfaces('abc123', '1.2.3');
  observed.surfaces.radar_daily_scan = { sha: null, version: '1.2.3', source: 'unobserved' };
  observed.surfaces.initial_analysis_worker = { sha: 'abc123', version: null, source: 'agt002_host_surface_systemd_unit_observed' };
  observed.surfaces.vercel_production = { sha: 'def456', version: '1.2.3', source: 'vercel_git_commit_sha' };
  observed.surfaces.radar_daily_top5 = { sha: 'abc123', version: '9.9.9', source: 'agt002_host_surface_systemd_unit_observed' };

  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'unobserved' && issue.surface === 'radar_daily_scan'));
  assert.ok(
    result.issues.some((issue) => issue.type === 'missing_observed_version' && issue.surface === 'initial_analysis_worker'),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.type === 'sha_mismatch' && issue.surface === 'vercel_production' && issue.observed_sha === 'def456',
    ),
  );
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.type === 'version_mismatch' && issue.surface === 'radar_daily_top5' && issue.observed_version === '9.9.9',
    ),
  );
});

test('checkAgt002Drift fails closed when receipt.desired is missing sha or version, even with all six surfaces observed', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const observed = fullyObservedSurfaces('abc123', '1.2.3');

  const missingVersion = checkAgt002Drift({ receipt: { desired: { sha: 'abc123', version: null } }, observed });
  assert.equal(missingVersion.ok, false);
  assert.ok(missingVersion.issues.some((issue) => issue.type === 'missing_desired_version'));

  const missingEverything = checkAgt002Drift({ receipt: {}, observed });
  assert.equal(missingEverything.ok, false);
  assert.ok(missingEverything.issues.some((issue) => issue.type === 'missing_desired_sha'));
  assert.ok(missingEverything.issues.some((issue) => issue.type === 'missing_desired_version'));
});

test('checkAgt002Drift fails when receipt.control_plane_reconciled is true, even with a fully matching observation', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const receipt = { control_plane_reconciled: true, desired: { sha: 'abc123', version: '1.2.3' } };
  const observed = fullyObservedSurfaces('abc123', '1.2.3');

  const result = checkAgt002Drift({ receipt, observed });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'control_plane_reconciled_true'));
});

test('checkAgt002Drift fails closed with no receipt/observed at all, and reports every surface unobserved', async () => {
  const { checkAgt002Drift } = await import(DRIFT_MODULE_SPECIFIER);
  const result = checkAgt002Drift({});
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.type === 'missing_desired_sha'));
  assert.deepEqual(
    result.issues.filter((issue) => issue.type === 'unobserved').map((issue) => issue.surface),
    WATCHED_SURFACES,
  );
  assert.deepEqual(result.warnings, []);
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

test('workflow triggers hourly on a schedule and supports manual workflow_dispatch', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(workflowText, /schedule:/);
  assert.match(workflowText, /cron:\s*'[^']+'/);
  assert.match(workflowText, /workflow_dispatch:/);
});

test('drift_alert job never uses a heredoc to fabricate observed surfaces', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.doesNotMatch(driftAlertSection, /<<\s*['"]?EOF/);
  assert.match(driftAlertSection, /agt002:observe-surfaces/);
});

test('drift_alert job collects origin_main, vercel_production and bridge through explicit configured env inputs (host jobs ride on the bridge URL)', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  for (const prefix of ['AGT002_OBSERVE_ORIGIN_MAIN', 'AGT002_OBSERVE_VERCEL_PRODUCTION', 'AGT002_OBSERVE_BRIDGE']) {
    assert.match(driftAlertSection, new RegExp(prefix), `expected drift_alert to configure ${prefix}`);
  }
});

test('workflow no longer observes the retired radar_pipeline, reanalysis_worker, or workbench_scheduler surfaces', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const retiredVar of [
    'AGT002_OBSERVE_RADAR_PIPELINE',
    'AGT002_OBSERVE_REANALYSIS_WORKER',
    'AGT002_OBSERVE_WORKBENCH_SCHEDULER',
    'AGT002_RADAR_PIPELINE_CONTROL_PLANE_URL',
    'AGT002_REANALYSIS_WORKER_CONTROL_PLANE_URL',
    'AGT002_WORKBENCH_SCHEDULER_CONTROL_PLANE_URL',
  ]) {
    assert.doesNotMatch(workflowText, new RegExp(retiredVar), `expected workflow to no longer reference ${retiredVar}`);
  }
});

test('release_receipt and drift_alert check out the full git history for per-surface last-change and ancestry checks', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const releaseReceiptSection = workflowText.slice(
    workflowText.indexOf('release_receipt:'),
    workflowText.indexOf('drift_alert:'),
  );
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(releaseReceiptSection, /actions\/checkout@v4\s*\n\s*with:\s*\n\s*fetch-depth:\s*0/);
  assert.match(driftAlertSection, /actions\/checkout@v4\s*\n\s*with:\s*\n\s*fetch-depth:\s*0/);
});

test('drift_alert job always uploads the structured drift result artifact, even when drift is detected', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /continue-on-error:\s*true/);
  assert.match(driftAlertSection, /if:\s*always\(\)/);
  assert.match(driftAlertSection, /name:\s*agt002-drift-result/);
  assert.match(driftAlertSection, /agt002-drift-result\.json/);
});

test('drift_alert job fails the job when drift is detected, after uploading the artifact', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  const uploadIndex = driftAlertSection.indexOf('agt002-drift-result');
  const failIndex = driftAlertSection.search(/if:\s*steps\.drift\.outcome\s*==\s*'failure'/);
  assert.ok(failIndex >= 0, 'expected a step that fails the job on steps.drift.outcome == failure');
  assert.ok(uploadIndex >= 0 && uploadIndex < failIndex, 'the artifact upload must precede the fail step');
});

// --- PR deadlock fix: drift must target the PR base sha, never the synthetic merge sha ---

test('workflow defines a shared AGT002_DESIRED_SHA: PR base sha on pull_request, github.sha otherwise', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.match(
    workflowText,
    /AGT002_DESIRED_SHA:\s*\$\{\{\s*github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha \|\| github\.sha\s*\}\}/,
  );
});

test('release_receipt job binds --git-sha to the shared AGT002_DESIRED_SHA, not github.sha directly', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const releaseReceiptSection = workflowText.slice(
    workflowText.indexOf('release_receipt:'),
    workflowText.indexOf('drift_alert:'),
  );
  assert.match(
    releaseReceiptSection,
    /agt002:release-receipt.*--git-sha\s+"\$\{\{\s*env\.AGT002_DESIRED_SHA\s*\}\}"/,
  );
  assert.doesNotMatch(releaseReceiptSection, /--git-sha\s+"\$\{\{\s*github\.sha\s*\}\}"/);
});

test('drift_alert job binds both --desired-sha and --git-sha to the shared AGT002_DESIRED_SHA', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /--desired-sha\s+"\$\{\{\s*env\.AGT002_DESIRED_SHA\s*\}\}"/);
  assert.match(driftAlertSection, /--git-sha\s+"\$\{\{\s*env\.AGT002_DESIRED_SHA\s*\}\}"/);
  assert.doesNotMatch(driftAlertSection, /--desired-sha\s+"\$\{\{\s*github\.sha\s*\}\}"/);
});

test('drift_alert job no longer hardcodes origin_main sha to github.sha via a separate env var', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.doesNotMatch(driftAlertSection, /AGT002_OBSERVE_ORIGIN_MAIN_SHA/);
});

// --- fake host observation fix: deployed-sha/version vars are configuration, not live self-report ---

test('workflow no longer configures static deployed sha/version vars for radar_pipeline, reanalysis_worker, or workbench_scheduler', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const staticVar of [
    'AGT002_RADAR_PIPELINE_DEPLOYED_SHA',
    'AGT002_RADAR_PIPELINE_DEPLOYED_VERSION',
    'AGT002_REANALYSIS_WORKER_DEPLOYED_SHA',
    'AGT002_REANALYSIS_WORKER_DEPLOYED_VERSION',
    'AGT002_WORKBENCH_SCHEDULER_DEPLOYED_SHA',
    'AGT002_WORKBENCH_SCHEDULER_DEPLOYED_VERSION',
  ]) {
    assert.doesNotMatch(workflowText, new RegExp(staticVar), `expected workflow to no longer reference ${staticVar}`);
  }
});

test('drift_alert job configures a read-only URL contract for vercel_production and the bridge', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  for (const urlEnvVar of ['AGT002_OBSERVE_VERCEL_PRODUCTION_URL', 'AGT002_OBSERVE_BRIDGE_URL']) {
    assert.match(driftAlertSection, new RegExp(urlEnvVar), `expected drift_alert to configure ${urlEnvVar}`);
  }
});

// --- cost/efficiency fix: schedule must not rerun build/full suites ---

test('quality jobs are skipped on schedule so the hourly run does not rerun build/full suites', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  for (const jobName of ['f0_suite', 'backend_parity', 'production_build', 'migration_static', 'grants_security']) {
    const jobStart = workflowText.indexOf(`\n  ${jobName}:`);
    assert.ok(jobStart >= 0, `expected to find job ${jobName}`);
    const jobSection = workflowText.slice(jobStart, jobStart + 500);
    assert.match(
      jobSection,
      /if:\s*github\.event_name != 'schedule'/,
      `expected ${jobName} to skip on schedule`,
    );
  }
});

test('release_receipt job runs on schedule despite skipped quality-job needs, via an explicit always() condition', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const releaseReceiptSection = workflowText.slice(
    workflowText.indexOf('release_receipt:'),
    workflowText.indexOf('drift_alert:'),
  );
  assert.match(releaseReceiptSection, /if:\s*>/);
  assert.match(releaseReceiptSection, /always\(\)/);
  assert.match(releaseReceiptSection, /github\.event_name == 'schedule'/);
});

test('release_receipt job requires every quality job to succeed on non-schedule events', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const releaseReceiptSection = workflowText.slice(
    workflowText.indexOf('release_receipt:'),
    workflowText.indexOf('drift_alert:'),
  );
  for (const jobName of ['f0_suite', 'backend_parity', 'production_build', 'migration_static', 'grants_security']) {
    assert.match(releaseReceiptSection, new RegExp(`needs\\.${jobName}\\.result == 'success'`));
  }
});

test('drift_alert still needs release_receipt so it runs after it, including on schedule', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.match(driftAlertSection, /needs:\s*\n\s*-\s*release_receipt/);
});

// --- PR bootstrap deadlock fix: pull_request runs an offline detector-contract test instead of
// pretending to observe/produce a production drift result, since no live URLs are configured yet ---

test('drift_alert job runs the offline drift-detection test file only on pull_request', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  const offlineStepIndex = driftAlertSection.search(
    /if:\s*github\.event_name == 'pull_request'\s*\n\s*run:\s*node --test tests\/agt002-f0-drift-detection\.test\.mjs/,
  );
  assert.ok(offlineStepIndex >= 0, 'expected a pull_request-gated step running the offline drift-detection test file');
});

// --- fail-closed fix: drift_alert must not run on a failed/skipped release_receipt ---

test('drift_alert job declares a job-level fail-closed if requiring release_receipt to succeed', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertStart = workflowText.indexOf('\n  drift_alert:');
  assert.ok(driftAlertStart >= 0, 'expected to find the drift_alert job');
  const stepsIndex = workflowText.indexOf('\n    steps:', driftAlertStart);
  assert.ok(stepsIndex >= 0, 'expected drift_alert to declare steps:');
  const driftAlertJobHeader = workflowText.slice(driftAlertStart, stepsIndex);

  assert.match(
    driftAlertJobHeader,
    /if:\s*always\(\)\s*&&\s*needs\.release_receipt\.result == 'success'/,
    'expected a job-level if: always() && needs.release_receipt.result == \'success\' on drift_alert',
  );
});

test('drift_alert job-level condition gates only on release_receipt, not on the quality jobs directly, so it still runs on schedule when they are skipped', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertStart = workflowText.indexOf('\n  drift_alert:');
  const stepsIndex = workflowText.indexOf('\n    steps:', driftAlertStart);
  const driftAlertJobHeader = workflowText.slice(driftAlertStart, stepsIndex);

  for (const qualityJob of ['f0_suite', 'backend_parity', 'production_build', 'migration_static', 'grants_security']) {
    assert.doesNotMatch(
      driftAlertJobHeader,
      new RegExp(`needs\\.${qualityJob}\\.result`),
      `drift_alert's own if must not reference needs.${qualityJob}.result -- release_receipt's if already encodes that`,
    );
  }
});

test('drift_alert live-observation steps are gated off on pull_request', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  const stepStarts = [
    { name: 'download-artifact', re: /uses:\s*actions\/download-artifact@v4\s*\n\s*if:\s*github\.event_name != 'pull_request'/ },
    { name: 'Collect observed surfaces', re: /name:\s*Collect observed surfaces\s*\n\s*if:\s*github\.event_name != 'pull_request'/ },
    { name: 'Check drift', re: /name:\s*Check drift\s*\n\s*if:\s*github\.event_name != 'pull_request'/ },
  ];
  for (const step of stepStarts) {
    assert.match(driftAlertSection, step.re, `expected ${step.name} to be gated off on pull_request`);
  }
  assert.match(driftAlertSection, /if:\s*always\(\)\s*&&\s*github\.event_name != 'pull_request'/, 'expected Upload drift result gated off on pull_request');
  assert.match(
    driftAlertSection,
    /if:\s*steps\.drift\.outcome == 'failure'\s*&&\s*github\.event_name != 'pull_request'/,
    'expected Fail on drift gated off on pull_request',
  );
});

test('drift_alert job never claims a production drift result on pull_request: Check drift/Fail on drift only run for non-PR events', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  assert.doesNotMatch(
    driftAlertSection.slice(0, driftAlertSection.search(/name:\s*Collect observed surfaces/)),
    /run:\s*corepack pnpm run check:agt002-drift/,
    'check:agt002-drift must not run before the pull_request gate',
  );
});

test('drift_alert job-level fail-closed if does not disturb the real collect-observed-surfaces -> check:agt002-drift -> upload -> fail-on-drift step pipeline', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('\n  drift_alert:'));

  const collectIndex = driftAlertSection.search(/name:\s*Collect observed surfaces/);
  const checkIndex = driftAlertSection.search(/name:\s*Check drift/);
  const uploadIndex = driftAlertSection.search(/name:\s*Upload drift result/);
  const failIndex = driftAlertSection.search(/name:\s*Fail on drift/);

  assert.ok(collectIndex >= 0 && checkIndex > collectIndex, 'Collect observed surfaces must precede Check drift');
  assert.ok(checkIndex >= 0 && uploadIndex > checkIndex, 'Check drift must precede Upload drift result');
  assert.ok(uploadIndex >= 0 && failIndex > uploadIndex, 'Upload drift result must precede Fail on drift');

  const collectSection = driftAlertSection.slice(collectIndex, checkIndex);
  assert.match(collectSection, /run:\s*corepack pnpm run agt002:observe-surfaces/);
  const checkSection = driftAlertSection.slice(checkIndex, uploadIndex);
  assert.match(
    checkSection,
    /run:\s*corepack pnpm run check:agt002-drift.*--receipt\s+agt002-release-receipt\.json\s+--observed\s+agt002-observed-surfaces\.json/,
  );
  const failSection = driftAlertSection.slice(failIndex);
  assert.match(failSection, /run:\s*exit 1/);
});

// --- f0_suite must actually execute the migration/rollback behavioral test, not just declare it ---

test('f0_suite job runs the users-security-095 pglite migration/rollback integration test', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const f0SuiteStart = workflowText.indexOf('\n  f0_suite:');
  assert.ok(f0SuiteStart >= 0, 'expected to find the f0_suite job');
  const nextJobIndex = workflowText.indexOf('\n  backend_parity:');
  assert.ok(nextJobIndex > f0SuiteStart, 'expected backend_parity job to follow f0_suite');
  const f0SuiteSection = workflowText.slice(f0SuiteStart, nextJobIndex);

  const runLineMatch = f0SuiteSection.match(/run:\s*node --test [^\n]+/);
  assert.ok(runLineMatch, 'expected f0_suite to declare a node --test run line');
  assert.match(
    runLineMatch[0],
    /tests\/agt002-f0-users-security-095-pglite\.integration\.test\.mjs\b/,
    'expected f0_suite\'s node --test command to include tests/agt002-f0-users-security-095-pglite.integration.test.mjs so GitHub actually executes it',
  );
});

// --- release receipt migration manifest fix: 095 was merged but omitted from receipt.migrations ---

const REQUIRED_MIGRATIONS = [
  { name: '092_agt002_f0b_chat_query_revoke.sql' },
  { name: '094_agt002_f0b2_rpc_hardening.sql' },
  { name: '095_agt002_f0_users_security.sql' },
];

function sha256OfRepoFile(relativePath) {
  const bytes = readFileSync(new URL(`../supabase/migrations/${relativePath}`, import.meta.url));
  return createHash('sha256').update(bytes).digest('hex');
}

test('supabase/migrations/095_agt002_f0_users_security.sql exists as an explicit immutable receipt input', () => {
  assert.ok(
    existsSync(fileURLToPath(new URL('../supabase/migrations/095_agt002_f0_users_security.sql', import.meta.url))),
    'expected supabase/migrations/095_agt002_f0_users_security.sql to exist',
  );
});

test('generateAgt002ReleaseReceipt includes exact SHA-256 entries for migrations 092, 094, and 095', async () => {
  const { generateAgt002ReleaseReceipt } = await import(RELEASE_RECEIPT_MODULE_SPECIFIER);
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });

  assert.ok(receipt.migrations, 'expected receipt.migrations to be present');
  for (const { name } of REQUIRED_MIGRATIONS) {
    const expectedSha256 = sha256OfRepoFile(name);
    assert.equal(
      receipt.migrations[name]?.sha256,
      expectedSha256,
      `expected receipt.migrations[${name}].sha256 to match the independently computed file hash`,
    );
  }
});

test('generateAgt002ReleaseReceipt.migrations contains exactly the required canonical entries, nothing more or less', async () => {
  const { generateAgt002ReleaseReceipt } = await import(RELEASE_RECEIPT_MODULE_SPECIFIER);
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });

  const expectedKeys = REQUIRED_MIGRATIONS.map(({ name }) => name).sort();
  const actualKeys = Object.keys(receipt.migrations).sort();
  assert.deepEqual(actualKeys, expectedKeys);
});

test('generateAgt002ReleaseReceipt preserves control_plane_reconciled=false alongside the completed migration manifest', async () => {
  const { generateAgt002ReleaseReceipt } = await import(RELEASE_RECEIPT_MODULE_SPECIFIER);
  const receipt = generateAgt002ReleaseReceipt({ git_sha: 'abc123' });

  assert.equal(receipt.control_plane_reconciled, false);
  assert.ok(receipt.migrations);
});

// --- stop trusting the manually maintained AGT002_DESIRED_VERSION repo variable: derive it
// from the validated desired sha instead ---

test('workflow no longer trusts the manually maintained AGT002_DESIRED_VERSION repository variable', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  assert.doesNotMatch(workflowText, /vars\.AGT002_DESIRED_VERSION/);
});

test('release_receipt and drift_alert jobs each validate AGT002_DESIRED_SHA as full lowercase 40-hex before deriving AGT002_DESIRED_VERSION=f0-<first 7 chars>', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const releaseReceiptSection = workflowText.slice(
    workflowText.indexOf('release_receipt:'),
    workflowText.indexOf('drift_alert:'),
  );
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));

  for (const section of [releaseReceiptSection, driftAlertSection]) {
    assert.match(section, /\^\[0-9a-f\]\{40\}\$/, 'expected a full lowercase 40-hex validation regex');
    assert.match(section, /AGT002_DESIRED_VERSION=f0-\$\{sha:0:7\}/, 'expected desired version to be derived as f0-<first 7 chars>');
    assert.match(section, />>\s*"\$GITHUB_ENV"/, 'expected the derived version to be exported via GITHUB_ENV');
  }

  assert.match(releaseReceiptSection, /--version\s+"\$AGT002_DESIRED_VERSION"/);
  assert.doesNotMatch(releaseReceiptSection, /--version\s+"\$\{\{\s*env\.AGT002_DESIRED_VERSION\s*\}\}"/);
  assert.match(driftAlertSection, /--desired-version\s+"\$AGT002_DESIRED_VERSION"/);
  assert.doesNotMatch(driftAlertSection, /--desired-version\s+"\$\{\{\s*env\.AGT002_DESIRED_VERSION\s*\}\}"/);
  assert.doesNotMatch(releaseReceiptSection, /AGT002_OBSERVE_ORIGIN_MAIN_VERSION/);
  assert.match(driftAlertSection, /AGT002_OBSERVE_ORIGIN_MAIN_VERSION=f0-\$\{sha:0:7\}/, 'expected origin_main.version to be derived alongside AGT002_DESIRED_VERSION');
});

test('drift_alert job derives AGT002_DESIRED_VERSION only off pull_request, before Collect observed surfaces', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  const deriveIndex = driftAlertSection.search(
    /name:\s*Derive desired version from desired sha\s*\n\s*if:\s*github\.event_name != 'pull_request'/,
  );
  const collectIndex = driftAlertSection.search(/name:\s*Collect observed surfaces/);
  assert.ok(deriveIndex >= 0, 'expected a pull_request-gated Derive desired version step');
  assert.ok(collectIndex > deriveIndex, 'Derive desired version must precede Collect observed surfaces');
});

test('drift_alert job retains the full live six-surface path unconditionally on push/schedule/workflow_dispatch (only pull_request is excluded)', () => {
  const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');
  const driftAlertSection = workflowText.slice(workflowText.indexOf('drift_alert:'));
  for (const marker of [
    "if: github.event_name != 'pull_request'",
    "if: always() && github.event_name != 'pull_request'",
    "if: steps.drift.outcome == 'failure' && github.event_name != 'pull_request'",
  ]) {
    assert.ok(driftAlertSection.includes(marker), `expected exact gate "${marker}"`);
    assert.doesNotMatch(
      marker,
      /schedule|workflow_dispatch|push/,
      'the live path must only exclude pull_request, never push/schedule/workflow_dispatch',
    );
  }
});
