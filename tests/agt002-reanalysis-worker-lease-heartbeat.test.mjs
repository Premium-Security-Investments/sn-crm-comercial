// AGT-002 fenced lease heartbeat — durable reanalysis worker (RED, no production change).
//
// The worker claims one job with a bounded lease (migration 068's psi_agt002_reanalysis_jobs +
// its `lease_id` fencing token) and hands it to `executeJob`, which — under V7 complete discovery —
// now spends N sequential provider calls inside that single lease. The remediation is a
// DETERMINISTIC STAGE-BOUNDARY heartbeat, never a timer: the worker gives the executor an explicit
// `beforeProviderCall` callback that renews THIS job's jobId+leaseId, and a lost lease closes the
// job fail-closed as the existing closed `lease_lost` code without it ever being completable.
//
// `executeJob(database, job)` receives no third argument today, so the first test below is the RED
// signal. The claim/complete/fail seams the existing suite already uses
// (tests/agt002-reanalysis-worker.test.mjs) are reused verbatim; the renewal itself is observed
// through a Supabase-shaped `.rpc()` double rather than a new mock, so the worker is required to go
// through the real fenced adapter. No network, no provider, no timer, no sleep.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgt002ReanalysisWorker } from '../agt002-reanalysis-worker.js';

const RENEW_RPC = 'psi_renew_agt002_reanalysis_job_lease';
const LEASE_SECONDS = 600;

const JOB = Object.freeze({
  jobId: 'job-hb-1', leaseId: 'lease-hb-1', opportunityId: 'opp-1', tenderId: 'tender-1',
  snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-1',
  frozenEngineInput: { schema_version: 1 }, requestedBy: 'actor-1',
});

function fakeDb({ rpcResults = {} } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    names: () => rpcCalls.map(call => call.name),
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const result = rpcResults[name];
      if (typeof result === 'function') return Promise.resolve(result(args));
      return Promise.resolve(result || { data: null, error: null });
    },
  };
}

function harness({ renewResult = { status: 'renewed', lease_expires_at: '2026-09-02T00:10:00.000Z' }, execute } = {}) {
  const calls = { claim: [], execute: [], complete: [], fail: [] };
  const database = fakeDb({ rpcResults: { [RENEW_RPC]: { data: renewResult, error: null } } });
  const worker = createAgt002ReanalysisWorker({
    database,
    leaseSeconds: LEASE_SECONDS,
    claimJob: async (...args) => { calls.claim.push(args); return JOB; },
    executeJob: async (...args) => { calls.execute.push(args); return execute(...args); },
    completeJob: async (...args) => { calls.complete.push(args); return { status: 'completed' }; },
    failJob: async (...args) => { calls.fail.push(args); return { status: 'unavailable' }; },
  });
  return { worker, calls, database };
}

/** The wished explicit heartbeat handle the executor is given alongside the job. */
function heartbeatOf(executeArgs) {
  const options = executeArgs[2];
  assert.equal(
    typeof options?.beforeProviderCall, 'function',
    'executeJob must receive an explicit beforeProviderCall callback so it can renew this job\'s lease at each stage boundary',
  );
  return options.beforeProviderCall;
}

test('the executor is handed an explicit stage-boundary renewal callback', async () => {
  const { worker, calls } = harness({ execute: async () => ({ status: 'completed', analysis_run_id: 'run-1' }) });
  await worker.runOnce();
  assert.equal(calls.execute.length, 1, 'zero retry: the executor is still invoked exactly once');
  heartbeatOf(calls.execute[0]);
});

test('the callback renews exactly this job, fenced by its own lease_id', async () => {
  const { worker, calls, database } = harness({
    execute: async (...args) => {
      await heartbeatOf(args)();
      return { status: 'completed', analysis_run_id: 'run-1' };
    },
  });
  const result = await worker.runOnce();

  assert.deepEqual(database.rpcCalls, [{
    name: RENEW_RPC,
    args: { p_job_id: JOB.jobId, p_lease_id: JOB.leaseId, p_lease_seconds: LEASE_SECONDS },
  }], "the renewal must carry exactly this job's id, its lease_id fencing token and the worker's configured lease window");
  assert.deepEqual(result, { status: 'completed', jobId: JOB.jobId, analysisRunId: 'run-1' });
  assert.deepEqual(calls.complete[0][1], { jobId: JOB.jobId, leaseId: JOB.leaseId, analysisRunId: 'run-1' });
  assert.equal(calls.fail.length, 0);
});

