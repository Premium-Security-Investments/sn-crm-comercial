// AGT-002 migration 076 — remove the redundant opportunity row lock while preserving
// canonical serialization, idempotency, V3 validation, and the public RPC contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/076_agt002_canonical_lock_contention_fix.sql', import.meta.url);
const rollbackPath = new URL('../supabase/rollbacks/076_agt002_canonical_lock_contention_fix_rollback.sql', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8');
const rollback = readFileSync(rollbackPath, 'utf8');
const fn = 'psi_record_agt002_canonical_analysis_run';

function body(sql) {
  const start = sql.indexOf(`function public.${fn}(`);
  assert.ok(start >= 0, `missing public.${fn}`);
  const end = sql.indexOf('\n$$;', start);
  assert.ok(end > start, `could not locate public.${fn} body`);
  return sql.slice(start, end);
}

const migratedBody = body(migration);
const rollbackBody = body(rollback);

assert.match(migration, /^begin;/i);
assert.match(migration, /commit;\s*$/i);
assert.match(migratedBody, /security definer/i);
assert.match(migratedBody, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
assert.match(migratedBody, /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*'agt002-canonical:'\s*\|\|\s*p_opportunity_id::text\s*,\s*0\s*\)\s*\)/i,
  '076 must serialize canonical promotions with a 64-bit transaction advisory lock');
assert.match(migratedBody, /perform\s+1\s+from\s+public\.psi_sales_opportunities\s+where\s+id\s*=\s*p_opportunity_id\s*;/i,
  '076 must preserve opportunity existence validation without a row lock');
assert.doesNotMatch(migratedBody, /from\s+public\.psi_sales_opportunities[^;]*for\s+update/i,
  '076 must remove the opportunity FOR UPDATE that contends with KEY SHARE');
assert.match(migratedBody, /from\s+public\.psi_tender_analysis_runs[\s\S]*canonical[\s\S]*for\s+update/i,
  '076 must retain the current canonical-run lock for atomic demote/insert');
assert.match(migratedBody, /p_schema_version\s*=\s*'3\.0\.0'/i,
  '076 must retain the 067 integral V3 gate');
assert.match(migratedBody, /idempotency_key\s*=\s*p_idempotency_key\s+for\s+share/i,
  '076 must retain the idempotency short-circuit');
assert.doesNotMatch(migration, /create\s+table|alter\s+table|drop\s+table/i,
  'the minimal lock fix must not change tables');
assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`,'i'));
assert.match(migration, new RegExp(`grant execute on function public\\.${fn}[\\s\\S]*to service_role`,'i'));

assert.doesNotMatch(rollbackBody, /pg_advisory_xact_lock/i,
  'rollback must restore 067 rather than retain the 076 advisory lock');
assert.match(rollbackBody, /from\s+public\.psi_sales_opportunities[^;]*for\s+update/i,
  'rollback must restore the exact 067 opportunity row-lock behavior');
assert.match(rollbackBody, /p_schema_version\s*=\s*'3\.0\.0'/i,
  'rollback must restore 067, including V3 validation');

console.log('AGT-002 canonical lock-contention migration 076 static contract passed');
