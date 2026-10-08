import { projectAgt002InitialAnalysisState } from './agt002-initial-analysis-projection.js';

function readError(label) {
  const error = new Error(label);
  error.code = 'AGT002_INITIAL_STATUS_READ_FAILED';
  return error;
}

async function hasCanonicalSuccessorLineage(database, opportunityId, ancestorRunId) {
  const { data: current, error: currentError } = await database
    .from('psi_tender_analysis_runs')
    .select('id,status,canonical,supersedes_run_id')
    .eq('opportunity_id', opportunityId).eq('status', 'completed').eq('canonical', true)
    .maybeSingle();
  if (currentError) throw readError('No fue posible verificar la sucesión canónica del análisis inicial.');
  if (!current || current.canonical !== true || current.status !== 'completed') return false;
  let cursor = current;
  const seen = new Set();
  for (let depth = 0; depth < 32 && cursor; depth += 1) {
    if (cursor.id === ancestorRunId) return true;
    if (cursor.supersedes_run_id === ancestorRunId) return true;
    if (!cursor.supersedes_run_id || seen.has(cursor.id)) return false;
    seen.add(cursor.id);
    const { data: predecessor, error } = await database.from('psi_tender_analysis_runs')
      .select('id,status,canonical,supersedes_run_id')
      .eq('id', cursor.supersedes_run_id).eq('opportunity_id', opportunityId).maybeSingle();
    if (error) throw readError('No fue posible verificar la sucesión canónica del análisis inicial.');
    cursor = predecessor;
  }
  return false;
}

/** Read-only canonical status loader. It never reads result JSON to infer execution state. */
export async function readAgt002InitialAnalysisStatus(database, opportunityId) {
  if (typeof opportunityId !== 'string' || opportunityId.trim() === '') {
    throw readError('La oportunidad es obligatoria.');
  }

  const { data: latestJob, error: jobError } = await database
    .from('psi_agt002_initial_analysis_jobs')
    .select('id,status,analysis_run_id,error_code,created_at,updated_at,analysis_kind')
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (jobError) throw readError('No fue posible leer el estado del análisis inicial.');

  // A REANALYSIS that is still running or that failed never hides the analysis it would succeed:
  // until it completes, the latest COMPLETED job (whose run is still canonical) stays the one shown.
  let job = latestJob;
  if (latestJob?.analysis_kind === 'REANALYSIS' && latestJob.status !== 'COMPLETED') {
    const { data: completedJob, error: completedError } = await database
      .from('psi_agt002_initial_analysis_jobs')
      .select('id,status,analysis_run_id,error_code,created_at,updated_at,analysis_kind')
      .eq('opportunity_id', opportunityId)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (completedError) throw readError('No fue posible leer el estado del análisis inicial.');
    if (completedJob) job = completedJob;
  }

  let run = null;
  if (job?.analysis_run_id) {
    const { data, error } = await database
      .from('psi_tender_analysis_runs')
      .select('id,status,canonical,analysis_kind,analysis_version,supersedes_run_id')
      .eq('id', job.analysis_run_id)
      .eq('opportunity_id', opportunityId)
      .maybeSingle();
    if (error) throw readError('No fue posible verificar la corrida canónica del análisis inicial.');
    // psi_tender_analysis_runs has no `current` column. "Current" is defined by the database itself: the partial
    // unique index psi_tender_analysis_runs_one_canonical_current_idx allows at most one row per opportunity with
    // canonical = true and status = 'completed', and promoting a newer run demotes the previous one (migration 063).
    const supersededByIncremental = data?.status === 'completed' && data.canonical !== true
      ? await hasCanonicalSuccessorLineage(database, opportunityId, data.id)
      : false;
    run = data ? {
      ...data,
      current: data.canonical === true && data.status === 'completed',
      superseded_by_incremental: supersededByIncremental,
    } : null;
  }

  return projectAgt002InitialAnalysisState({ job, run });
}
