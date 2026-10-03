import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createAgt002ReanalysisJob } from './agt002-reanalysis-jobs.js';

const EXPECTED = Object.freeze({
  sourceJobId: '4d8b0295-bfdc-4933-80a9-d7754b338109',
  opportunityId: '55fe6e7e-5f95-4224-81d9-dd834e43e5fd',
  tenderId: '13b6cb19-24f1-480c-9891-d5766893cf26',
  actorId: '60b26173-1226-476b-a958-cf2917661432',
  stableKey: 'c7e5d927aa2d4985e55106be13f98769ba07e2f3f6915be432bafad60b356c4e',
  worksetId: 'bb6ec684-16ff-452c-a674-99804c677b0f',
  frozenSha256: 'ab6fad0fb362f6e4dfc108325cd82daadf4b303fae075c1f2ffa487b65d74254',
  checkpointCount: 36,
});
const requiredFlags = Object.freeze([
  'AGT002_INTEGRAL_CONTRACT_V3',
  'AGT002_CANONICAL_ONLY',
  'AGT002_CONTEXT_V2',
  'AGT002_DOCUMENT_RETRIEVAL',
]);
const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('CONFIG_MISSING');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const fail = code => { throw new Error(code); };
const query = async promise => {
  const response = await promise;
  if (response.error) fail(`DB_${response.error.code || 'QUERY_FAILED'}`);
  return response.data;
};
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const active = await query(db.from('psi_agt002_reanalysis_jobs').select('id,status').in('status', ['queued', 'running']));
if (!Array.isArray(active) || active.length !== 0) fail('GLOBAL_ACTIVE_JOB_GATE_CLOSED');

const source = await query(db.from('psi_agt002_reanalysis_jobs')
  .select('id,opportunity_id,tender_id,snapshot_id,context_version_id,idempotency_key,frozen_engine_input,status,requested_by,execution_mode')
  .eq('id', EXPECTED.sourceJobId).single());
if (source.id !== EXPECTED.sourceJobId
    || source.opportunity_id !== EXPECTED.opportunityId
    || source.tender_id !== EXPECTED.tenderId
    || source.requested_by !== EXPECTED.actorId
    || source.idempotency_key !== EXPECTED.stableKey
    || source.status !== 'unavailable'
    || source.execution_mode !== 'durable_batched_v1'
    || sha(source.frozen_engine_input) !== EXPECTED.frozenSha256) fail('SOURCE_IDENTITY_GATE_CLOSED');
const frozen = source.frozen_engine_input;
if (frozen?.schema_version !== 2
    || frozen?.engine_identity?.effort !== 'medium'
    || requiredFlags.some(flag => frozen?.analysis_flags?.[flag] !== true)) fail('FROZEN_CONTRACT_GATE_CLOSED');

const workset = await query(db.from('psi_agt002_analysis_worksets')
  .select('id,idempotency_key,opportunity_id,tender_id,snapshot_id,context_version_id,published,published_analysis_run_id,archived_at')
  .eq('id', EXPECTED.worksetId).single());
if (workset.idempotency_key !== EXPECTED.stableKey
    || workset.opportunity_id !== EXPECTED.opportunityId
    || workset.tender_id !== EXPECTED.tenderId
    || workset.snapshot_id !== source.snapshot_id
    || workset.context_version_id !== source.context_version_id
    || workset.published !== false
    || workset.published_analysis_run_id !== null
    || workset.archived_at !== null) fail('WORKSET_GATE_CLOSED');

const checkpoints = await query(db.from('psi_agt002_analysis_checkpoints')
  .select('stage,batch_index').eq('workset_id', EXPECTED.worksetId));
const identities = new Set((checkpoints || []).map(row => `${row.stage}:${row.batch_index}`));
if (!Array.isArray(checkpoints)
    || checkpoints.length !== EXPECTED.checkpointCount
    || identities.size !== EXPECTED.checkpointCount) fail('CHECKPOINT_GATE_CLOSED');

const created = await createAgt002ReanalysisJob(db, {
  opportunityId: source.opportunity_id,
  tenderId: source.tender_id,
  snapshotId: source.snapshot_id,
  contextVersionId: source.context_version_id,
  idempotencyKey: source.idempotency_key,
  frozenEngineInput: source.frozen_engine_input,
  requestedBy: EXPECTED.actorId,
});
console.log(JSON.stringify({
  event: 'agt002_procuraduria_pr179_verification_enqueued',
  status: created.status,
  job_id: created.jobId,
  source_job_id: EXPECTED.sourceJobId,
  active_preflight_count: active.length,
  workset_id: EXPECTED.worksetId,
  checkpoint_count: checkpoints.length,
  stable_key: EXPECTED.stableKey,
  frozen_input_sha256: EXPECTED.frozenSha256,
  requested_by: EXPECTED.actorId,
  execution_mode: 'durable_batched_v1',
  deployed_sha: 'f6f6896ffba9ae110bec8576ed07fcb1526f8bd2',
}));
