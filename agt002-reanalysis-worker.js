import {
  claimAgt002ReanalysisJob,
  completeAgt002ReanalysisJob,
  failAgt002ReanalysisJob,
  renewAgt002ReanalysisJobLease,
} from './agt002-reanalysis-jobs.js';

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

export function classifyAgt002ReanalysisWorkerError(error) {
  const code = String(error?.runtime_boundary_code || error?.code || '').toUpperCase();
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('PERSIST')) return 'persistence_failure';
  if (code.includes('LEASE')) return 'lease_lost';
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
