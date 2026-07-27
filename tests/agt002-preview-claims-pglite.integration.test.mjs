import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/028_agt002_preview_claims.sql', import.meta.url), 'utf8');
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const key = char => char.repeat(64);

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
assert.equal((await claim(db, key('c'), 20, 1)).status, 'claimed');

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

await db.close();
console.log('PGlite AGT-002 atomic claims integration passed');
