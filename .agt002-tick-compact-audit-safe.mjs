import { createClient } from '@supabase/supabase-js';

const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('CONFIG_MISSING');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const since = '2026-09-04T14:53:39.684Z';
const opportunityIds = [
  '55fe6e7e-5f95-4224-81d9-dd834e43e5fd',
  'a20cbbe6-b5e6-4e0b-b531-28403802b7dc',
  '9cf66883-b67c-4080-99b6-b419ee2b98f7',
];
const must = async (promise) => {
  const response = await promise;
  if (response.error) {
    const error = new Error(response.error.code || 'QUERY_FAILED');
    error.code = response.error.code || 'QUERY_FAILED';
    throw error;
  }
  return response.data || [];
};
const safeSubcode = (value) => {
  const match = String(value || '').match(/\b(v3_[a-z0-9_]+)\b/);
  return match ? match[1] : null;
};

const active = await must(db.from('psi_agt002_reanalysis_jobs')
  .select('id,opportunity_id,status,created_at,execution_mode,phase,error_code')
  .in('status', ['queued', 'running']));

const jobs = await must(db.from('psi_agt002_reanalysis_jobs')
  .select('id,opportunity_id,status,requested_by,created_at,completed_at,error_code,error_message,analysis_run_id,execution_mode,phase,completed_batch_count,total_batch_count,resume_count,idempotency_key')
  .in('opportunity_id', opportunityIds)
  .gte('created_at', since)
  .order('created_at', { ascending: true }));

const worksets = await must(db.from('psi_agt002_analysis_worksets')
  .select('id,opportunity_id,idempotency_key,published,published_analysis_run_id,created_at,archived_at')
  .in('opportunity_id', opportunityIds)
  .gte('created_at', since)
  .order('created_at', { ascending: true }));

const worksetSummaries = [];
for (const workset of worksets) {
  const checkpoints = await must(db.from('psi_agt002_analysis_checkpoints')
    .select('stage,batch_index')
    .eq('workset_id', workset.id));
  const identities = checkpoints.map((row) => `${row.stage}:${row.batch_index}`);
  worksetSummaries.push({
    id: workset.id,
    opportunity_id: workset.opportunity_id,
    idempotency_key: workset.idempotency_key,
    published: workset.published,
    published_analysis_run_id: workset.published_analysis_run_id,
    created_at: workset.created_at,
    archived_at: workset.archived_at,
    checkpoint_count: checkpoints.length,
    unique_stage_batch_count: new Set(identities).size,
    stage_counts: checkpoints.reduce((acc, row) => ({ ...acc, [row.stage]: (acc[row.stage] || 0) + 1 }), {}),
  });
}

const runs = await must(db.from('psi_tender_analysis_runs')
  .select('id,opportunity_id,status,canonical,created_at,completed_at,supersedes_run_id')
  .eq('opportunity_id', '55fe6e7e-5f95-4224-81d9-dd834e43e5fd')
  .eq('canonical', true)
  .order('created_at', { ascending: false })
  .limit(3));

const reviewItems = await must(db.from('psi_tender_actionable_review_items')
  .select('id')
  .eq('opportunity_id', '55fe6e7e-5f95-4224-81d9-dd834e43e5fd')
  .gte('created_at', since));

const contexts = await must(db.from('psi_agt002_context_versions')
  .select('id,opportunity_id,created_at')
  .in('opportunity_id', opportunityIds)
  .gte('created_at', since));

console.log(JSON.stringify({
  observed_at: new Date().toISOString(),
  active_job_count: active.length,
  active_jobs: active,
  jobs: jobs.map((job) => ({
    id: job.id,
    opportunity_id: job.opportunity_id,
    status: job.status,
    requested_by: job.requested_by,
    created_at: job.created_at,
    completed_at: job.completed_at,
    error_code: job.error_code,
    safe_subcode: safeSubcode(job.error_message),
    analysis_run_id: job.analysis_run_id,
    execution_mode: job.execution_mode,
    phase: job.phase,
    completed_batch_count: job.completed_batch_count,
    total_batch_count: job.total_batch_count,
    resume_count: job.resume_count,
    idempotency_key: job.idempotency_key,
  })),
  worksets: worksetSummaries,
  canonical_runs: runs,
  review_item_count: reviewItems.length,
  contexts,
}, null, 2));
