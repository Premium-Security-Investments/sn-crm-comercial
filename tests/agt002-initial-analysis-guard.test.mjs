import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// AGT-002 P0-00 RED slice: scripts/agt002_initial_analysis_guard.mjs and
// docs/agt002/initial-analysis/CURRENT.md do not exist yet. Every test below
// is written against the contract those two artifacts must satisfy once
// implemented; all of them are expected to fail until that GREEN work lands.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD_MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'agt002_initial_analysis_guard.mjs');
const GUARD_MODULE_SPECIFIER = '../scripts/agt002_initial_analysis_guard.mjs';
const CURRENT_DOC_PATH = path.join(REPO_ROOT, 'docs', 'agt002', 'initial-analysis', 'CURRENT.md');

const EXPECTED_BRANCH = 'feat/agt002-initial-analysis-p0';
const EXPECTED_REPO_ROOT = '/root/worktrees/agt002-initial-analysis-p0';
const EXPECTED_BASELINE_COMMIT = '9ec9626be21df0c7dfae5da281f8d90fda085fa1';

const REANALYSIS_MODULE_SPECIFIERS = [
  'agt002-reanalysis-api.js',
  'agt002-reanalysis-jobs.js',
  'agt002-reanalysis-worker.js',
  'agt002-reanalysis-input.js',
  'agt002-reanalysis-executor.js',
  'agt002-reanalysis-error-message.js',
];
const REANALYSIS_TABLE_NAME = 'psi_agt002_reanalysis_jobs';
const REANALYSIS_RPC_NAMES = [
  'psi_create_agt002_reanalysis_job',
  'psi_claim_agt002_reanalysis_job',
  'psi_complete_agt002_reanalysis_job',
  'psi_fail_agt002_reanalysis_job',
];

// Files this P0-00 RED/GREEN slice is itself allowed to leave dirty.
const ALLOWED_DIRTY_PATHS = [
  'scripts/agt002_initial_analysis_guard.mjs',
  'docs/agt002/initial-analysis/CURRENT.md',
  'tests/agt002-initial-analysis-guard.test.mjs',
  'package.json',
];

// A production-bypass mechanism for the frozen branch/repo-root/baseline-commit
// literals (an env var, a CLI flag, etc.) would defeat the guard. The only
// sanctioned way to exercise non-default values is calling the exported pure
// function directly with explicit arguments, which is what this test file does.
const FORBIDDEN_BYPASS_SOURCE_PATTERN =
  /process\.env\.[A-Z0-9_]*(GUARD|REPO_ROOT|BRANCH|BASELINE)[A-Z0-9_]*|--(skip|allow|override)-[a-z-]*(root|branch|baseline)/i;

