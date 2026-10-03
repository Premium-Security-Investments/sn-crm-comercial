// AGT-002 P0-05 — initial-analysis executor (docs/agt002/initial-analysis/CURRENT.md). Pure,
// dependency-injected orchestration of one claimed P0-04 initial-analysis job across its
// member-rehydration, per-batch analysis, checkpoint persistence and lease-fencing concerns.
// Wired as the `executeJob` dependency createAgt002InitialAnalysisWorker expects. Never imports,
// and is never imported by, any parallel operational runtime module.

const ERROR_CODE_MAP = Object.freeze({
  AGT002_ENGINE_MEMBER_HASH_MISMATCH: 'member_hash_mismatch',
  AGT002_INITIAL_CHECKPOINT_RESUME_INVALID: 'resume_invalid',
  AGT002_INITIAL_CHECKPOINT_PERSISTENCE_FAILED: 'persistence_failure',
  AGT002_ENGINE_BUDGET_EXCEEDED: 'budget_exceeded',
  AGT002_ENGINE_MODEL_CALL_FAILED: 'model_call_failed',
});

function mapErrorCode(error) {
  return ERROR_CODE_MAP[error?.code] ?? 'lease_lost';
}

export function createAgt002InitialAnalysisExecutor({ rehydrateMembers, assertMembersMatchHashes, runBatch, resumeCheckpoint, storeCheckpoint, renewLease }) {
  return async function execute(database, job) {
    if (!job?.payload?.persistence) {
      return { status: 'unavailable', error_code: 'persistence_failure' };
    }

    let synthesisOutput;

    for (const batch of job.payload.batches) {
      let checkpoint;
      try {
        checkpoint = await resumeCheckpoint(database, {
          expectedJobId: job.jobId,
          expectedBatchIndex: batch.batchIndex,
          expectedPhase: batch.phase,
          expectedRequestHash: batch.requestHash,
        });
      } catch (error) {
        return { status: 'unavailable', error_code: mapErrorCode(error) };
      }

      if (checkpoint) {
        if (batch.phase === 'synthesis') synthesisOutput = checkpoint.output;
        continue;
      }

      let members;
      try {
        members = await rehydrateMembers(database, batch.memberIds);
        assertMembersMatchHashes(members);
      } catch (error) {
        return { status: 'unavailable', error_code: mapErrorCode(error) };
      }

      let result;
      try {
        result = await runBatch({ modelId: batch.modelId, members, expectedMemberIds: batch.expectedMemberIds });
      } catch (error) {
        return { status: 'unavailable', error_code: mapErrorCode(error) };
      }

      try {
        await renewLease(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion });
      } catch {
        return { status: 'unavailable', error_code: 'lease_lost' };
      }

      try {
        await storeCheckpoint(database, {
          jobId: job.jobId,
          leaseId: job.leaseId,
          fenceVersion: job.fenceVersion,
          batchIndex: batch.batchIndex,
          phase: batch.phase,
          requestHash: batch.requestHash,
          output: result.output,
          outputSha256: result.outputSha256,
          usage: result.usage,
        });
      } catch (error) {
        return { status: 'unavailable', error_code: mapErrorCode(error) };
      }

      if (batch.phase === 'synthesis') synthesisOutput = result.output;
    }

    if (synthesisOutput === undefined) {
      return { status: 'unavailable', error_code: 'persistence_failure' };
    }

    return { status: 'completed', completion: { ...job.payload.persistence, envelope: synthesisOutput } };
  };
}
