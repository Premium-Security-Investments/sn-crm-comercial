import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/028_agt002_preview_claims.sql', import.meta.url), 'utf8');
const heartbeatMigration = readFileSync(new URL('../supabase/migrations/079_agt002_lease_heartbeat.sql', import.meta.url), 'utf8');
const heartbeatRollback = readFileSync(new URL('../supabase/rollbacks/079_agt002_lease_heartbeat_rollback.sql', import.meta.url), 'utf8');
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const key = char => char.repeat(64);

async function renewPreviewClaim(db, idempotencyKey, claimId, leaseSeconds) {
  return (await one(db,
    'select public.psi_renew_agt002_preview_claim($1::text,$2::uuid,$3::int) as result',
    [idempotencyKey, claimId, leaseSeconds],
  )).result;
}

async function claim(db, idempotencyKey, daily = 20, concurrent = 2, lease = 30) {
  return (await one(db,
    'select public.psi_claim_agt002_preview_run($1::text,$2::int,$3::int,$4::int) as result',
    [idempotencyKey, daily, concurrent, lease],
  )).result;
}

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  alter role service_role bypassrls;
  grant service_role to current_user;
  create table public.psi_tender_analysis_runs (
    id uuid primary key default gen_random_uuid(),
    producer text not null,
    idempotency_key text not null unique,
    created_at timestamptz not null default now()
  );
`);
await db.exec(migration);
// Fixture-only counterpart of 068's public.psi_agt002_reanalysis_jobs, NOT a production
// schema substitute: 079 also defines psi_renew_agt002_reanalysis_job_lease, whose
// `%rowtype` declaration is resolved at CREATE FUNCTION time, so this isolated preview-only
// fixture needs the minimal columns that RPC references for 079 to compile here. Production
// applies migrations sequentially and already has the real table from 068.
await db.exec(`
  create table public.psi_agt002_reanalysis_jobs (
    id uuid primary key,
    lease_id uuid,
    status text,
    lease_expires_at timestamptz,
    updated_at timestamptz
  );