function withTempFiles(entries, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agt002-initial-analysis-guard-'));
  try {
    const changedFiles = entries.map(({ relPath, content }) => {
      const absPath = path.join(dir, relPath.replace(/\//g, path.sep));
      mkdirSync(path.dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, 'utf8');
      return { path: relPath, content: readFileSync(absPath, 'utf8') };
    });
    return fn(changedFiles);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function baseObservation(overrides = {}) {
  return {
    branch: EXPECTED_BRANCH,
    repoRoot: EXPECTED_REPO_ROOT,
    baselineCommit: EXPECTED_BASELINE_COMMIT,
    dirtyPaths: [],
    changedFiles: [],
    ...overrides,
  };
}

function violationCodes(result) {
  return result.violations.map(v => v.code).sort();
}

let guardModule;
let guardModuleLoadError;
try {
  guardModule = await import(GUARD_MODULE_SPECIFIER);
} catch (err) {
  guardModuleLoadError = err;
}

function requireGuardModule() {
  assert.equal(
    guardModuleLoadError,
    undefined,
    `scripts/agt002_initial_analysis_guard.mjs must import cleanly: ${guardModuleLoadError?.message}`,
  );
  return guardModule;
}

test('scripts/agt002_initial_analysis_guard.mjs exists and exports its frozen constants and entrypoint', () => {
  assert.ok(existsSync(GUARD_MODULE_PATH), 'scripts/agt002_initial_analysis_guard.mjs must exist');
  const mod = requireGuardModule();
  assert.equal(typeof mod.runAgt002InitialAnalysisGuard, 'function');
  assert.equal(mod.EXPECTED_BRANCH, EXPECTED_BRANCH);
  assert.equal(mod.EXPECTED_REPO_ROOT, EXPECTED_REPO_ROOT);
  assert.equal(mod.EXPECTED_BASELINE_COMMIT, EXPECTED_BASELINE_COMMIT);
  assert.deepEqual([...mod.ALLOWED_DIRTY_PATHS].sort(), [...ALLOWED_DIRTY_PATHS].sort());
});

test('guard source carries no production bypass for branch/repo-root/baseline-commit; only the exported function accepts explicit overrides', () => {
  assert.ok(existsSync(GUARD_MODULE_PATH), 'scripts/agt002_initial_analysis_guard.mjs must exist');
  const source = readFileSync(GUARD_MODULE_PATH, 'utf8');
  assert.doesNotMatch(
    source,
    FORBIDDEN_BYPASS_SOURCE_PATTERN,
    'guard must not read an env var or CLI flag that overrides branch/repo-root/baseline-commit checks',
  );
});

test('an observation matching every frozen value with no dirty paths and no changed files passes with zero violations', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  const result = runAgt002InitialAnalysisGuard(baseObservation());
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('rejects any branch other than the exact literal feat/agt002-initial-analysis-p0', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  for (const branch of [
    'feat/agt002-initial-analysis-p0-typo',
    'main',
    'feat/agt002-initial-analysis-p0 ',
    'FEAT/AGT002-INITIAL-ANALYSIS-P0',
    '',
  ]) {
    const result = runAgt002InitialAnalysisGuard(baseObservation({ branch }));
    assert.equal(result.ok, false, `branch ${JSON.stringify(branch)} must be rejected`);
    assert.ok(
      result.violations.some(v => v.code === 'branch_mismatch'),
      `branch ${JSON.stringify(branch)} must produce a branch_mismatch violation`,
    );
  }
});

test('rejects any repo root other than the exact literal /root/worktrees/agt002-initial-analysis-p0', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  for (const repoRoot of [
    '/root/worktrees/agt002-initial-analysis-p0/',
    '/workspace',
    '/root/worktrees/agt002-initial-analysis-p0-typo',
    'root/worktrees/agt002-initial-analysis-p0',
    '',
  ]) {
    const result = runAgt002InitialAnalysisGuard(baseObservation({ repoRoot }));
    assert.equal(result.ok, false, `repoRoot ${JSON.stringify(repoRoot)} must be rejected`);
    assert.ok(
      result.violations.some(v => v.code === 'repo_root_mismatch'),
      `repoRoot ${JSON.stringify(repoRoot)} must produce a repo_root_mismatch violation`,
    );
  }
});

test('rejects any baseline commit other than the exact frozen literal', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  for (const baselineCommit of [
    '9ec9626be21df0c7dfae5da281f8d90fda085fa',
    '9EC9626BE21DF0C7DFAE5DA281F8D90FDA085FA1',
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    '',
  ]) {
    const result = runAgt002InitialAnalysisGuard(baseObservation({ baselineCommit }));
    assert.equal(result.ok, false, `baselineCommit ${JSON.stringify(baselineCommit)} must be rejected`);
    assert.ok(
      result.violations.some(v => v.code === 'baseline_commit_mismatch'),
      `baselineCommit ${JSON.stringify(baselineCommit)} must produce a baseline_commit_mismatch violation`,
    );
  }
});

test('flags every dirty path not on the explicit allow-list, and none of the allow-listed ones', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  const dirtyPaths = [
    'docs/agt002/initial-analysis/CURRENT.md',
    'scripts/agt002_initial_analysis_guard.mjs',
    'src/unexpected-file.js',
    'agt002-something-unrelated.js',
  ];
  const result = runAgt002InitialAnalysisGuard(baseObservation({ dirtyPaths }));
  assert.equal(result.ok, false);
  const flaggedPaths = result.violations.filter(v => v.code === 'unexpected_dirty_path').map(v => v.path).sort();
  assert.deepEqual(flaggedPaths, ['agt002-something-unrelated.js', 'src/unexpected-file.js']);
});

test('flags newly introduced production env/secret declarations, read from real temp fixture files, while ignoring example templates', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  withTempFiles(
    [
      { relPath: '.env.production', content: 'AGT002_INITIAL_ANALYSIS_SECRET=super-real-value\n' },
      {
        relPath: 'ops/agt002-initial-analysis/env.example',
        content: 'AGT002_INITIAL_ANALYSIS_SECRET=__REPLACE_ME__\n',
      },
      { relPath: 'agt002-initial-analysis-report.js', content: 'export const REPORT_TITLE = "initial analysis";\n' },
    ],
    changedFiles => {
      const result = runAgt002InitialAnalysisGuard(baseObservation({ changedFiles }));
      assert.equal(result.ok, false);
      const flaggedPaths = result.violations
        .filter(v => v.code === 'production_env_secret_declaration')
        .map(v => v.path);
      assert.deepEqual(flaggedPaths, ['.env.production']);
    },
  );
});

