/**
 * Pure dependency-injected orchestration for the initial-analysis worker loop. This is the ONLY
 * place production code decides which worker identity to claim under: the factory's own
 * `workerId` option (if any) is always ignored.
 */
import { AGT002_INITIAL_ANALYSIS_WORKER_ID } from './agt002-initial-analysis-jobs.js';

export function createAgt002InitialAnalysisWorker({ database, leaseSeconds, claimJob, executeJob, completeJob, failJob, announceFailure } = {}) {
  /**
   * Un análisis caído tiene que dejar rastro donde lo vea una persona
   * (agt002-analysis-failure-notice.js: el 2026-10-26T00:58Z uno falló en Supersalud sin dejar nada y se
   * supo tres horas después porque Juan preguntó). Va DESPUÉS de marcar el fallo y no puede tumbarlo:
   * si el aviso falla, el trabajo ya quedó marcado, que es lo que importa.
   */
  const announce = async (job, errorCode) => {
    if (typeof announceFailure !== 'function') return;
    try {
      await announceFailure(database, { opportunityId: job?.opportunityId, jobId: job?.jobId, errorCode });
    } catch { /* el fallo ya está registrado: el aviso nunca cambia el resultado del turno */ }
  };

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
        await announce(job, errorCode);
        return { status: 'unavailable', jobId: job.jobId, errorCode };
      }

      if (outcome?.status === 'completed') {
        try {
          await completeJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, completion: outcome.completion });
          return { status: 'completed', jobId: job.jobId };
        } catch {
          const errorCode = 'persistence_failure';
          await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, errorCode });
          await announce(job, errorCode);
          return { status: 'unavailable', jobId: job.jobId, errorCode };
        }
      }

      const errorCode = outcome?.error_code;
      await failJob(database, { jobId: job.jobId, leaseId: job.leaseId, fenceVersion: job.fenceVersion, errorCode });
      await announce(job, errorCode);
      return { status: 'unavailable', jobId: job.jobId, errorCode };
    },
  });
}
