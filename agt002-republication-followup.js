// AGT-002 — seguimiento automático de un proceso SECOP II republicado (decisión del dueño, 2026-10-08).
//
// SECOP publica un proceso modificado como un proceso NUEVO con la misma referencia. Cuando la importación del
// Radar enlaza esa versión nueva a una oportunidad ya convertida (tender-phase-identity.js), deja en las
// observaciones de la oportunidad el aviso "SECOP publicó una versión nueva del proceso (<ref>): <url>" y apunta su
// "Link fuente" al aviso nuevo. Desde ahí, sin intervención humana y desde los jobs del host (nunca en una petición
// web):
//   1. Documentos (job diario del Radar, sin costo de modelo): importa los documentos oficiales del aviso nuevo
//      (datos.gov.co, por urlproceso → id_del_portafolio) y retira como historial los del aviso anterior. Si
//      datos.gov.co aún no publica el proceso o sus documentos (1–2 días de rezago), queda pendiente y se reintenta
//      en la siguiente corrida sin fallar la importación.
//   2. Análisis (timer de auto-initial): con los documentos nuevos ya vigentes, admite un REANÁLISIS sucesor del
//      análisis canónico vigente (o el INITIAL si la oportunidad aún no tiene análisis completado), autorizado por
//      quien convirtió ("convertir = autorización"), dentro del MISMO cupo diario de auto-initial y con los topes por
//      análisis del worker. Como mucho uno por aviso nuevo; nunca en bucle.
// El estado se deriva de hechos ya registrados (aviso en observaciones, interacción de importación con el noticeUID,
// jobs de análisis creados después de esa importación): no hay tabla nueva y cada paso es idempotente.

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import {
  AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  AGT002_AUTO_INITIAL_POLICY_VERSION,
  countAgt002InitialAnalysesToday,
  selectAgt002AutoInitialMembers,
} from './agt002-auto-initial.js';
import { TENDER_REPUBLICATION_NOTICE_PREFIX } from './tender-process-family.js';

/** Identidad técnica Vig-IA (migración 047): actor de la importación documental automática, no de la autorización. */
export const AGT002_VIGIA_AGENT_PROFILE_ID = 'a0020000-0000-4000-8000-000000000002';
export const AGT002_REPUBLICATION_REFRESH_KIND = 'tender_document_refresh';
const AUTHORIZATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_ANALYSIS_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);

