// AGT-002 P0-04 (RED) — initial-analysis worker loop.
//
// Mirrors the orchestration conventions of agt002-reanalysis-worker.test.mjs: the worker is pure
// dependency-injected orchestration (claimJob/executeJob/completeJob/failJob), and it is the ONLY
// place production code decides which worker identity to claim under. The wished module
// ../agt002-initial-analysis-worker.js does not exist yet — that absence (ERR_MODULE_NOT_FOUND)
// is the RED signal below.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgt002InitialAnalysisWorker } from '../agt002-initial-analysis-worker.js';

const JOB = Object.freeze({
  jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1,
  opportunityId: 'opp-1', tenderId: 'tender-1', idempotencyKey: 'key-1',
  payload: { manifest: 'v1' }, requestedBy: 'user-1',
});

function harness({ claim = JOB, outcome = { status: 'completed' }, executeError = null, completeError = null, failError = null } = {}) {
  const calls = { claim: [], execute: [], complete: [], fail: [] };
  const worker = createAgt002InitialAnalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    claimJob: async (...args) => { calls.claim.push(args); return claim; },
    executeJob: async (...args) => { calls.execute.push(args); if (executeError) throw executeError; return outcome; },
    completeJob: async (...args) => { calls.complete.push(args); if (completeError) throw completeError; return { status: 'completed' }; },
    failJob: async (...args) => { calls.fail.push(args); if (failError) throw failError; return { status: 'unavailable' }; },
  });
  return { worker, calls };
}

test('claims exactly one job under the fixed worker identity and completes it', async () => {
  const { worker, calls } = harness();
  const result = await worker.runOnce();
  assert.equal(result.status, 'completed');
  assert.equal(result.jobId, 'job-1');
  assert.equal(calls.claim.length, 1);
  assert.deepEqual(calls.claim[0][1], { workerId: 'agt002-initial-analysis-worker', leaseSeconds: 600 });
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.fail.length, 0);
});

test('the fixed worker identity can never be overridden by a factory option', async () => {
  const calls = { claim: [] };
  const worker = createAgt002InitialAnalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    workerId: 'someone-else',
    claimJob: async (...args) => { calls.claim.push(args); return null; },
    executeJob: async () => { throw new Error('must not execute when the queue is empty'); },
    completeJob: async () => { throw new Error('must not complete when the queue is empty'); },
    failJob: async () => { throw new Error('must not fail when the queue is empty'); },
  });
  await worker.runOnce();
  assert.deepEqual(calls.claim[0][1], { workerId: 'agt002-initial-analysis-worker', leaseSeconds: 600 });
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
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'invalid_output');
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.complete.length, 0);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'invalid_output' });
});

test('maps an executor exception to a closed terminal code without exposing its message', async () => {
  const secret = new Error('raw provider secret detail');
  const { worker, calls } = harness({ executeError: secret });
  const result = await worker.runOnce();
  assert.equal(result.status, 'unavailable');
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.fail.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /raw provider secret detail/);
  assert.doesNotMatch(JSON.stringify(calls.fail), /raw provider secret detail/);
});

test('a failed complete transition converts to one persistence_failure terminal attempt, never rerunning the model', async () => {
  const { worker, calls } = harness({ completeError: new Error('raw database detail') });
  const result = await worker.runOnce();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'persistence_failure');
  assert.equal(calls.execute.length, 1);
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.fail.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /raw database detail/);
});

test('the fail call always carries the fencing token, never a bare job id', async () => {
  const { worker, calls } = harness({ outcome: { status: 'unavailable', error_code: 'timeout' } });
  await worker.runOnce();
  const failArgs = calls.fail[0][1];
  assert.ok(Object.hasOwn(failArgs, 'fenceVersion'), 'a fence-less write must never be attempted');
  assert.equal(failArgs.fenceVersion, 1);
});

test('worker exposes no API beyond runOnce (no checkpoint/cleanup/identity-override surface)', () => {
  const { worker } = harness();
  assert.deepEqual(Object.keys(worker), ['runOnce']);
});
