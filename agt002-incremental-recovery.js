import { buildAgt002IncrementalDeltaManifest } from './agt002-incremental-analysis-input.js';
import { projectAgt002PriorFindings } from './agt002-incremental-dispatch.js';
import { closeAgt002IncrementalChangeSet, sealAgt002IncrementalChangeSet } from './agt002-incremental-reanalysis-triggers.js';
import { prepareAndDispatchAgt002IncrementalJob, readCurrentAgt002IncrementalSnapshotId } from './agt002-incremental-job-service.js';

function iso(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Una señal incremental tiene observed_at inválido.');
  return date.toISOString();
}

async function maybeOne(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadSetMembers(database, changeSetId) {
  const { data, error } = await database.from('psi_agt002_incremental_signals')
    .select('id,trigger_kind,source_table,source_type,source_id,source_version,content_hash,observed_at,actor_profile_id,source_batch_id')
    .eq('change_set_id', changeSetId)
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []).map(row => ({
    signal_id: row.id,
    trigger_kind: row.trigger_kind,
    source_table: row.source_table,
    source_type: row.source_type,
    source_id: row.source_id,
    source_version: row.source_version,
    content_hash: row.content_hash,
    observed_at: iso(row.observed_at),
    actor_profile_id: row.actor_profile_id,
    source_batch_id: row.source_batch_id,
  }));
}

/** One bounded recovery decision: no polling, no model retry and no more than one set/job. */
export async function recoverOneAgt002IncrementalChangeSet(database, { environment = process.env } = {}) {
  let set = await maybeOne(database.from('psi_agt002_incremental_change_sets')
    .select('id,opportunity_id,tender_id,prior_canonical_run_id,prior_context_version_id,requested_by,state,policy_version,manifest,linked_job_id')
    .in('state', ['SEALED', 'DISPATCHED', 'RUNNING'])
    .order('created_at', { ascending: true }).limit(1));
  if (!set) {
    set = await maybeOne(database.from('psi_agt002_incremental_change_sets')
      .select('id,opportunity_id,tender_id,prior_canonical_run_id,prior_context_version_id,requested_by,state,policy_version,manifest,linked_job_id')
      .eq('state', 'ACCUMULATING').order('created_at', { ascending: true }).limit(1));
  }
  if (!set) return { status: 'empty', job_id: null };
  if (set.state === 'DISPATCHED' || set.state === 'RUNNING') {
    const job = await maybeOne(database.from('psi_agt002_reanalysis_jobs')
      .select('id,status,analysis_run_id,error_code').eq('id', set.linked_job_id));
    if (!job) throw new Error('El conjunto incremental activo no tiene un job durable legible.');
    if (job.status === 'completed' && job.analysis_run_id) {
      await closeAgt002IncrementalChangeSet(database, {
        jobId: job.id, outcome: 'completed', analysisRunId: job.analysis_run_id,
        workerId: 'agt002-incremental-recovery',
      });
      return { status: 'reconciled', change_set_id: set.id, job_id: job.id, outcome: 'completed' };
    }
    if (job.status === 'unavailable' && job.error_code) {
      await closeAgt002IncrementalChangeSet(database, {
        jobId: job.id, outcome: 'failed', safeError: job.error_code,
        workerId: 'agt002-incremental-recovery',
      });
      return { status: 'reconciled', change_set_id: set.id, job_id: job.id, outcome: 'failed' };
    }
    if (!['queued', 'running'].includes(job.status)) {
      throw new Error('El job durable del conjunto incremental tiene un estado incompatible.');
    }
    return { status: 'job_ready', change_set_id: set.id, job_id: set.linked_job_id };
  }
  let manifest = set.manifest;
  if (set.state === 'ACCUMULATING') {
    const members = await loadSetMembers(database, set.id);
    const prior = await maybeOne(database.from('psi_tender_analysis_runs')
      .select('id,result').eq('id', set.prior_canonical_run_id)
      .eq('opportunity_id', set.opportunity_id).eq('tender_id', set.tender_id));
    if (!prior) throw new Error('La corrida canónica previa del conjunto acumulado no está disponible.');
    const affectedFindingRefs = projectAgt002PriorFindings(prior.result)
      .map(finding => finding.finding_ref).sort();
    manifest = buildAgt002IncrementalDeltaManifest({
      opportunityId: set.opportunity_id,
      tenderId: set.tender_id,
      changeSetId: set.id,
      priorCanonicalRunId: set.prior_canonical_run_id,
      priorContextVersionId: set.prior_context_version_id,
      members,
      affectedFindingRefs,
      policyVersion: set.policy_version,
    });
    await sealAgt002IncrementalChangeSet(database, manifest);
  }
  const snapshotId = await readCurrentAgt002IncrementalSnapshotId(database, set.opportunity_id);
  const dispatched = await prepareAndDispatchAgt002IncrementalJob(database, {
    manifest,
    snapshotId,
    actorProfileId: set.requested_by,
    environment,
    wakeWorker: null,
  });
  return { status: 'job_ready', change_set_id: set.id, job_id: dispatched.job_id };
}
