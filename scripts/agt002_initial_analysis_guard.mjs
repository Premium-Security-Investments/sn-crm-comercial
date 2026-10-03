import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// P0-00 frozen literals for the AGT-002 initial-analysis worktree. These are
// intentionally hardcoded (not sourced from an env var or CLI flag) so the
// guard cannot be pointed at a different branch/root/baseline in production.
export const EXPECTED_BRANCH = 'feat/agt002-initial-analysis-p0';
export const EXPECTED_REPO_ROOT = '/root/worktrees/agt002-initial-analysis-p0';
export const EXPECTED_BASELINE_COMMIT = '9ec9626be21df0c7dfae5da281f8d90fda085fa1';

// Files this P0-00 slice is itself allowed to leave dirty.
export const ALLOWED_DIRTY_PATHS = [
  'scripts/agt002_initial_analysis_guard.mjs',
  'docs/agt002/initial-analysis/CURRENT.md',
  'tests/agt002-initial-analysis-guard.test.mjs',
  'package.json',
];

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
const INITIAL_SOURCE_PATH_PATTERN = /initial[-_]analysis/i;

// The reanalysis-boundary scan itself must reference the reanalysis module
// specifiers/table/RPC names (to check for them) and the guard's own tests
// reference those same literals as fixtures, so both the guard module and its
// test file always "contain a reanalysis reference" and must be excluded, not
// just docs/tests in general.
const GUARD_SOURCE_PATH = 'scripts/agt002_initial_analysis_guard.mjs';
const INITIAL_PRODUCTION_SOURCE_EXTENSION_PATTERN = /\.(m?js|cjs|ts|tsx|sql)$/i;
const TEST_OR_DOCS_PATH_PATTERN = /(^|\/)(tests|docs)(\/|$)|\.(test|spec)\.[^./]+$/i;

const TEMPLATE_FILENAME_PATTERN = /\.(example|sample|template|dist)(\.[^./]+)?$/i;
const DOTENV_FILENAME_PATTERN = /^\.env(\.[a-z0-9_-]+)?$/i;
const SECRET_FILENAME_PATTERN = /secret/i;
const SECRET_DECLARATION_EXTENSION_PATTERN = /\.(ya?ml|json|env|txt|pem|key|cfg|conf|ini)$/i;
const PLACEHOLDER_VALUE_PATTERN = /replace[_-]?me|change[_-]?me|<[^>]+>|\bTODO\b|\bTBD\b|\bXXX\b/i;
const ENV_ASSIGNMENT_LINE_PATTERN = /^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=.+$/m;

const INSTALL_MANIFEST_EXTENSION_PATTERN = /\.(service|timer)$/i;
const CRONTAB_FILENAME_PATTERN = /^crontab$/i;

function basename(relPath) {
  const segments = relPath.split('/');
  return segments[segments.length - 1] ?? relPath;
}

function isProductionEnvSecretDeclarationFile(relPath, content) {
  const filename = basename(relPath);
  if (TEMPLATE_FILENAME_PATTERN.test(filename)) return false;

  const looksLikeDotEnvFile = DOTENV_FILENAME_PATTERN.test(filename);
  const looksLikeSecretFile =
    SECRET_FILENAME_PATTERN.test(filename) && SECRET_DECLARATION_EXTENSION_PATTERN.test(filename);
  if (!looksLikeDotEnvFile && !looksLikeSecretFile) return false;

  if (!ENV_ASSIGNMENT_LINE_PATTERN.test(content)) return false;
  if (PLACEHOLDER_VALUE_PATTERN.test(content)) return false;
  return true;
}

function referencesReanalysisOperationalSurface(content) {
  const hasModuleReference = REANALYSIS_MODULE_SPECIFIERS.some(specifier => content.includes(specifier));
  const hasTableReference = content.includes(REANALYSIS_TABLE_NAME);
  const hasRpcReference = REANALYSIS_RPC_NAMES.some(rpcName => content.includes(rpcName));
  return hasModuleReference || hasTableReference || hasRpcReference;
}

function isInstallManifestPath(relPath) {
  const filename = basename(relPath);
  return INSTALL_MANIFEST_EXTENSION_PATTERN.test(filename) || CRONTAB_FILENAME_PATTERN.test(filename);
}

// Only actual INITIAL production/runtime modules and SQL are in scope for the
// reanalysis-boundary scan: the guard's own source, tests, and docs legitimately
// contain the reanalysis literals (as detection data/fixtures) without that
// meaning production "initial analysis" code has reached across the boundary.
export function isReanalysisBoundaryScanCandidate(relPath) {
  if (relPath === GUARD_SOURCE_PATH) return false;
  if (TEST_OR_DOCS_PATH_PATTERN.test(relPath)) return false;
  if (!INITIAL_PRODUCTION_SOURCE_EXTENSION_PATTERN.test(relPath)) return false;
  return INITIAL_SOURCE_PATH_PATTERN.test(relPath);
}

