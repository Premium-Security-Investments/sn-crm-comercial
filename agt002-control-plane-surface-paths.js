import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGT002_HOST_SURFACE_RUNNERS } from './agt002-host-surface-observer.js';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

// The CRM API monolith. The Radar import runner loads it, but nearly every CRM change (AGT-003,
// UI, etc.) touches it, so following it would make the Radar import look stale on every merge.
// It is never followed; instead the Radar modules it imports are listed explicitly below.
// Known blind spot: Radar code written inline in the monolith (persistTenderRadar,
// fetchPublicTenderRadar) is not watched.
const MONOLITH_PATHS = Object.freeze(['api/[...path].js', 'server/index.js']);

// Radar modules the monolith imports for the daily import / requests / Top 5 paths.
const RADAR_MONOLITH_MODULES = Object.freeze([
  'tender-phase-identity.js',
  'tender-competibility-policy.js',
  'tender-radar-source-fetch.js',
  'tender-radar-deep-search.js',
  'tender-source-status.js',
  'tender-relevance-terms.js',
  'tender-fit-policy.js',
  'esu-direct-crawl.js',
  'agt002-radar-run-receipt.js',
  'agt002-radar-run-delta.js',
  'agt002-radar-run-delta-persistence.js',
]);

// Paths every pinned surface depends on regardless of its import graph: the lockfile pins the
// third-party code it loads.
const SHARED_PATHS = Object.freeze(['pnpm-lock.yaml']);

function hostRunnerEntries(surface) {
  return [AGT002_HOST_SURFACE_RUNNERS[surface].relativePath];
}

const RADAR_IMPORT_ENTRIES = Object.freeze([
  ...hostRunnerEntries('radar_daily_import'),
  'ops/agt002-radar-daily/agt002-radar-top5.mjs',
  ...RADAR_MONOLITH_MODULES,
]);

// Surfaces that run a pinned release (and so may legitimately lag main): the entry files whose
// static relative-import closure is the code that surface actually runs.
export const AGT002_PINNED_SURFACE_ENTRIES = Object.freeze({
  bridge: Object.freeze(['ops/agt002-hetzner-bridge/run-server.mjs']),
  initial_analysis_worker: Object.freeze(hostRunnerEntries('initial_analysis_worker')),
  auto_initial: Object.freeze(hostRunnerEntries('auto_initial')),
  radar_daily_import: RADAR_IMPORT_ENTRIES,
  radar_daily_scan: Object.freeze(hostRunnerEntries('radar_daily_scan')),
  radar_daily_reconciliation: Object.freeze(hostRunnerEntries('radar_daily_reconciliation')),
  radar_daily_top5: RADAR_IMPORT_ENTRIES,
  radar_requests: RADAR_IMPORT_ENTRIES,
});

export const AGT002_PINNED_SURFACE_NAMES = Object.freeze(Object.keys(AGT002_PINNED_SURFACE_ENTRIES));

const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const RESOLVE_SUFFIXES = Object.freeze(['', '.js', '.mjs', '/index.js']);

function resolveRelativeImport(fromPath, specifier, exists) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  for (const suffix of RESOLVE_SUFFIXES) {
    if (exists(`${base}${suffix}`)) return `${base}${suffix}`;
  }
  return null;
}

// Repo-relative files a surface runs: the transitive closure of static and literal dynamic
// relative imports from its entries (bare package imports are covered by the lockfile), minus the
// monolith, plus the shared paths. Sorted, deterministic, read from the checkout only.
export function collectAgt002SurfaceCodePaths(surface, { root = REPO_ROOT, readFile, exists } = {}) {
  const entries = AGT002_PINNED_SURFACE_ENTRIES[surface];
  if (!entries) throw new Error(`Not a pinned AGT-002 surface: ${surface}`);
  const fileExists = exists ?? ((path) => existsSync(join(root, path)));
  const readSource = readFile ?? ((path) => readFileSync(join(root, path), 'utf8'));

  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop();
    if (seen.has(path) || MONOLITH_PATHS.includes(path) || !fileExists(path)) continue;
    seen.add(path);
    for (const match of readSource(path).matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveRelativeImport(path, specifier, fileExists);
      if (resolved) pending.push(resolved);
    }
  }
  return [...seen, ...SHARED_PATHS].sort();
}

function defaultLastChange({ ref, paths, root }) {
  // Literal pathspecs: a path is a file name, never a glob. Needs the full history (a shallow
  // clone would report the shallow boundary commit as the last change of every path).
  const args = ['--literal-pathspecs', '-C', root, 'log', '-1', '--format=%H', ref, '--', ...paths];
  const output = execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return output.trim() || null;
}

// For each pinned surface: the newest commit reachable from `ref` that changed a file the surface
// runs. A deployed release at that commit or any later main commit is up to date for that surface.
// Any git failure (unknown ref, shallow clone without the history) yields null for that surface --
// never a guess -- and the drift check treats a missing min_sha as a failure.
export function computeAgt002PinnedSurfaceMinShas({ ref, root = REPO_ROOT, lastChange = defaultLastChange } = {}) {
  const result = {};
  for (const surface of AGT002_PINNED_SURFACE_NAMES) {
    const paths = collectAgt002SurfaceCodePaths(surface, { root });
    let minSha = null;
    if (typeof ref === 'string' && ref.length > 0) {
      try {
        minSha = lastChange({ ref, paths, root }) || null;
      } catch {
        minSha = null;
      }
    }
    result[surface] = { min_sha: minSha, paths_count: paths.length };
  }
  return result;
}
