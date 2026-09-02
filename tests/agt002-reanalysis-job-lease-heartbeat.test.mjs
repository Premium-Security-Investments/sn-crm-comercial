// AGT-002 fenced lease heartbeat — reanalysis job adapter (RED, no production change).
//
// Mirror of tests/agt002-preview-claim-lease-heartbeat.test.mjs for the durable reanalysis queue
// (migration 068's psi_agt002_reanalysis_jobs + its fencing token `lease_id`). A V7 discovery run
// executed by the worker makes N sequential provider calls under one 600s lease; the desired
// remediation renews the lease at each deterministic stage boundary — immediately before every
// provider call and before final persistence — and fails closed when the renewal reports the lease
// was lost. No timer, no sleep, no background refresh.
//
// The wished `renewAgt002ReanalysisJobLease(database, { jobId, leaseId, leaseSeconds })` export of
// agt002-reanalysis-jobs.js does not exist yet: that absence is the RED signal. The only double is
// the Supabase-shaped `.rpc()` client, exactly as in tests/agt002-reanalysis-jobs.test.mjs.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as reanalysisJobs from '../agt002-reanalysis-jobs.js';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';

const RENEW_RPC = 'psi_renew_agt002_reanalysis_job_lease';

const IDENTITY = Object.freeze({
  jobId: '00000000-0000-4000-8000-0000000000a1',
  leaseId: '00000000-0000-4000-8000-0000000000b2',
  leaseSeconds: 600,
});

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

function renew(database, overrides = {}) {
  const renewFn = reanalysisJobs.renewAgt002ReanalysisJobLease;
  assert.equal(
    typeof renewFn, 'function',
    'agt002-reanalysis-jobs.js must export renewAgt002ReanalysisJobLease(database, { jobId, leaseId, leaseSeconds })',
  );
  return renewFn(database, { ...IDENTITY, ...overrides });
}

test('the reanalysis job adapter exposes the wished stage-boundary renewal API', () => {
  assert.equal(
    typeof reanalysisJobs.renewAgt002ReanalysisJobLease, 'function',
    'the fenced heartbeat needs an explicit renewal wrapper; a timer or an implicit background refresh is not the contract',
  );
});

test('renewal maps to the exact snake_case RPC params and returns the camelCase renewed lease', async () => {
  const db = fakeDb({
    rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:10:00.000Z' }, error: null } },
  });
  const result = await renew(db);
  assert.deepEqual(db.rpcCalls, [{
    name: RENEW_RPC,
    args: {
      p_job_id: IDENTITY.jobId,
      p_lease_id: IDENTITY.leaseId,
      p_lease_seconds: IDENTITY.leaseSeconds,
    },
  }], 'the renewal must be one fenced RPC call carrying exactly the job id, the lease_id fencing token and the lease seconds');
  assert.deepEqual(result, { status: 'renewed', leaseExpiresAt: '2026-09-02T00:10:00.000Z' });
});

test('the renewal wrapper never forwards free text or raw provider data', async () => {
  const db = fakeDb({
    rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:10:00.000Z' }, error: null } },
  });
  await renew(db);
  assert.deepEqual(
    Object.keys(db.rpcCalls[0].args).sort(),
    ['p_job_id', 'p_lease_id', 'p_lease_seconds'],
    'a heartbeat carries identity and a bounded duration only — never an error message, a result or model output',
  );
});

test('a lost lease fails closed and classifies as the existing closed lease_lost code', async () => {
  const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: { status: 'lost' }, error: null } } });
  await assert.rejects(
    renew(db),
    error => {
      // Deliberately asserted through the REAL, unchanged worker classifier instead of a hardcoded
      // literal: the renewal rejection must land on the existing closed 'lease_lost' code without
      // any new error vocabulary being introduced.
      assert.equal(
        classifyAgt002ReanalysisWorkerError(error), 'lease_lost',
        'a lost lease must carry a stable, non-secret code that the existing closed classifier maps to lease_lost',
      );
      return true;
    },
    'status "lost" must never be returned as if the lease had been renewed',
  );
  assert.equal(db.rpcCalls.length, 1, 'a lost lease must not trigger any follow-up call (no complete, no re-renew, no persistence)');
});

test('a malformed renewal result never counts as a renewed lease', async () => {
  const malformed = [
    { status: 'renewed' },
    { status: 'renewed', lease_expires_at: '' },
    { status: 'renewed', lease_expires_at: '   ' },
    { status: 'renewed', lease_expires_at: 7 },
    { status: 'renewed', lease_expires_at: null },
    { status: 'bogus', lease_expires_at: '2026-09-02T00:10:00.000Z' },
    { lease_expires_at: '2026-09-02T00:10:00.000Z' },
    true,
    'renewed',
    null,
  ];
  for (const data of malformed) {
    const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data, error: null } } });
    await assert.rejects(renew(db), `${JSON.stringify(data)} must fail closed instead of being accepted as a renewed lease`);
    assert.equal(db.rpcCalls.length, 1, 'a malformed renewal must not trigger any follow-up call');
  }
});

test('a database error on renewal fails closed rather than resolving', async () => {
  const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: null, error: { code: '55000', status: 409, message: 'reserva inválida o expirada' } } } });
  await assert.rejects(renew(db), 'an RPC error must never be swallowed into a successful renewal');
  assert.equal(db.rpcCalls.length, 1);
});

test('an incomplete fenced identity never reaches the database', async () => {
  for (const overrides of [
    { jobId: '' },
    { jobId: null },
    { jobId: undefined },
    { leaseId: '' },
    { leaseId: null },
    { leaseId: undefined },
  ]) {
    const db = fakeDb();
    await assert.rejects(renew(db, overrides), `${JSON.stringify(overrides)} must be rejected before any RPC`);
    assert.equal(db.rpcCalls.length, 0, 'an unfenced renewal (missing job_id or lease_id) must never reach the database');
  }
});

test('an invalid lease duration never reaches the database', async () => {
  for (const leaseSeconds of [0, -1, 1.5, 601, 100000, '600', null, undefined, NaN, Infinity]) {
    const db = fakeDb();
    await assert.rejects(renew(db, { leaseSeconds }), `leaseSeconds=${String(leaseSeconds)} must be rejected before any RPC`);
    assert.equal(db.rpcCalls.length, 0, 'an out-of-range or non-integer lease duration must never reach the database');
  }
  for (const leaseSeconds of [1, 600]) {
    const db = fakeDb({ rpcResults: { [RENEW_RPC]: { data: { status: 'renewed', lease_expires_at: '2026-09-02T00:10:00.000Z' }, error: null } } });
    await renew(db, { leaseSeconds });
    assert.equal(db.rpcCalls[0].args.p_lease_seconds, leaseSeconds);
  }
});
