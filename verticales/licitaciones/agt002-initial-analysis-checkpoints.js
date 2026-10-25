// AGT-002 P0-05 — initial-analysis checkpoint adapter (docs/agt002/initial-analysis/CURRENT.md).
// A thin, closed wrapper around the initial-analysis checkpoint RPCs, fenced by one claimed
// P0-04 job's own (jobId, leaseId, fenceVersion). Mirrors agt002-analysis-checkpoints.js's
// conventions (exact snake_case param mapping in, exact camelCase result mapping out, raw DB
// messages never forwarded) but belongs to the initial-analysis slice and never imports, and is
// never imported by, any agt002-reanalysis-*.js module.

export const AGT002_INITIAL_ANALYSIS_CHECKPOINT_PHASES = Object.freeze(['member_batch_analysis', 'synthesis']);

export const AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES = Object.freeze({
  CHECKPOINT_INVALID: 'AGT002_INITIAL_CHECKPOINT_INVALID',
  RESUME_INVALID: 'AGT002_INITIAL_CHECKPOINT_RESUME_INVALID',
  LEASE_LOST: 'AGT002_INITIAL_CHECKPOINT_LEASE_LOST',
  PERSISTENCE_FAILED: 'AGT002_INITIAL_CHECKPOINT_PERSISTENCE_FAILED',
});

function checkpointError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

/** Stores one initial-analysis checkpoint, always fenced by the caller's own fence token. */
export async function storeAgt002InitialAnalysisCheckpoint(database, params) {
  const value = params ?? {};
  const requiredFields = ['jobId', 'leaseId', 'fenceVersion', 'batchIndex', 'phase', 'requestHash', 'outputSha256'];
  if (!requiredFields.every(field => isPresent(value[field]))) {
    throw checkpointError(
      AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.CHECKPOINT_INVALID,
      'AGT-002 initial-analysis checkpoint: identidad de almacenamiento incompleta.',
    );
  }

  const { data, error } = await database.rpc('psi_store_agt002_initial_analysis_checkpoint', {
    p_job_id: value.jobId,
    p_lease_id: value.leaseId,
    p_fence_version: value.fenceVersion,
    p_batch_index: value.batchIndex,
    p_phase: value.phase,
    p_request_hash: value.requestHash,
    p_output: value.output,
    p_output_sha256: value.outputSha256,
    p_usage: value.usage ?? null,
  });

  if (error) {
    if (error.code === '55000') {
      throw checkpointError(
        AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.LEASE_LOST,
        'AGT-002 initial-analysis checkpoint: el job perdió su reserva.',
      );
    }
    throw checkpointError(
      AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED,
      'AGT-002 initial-analysis checkpoint: fallo de persistencia no clasificado.',
    );
  }

  return { status: data.status, checkpointId: data.checkpoint_id };
}

/** Narrow read of one (jobId, batchIndex, phase) checkpoint row; never interprets `output`. */
export async function loadAgt002InitialAnalysisCheckpoint(database, { jobId, batchIndex, phase }) {
  const { data } = await database.rpc('psi_load_agt002_initial_analysis_checkpoint', {
    p_job_id: jobId,
    p_batch_index: batchIndex,
    p_phase: phase,
  });

  if (!data.checkpoint) return null;

  const row = data.checkpoint;
  return {
    jobId: row.job_id,
    batchIndex: row.batch_index,
    phase: row.phase,
    requestHash: row.request_hash,
    output: row.output,
    outputSha256: row.output_sha256,
    usage: row.usage,
  };
}

/** Fails closed unless every bound field of a persisted checkpoint agrees with the caller's own. */
export function assertAgt002InitialAnalysisCheckpointResumable({ checkpoint, expectedJobId, expectedBatchIndex, expectedPhase, expectedRequestHash }) {
  if (
    checkpoint.jobId !== expectedJobId
    || checkpoint.batchIndex !== expectedBatchIndex
    || checkpoint.phase !== expectedPhase
    || checkpoint.requestHash !== expectedRequestHash
  ) {
    throw checkpointError(
      AGT002_INITIAL_ANALYSIS_CHECKPOINT_ERROR_CODES.RESUME_INVALID,
      'AGT-002 initial-analysis checkpoint: el checkpoint persistido no coincide con este job/lote/fase/hash.',
    );
  }
}

/** Loads and validates a resumable checkpoint, or returns null when there is nothing to resume. */
export async function resumeAgt002InitialAnalysisCheckpoint(database, { expectedJobId, expectedBatchIndex, expectedPhase, expectedRequestHash }) {
  const checkpoint = await loadAgt002InitialAnalysisCheckpoint(database, {
    jobId: expectedJobId,
    batchIndex: expectedBatchIndex,
    phase: expectedPhase,
  });
  if (!checkpoint) return null;

  assertAgt002InitialAnalysisCheckpointResumable({ checkpoint, expectedJobId, expectedBatchIndex, expectedPhase, expectedRequestHash });
  return checkpoint;
}
