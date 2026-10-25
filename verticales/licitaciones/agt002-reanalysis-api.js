/**
 * Pure, framework-free helpers shared by the two behaviorally-identical HTTP mirrors
 * (server/index.js and api/[...path].js) for the AGT-002 canonical reanalysis queue
 * surface. Nothing here touches the database, the provider, or the bridge.
 */

export const AGT002_REANALYSIS_STATUS_ROUTE = '/api/agt002-reanalysis-status';

/** The exact, closed field allowlist the browser is ever allowed to see for a queue job. */
export const AGT002_REANALYSIS_STATUS_FIELDS = Object.freeze([
  'job_id', 'status', 'created_at', 'started_at', 'completed_at', 'analysis_run_id', 'error_code',
]);

const NO_JOB_STATUS = Object.freeze({
  job_id: null,
  status: 'no_job',
  created_at: null,
  started_at: null,
  completed_at: null,
  analysis_run_id: null,
  error_code: null,
});

/**
 * Maps the durable job row (or its absence) to the closed wire shape for
 * GET /api/agt002-reanalysis-status. Never includes opportunity_id, snapshot_id,
 * context_version_id, error_message, or updated_at: those never reach the browser.
 */
export function presentAgt002ReanalysisStatus(job) {
  if (!job) return NO_JOB_STATUS;
  return {
    job_id: job.jobId,
    status: job.status,
    created_at: job.createdAt ?? null,
    started_at: job.startedAt ?? null,
    completed_at: job.completedAt ?? null,
    analysis_run_id: job.analysisRunId ?? null,
    error_code: job.errorCode ?? null,
  };
}