export function noticeUidFromTenderUrl(url) {
  const match = String(url || '').match(/[?&]noticeUID=([^&\s]+)/i);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** noticeUIDs anunciados como versión nueva en las observaciones de la oportunidad. */
export function republicationNoticeUids(observaciones) {
  const uids = new Set();
  for (const line of String(observaciones || '').split('\n')) {
    if (!line.startsWith(TENDER_REPUBLICATION_NOTICE_PREFIX)) continue;
    const uid = noticeUidFromTenderUrl(line);
    if (uid) uids.add(uid);
  }
  return uids;
}

export function republicationDocumentsLine(noticeUid, { currentCount = 0, retiredCount = 0 } = {}) {
  return `Documentos oficiales de la versión nueva de SECOP importados (${noticeUid}): ${currentCount} vigentes; ${retiredCount} del aviso anterior quedan como historial.`;
}

export function republicationAnalysisLine(noticeUid, outcome) {
  const prefix = `SECOP publicó una versión nueva (${noticeUid}); `;
  if (outcome === 'REANALYSIS') return `${prefix}se lanzó el reanálisis automático.`;
  if (outcome === 'INITIAL') return `${prefix}se lanzó el análisis inicial automático.`;
  if (outcome === 'daily_cap') return `${prefix}reanálisis automático pendiente por cupo diario.`;
  if (outcome === 'window_elapsed') return `${prefix}el reanálisis automático no alcanzó cupo en 48 horas; requiere lanzarse manualmente.`;
  return `${prefix}${outcome}`;
}

/** Agrega `line` una sola vez (por texto exacto). */
export function appendObservationLineOnce(observaciones, line) {
  const text = String(observaciones || '');
  if (text.split('\n').includes(line)) return text;
  return text ? `${text}\n${line}` : line;
}

function parseNotes(notes) {
  if (notes && typeof notes === 'object') return notes;
  try { return JSON.parse(String(notes || '')); } catch { return null; }
}

/** La importación documental ya hecha para este aviso nuevo (interacción con su noticeUID), o null. */
export function findRepublicationDocumentImport(interactions, noticeUid) {
  return (interactions || [])
    .map(row => ({ row, notes: parseNotes(row?.notes) }))
    .filter(({ notes }) => notes?.kind === AGT002_REPUBLICATION_REFRESH_KIND && notes?.republication_notice_uid === noticeUid)
    .sort((a, b) => String(a.row.created_at).localeCompare(String(b.row.created_at)))[0]?.row || null;
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

/**
 * Oportunidades convertidas cuya fuente oficial actual es una versión nueva anunciada en sus observaciones.
 * Cada candidata trae la licitación, la oportunidad y el noticeUID vigente.
 */
export async function findAgt002RepublishedOpportunities(database) {
  const tenders = await must(database.from('psi_public_tenders')
    .select('id,ref,url,converted_opportunity_id,reviewed_by')
    .eq('internal_status', 'convertida_oportunidad'), 'licitaciones convertidas');
  const candidates = [];
  for (const tender of tenders || []) {
    const noticeUid = noticeUidFromTenderUrl(tender.url);
    if (!noticeUid || !tender.converted_opportunity_id) continue;
    const opportunity = await must(database.from('psi_sales_opportunities')
      .select('id,observaciones,service_type_code').eq('id', tender.converted_opportunity_id).maybeSingle(), 'oportunidad');
    if (!opportunity || opportunity.service_type_code !== 'licitacion_publica') continue;
    if (!republicationNoticeUids(opportunity.observaciones).has(noticeUid)) continue;
    candidates.push({ tender, opportunity, noticeUid });
  }
  return candidates;
}

async function readDocumentInteractions(database, opportunityId) {
  return must(database.from('psi_sales_interactions')
    .select('id,notes,created_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento'), 'interacciones documentales');
}

async function writeObservationLine(database, opportunity, line) {
  const next = appendObservationLineOnce(opportunity.observaciones, line);
  if (next === String(opportunity.observaciones || '')) return opportunity;
  await must(database.from('psi_sales_opportunities').update({ observaciones: next }).eq('id', opportunity.id), 'aviso en la oportunidad');
  return { ...opportunity, observaciones: next };
}

/**
 * Paso 1 (documentos, sin costo de modelo). `importDocuments(opportunityId, { noticeUid, actorProfileId })` es la
 * importación oficial del CRM (api: importRepublishedTenderDocuments). Nunca lanza por una candidata: un aviso que
 * datos.gov.co aún no publica queda `pending` y se reintenta en la siguiente corrida.
 */
export async function runAgt002RepublicationDocumentRefresh(database, { importDocuments, actorProfileId = AGT002_VIGIA_AGENT_PROFILE_ID } = {}) {
  if (typeof importDocuments !== 'function') throw new Error('importDocuments es obligatorio.');
  const events = [];
  for (const { opportunity, noticeUid } of await findAgt002RepublishedOpportunities(database)) {
    const base = { opportunityId: opportunity.id, noticeUid };
    try {
      if (findRepublicationDocumentImport(await readDocumentInteractions(database, opportunity.id), noticeUid)) {
        events.push({ event: 'agt002_republication_documents_already_imported', ...base });
        continue;
      }
      const result = await importDocuments(opportunity.id, { noticeUid, actorProfileId });
      const currentCount = Number(result?.new_count || 0) + Number(result?.updated_count || 0) + Number(result?.unchanged_count || 0);
      await writeObservationLine(database, opportunity, republicationDocumentsLine(noticeUid, { currentCount, retiredCount: Number(result?.retired_count || 0) }));
      events.push({ event: 'agt002_republication_documents_imported', documents: currentCount, retired: Number(result?.retired_count || 0), ...base });
    } catch (error) {
      events.push({ event: 'agt002_republication_documents_pending', message: String(error?.message || error).slice(0, 200), ...base });
    }
  }
  return events;
}

async function readAnalysisState(database, opportunityId) {
  const jobs = await must(database.from('psi_agt002_initial_analysis_jobs')
    .select('id,status,analysis_kind,created_at').eq('opportunity_id', opportunityId), 'análisis de la oportunidad');
  const canonical = await must(database.from('psi_tender_analysis_runs')
    .select('id,analysis_kind,status,canonical').eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
    .maybeSingle(), 'análisis canónico');
  return { jobs: jobs || [], canonical: canonical || null };
}

async function resolveAuthorizingActor(database, opportunityId, tender) {
  const jobs = await must(database.from('psi_tender_processing_jobs')
    .select('requested_by,created_at').eq('opportunity_id', opportunityId).order('created_at', { ascending: true }).limit(1), 'quien convirtió');
  return jobs?.[0]?.requested_by || tender?.reviewed_by || null;
}

/**
 * Decide, sin efectos, qué hacer con una oportunidad cuyos documentos nuevos ya están importados:
 * `done` (ya hay un análisis admitido después de la importación), `wait` (análisis en curso), o `admit` con el tipo
 * (REANALYSIS sucesor del canónico vigente, o INITIAL si aún no hay análisis completado).
 */
export function planAgt002RepublicationAnalysis({ documentsImportedAt, jobs = [], canonical = null }) {
  const importedMs = Date.parse(documentsImportedAt);
  if (jobs.some(job => Date.parse(job.created_at) >= importedMs)) return { action: 'done' };
  if (jobs.some(job => ACTIVE_ANALYSIS_STATUSES.has(job.status))) return { action: 'wait', reason: 'analysis_in_progress' };
  if (canonical?.id && canonical.analysis_kind) return { action: 'admit', analysisKind: 'REANALYSIS', sourceAnalysisRunId: canonical.id };
  return { action: 'admit', analysisKind: 'INITIAL', sourceAnalysisRunId: null };
}

/**
 * Paso 2 (análisis). Mismas reglas que auto-initial: interruptores encendidos, cupo diario compartido (INITIAL y
 * REANALYSIS cuentan igual), actor = quien convirtió, ventana G1 determinista desde la importación documental.
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
  for (const { tender, opportunity: found, noticeUid } of await findAgt002RepublishedOpportunities(database)) {
    let opportunity = found;
    const base = { opportunityId: opportunity.id, noticeUid };
    try {
      const imported = findRepublicationDocumentImport(await readDocumentInteractions(database, opportunity.id), noticeUid);
      if (!imported) { events.push({ event: 'agt002_republication_analysis_waiting_documents', ...base }); continue; }
      const { jobs, canonical } = await readAnalysisState(database, opportunity.id);
      const plan = planAgt002RepublicationAnalysis({ documentsImportedAt: imported.created_at, jobs, canonical });
      if (plan.action === 'done') { events.push({ event: 'agt002_republication_analysis_already_admitted', ...base }); continue; }
      if (plan.action === 'wait') { events.push({ event: 'agt002_republication_analysis_deferred', reason: plan.reason, ...base }); continue; }
      const expiresAt = new Date(Date.parse(imported.created_at) + AUTHORIZATION_WINDOW_MS);
      if (expiresAt <= now) {
        await writeObservationLine(database, opportunity, republicationAnalysisLine(noticeUid, 'window_elapsed'));
        events.push({ event: 'agt002_republication_analysis_skipped', reason: 'authorization_window_elapsed', ...base });
        continue;
      }
      if (admittedToday === null) admittedToday = await countAgt002InitialAnalysesToday(database, now);
      if (admittedToday >= dailyCap) {
        opportunity = await writeObservationLine(database, opportunity, republicationAnalysisLine(noticeUid, 'daily_cap'));
        events.push({ event: 'agt002_republication_analysis_deferred', reason: 'daily_cap', dailyCap, ...base });
        continue;
      }
      const actorProfileId = await resolveAuthorizingActor(database, opportunity.id, tender);
      if (!actorProfileId) { events.push({ event: 'agt002_republication_analysis_skipped', reason: 'no_authorizing_actor', ...base }); continue; }
      const { requestedMembers, includedCount } = await selectAgt002AutoInitialMembers(database, opportunity.id);
      if (includedCount === 0) { events.push({ event: 'agt002_republication_analysis_skipped', reason: 'no_readable_documents', ...base }); continue; }
      const profile = await freezeProfile(database, { actorProfileId });
      const admitted = await admit(database, {
        opportunityId: opportunity.id,
        tenderId: tender.id,
        actorProfileId,
        requestedMembers,
        scope: 'A_PLUS_B',
        profileSnapshotId: profile.profileSnapshotId,
        profileSnapshotHash: profile.profileSnapshotHash,
        expiresAt: expiresAt.toISOString(),
        policyVersion: AGT002_AUTO_INITIAL_POLICY_VERSION,
        // Una instancia de flujo propia por aviso nuevo: un reintento repite exactamente la misma admisión.
        attempt: `secop-republication:${noticeUid}`,
        analysisKind: plan.analysisKind,
        sourceAnalysisRunId: plan.sourceAnalysisRunId,
        environment,
      });
      if (admitted.admissionStatus === 'admitted') admittedToday += 1;
      await writeObservationLine(database, opportunity, republicationAnalysisLine(noticeUid, plan.analysisKind));
      events.push({ event: 'agt002_republication_analysis_admitted', analysisKind: plan.analysisKind, jobId: admitted.jobId, admissionStatus: admitted.admissionStatus, documents: includedCount, ...base });
    } catch (error) {
      events.push({ event: 'agt002_republication_analysis_failed', code: error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED', ...base });
    }
  }
  return events;
}
