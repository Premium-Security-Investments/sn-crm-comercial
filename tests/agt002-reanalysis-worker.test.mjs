import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgt002ReanalysisWorker } from '../agt002-reanalysis-worker.js';

const JOB = Object.freeze({
  jobId: 'job-1', leaseId: 'lease-1', opportunityId: 'opp-1', tenderId: 'tender-1',
  snapshotId: 'snapshot-1', contextVersionId: 'context-1', idempotencyKey: 'key-1',
  frozenEngineInput: { schema_version: 1 }, requestedBy: 'actor-1',
});

function harness({ claim = JOB, outcome = { status: 'completed', analysis_run_id: 'run-1' }, executeError = null, completeError = null, failError = null } = {}) {
  const calls = { claim: [], execute: [], complete: [], fail: [] };
  const worker = createAgt002ReanalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    claimJob: async (...args) => { calls.claim.push(args); return claim; },
    executeJob: async (...args) => { calls.execute.push(args); if (executeError) throw executeError; return outcome; },
    completeJob: async (...args) => { calls.complete.push(args); if (completeError) throw completeError; return { status: 'completed' }; },
    failJob: async (...args) => { calls.fail.push(args); if (failError) throw failError; return { status: 'unavailable' }; },
  });
  return { worker, calls };
}

test('claims at most one job and completes it only with a real canonical run id', async () => {
  const { worker, calls } = harness();
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', analysisRunId: 'run-1' });
  assert.equal(calls.claim.length, 1);
  assert.deepEqual(calls.claim[0][1], { leaseSeconds: 600 });
  assert.equal(calls.execute.length, 1, 'zero retry: executor is invoked exactly once');
  assert.equal(calls.complete.length, 1);
  assert.deepEqual(calls.complete[0][1], { jobId: 'job-1', leaseId: 'lease-1', analysisRunId: 'run-1' });
  assert.equal(calls.fail.length, 0);
});

test('returns empty without invoking the executor when no job is claimable', async () => {
  const { worker, calls } = harness({ claim: null });
  assert.deepEqual(await worker.runOnce(), { status: 'empty' });
  assert.equal(calls.execute.length, 0);
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 0);
});

test('closes an unavailable outcome once with a closed code and never retries', async () => {
  const { worker, calls } = harness({ outcome: { status: 'unavailable', error_code: 'invalid_output' } });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'invalid_output' });
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.complete.length, 0);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'invalid_output' });
});

test('maps an executor exception to a closed terminal code without exposing its message', async () => {
  const secret = new Error('provider raw secret');
  secret.code = 'AGT002_CODEX_TIMEOUT';
  const { worker, calls } = harness({ executeError: secret });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'timeout' });
  assert.equal(calls.execute.length, 1);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'timeout' });
  assert.doesNotMatch(JSON.stringify(calls.fail), /raw secret/);
});

test('fails closed on a malformed successful executor outcome', async () => {
  const { worker, calls } = harness({ outcome: { status: 'completed', analysis_run_id: null } });
  const result = await worker.runOnce();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'invalid_output');
  assert.equal(calls.complete.length, 0);
  assert.equal(calls.fail.length, 1);
});

test('converts a failed complete transition into one persistence_failure terminal attempt without rerunning the model', async () => {
  const { worker, calls } = harness({ completeError: new Error('raw database detail') });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'persistence_failure' });
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.complete.length, 1);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'persistence_failure' });
  assert.doesNotMatch(JSON.stringify(result), /raw database detail/);
});
