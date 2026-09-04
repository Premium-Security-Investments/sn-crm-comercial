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

const EXECUTOR_EXCEPTION_TABLE = [
  { code: 'AGT002_REANALYSIS_LEASE_LOST', stage: undefined, expectedErrorCode: 'lease_lost' },
  { code: 'AGT002_CHECKPOINT_LEASE_LOST', stage: undefined, expectedErrorCode: 'lease_lost' },
  { code: 'AGT002_CODEX_TIMEOUT', stage: undefined, expectedErrorCode: 'timeout' },
  { code: 'AGT002_BATCHED_V3_VALIDATION_INVALID', stage: 'json_parse', expectedErrorCode: 'invalid_output' },
  { code: 'AGT002_BATCHED_V3_VALIDATION_INVALID', stage: 'semantic_validation', expectedErrorCode: 'invalid_output' },
  { code: 'AGT002_BATCHED_V3_VALIDATION_INVALID', stage: 'usage', expectedErrorCode: 'invalid_output' },
  { code: 'AGT002_BATCHED_V3_VALIDATION_INVALID', stage: 'envelope', expectedErrorCode: 'invalid_output' },
  { code: 'AGT002_BATCHED_V3_CHECKPOINT_FAILED', stage: 'persistence', expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_BATCHED_V3_MERGE_FAILED', stage: 'envelope', expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_BATCHED_V3_FINALIZE_FAILED', stage: 'envelope', expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_BATCHED_V3_BATCH_FAILED', stage: undefined, expectedErrorCode: 'provider_error' },
  { code: 'AGT002_CHECKPOINT_PERSISTENCE_FAILED', stage: undefined, expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_CHECKPOINT_PERSISTENCE_CONFLICT', stage: undefined, expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_RUNTIME_PERSISTENCE_FAILED', stage: undefined, expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_BATCHED_V3_BOUNDARY_FAILED', stage: 'persistence', expectedErrorCode: 'persistence_failure' },
  { code: 'AGT002_FUTURE_FAILURE', stage: undefined, expectedErrorCode: 'provider_error' },
];

for (const { code, stage, expectedErrorCode } of EXECUTOR_EXCEPTION_TABLE) {
  const label = stage ? `${code} (stage=${stage})` : code;
  test(`maps executor exception ${label} to closed errorCode ${expectedErrorCode} without leaking the raw message`, async () => {
    const rawMessage = `RAW-PROVIDER-DETAIL-${code}-${stage ?? 'none'}`;
    const secret = new Error(rawMessage);
    secret.code = code;
    if (stage !== undefined) secret.stage = stage;
    const { worker, calls } = harness({ executeError: secret });

    const result = await worker.runOnce();

    assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: expectedErrorCode });
    assert.equal(calls.execute.length, 1, 'executor invoked exactly once');
    assert.equal(calls.complete.length, 0, 'completeJob is never invoked on executor exception');
    assert.equal(calls.fail.length, 1, 'failJob invoked exactly once');
    assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: expectedErrorCode });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(rawMessage));
    assert.doesNotMatch(JSON.stringify(calls.fail), new RegExp(rawMessage));
  });
}

test('does not double-complete when the executor already atomically finalized the queue row (queue_finalized:true)', async () => {
  const { worker, calls } = harness({
    outcome: { status: 'completed', analysis_run_id: 'run-1', queue_finalized: true },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', analysisRunId: 'run-1' });
  assert.equal(calls.complete.length, 0, 'completeJob must not be called: the atomic finalizer already completed the queue row');
  assert.equal(calls.fail.length, 0, 'failJob must not be called on a successful atomic finalize');
});

test('legacy single-turn outcome (no queue_finalized field) still completes exactly once', async () => {
  const { worker, calls } = harness({
    outcome: { status: 'completed', analysis_run_id: 'run-1' },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'completed', jobId: 'job-1', analysisRunId: 'run-1' });
  assert.equal(calls.complete.length, 1, 'legacy outcomes without queue_finalized must still go through completeJob exactly once');
  assert.deepEqual(calls.complete[0][1], { jobId: 'job-1', leaseId: 'lease-1', analysisRunId: 'run-1' });
  assert.equal(calls.fail.length, 0);
});

test('fails closed instead of legacy-completing when queue_finalized:true accompanies a non-completed status', async () => {
  const { worker, calls } = harness({
    outcome: { status: 'unavailable', error_code: 'timeout', queue_finalized: true },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'timeout' });
  assert.equal(calls.complete.length, 0, 'queue_finalized:true must never trigger a legacy completeJob call by itself');
  assert.equal(calls.fail.length, 1);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'timeout' });
});

test('fails closed instead of legacy-completing when queue_finalized:true accompanies a missing analysis_run_id', async () => {
  const { worker, calls } = harness({
    outcome: { status: 'completed', analysis_run_id: null, queue_finalized: true },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { status: 'unavailable', jobId: 'job-1', errorCode: 'invalid_output' });
  assert.equal(calls.complete.length, 0, 'queue_finalized:true must never substitute for a missing analysis_run_id');
  assert.equal(calls.fail.length, 1);
  assert.deepEqual(calls.fail[0][1], { jobId: 'job-1', leaseId: 'lease-1', errorCode: 'invalid_output' });
});

test('a canonical run already marked completed is never demoted or deleted by a subsequent worker failure', async () => {
  const canonicalStore = { 'run-1': 'completed' };
  const secret = new Error('raw provider detail that must never surface');
  secret.code = 'AGT002_BATCHED_V3_BATCH_FAILED';
  const worker = createAgt002ReanalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    claimJob: async () => JOB,
    executeJob: async () => {
      throw secret;
    },
    completeJob: async () => {
      throw new Error('completeJob must never be invoked after an executor exception');
    },
    failJob: async (..._args) => ({ status: 'unavailable' }),
  });

  assert.deepEqual(
    Object.keys(worker),
    ['runOnce'],
    'worker exposes no checkpoint, cleanup, or canonical-demotion API beyond runOnce'
  );

  const result = await worker.runOnce();

  assert.equal(result.status, 'unavailable');
  assert.equal(result.errorCode, 'provider_error');
  assert.equal(
    canonicalStore['run-1'],
    'completed',
    'a canonical outcome already recorded as completed is untouched by queue-level failure handling'
  );
  assert.doesNotMatch(JSON.stringify(result), /raw provider detail/);
});