// Exhaustive by construction: every check below always runs and pushes onto
// the same `violations` array; none of them return early, so a single call
// reports every simultaneous problem instead of stopping at the first one.
export function runAgt002InitialAnalysisGuard(observation = {}) {
  const {
    branch = '',
    repoRoot = '',
    baselineCommit = '',
    dirtyPaths = [],
    changedFiles = [],
  } = observation;

  const violations = [];

  if (branch !== EXPECTED_BRANCH) {
    violations.push({ code: 'branch_mismatch', expected: EXPECTED_BRANCH, actual: branch });
  }

  if (repoRoot !== EXPECTED_REPO_ROOT) {
    violations.push({ code: 'repo_root_mismatch', expected: EXPECTED_REPO_ROOT, actual: repoRoot });
  }

  if (baselineCommit !== EXPECTED_BASELINE_COMMIT) {
    violations.push({
      code: 'baseline_commit_mismatch',
      expected: EXPECTED_BASELINE_COMMIT,
      actual: baselineCommit,
    });
  }

  for (const dirtyPath of dirtyPaths) {
    if (!ALLOWED_DIRTY_PATHS.includes(dirtyPath)) {
      violations.push({ code: 'unexpected_dirty_path', path: dirtyPath });
    }
  }

  for (const changedFile of changedFiles) {
    if (isProductionEnvSecretDeclarationFile(changedFile.path, changedFile.content)) {
      violations.push({ code: 'production_env_secret_declaration', path: changedFile.path });
    }

    if (
      isReanalysisBoundaryScanCandidate(changedFile.path) &&
      referencesReanalysisOperationalSurface(changedFile.content)
    ) {
      violations.push({ code: 'reanalysis_reference_in_initial_source', path: changedFile.path });
    }
  }

  const installManifestCandidates = new Set([
    ...dirtyPaths,
    ...changedFiles.map(changedFile => changedFile.path),
  ]);
  for (const candidatePath of installManifestCandidates) {
    if (isInstallManifestPath(candidatePath)) {
      violations.push({ code: 'install_manifest_modified', path: candidatePath });
    }
  }

  return { ok: violations.length === 0, violations };
}

function runGit(args, cwd, { raw = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (!result || result.error || result.status !== 0) {
    return '';
  }
  return raw ? result.stdout : result.stdout.trim();
}

// Parses `git status --porcelain=v1 -z` output. Each record is a NUL-terminated
// "XY PATH" token (XY is always exactly 2 status chars + 1 separator space, so
// slicing at a fixed offset 3 is safe here — unlike newline-delimited porcelain,
// there is no " -> " inline rename joiner to desync that math). Rename/copy
// records (XY starting with 'R' or 'C') are the one exception: they consume an
// *extra* NUL-terminated token for the original path, with no " -> " in the
// first token at all. Both the original and new path are reported as dirty so
// a rename can never let an unallowed path slip past the allow-list unflagged.
export function parseGitStatusPorcelainZ(output) {
  const tokens = output.split('\0');
  if (tokens.length && tokens[tokens.length - 1] === '') tokens.pop();

  const dirtyPaths = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.length < 3) continue;
    const statusCode = token.slice(0, 2);
    const tokenPath = token.slice(3);

    if (statusCode[0] === 'R' || statusCode[0] === 'C') {
      const origPath = tokenPath;
      i += 1;
      const newPath = tokens[i] ?? '';
      if (origPath) dirtyPaths.push(origPath);
      if (newPath) dirtyPaths.push(newPath);
    } else if (tokenPath) {
      dirtyPaths.push(tokenPath);
    }
  }
  return dirtyPaths;
}

// Observes real Git state with a fixed argv per call (no shell interpolation,
// no user-controlled command strings). Any failed git invocation degrades to
// an empty string, which then fails the frozen-literal comparisons above —
// the guard fails closed rather than passing on an unreadable repository.
//
// `--untracked-files=all` makes Git itself expand a new untracked directory
// (e.g. docs/agt002/initial-analysis/) into one record per file inside it,
// instead of collapsing it to a single "?? dir/" record — so an allow-listed
// file living under an untracked directory is recognized as allowed while
// any unallowed sibling in that same directory is still individually caught.
function observeAgt002InitialAnalysisState(cwd) {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const repoRoot = runGit(['rev-parse', '--show-toplevel'], cwd);
  const baselineCommit = runGit(['merge-base', 'HEAD', 'main'], cwd);

  const statusOutput = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, { raw: true });
  const dirtyPaths = [...new Set(parseGitStatusPorcelainZ(statusOutput))];

  const changedFiles = [];
  for (const relPath of dirtyPaths) {
    const absPath = path.join(repoRoot || cwd, relPath);
    if (!existsSync(absPath)) continue;
    try {
      changedFiles.push({ path: relPath, content: readFileSync(absPath, 'utf8') });
    } catch {
      // Unreadable (e.g. binary/deleted) file: omit from content-based checks,
      // it still counts toward dirtyPaths above.
    }
  }

  return { branch, repoRoot, baselineCommit, dirtyPaths, changedFiles };
}

const isCliEntrypoint = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntrypoint) {
  const observation = observeAgt002InitialAnalysisState(process.cwd());
  const result = runAgt002InitialAnalysisGuard(observation);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
