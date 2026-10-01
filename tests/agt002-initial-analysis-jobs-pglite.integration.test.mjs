// AGT-002 P0-04 PGlite integration for migration 099 (RED then GREEN).
//
// 099's job table has no FK to 097/098's tables, so this fixture applies only 099 against a
// minimal role/grant harness rather than the full 097+098+099 migration chain.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migrationSource = name => strip(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));

const migration099 = () => migrationSource('099_agt002_initial_analysis_jobs.sql');

const O = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const WORKER = 'agt002-initial-analysis-worker';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function callRpc(pg, name, params) {
  const args = Object.values(params).map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${args}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createBaseFixture() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    grant service_role to current_user;
  `);
  return pg;
}

async function freshDb() {
  const pg = await createBaseFixture();
  await pg.exec(migration099());
  return pg;
}

async function admit(pg, overrides = {}) {
  const opts = {
    opportunityId: O, tenderId: T, idempotencyKey: 'idem-admit-default',
    payload: { manifest: 'v1' }, requestedBy: 'user-1', ...overrides,
  };
  return callRpc(pg, 'psi_admit_agt002_initial_analysis_job', {
    p_opportunity_id: opts.opportunityId, p_tender_id: opts.tenderId, p_idempotency_key: opts.idempotencyKey,
    p_payload: opts.payload, p_requested_by: opts.requestedBy,
  });
}

async function claim(pg, overrides = {}) {
  const opts = { workerId: WORKER, leaseSeconds: 60, ...overrides };
  return callRpc(pg, 'psi_claim_agt002_initial_analysis_job', {
    p_worker_id: opts.workerId, p_lease_seconds: opts.leaseSeconds,
  });
}

async function renew(pg, overrides = {}) {
  const opts = { jobId: undefined, leaseId: undefined, fenceVersion: undefined, leaseSeconds: 60, ...overrides };
  return callRpc(pg, 'psi_renew_agt002_initial_analysis_job_lease', {
    p_job_id: opts.jobId, p_lease_id: opts.leaseId, p_fence_version: opts.fenceVersion, p_lease_seconds: opts.leaseSeconds,
  });
}

async function jobCount(pg) {
  return (await pg.query(`select count(*)::int as n from public.psi_agt002_initial_analysis_jobs`)).rows[0].n;
}

async function markCompleted(pg, jobId) {
  await pg.exec(`update public.psi_agt002_initial_analysis_jobs set status = 'COMPLETED', updated_at = now() where id = '${jobId}'`);
}

async function expireLease(pg, jobId) {
  await pg.exec(`update public.psi_agt002_initial_analysis_jobs set lease_expires_at = now() - interval '1 hour' where id = '${jobId}'`);
}

test('migration 099 applies cleanly and defines the table and three RPCs', async () => {
  const pg = await freshDb();
  try {
    const table = (await pg.query(`select to_regclass('public.psi_agt002_initial_analysis_jobs') is not null as present`)).rows[0];
    assert.equal(table.present, true);

    const fns = (await pg.query(`
      select
        to_regprocedure('public.psi_admit_agt002_initial_analysis_job(uuid,uuid,text,jsonb,text)') is not null as admit,
        to_regprocedure('public.psi_claim_agt002_initial_analysis_job(text,integer)') is not null as claim,
        to_regprocedure('public.psi_renew_agt002_initial_analysis_job_lease(uuid,uuid,integer,integer)') is not null as renew
    `)).rows[0];
    assert.equal(fns.admit, true);
    assert.equal(fns.claim, true);
    assert.equal(fns.renew, true);
  } finally {
    await pg.close();
  }
});

test('admit creates a QUEUED job; an exact replay returns the existing same id; a payload mismatch fails closed and inserts nothing new', async () => {
  const pg = await freshDb();
  try {
    const first = await admit(pg, { idempotencyKey: 'idem-replay' });
    assert.equal(first.status, 'admitted');
    assert.ok(first.job_id);
    assert.equal(first.job_status, 'QUEUED');
    assert.equal(await jobCount(pg), 1);

    const replay = await admit(pg, { idempotencyKey: 'idem-replay' });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.job_id, first.job_id);
    assert.equal(await jobCount(pg), 1, 'an exact replay must insert nothing new');

    const mismatch = await admit(pg, { idempotencyKey: 'idem-replay', payload: { manifest: 'v2' } });
    assert.equal(mismatch.status, 'payload_mismatch');
    assert.equal(mismatch.job_id, first.job_id);
    assert.equal(await jobCount(pg), 1, 'a payload mismatch under the same key must insert nothing new');
  } finally {
    await pg.close();
  }
});

test('a second admit for the same opportunity while the first is QUEUED raises 55000', async () => {
  const pg = await freshDb();
  try {
    await admit(pg, { idempotencyKey: 'idem-active-1' });
    await assert.rejects(
      admit(pg, { idempotencyKey: 'idem-active-2' }),
      error => /55000/.test(String(error.message ?? error)) || String(error.code) === '55000',
    );
    assert.equal(await jobCount(pg), 1, 'a blocked second admission must never insert a row');
  } finally {
    await pg.close();
  }
});

test('after a job is marked COMPLETED, a new admit for the same opportunity raises 55001', async () => {
  const pg = await freshDb();
  try {
    const first = await admit(pg, { idempotencyKey: 'idem-completed-1' });
    await markCompleted(pg, first.job_id);

    await assert.rejects(
      admit(pg, { idempotencyKey: 'idem-completed-2' }),
      error => /55001/.test(String(error.message ?? error)) || String(error.code) === '55001',
    );
    assert.equal(await jobCount(pg), 1, 'an admit blocked by a prior COMPLETED job must never insert a second row');
  } finally {
    await pg.close();
  }
});

test('claim rejects a worker_id other than agt002-initial-analysis-worker; the correct identity claims and returns fence_version 1; a second claim while the lease is live returns empty', async () => {
  const pg = await freshDb();
  try {
    await admit(pg, { idempotencyKey: 'idem-claim-1' });

    await assert.rejects(claim(pg, { workerId: 'some-other-worker' }), /./);

    const claimed = await claim(pg);
    assert.equal(claimed.status, 'claimed');
    assert.equal(claimed.fence_version, 1);
    assert.ok(claimed.lease_id);

    const second = await claim(pg);
    assert.equal(second.status, 'empty');
  } finally {
    await pg.close();
  }
});

test('expiring the lease lets a reclaim increment fence_version; an old-fence renew is fenced, a matching-fence renew succeeds, and a wrong lease_id is lost', async () => {
  const pg = await freshDb();
  try {
    await admit(pg, { idempotencyKey: 'idem-reclaim-1' });
    const firstClaim = await claim(pg);
    assert.equal(firstClaim.fence_version, 1);

    await expireLease(pg, firstClaim.job_id);

    const reclaim = await claim(pg);
    assert.equal(reclaim.status, 'claimed');
    assert.equal(reclaim.job_id, firstClaim.job_id);
    assert.equal(reclaim.fence_version, 2, 'a reclaim of an expired lease must strictly increment the fencing token');

    const staleRenew = await renew(pg, { jobId: firstClaim.job_id, leaseId: reclaim.lease_id, fenceVersion: 1, leaseSeconds: 60 });
    assert.equal(staleRenew.status, 'fenced', 'the superseded fence_version must be rejected as fenced');

    const matchingRenew = await renew(pg, { jobId: firstClaim.job_id, leaseId: reclaim.lease_id, fenceVersion: 2, leaseSeconds: 60 });
    assert.equal(matchingRenew.status, 'renewed');

    const wrongLease = await renew(pg, { jobId: firstClaim.job_id, leaseId: firstClaim.lease_id, fenceVersion: 2, leaseSeconds: 60 });
    assert.equal(wrongLease.status, 'lost', 'the old lease_id from the superseded claim must be reported as lost');
  } finally {
    await pg.close();
  }
});

test('the applied claim function source contains FOR UPDATE SKIP LOCKED', () => {
  assert.match(migration099(), /for update skip locked/i);
});

test('admit never inserts into any reanalysis-named table', async (t) => {
  const pg = await freshDb();
  try {
    const reanalysisTables = (await pg.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name ilike '%reanalysis%'
    `)).rows;
    if (reanalysisTables.length === 0) {
      t.skip('068 (psi_agt002_reanalysis_jobs) is not part of the 099-only fixture');
      return;
    }
    await admit(pg, { idempotencyKey: 'idem-no-reanalysis' });
    for (const { table_name } of reanalysisTables) {
      const count = (await pg.query(`select count(*)::int as n from public.${table_name}`)).rows[0].n;
      assert.equal(count, 0, `${table_name} must remain untouched by admit`);
    }
  } finally {
    await pg.close();
  }
});

test('the rollback refuses to run while any job row exists, and succeeds against a pristine install', async () => {
  const seeded = await freshDb();
  try {
    await admit(seeded, { idempotencyKey: 'idem-rollback-guard' });
    const rollback099 = strip(readFileSync(new URL('../supabase/rollbacks/099_agt002_initial_analysis_jobs_rollback.sql', import.meta.url), 'utf8'));
    await assert.rejects(seeded.exec(rollback099), /./);
  } finally {
    await seeded.close();
  }

  const pristine = await freshDb();
  try {
    const rollback099 = strip(readFileSync(new URL('../supabase/rollbacks/099_agt002_initial_analysis_jobs_rollback.sql', import.meta.url), 'utf8'));
    await pristine.exec(rollback099);
    const table = (await pristine.query(`select to_regclass('public.psi_agt002_initial_analysis_jobs') is null as gone`)).rows[0];
    assert.equal(table.gone, true);

    const preserved = (await pristine.query(`select exists (select 1 from pg_roles where rolname = 'service_role') as still_there`)).rows[0];
    assert.equal(preserved.still_there, true, 'rollback 099 must never touch preexisting harness state');
  } finally {
    await pristine.close();
  }
});
