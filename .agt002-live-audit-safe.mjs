import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const opportunities = {
  procuraduria: '55fe6e7e-5f95-4224-81d9-dd834e43e5fd',
  cali: 'a20cbbe6-b5e6-4e0b-b531-28403802b7dc',
  pereira: '9cf66883-b67c-4080-99b6-b419ee2b98f7',
};
const since = '2026-09-04T14:53:39.684Z';
const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('CONFIG_MISSING');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeSubcode = value => {
  const match = String(value || '').match(/\b(v3_[a-z0-9_]+)\b/);
  return match ? match[1] : null;
};
const must = async promise => {
  const response = await promise;
  if (response.error) {
    const error = new Error(response.error.code || 'QUERY_FAILED');
    error.code = response.error.code || 'QUERY_FAILED';
    throw error;
  }
  return response.data || [];
};

const active = await must(db.from('psi_agt002_reanalysis_jobs')
  .select('id,opportunity_id,status,created_at,started_at,updated_at,lease_expires_at,execution_mode,phase,completed_batch_count,total_batch_count,resume_count')
  .in('status', ['queued', 'running']).order('created_at', { ascending: true }));

const report = {
  observed_at: new Date().toISOString(),
  active_jobs: active,
  active_job_count: active.length,
  cases: {},
};

for (const [name, opportunityId] of Object.entries(opportunities)) {
  const jobs = await must(db.from('psi_agt002_reanalysis_jobs')
    .select('id,opportunity_id,tender_id,snapshot_id,context_version_id,idempotency_key,frozen_engine_input,status,requested_by,created_at,started_at,completed_at,updated_at,analysis_run_id,error_code,error_message,lease_expires_at,execution_mode,phase,completed_batch_count,total_batch_count,resume_count')
    .eq('opportunity_id', opportunityId).gte('created_at', since).order('created_at', { ascending: true }));
  const worksets = await must(db.from('psi_agt002_analysis_worksets')
    .select('id,idempotency_key,opportunity_id,tender_id,snapshot_id,context_version_id,published,published_analysis_run_id,created_at,archived_at')
    .eq('opportunity_id', opportunityId).gte('created_at', since).order('created_at', { ascending: true }));
  const worksetAudits = [];
  for (const workset of worksets) {
    const checkpoints = await must(db.from('psi_agt002_analysis_checkpoints')
      .select('id,stage,batch_index,request_hash,output_sha256,provider_idempotency_key,created_at')
      .eq('workset_id', workset.id).order('stage').order('batch_index'));
    const identities = checkpoints.map(row => `${row.stage}:${row.batch_index}`);
    worksetAudits.push({
      ...workset,
      checkpoint_count: checkpoints.length,
      unique_stage_batch_count: new Set(identities).size,
      stage_counts: checkpoints.reduce((acc, row) => ({ ...acc, [row.stage]: (acc[row.stage] || 0) + 1 }), {}),
      checkpoints: checkpoints.map(({ id, stage, batch_index, request_hash, output_sha256, provider_idempotency_key, created_at }) => ({ id, stage, batch_index, request_hash, output_sha256, provider_idempotency_key, created_at })),
    });
  }
  const runs = await must(db.from('psi_tender_analysis_runs')
    .select('id,snapshot_id,opportunity_id,tender_id,producer,method,status,idempotency_key,schema_version,policy_version,model,created_at,completed_at,canonical,context_version_id,supersedes_run_id')
    .eq('opportunity_id', opportunityId).gte('created_at', since).order('created_at', { ascending: true }));
  const contexts = await must(db.from('psi_agt002_context_versions')
    .select('id,opportunity_id,tender_id,snapshot_id,created_at')
    .eq('opportunity_id', opportunityId).gte('created_at', since).order('created_at', { ascending: true }));
  const reviewItems = await must(db.from('psi_tender_actionable_review_items')
    .select('id,analysis_run_id,created_at')
    .eq('opportunity_id', opportunityId).gte('created_at', since));
  let reviewEventCount = 0;
  if (reviewItems.length) {
    const events = await must(db.from('psi_tender_actionable_review_events').select('id,review_item_id,event_type,created_at').in('review_item_id', reviewItems.map(row => row.id)));
    reviewEventCount = events.length;
  }
  report.cases[name] = {
    opportunity_id: opportunityId,
    jobs: jobs.map(job => ({
      id: job.id,
      tender_id: job.tender_id,
      snapshot_id: job.snapshot_id,
      context_version_id: job.context_version_id,
      idempotency_key: job.idempotency_key,
      frozen_input_sha256: sha(job.frozen_engine_input),
      frozen_contract: {
        schema_version: job.frozen_engine_input?.schema_version ?? null,
        effort: job.frozen_engine_input?.engine_identity?.effort ?? job.frozen_engine_input?.effort ?? null,
        analysis_flags: job.frozen_engine_input?.analysis_flags ?? null,
      },
      status: job.status,
      requested_by: job.requested_by,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      updated_at: job.updated_at,
      analysis_run_id: job.analysis_run_id,
      error_code: job.error_code,
      safe_subcode: safeSubcode(job.error_message),
      lease_expires_at: job.lease_expires_at,
      execution_mode: job.execution_mode,
      phase: job.phase,
      completed_batch_count: job.completed_batch_count,
      total_batch_count: job.total_batch_count,
      resume_count: job.resume_count,
    })),
    worksets: worksetAudits,
    runs,
    contexts,
    review_item_count: reviewItems.length,
    review_event_count: reviewEventCount,
  };
}
console.log(JSON.stringify(report, null, 2));