`);
await db.exec(heartbeatMigration);

// Two distinct simultaneous requests compete for one globally serialized slot.
const simultaneous = await Promise.all([
  claim(db, key('a'), 20, 1),
  claim(db, key('b'), 20, 1),
]);
assert.deepEqual(simultaneous.map(item => item.status).sort(), ['claimed', 'saturated']);
const winner = simultaneous.find(item => item.status === 'claimed');
const winnerKey = simultaneous[0].status === 'claimed' ? key('a') : key('b');

// Same-key retry is identified before generic saturation/quota.
assert.equal((await claim(db, winnerKey, 1, 1)).status, 'in_progress');

// Release refunds a failed attempt; the next distinct reservation can proceed.
assert.equal((await one(db,
  'select public.psi_release_agt002_preview_claim($1::text,$2::uuid) as released',
  [winnerKey, winner.claim_id],
)).released, true);
assert.equal((await claim(db, key('c'), 20, 1)).status, 'claimed');

// Active reservations count toward the daily budget atomically.
assert.equal((await claim(db, key('d'), 1, 10)).status, 'quota');

// Expired leases no longer block the same identity.
await db.exec("update public.psi_agt002_preview_claims set claimed_at = now() - interval '2 minutes', lease_expires_at = now() - interval '1 minute'");
const reclaimedC = await claim(db, key('c'), 20, 1);
assert.equal(reclaimedC.status, 'claimed');
const activeClaimId = reclaimedC.claim_id;

// A persisted run wins over a stale/in-flight claim and prevents a second provider call.
await db.query("insert into public.psi_tender_analysis_runs(producer,idempotency_key) values ('AGT-002',$1)", [key('z')]);
assert.equal((await claim(db, key('z'), 20, 1)).status, 'existing');

// Only service_role may execute RPCs; it still cannot mutate the claim table directly.
await db.exec('set role service_role');
assert.equal((await claim(db, key('z'), 20, 1)).status, 'existing');
await assert.rejects(() => db.query("insert into public.psi_agt002_preview_claims(idempotency_key, lease_expires_at) values ($1, now() + interval '1 minute')", [key('y')]), /permission denied/i);
await db.exec('reset role; set role authenticated');
await assert.rejects(() => claim(db, key('x'), 20, 1), /permission denied/i);
await db.exec('reset role; set role anon');
await assert.rejects(() => claim(db, key('w'), 20, 1), /permission denied/i);
await assert.rejects(() => db.query("insert into public.psi_agt002_preview_claims(idempotency_key, lease_expires_at) values ($1, now() + interval '1 minute')", [key('v')]), /permission denied/i);
await db.exec('reset role');

// --- AGT-002 lease heartbeat (migration 079) ---

// The active current claim renews and returns a parseable, bounded lease_expires_at.
const beforeRenew = Date.now();
const renewed = await renewPreviewClaim(db, key('c'), activeClaimId, 45);
assert.equal(renewed.status, 'renewed');
const renewedExpiry = Date.parse(renewed.lease_expires_at);
assert.ok(Number.isFinite(renewedExpiry), 'lease_expires_at must be a parseable timestamp');
assert.ok(renewedExpiry > beforeRenew && renewedExpiry - beforeRenew <= 46_000, 'renewed lease must be bounded to ~45s from now');

// The exact same idempotency_key with a stale/random claim_id is fenced off: it never
// renews and never alters the active token's lease.
const rowBeforeStaleRenew = await one(db, 'select lease_expires_at from public.psi_agt002_preview_claims where idempotency_key = $1', [key('c')]);
const staleRenew = await renewPreviewClaim(db, key('c'), '99999999-9999-4999-8999-999999999999', 45);
assert.equal(staleRenew.status, 'lost');
const rowAfterStaleRenew = await one(db, 'select lease_expires_at from public.psi_agt002_preview_claims where idempotency_key = $1', [key('c')]);
assert.equal(new Date(rowAfterStaleRenew.lease_expires_at).getTime(), new Date(rowBeforeStaleRenew.lease_expires_at).getTime());

// An expired current claim returns lost; it is never resurrected.
await db.exec(`update public.psi_agt002_preview_claims set claimed_at = now() - interval '2 seconds', lease_expires_at = now() - interval '1 second' where idempotency_key = '${key('c')}'`);
assert.equal((await renewPreviewClaim(db, key('c'), activeClaimId, 45)).status, 'lost');

// Restore an active lease before exercising the fail-closed lease-seconds checks.
await db.exec(`update public.psi_agt002_preview_claims set lease_expires_at = now() + interval '30 seconds' where idempotency_key = '${key('c')}'`);

// null/0/601 lease seconds fail closed.
await assert.rejects(() => renewPreviewClaim(db, key('c'), activeClaimId, null), /no es válida/i);
await assert.rejects(() => renewPreviewClaim(db, key('c'), activeClaimId, 0), /no es válida/i);
await assert.rejects(() => renewPreviewClaim(db, key('c'), activeClaimId, 601), /no es válida/i);

// Rollback ordering: 079 rolls back before the base migration's own rollback. Only the
// renewal RPC disappears; the base claim table and its RPCs remain usable.
await db.exec(heartbeatRollback);
await assert.rejects(() => renewPreviewClaim(db, key('c'), activeClaimId, 45), /psi_renew_agt002_preview_claim[\s\S]*does not exist/i);
assert.ok((await one(db, "select to_regclass('public.psi_agt002_preview_claims') as t")).t, 'base claim table must still exist after only the 079 rollback');
const claimAfterHeartbeatRollback = await claim(db, key('e'), 20, 5);
assert.equal(claimAfterHeartbeatRollback.status, 'claimed');
assert.equal((await one(db,
  'select public.psi_release_agt002_preview_claim($1::text,$2::uuid) as released',
  [key('e'), claimAfterHeartbeatRollback.claim_id],
)).released, true);

await db.close();
console.log('PGlite AGT-002 atomic claims integration passed');