test('one renewal per stage boundary, and none at all when the executor asks for none', async () => {
  const { worker, calls, database } = harness({
    execute: async (...args) => {
      const heartbeat = heartbeatOf(args);
      await heartbeat();
      await heartbeat();
      await heartbeat();
      return { status: 'completed', analysis_run_id: 'run-1' };
    },
  });
  await worker.runOnce();
  assert.equal(
    database.rpcCalls.filter(call => call.name === RENEW_RPC).length, 3,
    'N provider turns must produce N renewals: the heartbeat is driven by stage boundaries, never by a clock',
  );

  const quiet = harness({ execute: async () => ({ status: 'completed', analysis_run_id: 'run-1' }) });
  await quiet.worker.runOnce();
  assert.deepEqual(
    quiet.database.names(), [],
    'an executor that takes no provider turn must produce no renewal at all: nothing may fire on a timer',
  );
});

test('a lost lease propagated by the executor closes the job as the existing closed lease_lost code', async () => {
  const { worker, calls, database } = harness({
    renewResult: { status: 'lost' },
    // The realistic path: the executor awaits the heartbeat before its next provider call, the
    // rejection propagates, and no provider call is ever made from that point on.
    execute: async (...args) => {
      await heartbeatOf(args)();
      throw new Error('unreachable: the heartbeat must have rejected before this line');
    },
  });
  const result = await worker.runOnce();

  assert.deepEqual(result, { status: 'unavailable', jobId: JOB.jobId, errorCode: 'lease_lost' });
  assert.equal(calls.complete.length, 0, 'a job whose lease was lost can never be completed');
  assert.deepEqual(calls.fail[0][1], { jobId: JOB.jobId, leaseId: JOB.leaseId, errorCode: 'lease_lost' });
  assert.equal(database.rpcCalls.filter(call => call.name === RENEW_RPC).length, 1, 'a lost lease is never re-renewed');
  assert.doesNotMatch(JSON.stringify(result), /unreachable|lease_expires_at/, 'no raw executor or renewal detail may reach the worker outcome');
});

test('a lost lease can never be completed even if the executor returns a run id anyway', async () => {
  // Fail-closed backstop: once the fenced renewal reported the lease lost, another worker may
  // already own this job. Whatever the executor then returns, this worker must not close the job as
  // completed against it.
  const { worker, calls } = harness({
    renewResult: { status: 'lost' },
    execute: async (...args) => {
      await heartbeatOf(args)().catch(() => {});
      return { status: 'completed', analysis_run_id: 'run-after-lease-loss' };
    },
  });
  const result = await worker.runOnce();

  assert.equal(calls.complete.length, 0, 'the job must not be completed after its lease was reported lost');
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'lease_lost');
  assert.deepEqual(calls.fail[0][1], { jobId: JOB.jobId, leaseId: JOB.leaseId, errorCode: 'lease_lost' });
});

test('the existing closed error handling is preserved for non-lease failures', async () => {
  const secret = new Error('provider raw secret');
  secret.code = 'AGT002_CODEX_TIMEOUT';
  const { worker, calls, database } = harness({
    execute: async () => { throw secret; },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: JOB.jobId, errorCode: 'timeout' });
  assert.equal(calls.execute.length, 1);
  assert.deepEqual(calls.fail[0][1], { jobId: JOB.jobId, leaseId: JOB.leaseId, errorCode: 'timeout' });
  assert.doesNotMatch(JSON.stringify(calls.fail), /raw secret/);
  assert.deepEqual(database.names(), [], 'a failure with no stage boundary crossed must not renew anything');
});
