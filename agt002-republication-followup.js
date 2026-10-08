// AGT-002 — seguimiento automático de un proceso SECOP II republicado (decisiones del dueño, 2026-10-08).
//
// SECOP publica un proceso modificado como un proceso NUEVO con la misma referencia salvo puntuación/espacios. Cuando
// la importación del Radar enlaza esa versión nueva a una oportunidad ya convertida (tender-phase-identity.js; un paso
// de fase de SECOP NO es republicación), la oportunidad apunta al aviso nuevo y queda el aviso visible. Desde ahí, sin
// intervención humana y sólo desde los jobs del host (nunca en una petición web):
//   1. Documentos (job diario del Radar, sin costo de modelo): observa el conjunto de documentos que datos.gov.co
//      publica para el aviso nuevo y sólo lo importa cuando es el MISMO en dos corridas seguidas y no es mucho menor que
//      el conjunto oficial vigente. Retira como historial los del aviso anterior y deja la marca de importación sólo
//      después de publicar el snapshot documental. Si datos.gov.co aún no lo tiene, espera y reintenta.
//   2. Análisis (timer de auto-initial): con esa marca y un snapshot vigente posterior a la importación, admite un
//      REANÁLISIS sucesor del análisis canónico (o INITIAL si no hay análisis completado), autorizado por quien
//      convirtió ("convertir = autorización"), dentro del cupo diario de las admisiones AUTOMÁTICAS. Uno por aviso
//      nuevo; un resultado no admitido o sin cupo se registra y no se reintenta hasta el día siguiente (Bogotá).
//
// El estado vive en interacciones 'documento' con notas JSON (sólo se agregan, nunca se editan); las líneas visibles de
// las observaciones se agregan con un UPDATE atómico del lado SQL (migración 116), sin reescribir el campo completo.

import { createHash } from 'node:crypto';

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import {
  AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  AGT002_AUTO_INITIAL_POLICY_VERSION,
  AGT002_REPUBLICATION_ANALYSIS_KIND,
  agt002BogotaDayStart,
  countAgt002AutomaticAnalysesToday,
  selectAgt002AutoInitialMembers,
} from './agt002-auto-initial.js';

/** Identidad técnica Vig-IA (migración 047): actor de la importación documental y de los registros de estado. */
export const AGT002_VIGIA_AGENT_PROFILE_ID = 'a0020000-0000-4000-8000-000000000002';
export const AGT002_REPUBLICATION_KINDS = Object.freeze({
  detected: 'tender_republication_detected',
  observed: 'tender_republication_documents_observed',
  imported: 'tender_republication_documents_imported',
  analysis: AGT002_REPUBLICATION_ANALYSIS_KIND,
});
const AUTHORIZATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_ANALYSIS_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);
const LAUNCHED_ADMISSION_STATUSES = new Set(['admitted', 'existing']);

export function noticeUidFromTenderUrl(url) {
  const match = String(url || '').match(/[?&]noticeUID=([^&\s]+)/i);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** Huella del conjunto de documentos (nombres ordenados, sin duplicados). */
export function republicationDocumentSetHash(names) {
  const normalized = [...new Set((names || []).map(name => String(name || '').trim()).filter(Boolean))].sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex');
}

/** Un conjunto "mucho menor" que el oficial vigente (menos de la mitad) no reemplaza al expediente: se espera. */
export function isRepublicationDocumentSetTooSmall({ documentCount, currentOfficialCount }) {
  return Number(documentCount || 0) < Math.ceil(Number(currentOfficialCount || 0) / 2);
}

export function republicationDocumentsLine(noticeUid, { documentCount = 0, retiredCount = 0 } = {}) {
  return `Documentos oficiales de la versión nueva de SECOP importados (${noticeUid}): ${documentCount} vigentes; ${retiredCount} del aviso anterior quedan como historial.`;
}

export function republicationAnalysisLine(noticeUid, { outcome, analysisKind, admissionStatus } = {}) {
  const prefix = `SECOP publicó una versión nueva (${noticeUid}); `;
  if (outcome === 'launched') return `${prefix}se lanzó ${analysisKind === 'INITIAL' ? 'el análisis inicial' : 'el reanálisis'} automático.`;
  if (outcome === 'daily_cap') return `${prefix}reanálisis automático pendiente por cupo diario.`;
  if (outcome === 'window_elapsed') return `${prefix}el reanálisis automático no se lanzó en 48 horas; requiere lanzarse manualmente.`;
  return `${prefix}el reanálisis automático no se pudo lanzar (${admissionStatus || outcome}); se reintenta mañana.`;
}

function parseNotes(notes) {
  if (notes && typeof notes === 'object') return notes;
  try { return JSON.parse(String(notes || '')); } catch { return null; }
}

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) {
    const wrapped = new Error(`${label}: ${error.message || 'error de lectura'}`);
    wrapped.code = 'AGT002_REPUBLICATION_READ_FAILED';
    throw wrapped;
  }
  return data;
}

