import { projectAgt002InitialAnalysisState } from './agt002-initial-analysis-projection.js';

function readError(label) {
  const error = new Error(label);
  error.code = 'AGT002_INITIAL_STATUS_READ_FAILED';
  return error;
}

/** Read-only canonical status loader. It never reads result JSON to infer execution state. */
export async function readAgt002InitialAnalysisStatus(database, opportunityId) {
  if (typeof opportunityId !== 'string' || opportunityId.trim() === '') {
    throw readError('La oportunidad es obligatoria.');
  }

  const { data: job, error: jobError } = await database
    .from('psi_agt002_initial_analysis_jobs')
    .select('id,status,analysis_run_id,error_code,created_at,updated_at')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) throw readError('No fue posible leer el estado del análisis inicial.');

  let run = null;
  if (job?.analysis_run_id) {
    const { data, error } = await database
      .from('psi_tender_analysis_runs')
      .select('id,status,canonical,analysis_kind,analysis_version')
      .eq('id', job.analysis_run_id)
      .eq('opportunity_id', opportunityId)
      .maybeSingle();
    if (error) throw readError('No fue posible verificar la corrida canónica del análisis inicial.');
    // psi_tender_analysis_runs has no `current` column. "Current" is defined by the database itself: the partial
    // unique index psi_tender_analysis_runs_one_canonical_current_idx allows at most one row per opportunity with
    // canonical = true and status = 'completed', and promoting a newer run demotes the previous one (migration 063).
    run = data ? { ...data, current: data.canonical === true && data.status === 'completed' } : null;
  }

  return projectAgt002InitialAnalysisState({ job, run });
}
