import { createClient } from '@supabase/supabase-js';
const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url || !key) throw new Error('CONFIG_MISSING');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const jobId = '8c369dae-6ebc-489b-a0e0-2cfe9be352d7';
const { data, error } = await db.from('psi_agt002_reanalysis_jobs')
  .select('id,status,error_code,error_message,completed_at,updated_at,analysis_run_id,phase,completed_batch_count,total_batch_count,resume_count,execution_mode')
  .eq('id', jobId).single();
if (error) throw new Error(error.code || 'QUERY_FAILED');
const message = String(data.error_message || '');
const subcode = (message.match(/\b(v3_[a-z0-9_]+|AGT002_[A-Z0-9_]+)\b/) || [])[1] || null;
console.log(JSON.stringify({
  id: data.id,
  status: data.status,
  error_code: data.error_code,
  safe_subcode: subcode,
  message_length: message.length,
  message_has_v3: /v3_/.test(message),
  message_has_agt002: /AGT002_/.test(message),
  closed_code_match: (message.match(/\b(AGT002_[A-Z0-9_]+)\b/) || [])[1] || null,
  completed_at: data.completed_at,
  analysis_run_id: data.analysis_run_id,
  phase: data.phase,
  completed_batch_count: data.completed_batch_count,
  total_batch_count: data.total_batch_count,
  resume_count: data.resume_count,
  execution_mode: data.execution_mode,
}));
