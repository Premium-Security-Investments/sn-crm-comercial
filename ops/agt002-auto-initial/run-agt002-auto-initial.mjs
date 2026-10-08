#!/usr/bin/env node
// AGT-002 automatic first analysis after a conversion (owner decision 2026-10-06). One pass, run by a systemd timer:
//   1. Documents: drives the CRM's own durable document pipeline (POST /api/tender-processing-worker-run, one document
//      per call) while a conversion at or after AGT002_AUTO_INITIAL_SINCE still waits for its documents. The pipeline's
//      claim is global FIFO, so an older pending job is processed first: that only downloads documents (no model, no
//      cost) and is never admitted to an analysis, because step 2 only admits conversions since the activation.
//   2. Analysis: admits the INITIAL analysis for every conversion whose documents are ready (agt002-auto-initial.js),
//      within the daily cap; the initial-analysis worker timer then runs it.
//   3. New SECOP phase or republication of a converted process (owner decision 2026-10-08): once its new official
//      documents are imported (Radar daily job), admits its REANALYSIS (or INITIAL) within the SAME daily cap, at most
//      once per new notice (agt002-phase-change-followup.js).
import { createClient } from '@supabase/supabase-js';
import { runAgt002AutoInitialAdmissions } from '../../agt002-auto-initial.js';
import { runAgt002PhaseChangeAnalysisAdmissions } from '../../agt002-phase-change-followup.js';

const CLAIMABLE = ['queued', 'discovering_documents', 'importing_documents', 'retry_wait', 'ready_for_snapshot', 'snapshot_ready'];
const log = event => console.log(JSON.stringify(event));
const env = process.env;
const since = env.AGT002_AUTO_INITIAL_SINCE;
const supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!supabaseUrl || !serviceKey || !since) {
  log({ event: 'agt002_auto_initial_config_missing' });
  process.exit(1);
}
const database = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

async function claimableJobs(filter) {
  const { data, error } = await filter(database.from('psi_tender_processing_jobs').select('id,opportunity_id,status,created_at').in('status', CLAIMABLE));
  if (error) throw new Error(`lectura de trabajos: ${error.message}`);
  return data || [];
}

async function driveDocuments() {
  const pending = await claimableJobs(query => query.gte('created_at', since));
  if (pending.length === 0) return { event: 'agt002_auto_initial_documents_idle' };
  if (!env.TENDER_WORKER_URL || !env.TENDER_WORKER_SECRET) return { event: 'agt002_auto_initial_documents_unconfigured' };
  const deadline = Date.now() + Number(env.AGT002_AUTO_INITIAL_DOCUMENTS_BUDGET_MS || 240_000);
  let calls = 0;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(env.TENDER_WORKER_URL, {
      method: 'POST',
      headers: { 'x-tender-worker-secret': env.TENDER_WORKER_SECRET, 'Content-Length': '0' },
      signal: AbortSignal.timeout(120_000),
    }).catch(error => ({ ok: false, status: 0, json: async () => ({ error: error?.name || 'fetch_failed' }) }));
    calls += 1;
    last = { http: response.status, ...(await response.json().catch(() => ({}))) };
    if (!response.ok || !last.processed) break;
    if ((await claimableJobs(query => query.gte('created_at', since))).length === 0) break;
  }
  return { event: 'agt002_auto_initial_documents_driven', calls, last };
}

try {
  log(await driveDocuments());
} catch (error) {
  log({ event: 'agt002_auto_initial_documents_failed', message: String(error?.message || error).slice(0, 200) });
}
try {
  const dailyCap = Number(env.AGT002_AUTO_INITIAL_DAILY_CAP || 5);
  for (const event of await runAgt002AutoInitialAdmissions(database, { since, dailyCap, environment: env })) log(event);
} catch (error) {
  log({ event: 'agt002_auto_initial_admission_pass_failed', message: String(error?.message || error).slice(0, 200) });
  process.exitCode = 1;
}
try {
  const dailyCap = Number(env.AGT002_AUTO_INITIAL_DAILY_CAP || 5);
  for (const event of await runAgt002PhaseChangeAnalysisAdmissions(database, { dailyCap, environment: env })) log(event);
} catch (error) {
  log({ event: 'agt002_phase_change_analysis_pass_failed', message: String(error?.message || error).slice(0, 200) });
  process.exitCode = 1;
}
