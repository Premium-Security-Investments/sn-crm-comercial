import { createAgt002ReanalysisWorker } from './agt002-reanalysis-worker.js';
import { claimAgt002ReanalysisJobById } from './agt002-reanalysis-jobs.js';
import { recoverOneAgt002IncrementalChangeSet } from './agt002-incremental-recovery.js';

export function createAgt002IncrementalHostDrain({
  database,
  executeJob,
  environment = process.env,
  maxJobs = 10,
  recoverOne = recoverOneAgt002IncrementalChangeSet,
  claimJobById = claimAgt002ReanalysisJobById,
  createWorker = createAgt002ReanalysisWorker,
} = {}) {
  if (!database || typeof executeJob !== 'function') throw new Error('El drain incremental requiere database y executor.');
  if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 10) throw new Error('El límite del drain incremental no es válido.');
  return Object.freeze({
    async run({ targetJobId = null } = {}) {
      const outcomes = [];
      let nextJobId = targetJobId;
      for (let index = 0; index < maxJobs; index += 1) {
        if (!nextJobId) {
          const recovered = await recoverOne(database, { environment });
          if (recovered.status === 'empty') break;
          if (recovered.status === 'reconciled') {
            outcomes.push({
              status: 'reconciled', jobId: recovered.job_id,
              changeSetId: recovered.change_set_id, outcome: recovered.outcome,
            });
            continue;
          }
          nextJobId = recovered.job_id;
        }
        const exactJobId = nextJobId;
        nextJobId = null;
        const worker = createWorker({
          database, executeJob, leaseSeconds: 600,
          claimJob: (db, { leaseSeconds }) => claimJobById(db, { jobId: exactJobId, leaseSeconds }),
        });
        const outcome = await worker.runOnce();
        outcomes.push(outcome);
        if (outcome.status === 'empty') break;
      }
      return {
        status: outcomes.length ? 'drained' : 'empty',
        jobs_processed: outcomes.length,
        outcomes,
        bounded: outcomes.length === maxJobs,
      };
    },
  });
}
