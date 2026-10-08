import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgt002IncrementalHostDrain } from '../agt002-incremental-host-drain.js';

function job(id) {
  return {
    jobId: id, leaseId: `lease-${id}`, opportunityId: 'o-1', tenderId: 't-1',
    snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: `key-${id}`,
    frozenEngineInput: { schema_version: 2, incremental_delta_manifest: {} }, requestedBy: 'p-1',
  };
}

test('drains an event job and one late successor serially without polling', async () => {
  const claimed = [];
  const recovery = [{ status: 'job_ready', job_id: 'job-2' }, { status: 'empty', job_id: null }];
  const drain = createAgt002IncrementalHostDrain({
    database: { kind: 'db' }, maxJobs: 10,
    recoverOne: async () => recovery.shift(),
    claimJobById: async (_db, { jobId }) => { claimed.push(jobId); return job(jobId); },
    executeJob: async (_db, claimedJob) => ({ status: 'completed', analysis_run_id: `run-${claimedJob.jobId}` }),
    createWorker: ({ database, claimJob }) => ({
      async runOnce() {
        const claimedJob = await claimJob(database, { leaseSeconds: 600 });
        return { status: 'completed', jobId: claimedJob.jobId, analysisRunId: `run-${claimedJob.jobId}` };
      },
    }),
  });
  const result = await drain.run({ targetJobId: 'job-1' });
  assert.deepEqual(claimed, ['job-1', 'job-2']);
  assert.equal(result.status, 'drained');
  assert.equal(result.jobs_processed, 2);
  assert.equal(result.bounded, false);
});

test('the drain stops at its explicit bound and leaves further durable work for recovery', async () => {
  let sequence = 0;
  const drain = createAgt002IncrementalHostDrain({
    database: {}, maxJobs: 2, executeJob: async () => ({}),
    recoverOne: async () => ({ status: 'job_ready', job_id: `job-${++sequence}` }),
    claimJobById: async (_db, { jobId }) => job(jobId),
    createWorker: ({ database, claimJob }) => ({ runOnce: async () => {
      const claimedJob = await claimJob(database, { leaseSeconds: 600 });
      return { status: 'completed', jobId: claimedJob.jobId, analysisRunId: `run-${claimedJob.jobId}` };
    } }),
  });
  const result = await drain.run();
  assert.equal(result.jobs_processed, 2);
  assert.equal(result.bounded, true);
});

test('a terminal job/set crash gap is reconciled before draining its late successor', async () => {
  const claimed = [];
  const recovery = [
    { status: 'reconciled', change_set_id: 'set-1', job_id: 'job-1', outcome: 'completed' },
    { status: 'job_ready', change_set_id: 'set-2', job_id: 'job-2' },
    { status: 'empty', job_id: null },
  ];
  const drain = createAgt002IncrementalHostDrain({
    database: {}, maxJobs: 10, executeJob: async () => ({}),
    recoverOne: async () => recovery.shift(),
    claimJobById: async (_db, { jobId }) => { claimed.push(jobId); return job(jobId); },
    createWorker: ({ database, claimJob }) => ({ runOnce: async () => {
      const claimedJob = await claimJob(database, { leaseSeconds: 600 });
      return { status: 'completed', jobId: claimedJob.jobId, analysisRunId: `run-${claimedJob.jobId}` };
    } }),
  });
  const result = await drain.run();
  assert.deepEqual(claimed, ['job-2']);
  assert.deepEqual(result.outcomes[0], {
    status: 'reconciled', jobId: 'job-1', changeSetId: 'set-1', outcome: 'completed',
  });
  assert.equal(result.jobs_processed, 2);
});