test('flags INITIAL source files that import or reference reanalysis operational modules, tables, or RPCs', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  withTempFiles(
    [
      {
        relPath: 'agt002-initial-analysis-input.js',
        content: `import { loadReanalysisJob } from './${REANALYSIS_MODULE_SPECIFIERS[1]}';\nexport default loadReanalysisJob;\n`,
      },
      {
        relPath: 'agt002-initial-analysis-store.js',
        content: `export const QUERY = "select * from ${REANALYSIS_TABLE_NAME} limit 1";\n`,
      },
      {
        relPath: 'agt002-initial-analysis-worker.js',
        content: `export async function claim(client) {\n  return client.rpc('${REANALYSIS_RPC_NAMES[1]}', {});\n}\n`,
      },
      {
        relPath: 'agt002-initial-analysis-summary.js',
        content: 'export function summarize(x) {\n  return x.length;\n}\n',
      },
    ],
    changedFiles => {
      const result = runAgt002InitialAnalysisGuard(baseObservation({ changedFiles }));
      assert.equal(result.ok, false);
      const flaggedPaths = result.violations
        .filter(v => v.code === 'reanalysis_reference_in_initial_source')
        .map(v => v.path)
        .sort();
      assert.deepEqual(flaggedPaths, [
        'agt002-initial-analysis-input.js',
        'agt002-initial-analysis-store.js',
        'agt002-initial-analysis-worker.js',
      ]);
    },
  );
});

test('flags modifications to systemd/timer/cron installation manifests', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  const dirtyPaths = [
    'ops/agt002-initial-analysis/agt002-initial-analysis.service',
    'ops/agt002-initial-analysis/agt002-initial-analysis.timer',
    'ops/agt002-reanalysis-worker/agt002-reanalysis-worker.service',
    'ops/agt002-initial-analysis/crontab',
    'ops/agt002-initial-analysis/run-agt002-initial-analysis.mjs',
  ];
  const result = runAgt002InitialAnalysisGuard(baseObservation({ dirtyPaths }));
  assert.equal(result.ok, false);
  const flaggedPaths = result.violations
    .filter(v => v.code === 'install_manifest_modified')
    .map(v => v.path)
    .sort();
  assert.deepEqual(flaggedPaths, [
    'ops/agt002-initial-analysis/agt002-initial-analysis.service',
    'ops/agt002-initial-analysis/agt002-initial-analysis.timer',
    'ops/agt002-initial-analysis/crontab',
    'ops/agt002-reanalysis-worker/agt002-reanalysis-worker.service',
  ]);
  assert.ok(
    !flaggedPaths.includes('ops/agt002-initial-analysis/run-agt002-initial-analysis.mjs'),
    'a plain runner script must not be flagged as an install manifest',
  );
});

