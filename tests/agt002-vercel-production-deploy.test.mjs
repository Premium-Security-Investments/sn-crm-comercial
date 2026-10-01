import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Exercises scripts/agt002-deploy-vercel-production.sh end to end against temporary git
// repos and mock `curl`/`vercel` commands on PATH. No real network call is ever made: the
// control-plane URL is a dummy string the mock `curl` ignores entirely.

const SCRIPT = path.join(process.cwd(), 'scripts', 'agt002-deploy-vercel-production.sh');
const CONTROL_PLANE_URL = 'http://agt002-control-plane.invalid/status';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  assert.equal(result.status, 0, `${cmd} ${args.join(' ')} failed: ${result.stderr}`);
  return result;
}

function initGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'agt002-deploy-repo-'));
  run('git', ['init', '-q', dir]);
  run('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  run('git', ['-C', dir, 'config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'file.txt'), 'hello\n');
  run('git', ['-C', dir, 'add', '.']);
  run('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  const sha = run('git', ['-C', dir, 'rev-parse', 'HEAD']).stdout.trim();
  // No real remote is fetched (no network in tests); the origin/main tracking ref is
  // pointed at HEAD directly, which is exactly what a real `git fetch` would leave behind.
  run('git', ['-C', dir, 'update-ref', 'refs/remotes/origin/main', sha]);
  return { dir, sha, version: `f0-${sha.slice(0, 7)}` };
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function writeMockBin({ curlResponses, vercelExitCode = 0 } = {}) {
  const binDir = mkdtempSync(path.join(tmpdir(), 'agt002-deploy-bin-'));
  const responsesDir = path.join(binDir, 'curl-responses');
  mkdirSync(responsesDir);
  (curlResponses ?? []).forEach((body, index) => {
    writeFileSync(path.join(responsesDir, `${index + 1}.json`), body);
  });

  writeExecutable(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
echo called >> "$MOCK_CURL_CALL_LOG"
count=$(wc -l < "$MOCK_CURL_CALL_LOG")
dir="$MOCK_CURL_RESPONSES_DIR"
file="$dir/$count.json"
if [ ! -f "$file" ]; then
  # Sticky: once past the last scripted response, keep repeating it (simulates a
  # control plane that never changes again, e.g. a deploy that never lands).
  file="$dir/$(ls "$dir" | sort -t. -k1,1n | tail -1)"
fi
cat "$file"
`,
  );

  writeExecutable(
    path.join(binDir, 'vercel'),
    `#!/usr/bin/env bash
set -euo pipefail
echo called >> "$MOCK_VERCEL_CALL_LOG"
printf '%s\\n' "$*" >> "$MOCK_VERCEL_ARGS_LOG"
pwd >> "$MOCK_VERCEL_PWD_LOG"
exit ${vercelExitCode}
`,
  );

  return { binDir, responsesDir };
}

function countLines(filePath) {
  const result = spawnSync('bash', ['-c', `[ -f "$1" ] && wc -l < "$1" || echo 0`, '_', filePath], {
    encoding: 'utf8',
  });
  return parseInt(result.stdout.trim(), 10);
}

function readFileOr(filePath, fallback) {
  const result = spawnSync('bash', ['-c', `[ -f "$1" ] && cat "$1" || true`, '_', filePath], {
    encoding: 'utf8',
  });
  return result.stdout || fallback;
}

function runDeployScript({ repoDir, binDir, lockPath, pollAttempts = '3', env = {} }) {
  const callLogDir = mkdtempSync(path.join(tmpdir(), 'agt002-deploy-logs-'));
  const mockCurlCallLog = path.join(callLogDir, 'curl-calls.log');
  const mockVercelCallLog = path.join(callLogDir, 'vercel-calls.log');
  const mockVercelArgsLog = path.join(callLogDir, 'vercel-args.log');
  const mockVercelPwdLog = path.join(callLogDir, 'vercel-pwd.log');

  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      AGT002_DEPLOY_REPO_DIR: repoDir,
      AGT002_DEPLOY_LOCK_PATH: lockPath,
      // These fixture repos have no real `origin` remote configured (refs/remotes/origin/main is
      // pointed at HEAD by hand instead), so a real `git fetch origin main` would fail with no
      // network access anyway. Skip it explicitly rather than relying on that failure.
      AGT002_DEPLOY_SKIP_FETCH: '1',
      AGT002_VERCEL_PRODUCTION_CONTROL_PLANE_URL: CONTROL_PLANE_URL,
      AGT002_DEPLOY_POLL_ATTEMPTS: pollAttempts,
      AGT002_DEPLOY_POLL_INTERVAL_SECONDS: '0',
      MOCK_CURL_CALL_LOG: mockCurlCallLog,
      MOCK_CURL_RESPONSES_DIR: path.join(binDir, 'curl-responses'),
      MOCK_VERCEL_CALL_LOG: mockVercelCallLog,
      MOCK_VERCEL_ARGS_LOG: mockVercelArgsLog,
      MOCK_VERCEL_PWD_LOG: mockVercelPwdLog,
      ...env,
    },
  });

  return {
    result,
    curlCallCount: countLines(mockCurlCallLog),
    vercelCallCount: countLines(mockVercelCallLog),
    vercelArgs: readFileOr(mockVercelArgsLog, ''),
    vercelPwd: readFileOr(mockVercelPwdLog, '').trim(),
  };
}

function tempLockPath() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'agt002-deploy-lock-')), 'deploy.lock');
}

const REAL_GIT_BIN = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

// A thin logging shim around the real `git` binary: every invocation's args are appended to
// MOCK_GIT_CALL_LOG before being forwarded on, so a test can assert whether (and when) `git
// fetch origin main` was actually invoked without faking git's own behavior.
function writeMockGitBin(binDir) {
  const mockGitPath = path.join(binDir, 'mock-git');
  writeExecutable(
    mockGitPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$MOCK_GIT_CALL_LOG"
exec "$REAL_GIT_BIN" "$@"
`,
  );
  return mockGitPath;
}

test('exact sha+version already live: exits 0 and never calls vercel', () => {
  const { dir, sha, version } = initGitRepo();
  const { binDir } = writeMockBin({
    curlResponses: [JSON.stringify({ sha, version })],
  });

  const { result, curlCallCount, vercelCallCount } = runDeployScript({
    repoDir: dir,
    binDir,
    lockPath: tempLockPath(),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(vercelCallCount, 0, 'vercel must not be invoked when already live at the exact sha+version');
  assert.equal(curlCallCount, 1, 'only the single pre-deploy check should be made');
});

test('mismatch: deploys exactly once and verifies an exact readback afterwards', () => {
  const { dir, sha, version } = initGitRepo();
  const staleBody = JSON.stringify({ sha: '0'.repeat(40), version: 'f0-0000000' });
  const freshBody = JSON.stringify({ sha, version });
  const { binDir } = writeMockBin({
    curlResponses: [staleBody, freshBody],
  });

  const secretValue = 'super-secret-token-must-not-leak';
  const cwdBeforeRun = realpathSync(process.cwd());
  const { result, curlCallCount, vercelCallCount, vercelArgs, vercelPwd } = runDeployScript({
    repoDir: dir,
    binDir,
    lockPath: tempLockPath(),
    env: { VERCEL_TOKEN: secretValue },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(vercelCallCount, 1, 'vercel must be invoked exactly once on a mismatch');
  assert.ok(curlCallCount >= 2, 'the pre-deploy check plus at least one post-deploy poll must happen');
  assert.ok(vercelArgs.includes(`AGT002_DEPLOYED_GIT_SHA=${sha}`), vercelArgs);
  assert.ok(vercelArgs.includes(`AGT002_DEPLOYED_VERSION=${version}`), vercelArgs);
  assert.ok(vercelArgs.includes('--prod'));
  assert.ok(vercelArgs.includes('--yes'));
  assert.equal(
    vercelPwd,
    realpathSync(dir),
    'vercel must be invoked with its cwd set to the verified AGT002_DEPLOY_REPO_DIR, not the caller\'s $PWD',
  );
  assert.equal(
    realpathSync(process.cwd()),
    cwdBeforeRun,
    "the parent test process's own cwd must remain the actual worktree, not the temporary repo dir",
  );
  assert.ok(!result.stdout.includes(secretValue), 'stdout must never include a secret value');
  assert.ok(!result.stderr.includes(secretValue), 'stderr must never include a secret value');
});

test('lock contention: a concurrent holder prevents the run, vercel is never invoked', async () => {
  const { dir } = initGitRepo();
  const { binDir } = writeMockBin({ curlResponses: [] });
  const lockPath = tempLockPath();

  const holder = spawn('flock', ['-n', lockPath, '-c', 'sleep 5'], { stdio: 'ignore' });
  try {
    // Give the holder a moment to actually acquire the lock before racing the script against it.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { result, curlCallCount, vercelCallCount } = runDeployScript({
      repoDir: dir,
      binDir,
      lockPath,
    });

    assert.notEqual(result.status, 0, 'the run must fail while the lock is held');
    assert.equal(vercelCallCount, 0, 'vercel must never be invoked when the lock is contended');
    assert.equal(curlCallCount, 0, 'the control plane must never be checked when the lock is contended');
  } finally {
    holder.kill('SIGKILL');
  }
});

test('failed readback: deploys once but fails when the control plane never reflects the new sha+version', () => {
  const { dir, sha, version } = initGitRepo();
  const staleBody = JSON.stringify({ sha: '0'.repeat(40), version: 'f0-0000000' });
  // Only one scripted response: the mock curl stays stuck on it forever (sticky fallback),
  // simulating a control plane that never picks up the new deploy.
  const { binDir } = writeMockBin({ curlResponses: [staleBody] });

  const { result, curlCallCount, vercelCallCount, vercelArgs } = runDeployScript({
    repoDir: dir,
    binDir,
    lockPath: tempLockPath(),
    pollAttempts: '3',
  });

  assert.notEqual(result.status, 0, 'the run must fail when readback never matches');
  assert.equal(vercelCallCount, 1, 'vercel must still have been invoked exactly once');
  assert.equal(curlCallCount, 4, 'one pre-deploy check plus three bounded post-deploy polls');
  assert.ok(vercelArgs.includes(`AGT002_DEPLOYED_GIT_SHA=${sha}`), vercelArgs);
  assert.ok(vercelArgs.includes(`AGT002_DEPLOYED_VERSION=${version}`), vercelArgs);
});

test('by default, fetches origin main before comparing HEAD against it', () => {
  const { dir, sha, version } = initGitRepo();
  const { binDir } = writeMockBin({ curlResponses: [JSON.stringify({ sha, version })] });
  const mockGitPath = writeMockGitBin(binDir);
  const gitCallLog = path.join(mkdtempSync(path.join(tmpdir(), 'agt002-deploy-git-log-')), 'git-calls.log');

  const { result } = runDeployScript({
    repoDir: dir,
    binDir,
    lockPath: tempLockPath(),
    env: {
      // These fixture repos have no real `origin` remote, so this deliberately does not skip
      // the fetch -- it only proves the script attempts it unconditionally by default.
      AGT002_DEPLOY_SKIP_FETCH: '0',
      AGT002_DEPLOY_GIT_BIN: mockGitPath,
      MOCK_GIT_CALL_LOG: gitCallLog,
      REAL_GIT_BIN,
    },
  });

  const calls = readFileOr(gitCallLog, '');
  assert.ok(calls.includes('fetch origin main'), calls);
  assert.notEqual(result.status, 0, 'fetching a nonexistent origin remote must fail the run rather than silently continue');
});

test('AGT002_DEPLOY_SKIP_FETCH=1 explicitly skips the fetch', () => {
  const { dir, sha, version } = initGitRepo();
  const { binDir } = writeMockBin({ curlResponses: [JSON.stringify({ sha, version })] });
  const mockGitPath = writeMockGitBin(binDir);
  const gitCallLog = path.join(mkdtempSync(path.join(tmpdir(), 'agt002-deploy-git-log-')), 'git-calls.log');

  const { result, vercelCallCount } = runDeployScript({
    repoDir: dir,
    binDir,
    lockPath: tempLockPath(),
    env: {
      AGT002_DEPLOY_SKIP_FETCH: '1',
      AGT002_DEPLOY_GIT_BIN: mockGitPath,
      MOCK_GIT_CALL_LOG: gitCallLog,
      REAL_GIT_BIN,
    },
  });

  const calls = readFileOr(gitCallLog, '');
  assert.ok(!calls.includes('fetch'), calls);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(vercelCallCount, 0, 'already live at the exact sha+version; vercel must not be invoked');
});
