import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/040_agt003_copilot_runs.sql', import.meta.url), 'utf8');
const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  opportunity: '22222222-2222-4222-8222-222222222222',
};
const hash = char => char.repeat(64);
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];

async function claim(db, key, daily = 20, concurrent = 2, lease = 30) {
  return (await one(db, 'select public.psi_claim_agt003_copilot_run($1::text,$2::int,$3::int,$4::int) as result', [key, daily, concurrent, lease])).result;
}

async function record(db, key, claimId, overrides = {}) {
  const input = {
    opportunity: ids.opportunity,
    snapshot: 'snapshot-001',
    actor: ids.actor,
    contract: '2.0-draft.1',
    capability: 'agt003.opportunity-copilot.preview',
    policy: 'policy-v1',
    model: 'model-v1',
    output: { brief: { summary: 'synthetic' } },
    usage: { input_tokens: 1, output_tokens: 2 },
    inputHash: hash('a'),
    outputHash: hash('b'),
    ...overrides,
  };
  return (await one(db, `select public.psi_record_agt003_copilot_run(
    $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::jsonb,$11::jsonb,$12::text,$13::text
  ) as result`, [key, claimId, input.opportunity, input.actor, input.snapshot, input.contract, input.capability, input.policy, input.model, JSON.stringify(input.output), JSON.stringify(input.usage), input.inputHash, input.outputHash])).result;
}

async function recordFailure(db, key, claimId, failureCode = 'PROVIDER_UNAVAILABLE') {
  return (await one(db, `select public.psi_record_agt003_copilot_failure(
    $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text,$8::text,$9::text,$10::jsonb,$11::text,$12::text
  ) as result`, [key, claimId, ids.opportunity, ids.actor, 'snapshot-failed', '2.0-draft.1', 'agt003.opportunity-copilot.preview', 'policy-v1', 'model-v1', JSON.stringify({ input_tokens: 0, output_tokens: 0 }), hash('a'), failureCode])).result;
}

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  alter role service_role bypassrls;
  grant service_role to current_user;
  create table public.psi_sales_profiles (id uuid primary key);
  create table public.psi_sales_opportunities (id uuid primary key);
  insert into public.psi_sales_profiles values ('${ids.actor}');
  insert into public.psi_sales_opportunities values ('${ids.opportunity}');
`);
await db.exec(migration);

const simultaneous = await Promise.all([claim(db, hash('c'), 20, 1), claim(db, hash('d'), 20, 1)]);
assert.deepEqual(simultaneous.map(item => item.status).sort(), ['claimed', 'saturated']);
const winner = simultaneous.find(item => item.status === 'claimed');
const winnerKey = simultaneous[0].status === 'claimed' ? hash('c') : hash('d');
assert.equal((await claim(db, winnerKey, 20, 1)).status, 'in_progress');
assert.equal((await one(db, 'select public.psi_release_agt003_copilot_claim($1::text,$2::uuid) as released', [winnerKey, winner.claim_id])).released, true);

const key = hash('e');
const reserved = await claim(db, key, 20, 1);
const saved = await record(db, key, reserved.claim_id);
assert.equal(saved.status, 'completed');
assert.equal(saved.idempotency_key, key);
assert.equal((await claim(db, key, 20, 1)).status, 'existing');
const duplicate = await record(db, key, reserved.claim_id);
assert.equal(duplicate.id, saved.id, 'same immutable payload reuses the persisted run');
await assert.rejects(() => record(db, key, reserved.claim_id, { outputHash: hash('f') }), /idempotencia|conflicto/i);
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_agt003_copilot_runs')).count), 1);
assert.equal(Number((await one(db, 'select count(*)::int as count from public.psi_agt003_copilot_claims')).count), 0, 'terminal record releases its claim');

const noClaimKey = hash('0');
await assert.rejects(() => record(db, noClaimKey, '33333333-3333-4333-8333-333333333333'), /reserva|claim/i);
const active = await claim(db, hash('1'), 1, 5);
assert.equal(active.status, 'quota', 'persisted runs count toward daily quota');
await db.exec("update public.psi_agt003_copilot_claims set claimed_at=now()-interval '2 minutes', lease_expires_at=now()-interval '1 minute'");
assert.equal((await claim(db, hash('2'), 20, 1)).status, 'claimed', 'expired leases do not block capacity');

const failureKey = hash('6');
const failureClaim = await claim(db, failureKey, 20, 2);
const failed = await recordFailure(db, failureKey, failureClaim.claim_id);
assert.equal(failed.status, 'failed');
assert.equal(failed.failure_code, 'PROVIDER_UNAVAILABLE');
assert.equal(failed.output, null);
assert.equal((await claim(db, failureKey, 20, 2)).status, 'existing');
await assert.rejects(() => recordFailure(db, failureKey, failureClaim.claim_id, 'private detail'), /idempotencia|conflicto|válid/i);

const feedback = (await one(db, 'select public.psi_record_agt003_copilot_feedback($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) as result', [saved.id, ids.opportunity, ids.actor, 'useful', 'Útil.'])).result;
assert.equal(feedback.rating, 'useful');
await assert.rejects(() => one(db, 'select public.psi_record_agt003_copilot_feedback($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) as result', [saved.id, ids.opportunity, ids.actor, 'send', null]), /feedback|rating/i);
await assert.rejects(() => db.query('update public.psi_agt003_copilot_runs set model=$1 where id=$2', ['other', saved.id]), /append-only/i);
await assert.rejects(() => db.query('delete from public.psi_agt003_copilot_runs where id=$1', [saved.id]), /append-only/i);
await assert.rejects(() => db.query('update public.psi_agt003_copilot_feedback set comment=$1 where id=$2', ['other', feedback.id]), /append-only/i);
await assert.rejects(() => db.query('delete from public.psi_agt003_copilot_feedback where id=$1', [feedback.id]), /append-only/i);

await db.exec('set role service_role');
assert.equal((await claim(db, key, 20, 1)).status, 'existing');
await assert.rejects(() => db.query(`insert into public.psi_agt003_copilot_runs(idempotency_key,opportunity_id,snapshot_id,actor_id,contract_version,capability_id,policy_version,model,status,output,usage,input_hash,output_hash,completed_at) values ($1,'${ids.opportunity}','s','${ids.actor}','2','c','p','m','completed','{}','{}',$2,$3,now())`, [hash('3'), hash('a'), hash('b')]), /permission denied/i);
await db.exec('reset role; set role authenticated');
await assert.rejects(() => claim(db, hash('4')), /permission denied/i);
await assert.rejects(() => db.query('select * from public.psi_agt003_copilot_runs'), /permission denied/i);
await db.exec('reset role; set role anon');
await assert.rejects(() => claim(db, hash('5')), /permission denied/i);
await assert.rejects(() => db.query('select * from public.psi_agt003_copilot_feedback'), /permission denied/i);
await db.exec('reset role');

await db.close();
console.log('PGlite AGT-003 copilot append-only persistence passed');
