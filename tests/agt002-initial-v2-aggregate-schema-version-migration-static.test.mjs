// AGT-002 migration 106 — the INITIAL completion RPC publishes the first aggregate as
// pre_go_analysis.v2 (v1 minus the render manifest). The table keeps accepting v1 for later stages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { MIGRATION_ORDER } from '../scripts/agt002-initial-analysis-migrations.mjs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/106_agt002_initial_v2_aggregate_schema_version.sql');
const rollback = read('../supabase/rollbacks/106_agt002_initial_v2_aggregate_schema_version_rollback.sql');
const m102 = read('../supabase/migrations/102_agt002_initial_analysis_canonical_persistence.sql');
const sqlOnly = sql => sql.replace(/--[^\n]*/g, '');

const fn = 'psi_complete_agt002_initial_analysis_job';

// --- registered in the governed chain, right after 105 -------------------------------------------
assert.equal(MIGRATION_ORDER.at(-1), '106', '106 must be the last slot in the governed chain');
assert.equal(MIGRATION_ORDER.at(-2), '105');

// --- shape ---------------------------------------------------------------------------------------
assert.match(migration, /^--/, '106 must open with its rationale');
assert.match(migration, /begin;/i);
assert.match(migration, /commit;\s*$/i);
assert.ok(migration.includes(`create or replace function public.${fn}(`));
assert.match(migration, /security definer/i);
assert.match(migration, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
assert.match(migration, /revoke all on function public\.psi_complete_agt002_initial_analysis_job/i);
assert.match(migration, /grant execute on function public\.psi_complete_agt002_initial_analysis_job[^;]*to service_role/i);

// --- the table accepts v1 or v2, and nothing else ---------------------------------------------------
assert.match(sqlOnly(migration),
  /check\s*\(\s*schema_version\s+in\s*\(\s*'pre_go_analysis\.v1'\s*,\s*'pre_go_analysis\.v2'\s*\)\s*\)/i);

// --- the RPC requires v2 in BOTH places and never v1 ---------------------------------------------------
const rpcSql = sqlOnly(migration);
assert.equal((rpcSql.match(/is distinct from 'pre_go_analysis\.v2'/g) ?? []).length, 2,
  'the RPC must require v2 in p_schema_version and in meta.schema_version');
assert.equal(rpcSql.includes("'pre_go_analysis.v1'") && /is distinct from 'pre_go_analysis\.v1'/.test(rpcSql), false,
  'the RPC must not require v1 any more');

// --- otherwise byte-identical to 102's function body -------------------------------------------------
const body = sql => {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  return sql.slice(start, sql.indexOf('\n$$;', start) + 4);
};
const normalize = text => text
  .replace(/pre_go_analysis\.v[12]/g, 'pre_go_analysis.VX')
  .replace(/del agregado( INITIAL)? debe ser/g, 'del agregado debe ser');
assert.equal(normalize(body(migration)), normalize(body(m102)),
  '106 must change only the schema-version checks of the 102 RPC body');

// --- rollback is fail-closed ---------------------------------------------------------------------------
assert.match(rollback, /begin;/i);
assert.match(rollback, /commit;\s*$/i);
assert.match(rollback, /lock table public\.psi_agt002_pre_go_analysis_versions in access exclusive mode/i);
assert.match(rollback, /Rollback 106 refused/i);
assert.match(rollback, /errcode\s*=\s*'55000'/i);
assert.match(sqlOnly(rollback), /check\s*\(\s*schema_version\s*=\s*'pre_go_analysis\.v1'\s*\)/i);
assert.equal(normalize(body(rollback)), normalize(body(m102)));
assert.ok(body(rollback).includes("'pre_go_analysis.v1'"), 'the rollback must restore the v1 RPC exactly');

console.log('AGT-002 migration 106 static contract passed');
