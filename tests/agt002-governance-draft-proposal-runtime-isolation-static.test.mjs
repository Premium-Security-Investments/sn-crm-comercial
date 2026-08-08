import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The governance draft proposal artifact (agt002-governance-draft-proposal.js and
// docs/governance/**) is DRAFT + HUMAN_APPROVAL_REQUIRED by construction (see the
// module's own validator) and must never be reachable from anything that serves live
// traffic or writes to Supabase. This is the static, mechanical proof: no runtime
// code — anywhere in the repository, not just the two named entrypoints or the root
// directory — imports the module, and no runtime code path reads docs/governance/.
//
// This scan is recursive across every subdirectory (server/, api/, src/, config/,
// contracts/, data/, ops/, ...), deliberately not limited to root-level .js files: a
// shallow, root-only scan would silently stop proving anything the moment runtime code
// is ever organized into a subdirectory (e.g. server/ growing internal submodules).
// Only genuinely non-runtime trees are excluded: node_modules (dependencies),
// tests/ and scripts/ (this module's own legitimate, non-runtime importers),
// docs/ (the draft artifact itself), dist/ (build output, not source), and .git.
// ---------------------------------------------------------------------------

const ROOT = new URL('..', import.meta.url).pathname;
const SELF = path.join(ROOT, 'agt002-governance-draft-proposal.js');

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'tests', 'scripts', 'docs']);
const SCANNABLE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.tsx']);

function collectScannableFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectScannableFiles(full, files);
    } else if (stats.isFile() && SCANNABLE_EXTENSIONS.has(path.extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

const RUNTIME_ENTRYPOINTS = [
  'server/index.js',
  'api/[...path].js',
];

for (const entrypoint of RUNTIME_ENTRYPOINTS) {
  const source = readFileSync(path.join(ROOT, entrypoint), 'utf8');
  assert.doesNotMatch(
    source,
    /agt002-governance-draft-proposal/,
    `${entrypoint} no debe importar agt002-governance-draft-proposal.js (artefacto DRAFT, no ejecutable)`,
  );
  assert.doesNotMatch(
    source,
    /docs\/governance/,
    `${entrypoint} no debe leer docs/governance/ en runtime`,
  );
}

const scannableFiles = collectScannableFiles(ROOT);
assert.ok(scannableFiles.length > 100, `El escaneo recursivo debe cubrir el repositorio completo (encontrados: ${scannableFiles.length}).`);

for (const file of scannableFiles) {
  if (file === SELF) continue;
  const relative = path.relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /agt002-governance-draft-proposal(\.js)?['"]/,
    `${relative} no debe importar agt002-governance-draft-proposal.js`,
  );
  assert.doesNotMatch(
    source,
    /docs\/governance/,
    `${relative} no debe leer docs/governance/ en runtime`,
  );
}

console.log(`agt002-governance-draft-proposal-runtime-isolation-static.test.mjs OK (${scannableFiles.length} archivos escaneados recursivamente)`);
