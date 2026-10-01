// AGT-002 P0-05 (RED, no production change) — initial-analysis executor.
//
// Pins the not-yet-created `agt002-initial-analysis-executor.js` module: pure, dependency-
// injected orchestration of one claimed P0-04 initial-analysis job (agt002-initial-analysis-
// jobs.js's claim/renew fence-token shape) across its member-rehydration, per-batch analysis
// (agt002-analysis-engine.js), checkpoint persistence (agt002-initial-analysis-checkpoints.js)
// and lease-fencing concerns. The executor is wired as the `executeJob` dependency the existing
// (GREEN) agt002-initial-analysis-worker.js's createAgt002InitialAnalysisWorker already expects
// — see tests/agt002-initial-analysis-worker.test.mjs for that contract. This module never
// imports, and is never imported by, any agt002-reanalysis-*.js module
// (docs/agt002/initial-analysis/CURRENT.md).
//
// The module does not exist yet — that absence is the RED signal: importing it below fails with
// ERR_MODULE_NOT_FOUND, which aborts this whole file before any test() body runs. That is the
// expected, intentional RED failure mode for this file (never a syntax error).
//
// Only injected fakes are used below — no network, no PGlite, no real database, and the only
// other production module imported is the already-existing, already-GREEN
// agt002-initial-analysis-worker.js (used purely to prove the end-to-end "partial persistence
// never completes the job" contract against the real worker loop).
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createAgt002InitialAnalysisWorker } from '../agt002-initial-analysis-worker.js';
import { createAgt002InitialAnalysisExecutor } from '../agt002-initial-analysis-executor.js';

const JOB = Object.freeze({
  jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1,
  opportunityId: 'opp-1', tenderId: 'tender-1', idempotencyKey: 'key-1', requestedBy: 'user-1',
  payload: Object.freeze({
    budget: { maxTotalTokens: 10_000 },
    batches: [Object.freeze({
      batchIndex: 0, phase: 'member_batch_analysis', modelId: 'model-a',
      memberIds: ['m-1', 'm-2'], expectedMemberIds: ['m-1', 'm-2'], requestHash: 'h'.repeat(64),
    })],
  }),
});

function members(ids) {
  return ids.map(id => ({ memberId: id, content: { requirement: id }, contentHash: `${id}-hash` }));
}

function codedError(code, message = 'raw detail') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function neverCalled(label) {
  return async () => { throw new Error(`must never be called: ${label}`); };
}

function baseDeps(overrides = {}) {
  return {
    rehydrateMembers: async (_database, memberIds) => members(memberIds),
    assertMembersMatchHashes: () => {},
    runBatch: async () => ({ output: { memberId: 'm-1' }, outputSha256: 'o'.repeat(64), usage: { totalTokens: 10 } }),
    resumeCheckpoint: async () => null,
    storeCheckpoint: async () => ({ status: 'created' }),
    renewLease: async () => ({ status: 'renewed' }),
    ...overrides,
  };
}

test('completes a job whose single batch rehydrates, analyzes and persists cleanly', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps());
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'completed');
});

// ---------------------------------------------------------------------------------------------
// 1) rehydrated member hash mismatch fails closed before any model call.
// ---------------------------------------------------------------------------------------------

test('a rehydrated member hash mismatch fails closed before the batch is ever handed to the model', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    assertMembersMatchHashes: () => { throw codedError('AGT002_ENGINE_MEMBER_HASH_MISMATCH', 'member content does not match its declared hash'); },
    runBatch: neverCalled('runBatch'),
    storeCheckpoint: neverCalled('storeCheckpoint'),
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  // Snake_case, matching the existing P0-04 worker's own outcome contract (createAgt002InitialAnalysisWorker
  // reads `outcome?.error_code`, never `outcome?.errorCode`) — see the composed worker test below.
  assert.equal(result.error_code, 'member_hash_mismatch');
});

// ---------------------------------------------------------------------------------------------
// 3) resume from invalid checkpoint (wrong job, wrong batch, wrong phase, or hash mismatch)
//    fails closed.
// ---------------------------------------------------------------------------------------------

test('a resume check against a mismatched persisted checkpoint fails closed rather than silently reusing or re-running the batch', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    resumeCheckpoint: async () => { throw codedError('AGT002_INITIAL_CHECKPOINT_RESUME_INVALID', 'persisted checkpoint does not match this job/batch/phase/hash'); },
    rehydrateMembers: neverCalled('rehydrateMembers'),
    runBatch: neverCalled('runBatch'),
    storeCheckpoint: neverCalled('storeCheckpoint'),
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'resume_invalid');
});

test('a valid resumed checkpoint is reused: the batch is never re-rehydrated, re-analyzed or re-persisted', async () => {
  const calls = { rehydrate: 0, runBatch: 0, store: 0 };
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    resumeCheckpoint: async () => ({ output: { memberId: 'm-1' }, usage: { totalTokens: 10 } }),
    rehydrateMembers: async (...args) => { calls.rehydrate += 1; return members(args[1]); },
    runBatch: async () => { calls.runBatch += 1; return { output: {}, outputSha256: 'o'.repeat(64), usage: {} }; },
    storeCheckpoint: async () => { calls.store += 1; return { status: 'created' }; },
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, { rehydrate: 0, runBatch: 0, store: 0 });
});

// ---------------------------------------------------------------------------------------------
// 4) provider response after lost lease/stale fence is discarded, never persisted.
// ---------------------------------------------------------------------------------------------

