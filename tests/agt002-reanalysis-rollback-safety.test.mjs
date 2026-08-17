import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/068_agt002_reanalysis_jobs.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/068_agt002_reanalysis_jobs_rollback.sql', import.meta.url), 'utf8');

// Table shape and closed state machine.
assert.match(migration, /create table if not exists public\.psi_agt002_reanalysis_jobs/i);
assert.match(migration, /frozen_engine_input jsonb not null/i);
assert.match(migration, /status text not null check \(status in \(\s*'queued',\s*'running',\s*'completed',\s*'unavailable'\s*\)\)/i);
assert.match(migration, /idempotency_key text not null check/i);
assert.doesNotMatch(migration, /idempotency_key text not null unique/i);
assert.match(migration, /create index if not exists psi_agt002_reanalysis_jobs_idempotency_idx/i);
assert.match(migration, /create unique index if not exists psi_agt002_reanalysis_jobs_one_active[\s\S]*where status in \(\s*'queued',\s*'running'\s*\)/i);
assert.match(migration, /context_version_id uuid not null references public\.psi_agt002_context_versions\(id\)/i);

// RLS / service_role-only surface.
assert.match(migration, /alter table public\.psi_agt002_reanalysis_jobs enable row level security/i);
assert.match(migration, /revoke all on public\.psi_agt002_reanalysis_jobs from public, authenticated, anon/i);
assert.match(migration, /grant select on public\.psi_agt002_reanalysis_jobs to service_role/i);

// Security-definer RPCs with fixed search_path, service_role-only execution.
for (const fn of ['psi_create_agt002_reanalysis_job', 'psi_claim_agt002_reanalysis_job', 'psi_complete_agt002_reanalysis_job', 'psi_fail_agt002_reanalysis_job']) {
  const fnRegex = new RegExp(`create or replace function public\\.${fn}`, 'i');
  assert.match(migration, fnRegex, `${fn} must be defined`);
}
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = public, pg_temp/i);
assert.match(migration, /grant execute[\s\S]*service_role/i);
assert.doesNotMatch(migration, /grant execute[\s\S]*to public/i);

// The create RPC's signature carries context_version_id, and its grant/revoke pair was
// updated to the new seven-argument signature (not left stale against the old six-arg one).
assert.match(migration, /create or replace function public\.psi_create_agt002_reanalysis_job\(\s*p_opportunity_id uuid,\s*p_tender_id uuid,\s*p_snapshot_id uuid,\s*p_context_version_id uuid,/i);
assert.match(migration, /psi_create_agt002_reanalysis_job\(uuid, uuid, uuid, uuid, text, jsonb, uuid\)/i);

// Claim discipline: FOR UPDATE SKIP LOCKED and a bounded lease.
assert.match(migration, /for update skip locked/i);
assert.match(migration, /least\(/i);

// Frozen identity/input immutability enforced by trigger, not just convention, and it
// covers context_version_id too.
assert.match(migration, /before update on public\.psi_agt002_reanalysis_jobs/i);
assert.match(migration, /inmutable/i);
assert.match(migration, /new\.context_version_id is distinct from old\.context_version_id/i);

// Partial unique active-job rule and a claimable index.
assert.match(migration, /create unique index if not exists psi_agt002_reanalysis_jobs_one_active[\s\S]*where status in \('queued', ?'running'\)/i);
assert.match(migration, /create index if not exists psi_agt002_reanalysis_jobs_claimable_idx/i);

// No automatic requeue/retry anywhere in the schema.
assert.doesNotMatch(migration, /retry|reintent|requeue/i);

// Completed requires a real canonical run; unavailable only carries a closed code/message.
assert.match(migration, /canonical/i);
assert.match(migration, /error_code text check \(error_code is null or error_code in \(/i);

// Claim sweeps expired-lease running jobs to a terminal, closed lease_lost state BEFORE
// looking for queued work — so a crashed worker's job can never be silently requeued or
// handed back out as a fresh claim.
assert.match(migration, /set status = 'unavailable'[\s\S]{0,200}error_code = 'lease_lost'[\s\S]{0,400}where status = 'running' and lease_expires_at <= now\(\)/i);

// Completion and failure both release the lease on the way to a terminal state — a
// terminal row can never be mistaken for a still-live claim. At least three distinct
// lease-clearing sites: the expiry sweep in claim, complete, and fail.
const leaseClearCount = (migration.match(/lease_id = null/gi) || []).length;
assert.ok(leaseClearCount >= 3, `expected lease_id to be cleared to null in at least 3 places (sweep, complete, fail), found ${leaseClearCount}`);

// Rollback is transactional and fail-closed on ANY existing row — not scoped to "active"
// jobs only — so terminal history (completed/unavailable) can never be silently dropped.
assert.match(rollback, /^\s*begin\s*;/i);
assert.match(rollback, /commit\s*;\s*$/i);
assert.match(rollback, /to_regclass\('public\.psi_agt002_reanalysis_jobs'\) is not null/i);
assert.match(rollback, /exists\s*\(\s*select 1 from public\.psi_agt002_reanalysis_jobs/i);
assert.doesNotMatch(rollback, /where\s+status/i);
assert.match(rollback, /raise exception/i);
assert.match(rollback, /drop table if exists public\.psi_agt002_reanalysis_jobs/i);
assert.doesNotMatch(rollback, /delete\s+from\s+public\.psi_agt002_reanalysis_jobs|truncate\s+.*psi_agt002_reanalysis_jobs/i);

// The rollback's drop for the create RPC must track the migration's current (seven-arg)
// signature — a stale drop signature would leave the old function behind on rollback.
assert.match(rollback, /drop function if exists public\.psi_create_agt002_reanalysis_job\(uuid, uuid, uuid, uuid, text, jsonb, uuid\)/i);

console.log('AGT-002 reanalysis jobs rollback safety contract passed');
