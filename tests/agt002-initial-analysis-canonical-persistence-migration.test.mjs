// AGT-002 P0-06 (RED) — 102_agt002_initial_analysis_canonical_persistence.sql static contract.
//
// Mirrors the static-safety conventions of tests/agt002-initial-analysis-jobs-migration.test.mjs.
// This migration/rollback pair does not exist yet: readFileSync throwing ENOENT is the RED
// signal for the whole file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/102_agt002_initial_analysis_canonical_persistence.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/102_agt002_initial_analysis_canonical_persistence_rollback.sql', import.meta.url), 'utf8');

// New append-only tables.
for (const table of [
  'psi_agt002_initial_analysis_checkpoints',
  'psi_agt002_initial_analysis_run_lineage',
  'psi_agt002_pre_go_analysis_versions',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'), `${table} must be defined`);
  assert.match(migration, new RegExp(`before update or delete on public\\.${table}`, 'i'), `${table} must be append-only`);
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, authenticated, anon, service_role`, 'i'));
  assert.match(migration, new RegExp(`grant select on table public\\.${table} to service_role`, 'i'));
}

// The closed future-stage vocabulary ships structurally even though only ANALYSIS_PUBLISHED is
// ever written by this migration's own RPC.
assert.match(
  migration,
  /aggregate_stage text not null check \(aggregate_stage in \(\s*'ANALYSIS_PUBLISHED',\s*'G2_RECORDED',\s*'DECISION_INVALIDATED',\s*'PRESENTATION_STATUS_CHANGED'\s*\)\)/i,
);
assert.match(migration, /unique \(analysis_run_id, aggregate_version\)/i);
assert.match(migration, /check \(\(aggregate_stage = 'ANALYSIS_PUBLISHED'\) = \(aggregate_version = 1\)\)/i);

// Additive adaptation of psi_tender_analysis_runs: nullable AGT002 columns, the INITIAL shape
// invariant, and the snapshot_id relaxation (additive, not a legacy breakage). P0-06 is
// INITIAL-only: it must never add a source_analysis_run_id column or define any REANALYSIS
// shape — that belongs to whatever migration later ships the parallel reanalysis runtime.
for (const column of [
  'analysis_kind text',
  'analysis_version integer',
  'g1_authorization_id uuid references public.psi_agt002_analysis_authorizations',
  'g1_scope text',
  'package_version_id uuid references public.psi_agt002_evidence_package_versions',
  'analysis_core_hash text',
]) {
  assert.match(migration, new RegExp(`add column if not exists ${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), `must add column ${column}`);
}
assert.match(migration, /alter column snapshot_id drop not null/i);
assert.match(
  migration,
  /check \(analysis_kind is distinct from 'INITIAL' or analysis_version = 1\)/i,
);
assert.match(migration, /check \(analysis_kind is null or analysis_kind = 'INITIAL'\)/i, 'the kind CHECK must only ever admit INITIAL in this migration');
assert.doesNotMatch(migration, /create or replace function public\.psi_tender_analysis_runs_prevent_mutation/i, 'must not redefine the 063 append-only guard');