test('a model response that arrives after the lease/fence was lost is discarded: the checkpoint write never happens', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    runBatch: async () => ({ output: { memberId: 'm-1' }, outputSha256: 'o'.repeat(64), usage: { totalTokens: 10 } }),
    // Mirrors the existing P0-04 renewAgt002InitialAnalysisJobLease (agt002-initial-analysis-jobs.js):
    // a fenced renewal failure is an UNCODED generic Error — any renewal failure, not merely one
    // carrying a specific code, must be treated as a lost lease and discard the pending output.
    renewLease: async () => { throw new Error('La renovación de la reserva del job de análisis inicial AGT-002 no fue exitosa.'); },
    storeCheckpoint: neverCalled('storeCheckpoint'),
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'lease_lost');
});

// ---------------------------------------------------------------------------------------------
// 5) partial persistence (checkpoint write fails mid-run) does not complete the job.
// ---------------------------------------------------------------------------------------------

test('a checkpoint write failure mid-run leaves the job unavailable, never completed', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    storeCheckpoint: async () => { throw codedError('AGT002_INITIAL_CHECKPOINT_PERSISTENCE_FAILED', 'raw database detail'); },
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'persistence_failure');
});

test('end-to-end through the real P0-04 worker loop: a mid-run checkpoint write failure never calls completeJob, only failJob', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    storeCheckpoint: async () => { throw codedError('AGT002_INITIAL_CHECKPOINT_PERSISTENCE_FAILED', 'raw database detail'); },
  }));
  const calls = { complete: 0, fail: [] };
  const worker = createAgt002InitialAnalysisWorker({
    database: { kind: 'db' },
    leaseSeconds: 600,
    claimJob: async () => JOB,
    executeJob: (database, job) => executor(database, job),
    completeJob: async () => { calls.complete += 1; return { status: 'completed' }; },
    failJob: async (...args) => { calls.fail.push(args[1]); return { status: 'unavailable' }; },
  });
  const result = await worker.runOnce();
  assert.equal(result.status, 'unavailable');
  assert.equal(calls.complete, 0);
  assert.equal(calls.fail.length, 1);
  assert.deepEqual(calls.fail[0], { jobId: 'job-1', leaseId: 'lease-1', fenceVersion: 1, errorCode: 'persistence_failure' });
});

// ---------------------------------------------------------------------------------------------
// 6) tokens/cost exceeding the G1/job budget fails closed with a closed error code, no raw
//    provider payload.
// ---------------------------------------------------------------------------------------------

test('a batch that would exceed the job budget fails closed without ever persisting a checkpoint or leaking the raw provider payload', async () => {
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    runBatch: async () => { throw codedError('AGT002_ENGINE_BUDGET_EXCEEDED', 'budget exceeded, raw provider payload: {"secret":"x"}'); },
    storeCheckpoint: neverCalled('storeCheckpoint'),
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'budget_exceeded');
  assert.doesNotMatch(JSON.stringify(result), /raw provider payload/);
});

// ---------------------------------------------------------------------------------------------
// 7) no automatic model fallback: a failed model call does not retry a different model id.
// ---------------------------------------------------------------------------------------------

test('a failed model call never retries with a different model id: runBatch is invoked exactly once, with the job-specified model', async () => {
  const seenModelIds = [];
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    runBatch: async ({ modelId }) => { seenModelIds.push(modelId); throw codedError('AGT002_ENGINE_MODEL_CALL_FAILED', 'raw provider failure'); },
    storeCheckpoint: neverCalled('storeCheckpoint'),
  }));
  const result = await executor({ kind: 'db' }, JOB);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error_code, 'model_call_failed');
  assert.deepEqual(seenModelIds, ['model-a']);
});

// ---------------------------------------------------------------------------------------------
// 8) a job with multiple batches runs every batch in order, each rehydrated/analyzed/persisted
//    on its own, before the job is reported completed.
// ---------------------------------------------------------------------------------------------

test('a job with two batches rehydrates, analyzes and persists each batch before completing', async () => {
  const TWO_BATCH_JOB = {
    ...JOB,
    payload: {
      ...JOB.payload,
      batches: [
        { batchIndex: 0, phase: 'member_batch_analysis', modelId: 'model-a', memberIds: ['m-1', 'm-2'], expectedMemberIds: ['m-1', 'm-2'], requestHash: 'h'.repeat(64) },
        { batchIndex: 1, phase: 'member_batch_analysis', modelId: 'model-b', memberIds: ['m-3', 'm-4'], expectedMemberIds: ['m-3', 'm-4'], requestHash: 'i'.repeat(64) },
      ],
    },
  };
  const seenModelIds = [];
  const seenBatchIndexes = [];
  const executor = createAgt002InitialAnalysisExecutor(baseDeps({
    resumeCheckpoint: async () => null,
    runBatch: async ({ modelId }) => {
      seenModelIds.push(modelId);
      return { output: { memberId: 'm-1' }, outputSha256: 'o'.repeat(64), usage: { totalTokens: 10 } };
    },
    storeCheckpoint: async (_database, { batchIndex }) => { seenBatchIndexes.push(batchIndex); return { status: 'created' }; },
  }));
  const result = await executor({ kind: 'db' }, TWO_BATCH_JOB);
  assert.equal(result.status, 'completed');
  assert.deepEqual(seenModelIds, ['model-a', 'model-b']);
  assert.deepEqual(seenBatchIndexes, [0, 1]);
});

// ---------------------------------------------------------------------------------------------
// Reanalysis decoupling (docs/agt002/initial-analysis/CURRENT.md, guard category 6).
// ---------------------------------------------------------------------------------------------

test('agt002-initial-analysis-executor.js never imports a reanalysis operational module', () => {
  const source = readFileSync(new URL('../agt002-initial-analysis-executor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /agt002-reanalysis-(api|jobs|worker|input|executor|error-message)\.js/);
});
