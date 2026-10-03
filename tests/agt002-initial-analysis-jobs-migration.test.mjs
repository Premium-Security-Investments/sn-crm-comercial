// AGT-002 P0-04 (RED) — 101_agt002_initial_analysis_jobs.sql static contract.
//
// Mirrors the static-safety conventions of tests/agt002-reanalysis-rollback-safety.test.mjs and
// tests/agt002-radar-preanalysis-ledger-migration-static.test.mjs. This migration/rollback pair
// does not exist yet: readFileSync throwing ENOENT is the RED signal for the whole file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/101_agt002_initial_analysis_jobs.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/101_agt002_initial_analysis_jobs_rollback.sql', import.meta.url), 'utf8');

// Table and closed state machine.
assert.match(migration, /create table if not exists public\.psi_agt002_initial_analysis_jobs/i);
assert.match(migration, /status text not null check \(status in \(\s*'QUEUED',\s*'CLAIMED',\s*'RUNNING',\s*'NEEDS_ATTENTION',\s*'COMPLETED',\s*'FAILED'\s*\)\)/i);
assert.match(migration, /fence_version (bigint|integer) not null default 1/i);
assert.match(migration, /idempotency_key text not null/i);

// RLS / service_role-only surface.
assert.match(migration, /alter table public\.psi_agt002_initial_analysis_jobs enable row level security/i);
assert.match(migration, /revoke all on public\.psi_agt002_initial_analysis_jobs from public, authenticated, anon/i);
assert.match(migration, /grant select on public\.psi_agt002_initial_analysis_jobs to service_role/i);

// The three wished RPCs, all security-definer with a fixed search_path and service_role-only grants.
const REQUIRED_RPCS = [
  'psi_admit_agt002_initial_analysis_job',
  'psi_claim_agt002_initial_analysis_job',
  'psi_renew_agt002_initial_analysis_job_lease',
];
for (const fn of REQUIRED_RPCS) {
  assert.match(migration, new RegExp(`create or replace function public\\.${fn}`, 'i'), `${fn} must be defined`);
}
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = public, pg_temp/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.doesNotMatch(migration, /grant execute[\s\S]*to public/i);

// Claim discipline: FOR UPDATE SKIP LOCKED and a bounded lease.
assert.match(migration, /for update skip locked/i);

// One active job per opportunity, enforced by a partial unique index over the active statuses —
// the DB-level backstop behind the P0-04 "second active job is rejected" contract.
assert.match(
  migration,
  /create unique index if not exists psi_agt002_initial_analysis_jobs_one_active[\s\S]{0,200}where status in \(\s*'QUEUED',\s*'CLAIMED',\s*'RUNNING',\s*'NEEDS_ATTENTION'\s*\)/i,
);

// This migration/rollback pair must never touch the reanalysis operational surface.
for (const sql of [migration, rollback]) {
  assert.doesNotMatch(sql, /psi_agt002_reanalysis_jobs/i, 'must not reference the reanalysis jobs table');
  assert.doesNotMatch(sql, /psi_claim_agt002_reanalysis/i, 'must not reference the reanalysis claim RPC');
  assert.doesNotMatch(sql, /psi_(create|complete|fail)_agt002_reanalysis_job/i, 'must not reference any other reanalysis job RPC');
}

// Rollback: transactional, fail-closed on any existing row, drops only the objects this
// migration introduces (the table and its three RPCs) — nothing from the reanalysis surface.
assert.match(rollback, /^\s*begin\s*;/i);
assert.match(rollback, /commit\s*;\s*$/i);
assert.match(rollback, /to_regclass\('public\.psi_agt002_initial_analysis_jobs'\) is not null/i);
assert.match(rollback, /raise exception/i);
assert.doesNotMatch(rollback, /delete\s+from\s+public\.psi_agt002_initial_analysis_jobs|truncate\s+.*psi_agt002_initial_analysis_jobs/i);

assert.match(rollback, /drop table if exists public\.psi_agt002_initial_analysis_jobs/i);
for (const fn of REQUIRED_RPCS) {
  assert.match(rollback, new RegExp(`drop function if exists public\\.${fn}`, 'i'), `rollback must drop ${fn}`);
}

console.log('AGT-002 initial-analysis jobs migration static safety passed');
