import { createHash } from 'node:crypto';

export const AGT002_CHECKPOINT_GENERATION_RECOVERY_CONTRACT = 'agt002-checkpoint-generation-recovery-v1';
export const AGT002_CHECKPOINT_GENERATION_RECOVERY_REASON = 'checkpoint_contract_drift';
export const AGT002_CHECKPOINT_GENERATION_2_RECOVERY_CONTRACT = 'agt002-checkpoint-generation-recovery-v2';
export const AGT002_CHECKPOINT_GENERATION_2_RECOVERY_REASON = 'batched_legal_normalization_parity';

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Derives the one fresh canonical/workset identity authorized for a checkpoint-contract
 * recovery. The byte contract is mirrored in migration 097; changing it requires a new
 * contract version and migration, never an in-place rewrite.
 */
export function computeAgt002CheckpointGenerationRecoveryKey({
  rootIdempotencyKey,
  sourceJobId,
  checkpointGeneration,
  repairCommitSha,
} = {}) {
  const contractVersion = checkpointGeneration === 1
    ? AGT002_CHECKPOINT_GENERATION_RECOVERY_CONTRACT
    : checkpointGeneration === 2
      ? AGT002_CHECKPOINT_GENERATION_2_RECOVERY_CONTRACT
      : null;
  if (!HEX64.test(rootIdempotencyKey || '')
      || !UUID.test(sourceJobId || '')
      || contractVersion === null
      || !HEX40.test(repairCommitSha || '')) {
    throw new Error('AGT-002 checkpoint recovery identity is invalid.');
  }
  return createHash('sha256').update([
    contractVersion,
    rootIdempotencyKey.trim(),
    sourceJobId,
    String(checkpointGeneration),
    repairCommitSha,
  ].join('\n'), 'utf8').digest('hex');
}

/**
 * Validates the exact server-frozen recovery extension and returns its derived job key.
 * Null means this is an ordinary governed job. Any present-but-invalid extension fails closed.
 */
export function validateAgt002CheckpointGenerationRecoveryIdentity(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    'checkpoint_generation', 'contract_version', 'reason_code', 'repair_commit_sha',
    'root_idempotency_key', 'source_job_id', 'source_workset_id',
  ].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return undefined;
  const validGeneration1 = value.contract_version === AGT002_CHECKPOINT_GENERATION_RECOVERY_CONTRACT
    && value.reason_code === AGT002_CHECKPOINT_GENERATION_RECOVERY_REASON
    && value.checkpoint_generation === 1;
  const validGeneration2 = value.contract_version === AGT002_CHECKPOINT_GENERATION_2_RECOVERY_CONTRACT
    && value.reason_code === AGT002_CHECKPOINT_GENERATION_2_RECOVERY_REASON
    && value.checkpoint_generation === 2;
  if ((!validGeneration1 && !validGeneration2)
      || !nonEmpty(value.root_idempotency_key)
      || !HEX64.test(value.root_idempotency_key)
      || !UUID.test(value.source_job_id || '')
      || !UUID.test(value.source_workset_id || '')
      || !HEX40.test(value.repair_commit_sha || '')) return undefined;
  try {
    return computeAgt002CheckpointGenerationRecoveryKey({
      rootIdempotencyKey: value.root_idempotency_key,
      sourceJobId: value.source_job_id,
      checkpointGeneration: value.checkpoint_generation,
      repairCommitSha: value.repair_commit_sha,
    });
  } catch {
    return undefined;
  }
}
