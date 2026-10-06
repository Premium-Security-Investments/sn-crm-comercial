export const AGT002_INITIAL_ANALYSIS_UI_STATES = Object.freeze([
  'pending', 'running', 'ready', 'failed',
]);

const ACTIVE = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);
const CLOSED_ERROR = /^[a-z0-9_]{1,80}$/;

function action(allowed, blockingCode, message) {
  return Object.freeze({ allowed, blockingCode, message });
}

function failed(jobId, errorCode, message) {
  return Object.freeze({
    state: 'failed', jobId, runId: null, errorCode, reportAvailable: false,
    humanDecisionRequired: false,
    action: action(false, errorCode === 'canonical_run_missing' ? 'CANONICAL_RUN_MISSING' : 'INITIAL_FAILED', message),
  });
}

/**
 * Produces the only browser-facing INITIAL state. It trusts durable job/run columns, never an
 * arbitrary result JSON. A completed job is not success unless its exact current canonical
 * INITIAL run can also be read back.
 */
export function projectAgt002InitialAnalysisState({ job, run } = {}) {
  if (!job && !run) {
    return Object.freeze({
      state: 'pending', jobId: null, runId: null, errorCode: null,
      reportAvailable: false, humanDecisionRequired: false,
      action: action(false, 'INITIAL_NOT_ADMITTED', 'El análisis inicial todavía no ha sido admitido.'),
    });
  }

  const jobId = typeof job?.id === 'string' ? job.id : null;
  if (!jobId || typeof job.status !== 'string') {
    return failed(jobId, 'state_invalid', 'El estado durable del análisis inicial no es válido.');
  }

  if (ACTIVE.has(job.status)) {
    if (job.analysis_run_id != null || job.error_code != null) {
      return failed(jobId, 'state_invalid', 'El estado durable del análisis inicial es contradictorio.');
    }
    return Object.freeze({
      state: 'running', jobId, runId: null, errorCode: null,
      reportAvailable: false, humanDecisionRequired: false,
      action: action(false, 'INITIAL_IN_PROGRESS', 'El análisis inicial está en curso.'),
    });
  }

  if (job.status === 'FAILED') {
    if (job.analysis_run_id != null || typeof job.error_code !== 'string' || !CLOSED_ERROR.test(job.error_code)) {
      return failed(jobId, 'state_invalid', 'El estado durable del análisis inicial es contradictorio.');
    }
    return failed(jobId, job.error_code, 'El análisis inicial terminó sin un reporte utilizable.');
  }

  if (job.status === 'COMPLETED') {
    const runMatches = typeof job.analysis_run_id === 'string'
      && run?.id === job.analysis_run_id
      && run.status === 'completed'
      && run.canonical === true
      && run.current === true
      && ((run.analysis_kind === 'INITIAL' && run.analysis_version === 1)
        // Migration 108: a REANALYSIS successor is the opportunity's canonical analysis from version 2 on.
        || (run.analysis_kind === 'REANALYSIS' && Number.isInteger(run.analysis_version) && run.analysis_version >= 2));
    if (!runMatches) {
      return failed(jobId, 'canonical_run_missing', 'El job terminó, pero su corrida canónica no está disponible.');
    }
    return Object.freeze({
      state: 'ready', jobId, runId: run.id, errorCode: null,
      reportAvailable: true, humanDecisionRequired: true,
      action: action(true, null, 'El reporte inicial está listo para revisión y decisión humana.'),
    });
  }

  return failed(jobId, 'state_invalid', 'El estado durable del análisis inicial no es válido.');
}
