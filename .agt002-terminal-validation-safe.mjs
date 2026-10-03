import { createClient } from '@supabase/supabase-js';
const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('CONFIG_MISSING');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const opportunityId = '55fe6e7e-5f95-4224-81d9-dd834e43e5fd';
const { data: runs, error: runError } = await db.from('psi_tender_analysis_runs')
  .select('id,status,canonical,producer,method,created_at,completed_at,supersedes_run_id')
  .eq('opportunity_id', opportunityId)
  .eq('canonical', true)
  .order('created_at', { ascending: false })
  .limit(5);
if (runError) throw new Error(runError.code || 'RUNS_QUERY_FAILED');
const { data: active, error: activeError } = await db.from('psi_agt002_reanalysis_jobs')
  .select('id,status')
  .in('status', ['queued', 'running']);
if (activeError) throw new Error(activeError.code || 'ACTIVE_QUERY_FAILED');
const { data: workset, error: worksetError } = await db.from('psi_agt002_analysis_worksets')
  .select('id,published,published_analysis_run_id,archived_at')
  .eq('id', 'bb6ec684-16ff-452c-a674-99804c677b0f')
  .single();
if (worksetError) throw new Error(worksetError.code || 'WORKSET_QUERY_FAILED');
const { count: checkpointCount, error: checkpointError } = await db.from('psi_agt002_analysis_checkpoints')
  .select('id', { count: 'exact', head: true })
  .eq('workset_id', 'bb6ec684-16ff-452c-a674-99804c677b0f');
if (checkpointError) throw new Error(checkpointError.code || 'CHECKPOINT_QUERY_FAILED');
const { count: reviewItemCount, error: reviewError } = await db.from('psi_tender_actionable_review_items')
  .select('id', { count: 'exact', head: true })
  .eq('opportunity_id', opportunityId)
  .gte('created_at', '2026-09-04T14:53:39.684Z');
if (reviewError) throw new Error(reviewError.code || 'REVIEW_QUERY_FAILED');
console.log(JSON.stringify({
  observed_at: new Date().toISOString(),
  active_job_count: (active || []).length,
  canonical_runs: runs,
  workset,
  checkpoint_count: checkpointCount,
  review_item_count_since_mission: reviewItemCount,
}));
