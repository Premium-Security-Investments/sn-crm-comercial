#!/usr/bin/env node
// AGT-002 automatic first analysis after a conversion (owner decision 2026-10-06). One pass, started by the
// initial-analysis worker unit before each worker run (one timer for the whole analysis since 2026-11-11):
//   1. Documents: drives the CRM's own durable document pipeline (POST /api/tender-processing-worker-run, one document
//      per call) while a conversion at or after AGT002_AUTO_INITIAL_SINCE still waits for its documents. The pipeline's
//      claim is global FIFO, so an older pending job is processed first: that only downloads documents (no model, no
//      cost) and is never admitted to an analysis, because step 2 only admits conversions since the activation.
//   2. Analysis: admits the INITIAL analysis for every conversion whose documents are ready (agt002-auto-initial.js),
//      within the daily cap; the initial-analysis worker timer then runs it.
//   3. "Volver a analizar": admits the reanalysis a person asked for from the opportunity (agt002-manual-reanalysis.js),
//      outside the daily cap of first analyses; the same worker timer runs it.
//   (New SECOP phases of converted tenders have their own review service: agt002-phase-change-review.)
// Entre 1 y 2: OCR de los PDF escaneados (Juan, 2026-11-08), antes de admitir análisis, para que el texto ya esté.
import { createClient } from '@supabase/supabase-js';
import { filterAgt002ActiveProcessingJobs, runAgt002AutoInitialAdmissions } from '../../verticales/licitaciones/agt002-auto-initial.js';
import { runAgt002ManualReanalysisRequests } from '../../verticales/licitaciones/agt002-manual-reanalysis.js';
import { runExperienceCertificateOcrPass, runTenderDocumentOcrPass } from '../../verticales/licitaciones/tender-document-ocr.js';
import { runTenderDocumentLegacyOfficePass } from '../../verticales/licitaciones/tender-document-legacy-office.js';
import { reviewExperienceCertificate } from '../../verticales/licitaciones/experience-certificate-review.js';
import { proposeCompanyFactsFromDocuments } from '../../verticales/licitaciones/agt002-company-fact-proposals.js';
import { runAgt002RespuestasPorObservacionPass } from '../../verticales/licitaciones/agt002-respuestas-por-observacion.js';

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

// Sólo trabajos de oportunidades ACTIVAS (decisión del dueño, 2026-10-09): una NO GO o cerrada nunca hace que el host
// llame al trabajador de documentos.
async function claimableJobs(filter) {
  const { data, error } = await filter(database.from('psi_tender_processing_jobs').select('id,opportunity_id,tender_id,status,created_at').in('status', CLAIMABLE));
  if (error) throw new Error(`lectura de trabajos: ${error.message}`);
  return filterAgt002ActiveProcessingJobs(database, data || []);
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
  // F14 también para lo escaneado: si el documento es nuestro, el texto del OCR pasa por la propuesta a la ficha. La
  // propuesta se apaga sola si este servidor no tiene la configuración de la Mesa.
  const onText = (version, text) => version.origin === 'propio'
    ? proposeCompanyFactsFromDocuments(database, { opportunityId: version.opportunity_id, actorId: version.actor_id, documents: [{ id: version.id, name: version.name, extracted_text: text }], environment: env, log })
    : null;
  for (const event of await runTenderDocumentOcrPass(database, { limit: Number(env.TENDER_OCR_PER_PASS || 2), onText })) log(event);
} catch (error) {
  log({ event: 'tender_ocr_pass_failed', message: String(error?.message || error).slice(0, 200) });
}
try {
  // Formatos viejos de Office (Juan, 2026-11-13): .doc y .xls, sueltos o dentro de un zip, se convierten con LibreOffice y
  // se vuelven a leer antes de que arranque el análisis.
  for (const event of await runTenderDocumentLegacyOfficePass(database, { limit: Number(env.TENDER_LEGACY_OFFICE_PER_PASS || 2) })) log(event);
} catch (error) {
  log({ event: 'tender_legacy_office_pass_failed', message: String(error?.message || error).slice(0, 200) });
}
try {
  // Mejora 9 (Juan, 2026-11-10): los certificados de experiencia escaneados se leen aquí, en el mismo pase, y Vig-IA los
  // revisa contra el RUP (se apaga sola si este servidor no tiene la configuración de la Mesa).
  const onText = row => reviewExperienceCertificate(database, row.id, { environment: env, log });
  for (const event of await runExperienceCertificateOcrPass(database, { limit: Number(env.EXPERIENCE_CERTIFICATE_OCR_PER_PASS || 2), onText })) log(event);
} catch (error) {
  log({ event: 'experience_certificate_ocr_pass_failed', message: String(error?.message || error).slice(0, 200) });
}
try {
  const dailyCap = Number(env.AGT002_AUTO_INITIAL_DAILY_CAP || 5);
  for (const event of await runAgt002AutoInitialAdmissions(database, { since, dailyCap, environment: env })) log(event);
} catch (error) {
  log({ event: 'agt002_auto_initial_admission_pass_failed', message: String(error?.message || error).slice(0, 200) });
  process.exitCode = 1;
}
try {
  for (const event of await runAgt002ManualReanalysisRequests(database, { environment: env })) log(event);
} catch (error) {
  log({ event: 'agt002_manual_reanalysis_pass_failed', message: String(error?.message || error).slice(0, 200) });
  process.exitCode = 1;
}
// Paso 3 del expediente vivo (Juan, 2026-11-12): las respuestas a observaciones, una por observación, para la Mesa.
// Va al final y con el tiempo que le quede a esta pasada (la unidad corta a los 10 minutos); si no alcanza, la siguiente.
try {
  const restante = Number(env.AGT002_AUTO_INITIAL_TIMEOUT_MS || 600_000) - Math.round(process.uptime() * 1000) - 45_000;
  for (const event of await runAgt002RespuestasPorObservacionPass(database, { environment: env, timeoutMs: Math.min(restante, 8 * 60 * 1000) })) log(event);
} catch (error) {
  log({ event: 'agt002_respuestas_pass_failed', message: String(error?.message || error).slice(0, 200) });
}