// The versions table carries its own explicit analysis_core_hash column (not derived solely
// from the JSON envelope), FK-bound back to the run's own hash so every version of a run is
// forced to agree with it (and therefore with each other).
assert.match(migration, /analysis_core_hash text not null check \(analysis_core_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(
  migration,
  /foreign key \(analysis_run_id, analysis_core_hash\)\s*references public\.psi_tender_analysis_runs \(id, analysis_core_hash\)/i,
  'aggregate versions must FK their analysis_core_hash back to the run that produced them',
);
assert.match(
  migration,
  /add constraint psi_tender_analysis_runs_agt002_hash_unique\s*unique \(id, analysis_core_hash\)/i,
  'the run table needs a unique (id, analysis_core_hash) target for that FK',
);

// Terminal-shape invariant on the jobs table: COMPLETED always carries a real run id and no
// error_code; FAILED always carries an error_code and no run id; every other status carries
// neither.
assert.match(migration, /add column if not exists analysis_run_id uuid references public\.psi_tender_analysis_runs/i);
assert.match(
  migration,
  /check \(\s*\(status = 'COMPLETED' and analysis_run_id is not null and error_code is null\)\s*or\s*\(status = 'FAILED' and analysis_run_id is null and error_code is not null\)\s*or\s*\(status not in \('COMPLETED', 'FAILED'\) and analysis_run_id is null and error_code is null\)\s*\)/i,
);

// The one atomic completion RPC, SECURITY DEFINER, search_path-pinned, service_role-only.
assert.match(migration, /create or replace function public\.psi_complete_agt002_initial_analysis_job/i);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = public, pg_temp/i);

// The exact-replay guard (MENOR finding): a COMPLETED replay under the same run id only reuses
// the existing result once the lineage bindings AND the aggregate v1 row's own hashes/shape match
// every incoming parameter; any mismatch must be a 23505 conflict.
assert.match(migration, /v_existing_lineage\.workflow_instance_id is distinct from p_workflow_instance_id/i);
assert.match(migration, /v_existing_lineage\.authorization_id is distinct from p_authorization_id/i);
assert.match(migration, /v_existing_lineage\.package_version_id is distinct from p_package_version_id/i);
assert.match(migration, /v_existing_version\.analysis_core_hash is distinct from p_analysis_core_hash/i);
assert.match(migration, /v_existing_version\.envelope_hash is distinct from p_envelope_hash/i);
assert.match(migration, /v_existing_version\.schema_version is distinct from p_schema_version/i);
assert.match(migration, /v_existing_version\.envelope is distinct from p_envelope/i);
assert.match(migration, /v_existing_run\.result is distinct from p_envelope/i);

// The publication boundary must bind to the exact single synthesis artifact, not merely check
// that some synthesis checkpoint happens to exist for the job.
assert.match(migration, /psi_agt002_initial_analysis_checkpoints_one_synthesis_idx/i);
assert.match(migration, /v_synthesis\.output is distinct from p_envelope/i);
assert.match(migration, /v_existing\.output is distinct from p_output/i);
assert.match(migration, /v_existing\.usage is distinct from p_usage/i);
assert.doesNotMatch(
  migration,
  /v_auth\.expires_at\s*<=\s*now\(\)/i,
  'expiry is checked when G1 is consumed; a long-running job must still be able to complete after that consumed grant reaches its wall-clock expiry',
);

// P0-06 fail-boundary RPC: additive error_code column (closed snake_case shape) plus the RPC
// itself, mirroring the completion RPC's SECURITY DEFINER/search_path pinning.
assert.match(
  migration,
  /add column if not exists error_code text check \(error_code is null or error_code ~ '\^\[a-z0-9_\]\{3,80\}\$'\)/i,
);
assert.match(migration, /create or replace function public\.psi_fail_agt002_initial_analysis_job/i);
assert.match(migration, /p_error_code !~ '\^\[a-z0-9_\]\{3,80\}\$'/i, 'the RPC must re-validate the closed error-code shape itself, not merely trust the column CHECK');
assert.match(migration, /v_job\.status = 'FAILED'/i, 'a same-error-code replay against an already-FAILED job must be idempotent');
assert.match(migration, /v_job\.status = 'COMPLETED'[\s\S]{0,200}raise exception/i, 'a COMPLETED job must never be degraded to FAILED');
assert.match(
  migration,
  /payload -> 'persistence' ->> 'workflowInstanceId'/i,
  'the fail RPC must read the workflow binding from payload.persistence.workflowInstanceId, exactly like the executor does in JS',
);
assert.match(migration, /jsonb_build_object\('error_code', p_error_code\)/i, 'the FAILED workflow event evidence must be limited to {error_code}, never a richer payload');

// Grant-statement check, per function signature rather than one greedy whole-file regex: a
// naive /grant execute[\s\S]*to public/ scan false-positives on "insert into public.<table>"
// (the substring "to public" is hiding inside "in-TO PUBLIc."), which lives throughout this
// file's RPC bodies. Instead, parse each actual `grant execute on function ... to <roles>;`
// statement and assert its role list is exactly {service_role} — never public/anon/authenticated.
const GRANT_EXECUTE_STATEMENT = /grant execute on function public\.(\w+)\([^)]*\)\s+to\s+([^;]+);/gi;
const grantedFunctions = new Map();
for (const match of migration.matchAll(GRANT_EXECUTE_STATEMENT)) {
  const [, fnName, roleList] = match;
  const roles = roleList.split(',').map(role => role.trim().toLowerCase());
  grantedFunctions.set(fnName, roles);
}
assert.ok(grantedFunctions.has('psi_complete_agt002_initial_analysis_job'), 'psi_complete_agt002_initial_analysis_job must have a GRANT EXECUTE statement');
assert.ok(grantedFunctions.has('psi_fail_agt002_initial_analysis_job'), 'psi_fail_agt002_initial_analysis_job must have a GRANT EXECUTE statement');
for (const [fnName, roles] of grantedFunctions) {
  assert.deepEqual(roles, ['service_role'], `${fnName} must be granted to service_role only, never public/anon/authenticated`);
}

