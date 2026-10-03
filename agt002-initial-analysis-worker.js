/**
 * Pure dependency-injected orchestration for the initial-analysis worker loop. This is the ONLY
 * place production code decides which worker identity to claim under: the factory's own
 * `workerId` option (if any) is always ignored.
 */
import { AGT002_INITIAL_ANALYSIS_WORKER_ID } from './agt002-initial-analysis-jobs.js';

export function createAgt002InitialAnalysisWorker({ database, leaseSeconds, claimJob, executeJob, completeJob, failJob } = {}) {
  return Object.freeze({
    async runOnce() {
      const job = await claimJob(database, { workerId: AGT002_INITIAL_ANALYSIS_WORKER_ID, leaseSeconds });
      if (!job) return { status: 'empty' };

      let outcome;
      try {
        outcome = await executeJob(database, job);
      } catch {
        const errorCode = 'executor_failure';
        await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, errorCode });
        return { status: 'unavailable', errorCode };
      }

      if (outcome?.status === 'completed') {
        try {
          await completeJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, completion: outcome.completion });
          return { status: 'completed', jobId: job.jobId };
        } catch {
          const errorCode = 'persistence_failure';
          await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, errorCode });
          return { status: 'unavailable', errorCode };
        }
      }

      const errorCode = outcome?.error_code;
      await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, errorCode });
      return { status: 'unavailable', errorCode };
    },
  });
}
