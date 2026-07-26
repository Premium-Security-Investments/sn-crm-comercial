import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const runnerPath = new URL('../scripts/tender-document-state-migrations.mjs', import.meta.url);
assert.equal(existsSync(runnerPath), true, 'debe existir un runner dedicado para 026/027');
const source = readFileSync(runnerPath, 'utf8');

// Loads the exact migrations/rollbacks; never improvises SQL inline.
assert.match(source, /supabase\/migrations\/026_tender_document_versions\.sql/);
assert.match(source, /supabase\/migrations\/027_tender_decision_current_analysis\.sql/);
assert.match(source, /supabase\/rollbacks\/027_tender_decision_current_analysis_rollback\.sql/);
assert.match(source, /supabase\/rollbacks\/026_tender_document_versions_rollback\.sql/);

// Reverse (LIFO) rollback order: 027's rollback file must be read/applied
// before 026's in source order.
{
  const idx027 = source.indexOf('ROLLBACK_027');
  const idx026 = source.indexOf('ROLLBACK_026');
  assert.ok(idx027 !== -1 && idx026 !== -1);
  const rollbackFnStart = source.indexOf('export async function rollback(');
  const rollbackFnEnd = source.indexOf('\nexport async function', rollbackFnStart + 1);
  const rollbackBody = source.slice(rollbackFnStart, rollbackFnEnd === -1 ? source.length : rollbackFnEnd);
  const use027 = rollbackBody.indexOf('ROLLBACK_027');
  const use026 = rollbackBody.indexOf('ROLLBACK_026');
  assert.ok(use027 !== -1 && use026 !== -1 && use027 < use026, 'rollback() debe aplicar el rollback de 027 antes que el de 026');
}

// Exports pure, testable building blocks (no hidden state, no side effects at import time).
for (const exportName of ['classify', 'prerequisitesOk', 'readStatus', 'preflight', 'verify', 'rollback', 'apply', 'STATE_SQL', 'PREREQUISITES_SQL']) {
  assert.match(source, new RegExp(`export (?:async )?function ${exportName}\\(|export const ${exportName}`), `debe exportar ${exportName}`);
}

// Never logs the service role key or Supabase URL secrets — only status/error shapes.
assert.doesNotMatch(source, /console\.(log|error)\([^)]*serviceKey/i, 'no debe imprimir el service role key');
assert.doesNotMatch(source, /console\.(log|error)\(`[^`]*\$\{serviceKey/i, 'no debe interpolar el service role key en logs');

// Fails closed: apply must validate 022/025 prerequisites before mutating.
assert.match(source, /async function apply\(execSql\) \{[\s\S]*?preflight\(execSql\)/);

// Distinguishes pending/applied/partial and refuses to reapply when already ready.
assert.match(source, /'pending'/);
assert.match(source, /'applied'/);
assert.match(source, /'partial'/);
assert.match(source, /APPLY_SKIPPED_ALREADY_READY/);

// Partial state must block a blind re-apply instead of guessing what to do.
{
  const applyStart = source.indexOf('export async function apply(');
  const applyEnd = source.indexOf('\nexport async function', applyStart + 1);
  const applyBody = source.slice(applyStart, applyEnd === -1 ? source.length : applyEnd);
  assert.match(applyBody, /partial/);
  assert.match(applyBody, /throw new Error/);
}

// verify() must be read-only: it must never execute migration or rollback SQL.
{
  const verifyStart = source.indexOf('export async function verify(');
  assert.notEqual(verifyStart, -1, 'debe existir una función verify() dedicada');
  const verifyEnd = source.indexOf('\nexport async function', verifyStart + 1);
  const verifyBody = source.slice(verifyStart, verifyEnd === -1 ? source.length : verifyEnd);
  assert.doesNotMatch(verifyBody, /MIGRATION_026|MIGRATION_027|ROLLBACK_026|ROLLBACK_027|readFileSync/, 'verify() no debe leer ni ejecutar archivos de migración/rollback');
}

// apply() must auto-rollback on failure rather than leaving a partial state silently.
{
  const applyStart = source.indexOf('export async function apply(');
  const applyEnd = source.indexOf('\nexport async function', applyStart + 1);
  const applyBody = source.slice(applyStart, applyEnd === -1 ? source.length : applyEnd);
  assert.match(applyBody, /catch[\s\S]*?rollback\(execSql\)/, 'apply debe intentar rollback automático si falla a mitad de camino');
}

// The CLI entry point only runs when the file is executed directly, never on import
// (so tests importing these functions never trigger a real network call).
assert.match(source, /import\.meta\.url === /);

console.log('tender document state migrations runner contract passed');
