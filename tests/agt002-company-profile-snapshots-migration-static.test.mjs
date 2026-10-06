// AGT-002 migration 107 — immutable, hash-identified company-profile snapshots for INITIAL scope A_PLUS_B.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATION_ORDER } from '../scripts/agt002-initial-analysis-migrations.mjs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/107_agt002_company_profile_snapshots.sql');
const rollback = read('../supabase/rollbacks/107_agt002_company_profile_snapshots_rollback.sql');
const sql = text => text.replace(/--[^\n]*/g, '');

assert.equal(MIGRATION_ORDER[MIGRATION_ORDER.indexOf('106') + 1], '107', '107 must follow 106 in the governed chain');
assert.match(migration, /^--/);
assert.match(migration, /begin;/i);
assert.match(migration, /commit;\s*$/i);

// Table: service-role read only, RLS on, append-only, unique by hash.
assert.match(sql(migration), /create table if not exists public\.psi_agt002_company_profile_snapshots/);
assert.match(sql(migration), /unique \(snapshot_hash\)/);
assert.match(sql(migration), /snapshot_hash text not null check \(snapshot_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
assert.match(sql(migration), /enable row level security/);
assert.match(sql(migration), /revoke all on table public\.psi_agt002_company_profile_snapshots from public, authenticated, anon, service_role/);
assert.match(sql(migration), /grant select on table public\.psi_agt002_company_profile_snapshots to service_role/);
assert.doesNotMatch(sql(migration), /grant (insert|update|delete)[^;]*psi_agt002_company_profile_snapshots/i, 'writes only through the RPC');
assert.match(sql(migration), /before update or delete on public\.psi_agt002_company_profile_snapshots/);

// RPC: security definer, hardened search_path, idempotent by hash, conflicting content rejected, service role only.
assert.match(migration, /create or replace function public\.psi_freeze_agt002_company_profile_snapshot\(/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = public, pg_temp/);
assert.match(migration, /'status', 'existing'/);
assert.match(migration, /errcode = '23505'/);
assert.match(migration, /revoke all on function public\.psi_freeze_agt002_company_profile_snapshot\(jsonb, text, uuid\) from public, authenticated, anon, service_role/);
assert.match(migration, /grant execute on function public\.psi_freeze_agt002_company_profile_snapshot\(jsonb, text, uuid\) to service_role/);

// Rollback: fail-closed while any snapshot exists.
assert.match(rollback, /lock table public\.psi_agt002_company_profile_snapshots in access exclusive mode/);
assert.match(rollback, /Rollback 107 refused/);
assert.match(rollback, /errcode = '55000'/);
assert.match(rollback, /commit;\s*$/i);

console.log('AGT-002 migration 107 static contract passed');
