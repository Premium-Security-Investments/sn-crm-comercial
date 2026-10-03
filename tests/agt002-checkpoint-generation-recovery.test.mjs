import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGT002_CHECKPOINT_GENERATION_RECOVERY_CONTRACT,
  AGT002_CHECKPOINT_GENERATION_RECOVERY_REASON,
  computeAgt002CheckpointGenerationRecoveryKey,
  validateAgt002CheckpointGenerationRecoveryIdentity,
} from '../agt002-checkpoint-generation-recovery.js';
import { claimAgt002ReanalysisJobById } from '../agt002-reanalysis-jobs.js';

const ROOT_KEY = 'a'.repeat(64);
const SOURCE_JOB_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_WORKSET_ID = '22222222-2222-4222-8222-222222222222';
const REPAIR_SHA = 'b'.repeat(40);

function identity(overrides = {}) {
  return {
    contract_version: AGT002_CHECKPOINT_GENERATION_RECOVERY_CONTRACT,
    reason_code: AGT002_CHECKPOINT_GENERATION_RECOVERY_REASON,
    root_idempotency_key: ROOT_KEY,
    source_job_id: SOURCE_JOB_ID,
    source_workset_id: SOURCE_WORKSET_ID,
    checkpoint_generation: 1,
    repair_commit_sha: REPAIR_SHA,
    ...overrides,
  };
}

test('checkpoint generation key is deterministic and bound to every recovery identity field', () => {
  const base = computeAgt002CheckpointGenerationRecoveryKey({
    rootIdempotencyKey: ROOT_KEY,
    sourceJobId: SOURCE_JOB_ID,
    checkpointGeneration: 1,
    repairCommitSha: REPAIR_SHA,
  });
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(validateAgt002CheckpointGenerationRecoveryIdentity(identity()), base);
  assert.notEqual(
    computeAgt002CheckpointGenerationRecoveryKey({
      rootIdempotencyKey: ROOT_KEY,
      sourceJobId: SOURCE_JOB_ID,
      checkpointGeneration: 1,
      repairCommitSha: 'c'.repeat(40),
    }),
    base,
  );
  assert.throws(() => computeAgt002CheckpointGenerationRecoveryKey({
    rootIdempotencyKey: 'not-a-root-hash',
    sourceJobId: SOURCE_JOB_ID,
    checkpointGeneration: 1,
    repairCommitSha: REPAIR_SHA,
  }));
});

test('recovery identity is optional, but any present malformed or extended shape fails closed', () => {
  assert.equal(validateAgt002CheckpointGenerationRecoveryIdentity(undefined), null);
  for (const value of [
    null,
    {},
    identity({ checkpoint_generation: 2 }),
    identity({ root_idempotency_key: 'not-a-hash' }),
    identity({ source_job_id: 'not-a-uuid' }),
    { ...identity(), extra: true },
  ]) {
    assert.equal(validateAgt002CheckpointGenerationRecoveryIdentity(value), undefined);
  }
});

test('exact-id claim adapter calls only the targeted recovery RPC and maps the modern claim', async () => {
  const calls = [];
  const database = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: {
          status: 'claimed', job_id: 'job-1', lease_id: 'lease-1', lease_expires_at: '2026-10-03T00:00:00Z',
          opportunity_id: 'opp-1', tender_id: 'tender-1', snapshot_id: 'snapshot-1', context_version_id: 'context-1',
          idempotency_key: 'key-1', frozen_engine_input: { schema_version: 2 }, requested_by: 'profile-1',
          execution_mode: 'durable_batched_v1', phase: null, completed_batch_count: 0, total_batch_count: 0, resume_count: 0,
        },
        error: null,
      };
    },
  };
  const claim = await claimAgt002ReanalysisJobById(database, { jobId: SOURCE_JOB_ID, leaseSeconds: 600 });
  assert.deepEqual(calls, [{
    name: 'psi_claim_agt002_reanalysis_job_by_id',
    args: { p_job_id: SOURCE_JOB_ID, p_lease_seconds: 600 },
  }]);
  assert.equal(claim.jobId, 'job-1');
  assert.equal(claim.executionMode, 'durable_batched_v1');
});

test('exact-id claim adapter never falls back to the ordinary queue on malformed input or empty', async () => {
  const calls = [];
  const database = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { status: 'empty' }, error: null };
    },
  };
  assert.equal(await claimAgt002ReanalysisJobById(database, { jobId: SOURCE_JOB_ID }), null);
  await assert.rejects(claimAgt002ReanalysisJobById(database, { jobId: '' }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'psi_claim_agt002_reanalysis_job_by_id');
});
