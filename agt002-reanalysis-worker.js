import {
  claimAgt002ReanalysisJob,
  completeAgt002ReanalysisJob,
  failAgt002ReanalysisJob,
  renewAgt002ReanalysisJobLease,
} from './agt002-reanalysis-jobs.js';
import { AGT002_CHECKPOINT_ERROR_CODES } from './agt002-analysis-checkpoints.js';
import { AGT002_V3_SAFE_VALIDATION_CODES } from './agt002-preview-engine.js';

export const AGT002_REANALYSIS_QUEUE_ERROR_CODES = Object.freeze([
  'timeout',
  'provider_error',
  'invalid_output',
  'persistence_failure',
  'lease_lost',
  'capacity_unavailable',
]);
const QUEUE_ERROR_CODE_SET = new Set(AGT002_REANALYSIS_QUEUE_ERROR_CODES);

function closedOutcomeCode(value) {
  return typeof value === 'string' && QUEUE_ERROR_CODE_SET.has(value) ? value : 'invalid_output';
}

// Existing queue lease code: AGT-002 reanalysis jobs' own claim/renew RPC fencing (see
// agt002-reanalysis-jobs.js), predates and is independent of the checkpoint adapter.
const REANALYSIS_QUEUE_LEASE_LOST_CODE = 'AGT002_REANALYSIS_LEASE_LOST';

// Closed, exact-match sets derived from the checkpoint adapter's own closed error code catalog
// (AGT002_CHECKPOINT_ERROR_CODES) — never prefix/substring/message matched — so a checkpoint
// code classifies here only by exact membership, staying in lockstep with the adapter's own
// closed catalog rather than a heuristic that could silently misclassify a future code.
const LEASE_LOST_ERROR_CODES = new Set([
  REANALYSIS_QUEUE_LEASE_LOST_CODE,
  AGT002_CHECKPOINT_ERROR_CODES.LEASE_LOST,
]);

const PERSISTENCE_FAILURE_ERROR_CODES = new Set([
  'AGT002_BATCHED_V3_CHECKPOINT_FAILED',
  'AGT002_BATCHED_V3_MERGE_FAILED',
  'AGT002_BATCHED_V3_FINALIZE_FAILED',
  'AGT002_RUNTIME_PERSISTENCE_FAILED',
  AGT002_CHECKPOINT_ERROR_CODES.WORKSET_PERSISTENCE_CONFLICT,
  AGT002_CHECKPOINT_ERROR_CODES.CHECKPOINT_PERSISTENCE_CONFLICT,
  AGT002_CHECKPOINT_ERROR_CODES.PERSISTENCE_FAILED,
]);

// The engine's own closed V3 semantic-invariant catalog, matched EXACTLY (never by substring):
// agt002-preview-engine.js attaches one of these lowercase subcodes verbatim as the `.code` of a
// V3 semantic-validation rejection — both on the one-turn path and, now, on the durable batched
// one. They name a rejected MODEL OUTPUT, so they are invalid_output; without this exact-match
// gate most of them (e.g. `v3_coverage_manifest_version_mismatch`) carry none of the substrings
// the heuristic below looks for and would be misattributed to the provider.
const V3_SAFE_VALIDATION_CODE_SET = new Set(AGT002_V3_SAFE_VALIDATION_CODES);

export function classifyAgt002ReanalysisWorkerError(error) {
  const rawCode = error?.runtime_boundary_code || error?.code || '';
  const code = String(rawCode).toUpperCase();
  if (code.includes('TIMEOUT')) return 'timeout';
  if (PERSISTENCE_FAILURE_ERROR_CODES.has(code) || error?.stage === 'persistence') return 'persistence_failure';
  if (LEASE_LOST_ERROR_CODES.has(code)) return 'lease_lost';
  if (typeof rawCode === 'string' && V3_SAFE_VALIDATION_CODE_SET.has(rawCode)) return 'invalid_output';
  if (code.includes('CAPACITY') || code.includes('SATURAT') || code.includes('QUOTA')) return 'capacity_unavailable';
  if (code.includes('INVALID') || code.includes('VALIDATION') || code.includes('JSON') || code.includes('CONTENT') || code.includes('ENVELOPE')) return 'invalid_output';
  return 'provider_error';
}

/**
 * Durable one-job drain. The executor is called at most once; every non-empty
 * invocation attempts exactly one terminal queue transition and never retries.
 */
export function createAgt002ReanalysisWorker({
  database,
  executeJob,
  leaseSeconds = 600,
  claimJob = claimAgt002ReanalysisJob,
  completeJob = completeAgt002ReanalysisJob,
  failJob = failAgt002ReanalysisJob,
} = {}) {
  if (!database || typeof executeJob !== 'function') {
    throw new Error('AGT-002 reanalysis worker requires database and executeJob.');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 600) {
    throw new Error('AGT-002 reanalysis worker leaseSeconds must be between 30 and 600.');
  }

  return Object.freeze({
    async runOnce() {
      const job = await claimJob(database, { leaseSeconds });
      if (!job) return { status: 'empty' };

      // Deterministic stage-boundary heartbeat: fenced by THIS job's own jobId+leaseId, renewing
      // for the worker's own configured lease window. The executor decides when (and whether) to
      // call it — zero, one or N times, one per provider turn it actually takes — never a timer.
      // A lost lease is remembered here (`leaseLost`), independent of whether the executor's own
      // error handling swallows the rejection: once the fenced renewal reports the lease lost,
      // another worker may already own this job, so it can never be completed afterward, whatever
      // the executor goes on to return.
      let leaseLost = false;
      const beforeProviderCall = async () => {
        try {
          return await renewAgt002ReanalysisJobLease(database, { jobId: job.jobId, leaseId: job.leaseId, leaseSeconds });
        } catch (error) {
          leaseLost = true;
          throw error;
        }
      };

      let outcome;
      try {
        outcome = await executeJob(database, job, { beforeProviderCall });
      } catch (error) {
        const errorCode = leaseLost ? 'lease_lost' : classifyAgt002ReanalysisWorkerError(error);
        await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, errorCode });
        return { status: 'unavailable', jobId: job.jobId, errorCode };
      }

      if (leaseLost) {
        await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, errorCode: 'lease_lost' });
        return { status: 'unavailable', jobId: job.jobId, errorCode: 'lease_lost' };
      }

      const analysisRunId = typeof outcome?.analysis_run_id === 'string' && outcome.analysis_run_id.trim()
        ? outcome.analysis_run_id.trim()
        : null;
      if (outcome?.status === 'completed' && analysisRunId && outcome?.queue_finalized === true) {
        return { status: 'completed', jobId: job.jobId, analysisRunId };
      }
      if (analysisRunId) {
        try {
          await completeJob(database, { jobId: job.jobId, leaseId: job.leaseId, analysisRunId });
          return { status: 'completed', jobId: job.jobId, analysisRunId };
        } catch {
          await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, errorCode: 'persistence_failure' });
          return { status: 'unavailable', jobId: job.jobId, errorCode: 'persistence_failure' };
        }
      }

      const errorCode = outcome?.status === 'unavailable'
        ? closedOutcomeCode(outcome.error_code)
        : 'invalid_output';
      await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, errorCode });
      return { status: 'unavailable', jobId: job.jobId, errorCode };
    },
  });
}