// Checkpoints RPCs backing the already-shipped P0-05 adapter.
for (const fn of ['psi_store_agt002_initial_analysis_checkpoint', 'psi_load_agt002_initial_analysis_checkpoint']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${fn}`, 'i'), `${fn} must be defined`);
  assert.ok(grantedFunctions.has(fn), `${fn} must have a GRANT EXECUTE statement`);
}

// This migration/rollback pair must never touch the reanalysis operational surface, and must
// never add any REANALYSIS-specific column, constraint or shape — P0-06 is INITIAL-only.
for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /psi_agt002_reanalysis_jobs/i, 'must not reference the reanalysis jobs table');
  assert.doesNotMatch(sql, /psi_(create|claim|complete|fail)_agt002_reanalysis_job/i, 'must not reference any reanalysis job RPC');
  assert.doesNotMatch(sql, /source_analysis_run_id/i, 'P0-06 is additive/INITIAL-only and must not bind to a source run at all — not even nullably');
  assert.doesNotMatch(sql, /analysis_kind[^;]*'REANALYSIS'/i, 'must not admit REANALYSIS into the analysis_kind CHECK');
  assert.doesNotMatch(sql, /analysis_version >= 2/i, 'must not define the REANALYSIS version-shape invariant');
  assert.doesNotMatch(sql, /reanalysis/i, 'production SQL comments must describe only INITIAL, never name the parallel reanalysis surface');
}

// Rollback: transactional, fail-closed on any existing INITIAL history.
assert.match(rollback, /^\s*begin\s*;/i);
assert.match(rollback, /commit\s*;\s*$/i);
assert.match(rollback, /raise exception/i);
// Strip full-line SQL comments before scanning: a comment merely discussing "delete or
// truncate" (prose, not code) must never trip this check — only a real statement would.
const rollbackCodeOnly = rollback.replace(/^\s*--.*$/gm, '');
assert.doesNotMatch(
  rollbackCodeOnly,
  /^\s*(delete\s+from\s+public\.psi_agt002_pre_go_analysis_versions\b|truncate\b)/im,
  'rollback must not contain a real DELETE/TRUNCATE statement against the append-only audit trail',
);
assert.match(rollback, /drop table if exists public\.psi_agt002_pre_go_analysis_versions/i);
assert.match(rollback, /drop table if exists public\.psi_agt002_initial_analysis_run_lineage/i);
assert.match(rollback, /drop table if exists public\.psi_agt002_initial_analysis_checkpoints/i);
assert.match(rollback, /alter column snapshot_id set not null/i);
assert.match(rollback, /drop function if exists public\.psi_fail_agt002_initial_analysis_job\(uuid, uuid, integer, text\)/i);
assert.match(rollback, /drop column if exists error_code/i);
assert.match(
  rollback,
  /exists \(select 1 from public\.psi_agt002_initial_analysis_jobs where error_code is not null limit 1\)/i,
  'rollback must also block while any job carries a recorded P0-06 failure (error_code)',
);

console.log('AGT-002 initial-analysis canonical persistence migration static safety passed');