async function recordState(database, opportunityId, payload, { actorId = AGT002_VIGIA_AGENT_PROFILE_ID, now = new Date() } = {}) {
  await must(database.from('psi_sales_interactions').insert({
    opportunity_id: opportunityId, interaction_type: 'documento', created_by: actorId, occurred_at: now.toISOString(),
    notes: JSON.stringify(payload),
  }), 'registro del seguimiento');
}

/** Registros de estado del seguimiento para una oportunidad, de más antiguo a más reciente. */
export async function readAgt002RepublicationState(database, opportunityId) {
  const rows = await must(database.from('psi_sales_interactions')
    .select('id,notes,created_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento')
    .like('notes', '%"kind":"tender_republication_%'), 'estado del seguimiento');
  return (rows || [])
    .map(row => ({ ...row, payload: parseNotes(row.notes) }))
    .filter(row => row.payload?.kind?.startsWith?.('tender_republication_'))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

const ofKind = (state, kind, noticeUid) => state.filter(row => row.payload.kind === kind && row.payload.notice_uid === noticeUid);

/** Línea visible en observaciones: UPDATE atómico del lado SQL, sólo si no está (migración 116). */
export async function appendAgt002ObservationLine(database, opportunityId, line) {
  const { error } = await database.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
  if (error) throw new Error(`aviso en la oportunidad: ${error.message || 'falló'}`);
}

/** Lo llama la importación del Radar en cada corrida mientras la republicación sea la fuente vigente (idempotente). */
export async function recordAgt002RepublicationDetected(database, opportunityId, { url, ref = null, processId = null, detectedAt } = {}) {
  const noticeUid = noticeUidFromTenderUrl(url);
  if (!opportunityId || !noticeUid) return false;
  if (ofKind(await readAgt002RepublicationState(database, opportunityId), AGT002_REPUBLICATION_KINDS.detected, noticeUid).length) return false;
  await recordState(database, opportunityId, { kind: AGT002_REPUBLICATION_KINDS.detected, notice_uid: noticeUid, url, ref, process_id: processId, detected_at: detectedAt || new Date().toISOString() });
  return true;
}

/** Lo llama la importación oficial (api) sólo después de publicar el snapshot documental del aviso nuevo. */
export async function recordAgt002RepublicationDocumentsImported(database, opportunityId, { actorId, noticeUid, documentSetHash, snapshotId, startedAt, documentCount, retiredCount }) {
  await recordState(database, opportunityId, {
    kind: AGT002_REPUBLICATION_KINDS.imported, notice_uid: noticeUid, document_set_hash: documentSetHash, snapshot_id: snapshotId,
    started_at: startedAt, document_count: documentCount, retired_count: retiredCount,
  }, { actorId: actorId || AGT002_VIGIA_AGENT_PROFILE_ID });
}

/**
 * Oportunidades convertidas cuya fuente oficial actual es una republicación registrada por la importación del Radar.
 */
export async function findAgt002RepublishedOpportunities(database) {
  const detected = await must(database.from('psi_sales_interactions')
    .select('opportunity_id,notes,created_at').eq('interaction_type', 'documento')
    .like('notes', `%"kind":"${AGT002_REPUBLICATION_KINDS.detected}"%`), 'republicaciones detectadas');
  const byOpportunity = new Map();
  for (const row of detected || []) {
    const payload = parseNotes(row.notes);
    if (payload?.kind !== AGT002_REPUBLICATION_KINDS.detected || !payload.notice_uid) continue;
    const list = byOpportunity.get(row.opportunity_id) || [];
    list.push(payload);
    byOpportunity.set(row.opportunity_id, list);
  }
  const candidates = [];
  for (const [opportunityId, notices] of byOpportunity) {
    const tender = await must(database.from('psi_public_tenders')
      .select('id,ref,url,converted_opportunity_id,reviewed_by,internal_status')
      .eq('converted_opportunity_id', opportunityId).maybeSingle(), 'licitación convertida');
    if (!tender || tender.internal_status !== 'convertida_oportunidad') continue;
    const noticeUid = noticeUidFromTenderUrl(tender.url);
    const notice = notices.find(item => item.notice_uid === noticeUid);
    if (!notice) continue; // Sólo la republicación que sigue siendo la fuente vigente.
    candidates.push({ tender, opportunityId, noticeUid, ref: notice.ref || tender.ref || null });
  }
  return candidates;
}

/**
 * Paso 1 (documentos, sin costo de modelo). `probeDocuments` y `importDocuments` son la lectura e importación oficial
 * del CRM (api: probeRepublishedTenderDocumentSet / importRepublishedTenderDocuments). Nunca lanza por una candidata.
 */
export async function runAgt002RepublicationDocumentRefresh(database, {
  probeDocuments, importDocuments, actorProfileId = AGT002_VIGIA_AGENT_PROFILE_ID, now = new Date(),
} = {}) {
  if (typeof probeDocuments !== 'function' || typeof importDocuments !== 'function') throw new Error('probeDocuments e importDocuments son obligatorios.');
  const events = [];
  for (const { opportunityId, noticeUid } of await findAgt002RepublishedOpportunities(database)) {
    const base = { opportunityId, noticeUid };
    try {
      const state = await readAgt002RepublicationState(database, opportunityId);
      const imported = ofKind(state, AGT002_REPUBLICATION_KINDS.imported, noticeUid).at(-1);
      if (imported) {
        await appendAgt002ObservationLine(database, opportunityId, republicationDocumentsLine(noticeUid, { documentCount: imported.payload.document_count, retiredCount: imported.payload.retired_count }));
        events.push({ event: 'agt002_republication_documents_already_imported', ...base });
        continue;
      }
      const probe = await probeDocuments(opportunityId, { noticeUid });
      const lastObserved = ofKind(state, AGT002_REPUBLICATION_KINDS.observed, noticeUid).at(-1);
      if (!lastObserved || lastObserved.payload.document_set_hash !== probe.document_set_hash) {
        await recordState(database, opportunityId, {
          kind: AGT002_REPUBLICATION_KINDS.observed, notice_uid: noticeUid, document_set_hash: probe.document_set_hash,
          document_count: probe.document_count, current_official_count: probe.current_official_count,
        }, { now });
        events.push({ event: 'agt002_republication_documents_waiting_stability', documents: probe.document_count, ...base });
        continue;
      }
      if (isRepublicationDocumentSetTooSmall({ documentCount: probe.document_count, currentOfficialCount: probe.current_official_count })) {
        events.push({ event: 'agt002_republication_documents_waiting_smaller_set', documents: probe.document_count, current: probe.current_official_count, ...base });
        continue;
      }
      const result = await importDocuments(opportunityId, { noticeUid, actorProfileId, expectedDocumentSetHash: probe.document_set_hash });
      await appendAgt002ObservationLine(database, opportunityId, republicationDocumentsLine(noticeUid, { documentCount: probe.document_count, retiredCount: Number(result?.retired_count || 0) }));
      events.push({ event: 'agt002_republication_documents_imported', documents: probe.document_count, retired: Number(result?.retired_count || 0), ...base });
    } catch (error) {
      events.push({ event: 'agt002_republication_documents_pending', message: String(error?.message || error).slice(0, 200), ...base });
    }
  }
  return events;
}

/**
 * Decide, sin efectos, qué hacer con una oportunidad cuyos documentos nuevos ya están importados. El orden importa: lo
 * ya resuelto, luego la espera del día, luego la ventana de 48 h (antes que la espera por un análisis en curso, para
 * que un job atascado en NEEDS_ATTENTION no deje la republicación esperando para siempre).
 */
export function planAgt002RepublicationAnalysis({ imported, analysisRecords = [], jobs = [], canonical = null, now }) {
  const importedMs = Date.parse(imported.created_at);
  if (analysisRecords.some(row => ['launched', 'window_elapsed'].includes(row.payload.outcome))) return { action: 'done' };
  if (jobs.some(job => Date.parse(job.created_at) >= importedMs)) return { action: 'done', reason: 'analysis_after_import' };
  const todayStart = agt002BogotaDayStart(now).getTime();
  if (analysisRecords.some(row => Date.parse(row.created_at) >= todayStart)) return { action: 'backoff' };
  if (importedMs + AUTHORIZATION_WINDOW_MS <= now.getTime()) return { action: 'window_elapsed' };
  if (jobs.some(job => ACTIVE_ANALYSIS_STATUSES.has(job.status))) return { action: 'wait', reason: 'analysis_in_progress' };
  if (canonical?.id && canonical.analysis_kind) return { action: 'admit', analysisKind: 'REANALYSIS', sourceAnalysisRunId: canonical.id };
  return { action: 'admit', analysisKind: 'INITIAL', sourceAnalysisRunId: null };
}

async function hasSnapshotAfterImport(database, opportunityId, imported) {
  const state = await must(database.from('psi_tender_document_state')
    .select('current_snapshot_id').eq('opportunity_id', opportunityId).maybeSingle(), 'estado documental');
  if (!state?.current_snapshot_id) return false;
  if (state.current_snapshot_id === imported.payload.snapshot_id) return true;
  const snapshot = await must(database.from('psi_tender_document_snapshots')
    .select('id,created_at').eq('id', state.current_snapshot_id).maybeSingle(), 'snapshot documental');
  return Boolean(snapshot) && Date.parse(snapshot.created_at) >= Date.parse(imported.payload.started_at || imported.created_at);
}

async function resolveAuthorizingActor(database, opportunityId, tender) {
  const jobs = await must(database.from('psi_tender_processing_jobs')
    .select('requested_by,created_at').eq('opportunity_id', opportunityId).order('created_at', { ascending: true }).limit(1), 'quien convirtió');
  return jobs?.[0]?.requested_by || tender?.reviewed_by || null;
}

/**
 * Paso 2 (análisis). Mismas reglas que auto-initial: interruptores encendidos, cupo diario de admisiones automáticas
 * (auto-initial + reanálisis por republicación), actor = quien convirtió, ventana G1 determinista desde la importación.
 */
export async function runAgt002RepublicationAnalysisAdmissions(database, {
  dailyCap = AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  now = new Date(),
  environment = process.env,
  admit = admitAgt002InitialAnalysis,
  freezeProfile = freezeAgt002CompanyProfileSnapshot,
} = {}) {
  if (environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true' || environment.AGT002_MODEL_CALLS_ENABLED !== 'true') {
    return [{ event: 'agt002_republication_analysis_disabled', reason: 'kill_switch_off' }];
  }
  const events = [];
  let admittedToday = null;
  for (const { tender, opportunityId, noticeUid } of await findAgt002RepublishedOpportunities(database)) {
    const base = { opportunityId, noticeUid };
    const record = async (outcome, extra = {}) => {
      await recordState(database, opportunityId, { kind: AGT002_REPUBLICATION_KINDS.analysis, notice_uid: noticeUid, outcome, ...extra }, { now });
      await appendAgt002ObservationLine(database, opportunityId, republicationAnalysisLine(noticeUid, { outcome, analysisKind: extra.analysis_kind, admissionStatus: extra.admission_status }));
    };
    try {
      const state = await readAgt002RepublicationState(database, opportunityId);
      const imported = ofKind(state, AGT002_REPUBLICATION_KINDS.imported, noticeUid).at(-1);
      if (!imported) { events.push({ event: 'agt002_republication_analysis_waiting_documents', ...base }); continue; }
      const jobs = await must(database.from('psi_agt002_initial_analysis_jobs')
        .select('id,status,analysis_kind,created_at').eq('opportunity_id', opportunityId), 'análisis de la oportunidad');
      const canonical = await must(database.from('psi_tender_analysis_runs')
        .select('id,analysis_kind,status,canonical').eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
        .maybeSingle(), 'análisis canónico');
      const plan = planAgt002RepublicationAnalysis({ imported, analysisRecords: ofKind(state, AGT002_REPUBLICATION_KINDS.analysis, noticeUid), jobs: jobs || [], canonical, now });
      if (plan.action === 'done') { events.push({ event: 'agt002_republication_analysis_already_resolved', reason: plan.reason || null, ...base }); continue; }
      if (plan.action === 'backoff') { events.push({ event: 'agt002_republication_analysis_deferred', reason: 'retry_tomorrow', ...base }); continue; }
      if (plan.action === 'window_elapsed') {
        await record('window_elapsed');
        events.push({ event: 'agt002_republication_analysis_skipped', reason: 'authorization_window_elapsed', ...base });
        continue;
      }
      if (plan.action === 'wait') { events.push({ event: 'agt002_republication_analysis_deferred', reason: plan.reason, ...base }); continue; }
      if (!(await hasSnapshotAfterImport(database, opportunityId, imported))) {
        events.push({ event: 'agt002_republication_analysis_deferred', reason: 'snapshot_not_current', ...base });
        continue;
      }
      if (admittedToday === null) admittedToday = await countAgt002AutomaticAnalysesToday(database, now);
      if (admittedToday >= dailyCap) {
        await record('daily_cap', { analysis_kind: plan.analysisKind });
        events.push({ event: 'agt002_republication_analysis_deferred', reason: 'daily_cap', dailyCap, ...base });
        continue;
      }
      const actorProfileId = await resolveAuthorizingActor(database, opportunityId, tender);
      if (!actorProfileId) { await record('not_admitted', { admission_status: 'sin_actor_autorizante' }); events.push({ event: 'agt002_republication_analysis_skipped', reason: 'no_authorizing_actor', ...base }); continue; }
      const { requestedMembers, includedCount } = await selectAgt002AutoInitialMembers(database, opportunityId);
      if (includedCount === 0) { await record('not_admitted', { admission_status: 'sin_documentos_legibles' }); events.push({ event: 'agt002_republication_analysis_skipped', reason: 'no_readable_documents', ...base }); continue; }
      const profile = await freezeProfile(database, { actorProfileId });
      const admitted = await admit(database, {
        opportunityId,
        tenderId: tender.id,
        actorProfileId,
        requestedMembers,
        scope: 'A_PLUS_B',
        profileSnapshotId: profile.profileSnapshotId,
        profileSnapshotHash: profile.profileSnapshotHash,
        expiresAt: new Date(Date.parse(imported.created_at) + AUTHORIZATION_WINDOW_MS).toISOString(),
        policyVersion: AGT002_AUTO_INITIAL_POLICY_VERSION,
        // Una instancia de flujo propia por aviso nuevo: un reintento repite exactamente la misma admisión.
        attempt: `secop-republication:${noticeUid}`,
        analysisKind: plan.analysisKind,
        sourceAnalysisRunId: plan.sourceAnalysisRunId,
        environment,
      });
      const launched = LAUNCHED_ADMISSION_STATUSES.has(admitted.admissionStatus) && Boolean(admitted.jobId);
      if (launched && admitted.admissionStatus === 'admitted') admittedToday += 1;
      await record(launched ? 'launched' : 'not_admitted', { analysis_kind: plan.analysisKind, job_id: admitted.jobId || null, admission_status: admitted.admissionStatus || null });
      events.push({ event: launched ? 'agt002_republication_analysis_admitted' : 'agt002_republication_analysis_not_admitted', analysisKind: plan.analysisKind, jobId: admitted.jobId || null, admissionStatus: admitted.admissionStatus || null, documents: includedCount, ...base });
    } catch (error) {
      try { await record('failed', { admission_status: String(error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED') }); } catch { /* el evento ya reporta la falla */ }
      events.push({ event: 'agt002_republication_analysis_failed', code: error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED', ...base });
    }
  }
  return events;
}