test('reports every simultaneous violation instead of short-circuiting on the first failure', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  const result = runAgt002InitialAnalysisGuard({
    branch: 'main',
    repoRoot: '/workspace',
    baselineCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    dirtyPaths: ['src/unexpected-file.js'],
    changedFiles: [],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(violationCodes(result), [
    'baseline_commit_mismatch',
    'branch_mismatch',
    'repo_root_mismatch',
    'unexpected_dirty_path',
  ]);
});

// P0-00 CLI-verification regressions: these cover real defects the unit tests
// above did not catch, each exposed only by running the guard against real
// `git status` output instead of hand-built dirtyPaths/changedFiles.

test('parseGitStatusPorcelainZ extracts exact paths from M and ?? porcelain -z records without losing leading characters', () => {
  const { parseGitStatusPorcelainZ } = requireGuardModule();
  const output =
    ['M  package.json', ' M docs/agt002/initial-analysis/CURRENT.md', '?? tests/agt002-initial-analysis-guard.test.mjs'].join(
      '\0',
    ) + '\0';
  assert.deepEqual(parseGitStatusPorcelainZ(output), [
    'package.json',
    'docs/agt002/initial-analysis/CURRENT.md',
    'tests/agt002-initial-analysis-guard.test.mjs',
  ]);
});

test('parseGitStatusPorcelainZ consumes the extra original-path token for rename/copy records without desyncing the path of the next record', () => {
  const { parseGitStatusPorcelainZ } = requireGuardModule();
  const output = ['R  old-name.js', 'new-name.js', 'M  package.json'].join('\0') + '\0';
  assert.deepEqual(parseGitStatusPorcelainZ(output), ['old-name.js', 'new-name.js', 'package.json']);
});

test('end-to-end: git status -z --untracked-files=all expands an untracked directory into per-file records, so an allow-listed file inside it is recognized as allowed while an unallowed sibling is still flagged', () => {
  const { parseGitStatusPorcelainZ, runAgt002InitialAnalysisGuard } = requireGuardModule();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agt002-initial-analysis-guard-repo-'));
  try {
    const run = args => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
      return result.stdout;
    };
    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    writeFileSync(path.join(dir, 'README.md'), 'seed\n');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'seed']);

    const docDir = path.join(dir, 'docs', 'agt002', 'initial-analysis');
    mkdirSync(docDir, { recursive: true });
    writeFileSync(path.join(docDir, 'CURRENT.md'), '# current\n');
    writeFileSync(path.join(docDir, 'unexpected-sibling.md'), '# sibling\n');

    const statusOutput = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: dir,
      encoding: 'utf8',
    }).stdout;
    const dirtyPaths = parseGitStatusPorcelainZ(statusOutput);

    assert.ok(
      dirtyPaths.includes('docs/agt002/initial-analysis/CURRENT.md'),
      'the allow-listed file must be reported individually, not folded into a directory record',
    );
    assert.ok(
      !dirtyPaths.includes('docs/agt002/initial-analysis/') && !dirtyPaths.includes('docs/agt002/initial-analysis'),
      'the untracked directory must not itself appear as a single collapsed dirty path',
    );

    const result = runAgt002InitialAnalysisGuard(baseObservation({ dirtyPaths }));
    const flaggedPaths = result.violations.filter(v => v.code === 'unexpected_dirty_path').map(v => v.path);
    assert.deepEqual(flaggedPaths, ['docs/agt002/initial-analysis/unexpected-sibling.md']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isReanalysisBoundaryScanCandidate excludes the guard source, its test file, and docs even though they legitimately contain the reanalysis literals the scan looks for', () => {
  const { isReanalysisBoundaryScanCandidate } = requireGuardModule();
  assert.equal(isReanalysisBoundaryScanCandidate('scripts/agt002_initial_analysis_guard.mjs'), false);
  assert.equal(isReanalysisBoundaryScanCandidate('tests/agt002-initial-analysis-guard.test.mjs'), false);
  assert.equal(isReanalysisBoundaryScanCandidate('docs/agt002/initial-analysis/CURRENT.md'), false);
});

test('isReanalysisBoundaryScanCandidate still covers real INITIAL production/runtime modules and SQL', () => {
  const { isReanalysisBoundaryScanCandidate } = requireGuardModule();
  assert.equal(isReanalysisBoundaryScanCandidate('agt002-initial-analysis-worker.js'), true);
  assert.equal(isReanalysisBoundaryScanCandidate('db/migrations/agt002-initial-analysis-schema.sql'), true);
  assert.equal(isReanalysisBoundaryScanCandidate('agt002-initial-analysis-notes.txt'), false);
});

test('running the guard against its own source and test file as changed files produces no false-positive reanalysis_reference_in_initial_source violation', () => {
  const { runAgt002InitialAnalysisGuard } = requireGuardModule();
  const guardSource = readFileSync(GUARD_MODULE_PATH, 'utf8');
  const testSource = readFileSync(
    path.join(REPO_ROOT, 'tests', 'agt002-initial-analysis-guard.test.mjs'),
    'utf8',
  );
  const changedFiles = [
    { path: 'scripts/agt002_initial_analysis_guard.mjs', content: guardSource },
    { path: 'tests/agt002-initial-analysis-guard.test.mjs', content: testSource },
  ];
  const result = runAgt002InitialAnalysisGuard(baseObservation({ changedFiles }));
  assert.deepEqual(
    result.violations.filter(v => v.code === 'reanalysis_reference_in_initial_source'),
    [],
  );
});

const FORBIDDEN_DOC_MARKERS = /TODO|TBD|FIXME|placeholder/i;

test('docs/agt002/initial-analysis/CURRENT.md exists and carries no TODO/TBD/FIXME/placeholder markers', () => {
  assert.ok(existsSync(CURRENT_DOC_PATH), 'docs/agt002/initial-analysis/CURRENT.md must exist');
  const content = readFileSync(CURRENT_DOC_PATH, 'utf8');
  assert.doesNotMatch(content, FORBIDDEN_DOC_MARKERS);
});

test('CURRENT.md documents the frozen branch, repo root, and baseline commit literals exactly', () => {
  assert.ok(existsSync(CURRENT_DOC_PATH), 'docs/agt002/initial-analysis/CURRENT.md must exist');
  const content = readFileSync(CURRENT_DOC_PATH, 'utf8');
  for (const literal of [EXPECTED_BRANCH, EXPECTED_REPO_ROOT, EXPECTED_BASELINE_COMMIT]) {
    assert.ok(content.includes(literal), `CURRENT.md must contain literal "${literal}"`);
  }
});

test('CURRENT.md documents every guard check category by name', () => {
  assert.ok(existsSync(CURRENT_DOC_PATH), 'docs/agt002/initial-analysis/CURRENT.md must exist');
  const content = readFileSync(CURRENT_DOC_PATH, 'utf8');
  for (const keyword of [
    /branch/i,
    /repo(sitory)? root/i,
    /baseline commit/i,
    /dirty/i,
    /env|secret/i,
    /reanalysis/i,
    /systemd|timer|cron/i,
  ]) {
    assert.match(content, keyword, `CURRENT.md must describe the guard check matching ${keyword}`);
  }
});
