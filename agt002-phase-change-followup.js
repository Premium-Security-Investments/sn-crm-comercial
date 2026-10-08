// AGT-002 — seguimiento automático cuando SECOP II publica una fase nueva (o una republicación) de un proceso ya
// convertido en oportunidad (decisiones del dueño, 2026-10-08: "si debe lanzar el análisis de los nuevos documentos sin
// autorización").
//
// Caso típico: el borrador "Presentación de observaciones" pasa al pliego definitivo "<ref> (Presentación de oferta)",
// otro proceso en SECOP (otro id_del_proceso, otro enlace). La importación diaria del Radar cambia el enlace de la
// oportunidad (tender-phase-identity.js) y, EN ESA MISMA CORRIDA, registra la marca "detectado" de este módulo. Nunca hay
// marca para cambios anteriores a la instalación: sólo la deja la corrida que cambia el enlace, y sólo cuando el
// proceso nuevo está vivo (no terminal, cierre futuro) y es una fase posterior o una republicación de la misma fase.
//
// Desde ahí, sin intervención humana y sólo desde los jobs del host (nunca en una petición web):
//   1. Documentos (job diario del Radar, sin costo de modelo): observa el conjunto que datos.gov.co publica para el
//      proceso nuevo; importa cuando trae documentos que la oportunidad aún no tiene, es el MISMO en dos corridas
//      seguidas y no es mucho menor que el vigente. Los anteriores quedan como historial. Si datos.gov.co aún no los
//      tiene, reintenta en cada corrida y, pasados ~3 días, deja aviso visible para revisión humana.
//   2. Análisis (timer de auto-initial): con la marca de importación y un snapshot vigente posterior, admite UN
//      reanálisis sucesor del análisis canónico (o el INITIAL si no hay análisis), autorizado por quien convirtió,
//      dentro del cupo diario de admisiones AUTOMÁTICAS (compartido con el análisis al convertir). Sin cupo: mañana.
//
// El estado vive en interacciones 'documento' con notas JSON (sólo se agregan, nunca se editan); las líneas visibles de
// las observaciones se agregan con un UPDATE atómico del lado SQL (migración 116), sin reescribir el campo completo.

import { createHash } from 'node:crypto';

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import {
  AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  AGT002_AUTO_INITIAL_POLICY_VERSION,
  AGT002_PHASE_CHANGE_ANALYSIS_KIND,
  agt002BogotaDayStart,
  countAgt002AutomaticAnalysesToday,
  selectAgt002AutoInitialMembers,
} from './agt002-auto-initial.js';
import { tenderSourceChangeFollowUpBlocker } from './tender-phase-identity.js';

/** Identidad técnica Vig-IA (migración 047): actor de la importación documental y de los registros de estado. */
export const AGT002_VIGIA_AGENT_PROFILE_ID = 'a0020000-0000-4000-8000-000000000002';
export const AGT002_PHASE_CHANGE_KINDS = Object.freeze({
  detected: 'tender_phase_change_detected',
  observed: 'tender_phase_change_documents_observed',
  imported: 'tender_phase_change_documents_imported',
  analysis: AGT002_PHASE_CHANGE_ANALYSIS_KIND,
});
const AUTHORIZATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_ANALYSIS_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);
const LAUNCHED_ADMISSION_STATUSES = new Set(['admitted', 'existing']);
// Resultados que cierran el seguimiento del análisis de un aviso: nunca se vuelven a intentar.
const FINAL_ANALYSIS_OUTCOMES = new Set(['launched', 'window_elapsed', 'process_closed']);
// ~3 corridas diarias (con margen para la hora del timer) antes de pedir revisión humana.
export const AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS = 3 * 24 * 60 * 60 * 1000 - 6 * 60 * 60 * 1000;

export function noticeUidFromTenderUrl(url) {
  const match = String(url || '').match(/[?&]noticeUID=([^&\s]+)/i);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

/** Huella del conjunto de documentos (entradas ordenadas, sin duplicados). */
export function phaseChangeDocumentSetHash(entries) {
  const normalized = [...new Set((entries || []).map(entry => String(entry || '').trim()).filter(Boolean))].sort();
  return createHash('sha256').update(normalized.join('\n')).digest('hex');
}

/** Un conjunto "mucho menor" que el oficial vigente (menos de la mitad) no reemplaza al expediente: se espera. */
export function isPhaseChangeDocumentSetTooSmall({ documentCount, currentOfficialCount }) {
  return Number(documentCount || 0) < Math.ceil(Number(currentOfficialCount || 0) / 2);
}

// ---- Avisos visibles (todas empiezan por "SECOP publicó", que es lo que muestra el resumen de la oportunidad). ----

function phaseChangeHead({ change, newPhase, ref, noticeUid } = {}) {
  const offer = /presentaci[oó]n de oferta/i.test(`${newPhase || ''} ${ref || ''}`);
  const what = change === 'republication' ? 'una versión nueva del proceso'
    : offer ? 'el pliego definitivo (fase de oferta)' : 'una fase nueva del proceso';
  return `SECOP publicó ${what} (${noticeUid})`;
}

export function phaseChangeDetectedLine(change) {
  return `${phaseChangeHead(change)}; el enlace de la oportunidad se actualizó y Vig-IA bajará sus documentos y lanzará el reanálisis.`;
}

export function phaseChangeDocumentsMissingLine(change) {
  return `${phaseChangeHead(change)}, pero datos.gov.co aún no publica sus documentos nuevos; revisar e importar a mano.`;
}

export function phaseChangeDocumentsIncompleteLine(change) {
  return `${phaseChangeHead(change)}, pero sus documentos en datos.gov.co están incompletos; revisar e importar a mano.`;
}

export function phaseChangeDocumentsLine(change, { changedCount = 0, retiredCount = 0 } = {}) {
  const retired = retiredCount ? `; ${retiredCount} que ya no publica quedan como historial` : '; los anteriores quedan como historial';
  return `${phaseChangeHead(change)}; se bajaron ${changedCount} documento(s) nuevo(s) o actualizado(s)${retired}.`;
}

export function phaseChangeAnalysisLine(change, { outcome, analysisKind, admissionStatus } = {}) {
  const prefix = `${phaseChangeHead(change)}; `;
  if (outcome === 'launched') return `${prefix}se lanzó ${analysisKind === 'INITIAL' ? 'el análisis inicial' : 'el reanálisis'} automático.`;
  if (outcome === 'daily_cap') return `${prefix}reanálisis automático pendiente por cupo diario; se intenta mañana.`;
  if (outcome === 'window_elapsed') return `${prefix}el reanálisis automático no se lanzó en 48 horas; requiere lanzarse manualmente.`;
  if (outcome === 'process_closed') return `${prefix}el proceso ya cerró o terminó en SECOP; no se reanaliza.`;
  return `${prefix}el reanálisis automático no se pudo lanzar (${admissionStatus || outcome}); se reintenta mañana.`;
}

// ---- Estado. ----

function parseNotes(notes) {
  if (notes && typeof notes === 'object') return notes;
  try { return JSON.parse(String(notes || '')); } catch { return null; }
}

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) {
    const wrapped = new Error(`${label}: ${error.message || 'error de lectura'}`);
    wrapped.code = 'AGT002_PHASE_CHANGE_READ_FAILED';
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
export async function readAgt002PhaseChangeState(database, opportunityId) {
  const rows = await must(database.from('psi_sales_interactions')
    .select('id,notes,created_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento')
    .like('notes', '%"kind":"tender_phase_change_%'), 'estado del seguimiento');
  return (rows || [])
    .map(row => ({ ...row, payload: parseNotes(row.notes) }))
    .filter(row => row.payload?.kind?.startsWith?.('tender_phase_change_'))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

const ofKind = (state, kind, noticeUid) => state.filter(row => row.payload.kind === kind && row.payload.notice_uid === noticeUid);
// Una importación que no trajo nada nuevo ni actualizado no cuenta como "documentos de la fase nueva": se sigue esperando.
const importBroughtChanges = row => row.payload.changed_count === undefined || Number(row.payload.changed_count) > 0;
const importsOf = (state, noticeUid) => ofKind(state, AGT002_PHASE_CHANGE_KINDS.imported, noticeUid);

/** Línea visible en observaciones: UPDATE atómico del lado SQL, sólo si no está (migración 116). */
export async function appendAgt002ObservationLine(database, opportunityId, line) {
  const { error } = await database.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
  if (error) throw new Error(`aviso en la oportunidad: ${error.message || 'falló'}`);
}

/**
 * Marca "detectado". La llama SÓLO la importación del Radar en la corrida que cambia el enlace de la oportunidad
 * (`sourceChange` del plan, sin bloqueo), ANTES de guardar el enlace nuevo: si esta marca no se puede escribir, la
 * importación deja el enlace como estaba y la siguiente corrida lo vuelve a intentar. Idempotente por aviso.
 */
export async function recordAgt002PhaseChangeDetected(database, opportunityId, sourceChange = {}, { now = new Date() } = {}) {
  const noticeUid = noticeUidFromTenderUrl(sourceChange.url);
  if (!opportunityId || !noticeUid) return false;
  if (sourceChange.blocker) return false;
  const state = await readAgt002PhaseChangeState(database, opportunityId);
  if (state.some(row => row.payload.kind === AGT002_PHASE_CHANGE_KINDS.detected && row.payload.notice_uid === noticeUid)) return false;
  await recordState(database, opportunityId, {
    kind: AGT002_PHASE_CHANGE_KINDS.detected, notice_uid: noticeUid, change: sourceChange.change || 'phase',
    url: sourceChange.url, ref: sourceChange.ref || null, process_id: sourceChange.processId || null,
    previous_url: sourceChange.previousUrl || null, previous_phase: sourceChange.previousPhase || null,
    new_phase: sourceChange.newPhase || null, deadline: sourceChange.deadline || null,
    detected_at: sourceChange.detectedAt || now.toISOString(),
  }, { now });
  return true;
}

/** La llama la importación oficial (api) sólo después de publicar el snapshot documental del proceso nuevo. */
export async function recordAgt002PhaseChangeDocumentsImported(database, opportunityId, { actorId, noticeUid, documentSetHash, snapshotId, startedAt, documentCount, changedCount, retiredCount }) {
  await recordState(database, opportunityId, {
    kind: AGT002_PHASE_CHANGE_KINDS.imported, notice_uid: noticeUid, document_set_hash: documentSetHash, snapshot_id: snapshotId,
    started_at: startedAt, document_count: documentCount, changed_count: changedCount, retired_count: retiredCount,
  }, { actorId: actorId || AGT002_VIGIA_AGENT_PROFILE_ID });
}

function changeOf(detected, noticeUid) {
  return { change: detected?.change || 'phase', newPhase: detected?.new_phase || null, ref: detected?.ref || null, noticeUid };
}

/**
 * Oportunidades convertidas cuya fuente oficial ACTUAL es un aviso con marca "detectado". Cada candidata trae el
 * bloqueo vigente (proceso terminal o cierre pasado): el estado de SECOP se vuelve a mirar en cada paso.
 */
export async function findAgt002PhaseChangeOpportunities(database, { now = new Date() } = {}) {
  const detected = await must(database.from('psi_sales_interactions')
    .select('opportunity_id,notes,created_at').eq('interaction_type', 'documento')
    .like('notes', `%"kind":"${AGT002_PHASE_CHANGE_KINDS.detected}"%`), 'cambios de fase detectados');
  const byOpportunity = new Map();
  for (const row of detected || []) {
    const payload = parseNotes(row.notes);
    if (payload?.kind !== AGT002_PHASE_CHANGE_KINDS.detected || !payload.notice_uid) continue;
    const list = byOpportunity.get(row.opportunity_id) || [];
    list.push({ ...payload, recorded_at: row.created_at });
    byOpportunity.set(row.opportunity_id, list);
  }
  const candidates = [];
  for (const [opportunityId, notices] of byOpportunity) {
    const tender = await must(database.from('psi_public_tenders')
      .select('id,ref,url,status,deadline_at,converted_opportunity_id,reviewed_by,internal_status')
      .eq('converted_opportunity_id', opportunityId).maybeSingle(), 'licitación convertida');
    if (!tender || tender.internal_status !== 'convertida_oportunidad') continue;
    const noticeUid = noticeUidFromTenderUrl(tender.url);
    const notice = notices.find(item => item.notice_uid === noticeUid);
    if (!notice) continue; // Sólo el aviso que sigue siendo la fuente vigente.
    const blocker = tenderSourceChangeFollowUpBlocker({ status: tender.status, deadline: tender.deadline_at }, now);
    candidates.push({ tender, opportunityId, noticeUid, detected: notice, change: changeOf(notice, noticeUid), blocker });
  }
  return candidates;
}

const ageMs = (since, now) => now.getTime() - Date.parse(since || '');

/**
 * Paso 1 (documentos, sin costo de modelo). `probeDocuments` e `importDocuments` son la lectura e importación oficial
 * del CRM (api: probePhaseChangeTenderDocumentSet / importPhaseChangeTenderDocuments). Nunca lanza por una candidata.
 */
export async function runAgt002PhaseChangeDocumentRefresh(database, {
  probeDocuments, importDocuments, actorProfileId = AGT002_VIGIA_AGENT_PROFILE_ID, now = new Date(),
} = {}) {
  if (typeof probeDocuments !== 'function' || typeof importDocuments !== 'function') throw new Error('probeDocuments e importDocuments son obligatorios.');
  const events = [];
  for (const { opportunityId, noticeUid, detected, change, blocker } of await findAgt002PhaseChangeOpportunities(database, { now })) {
    const base = { opportunityId, noticeUid };
    try {
      const state = await readAgt002PhaseChangeState(database, opportunityId);
      const imported = importsOf(state, noticeUid).filter(importBroughtChanges).at(-1);
      if (imported) {
        await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsLine(change, { changedCount: imported.payload.changed_count, retiredCount: imported.payload.retired_count }));
        events.push({ event: 'agt002_phase_change_documents_already_imported', ...base });
        continue;
      }
      if (blocker) { events.push({ event: 'agt002_phase_change_documents_skipped', reason: blocker, ...base }); continue; }
      const waitedLongEnough = ageMs(detected.detected_at || detected.recorded_at, now) >= AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS;
      let probe;
      try {
        probe = await probeDocuments(opportunityId, { noticeUid });
      } catch (error) {
        // datos.gov.co va 1–2 días atrás: el proceso nuevo o sus documentos aún no están. Se reintenta mañana.
        if (waitedLongEnough) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsMissingLine(change));
        events.push({ event: 'agt002_phase_change_documents_pending', message: String(error?.message || error).slice(0, 200), ...base });
        continue;
      }
      if (!Number(probe.new_document_count || 0)) {
        // El proceso nuevo ya está, pero sus documentos aún no (comparte portafolio con el borrador): se espera.
        if (waitedLongEnough) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsMissingLine(change));
        events.push({ event: 'agt002_phase_change_documents_waiting_new_documents', documents: probe.document_count, ...base });
        continue;
      }
      const lastUnchanged = importsOf(state, noticeUid).filter(row => !importBroughtChanges(row)).at(-1);
      if (lastUnchanged && lastUnchanged.payload.document_set_hash === probe.document_set_hash) {
        // Ya se importó este mismo conjunto y no trajo nada: no se repite la descarga hasta que SECOP publique otro.
        if (waitedLongEnough) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsMissingLine(change));
        events.push({ event: 'agt002_phase_change_documents_waiting_new_documents', reason: 'same_set_already_imported_without_changes', ...base });
        continue;
      }
      const lastObserved = ofKind(state, AGT002_PHASE_CHANGE_KINDS.observed, noticeUid).at(-1);
      if (!lastObserved || lastObserved.payload.document_set_hash !== probe.document_set_hash) {
        await recordState(database, opportunityId, {
          kind: AGT002_PHASE_CHANGE_KINDS.observed, notice_uid: noticeUid, document_set_hash: probe.document_set_hash,
          document_count: probe.document_count, new_document_count: probe.new_document_count, current_official_count: probe.current_official_count,
        }, { now });
        events.push({ event: 'agt002_phase_change_documents_waiting_stability', documents: probe.document_count, newDocuments: probe.new_document_count, ...base });
        continue;
      }
      if (isPhaseChangeDocumentSetTooSmall({ documentCount: probe.document_count, currentOfficialCount: probe.current_official_count })) {
        // No queda esperando en silencio: tras ~3 corridas con el mismo conjunto incompleto, aviso visible (una vez).
        if (ageMs(lastObserved.created_at, now) >= AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS) {
          await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsIncompleteLine(change));
        }
        events.push({ event: 'agt002_phase_change_documents_waiting_smaller_set', documents: probe.document_count, current: probe.current_official_count, ...base });
        continue;
      }
      const result = await importDocuments(opportunityId, { noticeUid, actorProfileId, expectedDocumentSetHash: probe.document_set_hash });
      const changedCount = Number(result?.new_count || 0) + Number(result?.updated_count || 0);
      const retiredCount = Number(result?.retired_count || 0);
      if (!changedCount) { events.push({ event: 'agt002_phase_change_documents_without_changes', documents: probe.document_count, ...base }); continue; }
      await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsLine(change, { changedCount, retiredCount }));
      events.push({ event: 'agt002_phase_change_documents_imported', documents: probe.document_count, changed: changedCount, retired: retiredCount, ...base });
    } catch (error) {
      events.push({ event: 'agt002_phase_change_documents_pending', message: String(error?.message || error).slice(0, 200), ...base });
    }
  }
  return events;
}

/**
 * Decide, sin efectos, qué hacer con una oportunidad cuyos documentos nuevos ya están importados. El orden importa: lo
 * ya resuelto, luego el proceso cerrado, la espera del día, la ventana de 48 h (antes que la espera por
 * un análisis en curso, para que un job atascado en NEEDS_ATTENTION no deje el cambio esperando para siempre).
 */
export function planAgt002PhaseChangeAnalysis({ imported, analysisRecords = [], jobs = [], canonical = null, blocker = null, now }) {
  const importedMs = Date.parse(imported.created_at);
  if (analysisRecords.some(row => FINAL_ANALYSIS_OUTCOMES.has(row.payload.outcome))) return { action: 'done' };
  if (jobs.some(job => Date.parse(job.created_at) >= importedMs)) return { action: 'done', reason: 'analysis_after_import' };
  if (blocker) return { action: 'process_closed', reason: blocker };
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
 * (auto-initial + estos reanálisis), actor = quien convirtió, ventana G1 determinista desde la importación, un
 * reanálisis por aviso nuevo (misma instancia de flujo en cada reintento).
 */
export async function runAgt002PhaseChangeAnalysisAdmissions(database, {
  dailyCap = AGT002_AUTO_INITIAL_DEFAULT_DAILY_CAP,
  now = new Date(),
  environment = process.env,
  admit = admitAgt002InitialAnalysis,
  freezeProfile = freezeAgt002CompanyProfileSnapshot,
} = {}) {
  if (environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED !== 'true' || environment.AGT002_MODEL_CALLS_ENABLED !== 'true') {
    return [{ event: 'agt002_phase_change_analysis_disabled', reason: 'kill_switch_off' }];
  }
  const events = [];
  let admittedToday = null;
  for (const { tender, opportunityId, noticeUid, change, blocker } of await findAgt002PhaseChangeOpportunities(database, { now })) {
    const base = { opportunityId, noticeUid };
    const record = async (outcome, extra = {}) => {
      await recordState(database, opportunityId, { kind: AGT002_PHASE_CHANGE_KINDS.analysis, notice_uid: noticeUid, outcome, ...extra }, { now });
      await appendAgt002ObservationLine(database, opportunityId, phaseChangeAnalysisLine(change, { outcome, analysisKind: extra.analysis_kind, admissionStatus: extra.admission_status }));
    };
    try {
      const state = await readAgt002PhaseChangeState(database, opportunityId);
      const imported = importsOf(state, noticeUid).filter(importBroughtChanges).at(-1);
      if (!imported) { events.push({ event: 'agt002_phase_change_analysis_waiting_documents', ...(blocker ? { reason: blocker } : {}), ...base }); continue; }
      const jobs = await must(database.from('psi_agt002_initial_analysis_jobs')
        .select('id,status,analysis_kind,created_at').eq('opportunity_id', opportunityId), 'análisis de la oportunidad');
      const canonical = await must(database.from('psi_tender_analysis_runs')
        .select('id,analysis_kind,status,canonical').eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
        .maybeSingle(), 'análisis canónico');
      const plan = planAgt002PhaseChangeAnalysis({ imported, analysisRecords: ofKind(state, AGT002_PHASE_CHANGE_KINDS.analysis, noticeUid), jobs: jobs || [], canonical, blocker, now });
      if (plan.action === 'done') { events.push({ event: 'agt002_phase_change_analysis_already_resolved', reason: plan.reason || null, ...base }); continue; }
      if (plan.action === 'process_closed') {
        await record('process_closed', { admission_status: plan.reason });
        events.push({ event: 'agt002_phase_change_analysis_skipped', reason: plan.reason, ...base });
        continue;
      }
      if (plan.action === 'backoff') { events.push({ event: 'agt002_phase_change_analysis_deferred', reason: 'retry_tomorrow', ...base }); continue; }
      if (plan.action === 'window_elapsed') {
        await record('window_elapsed');
        events.push({ event: 'agt002_phase_change_analysis_skipped', reason: 'authorization_window_elapsed', ...base });
        continue;
      }
      if (plan.action === 'wait') { events.push({ event: 'agt002_phase_change_analysis_deferred', reason: plan.reason, ...base }); continue; }
      if (!(await hasSnapshotAfterImport(database, opportunityId, imported))) {
        events.push({ event: 'agt002_phase_change_analysis_deferred', reason: 'snapshot_not_current', ...base });
        continue;
      }
      if (admittedToday === null) admittedToday = await countAgt002AutomaticAnalysesToday(database, now);
      if (admittedToday >= dailyCap) {
        await record('daily_cap', { analysis_kind: plan.analysisKind });
        events.push({ event: 'agt002_phase_change_analysis_deferred', reason: 'daily_cap', dailyCap, ...base });
        continue;
      }
      const actorProfileId = await resolveAuthorizingActor(database, opportunityId, tender);
      if (!actorProfileId) { await record('not_admitted', { admission_status: 'sin_actor_autorizante' }); events.push({ event: 'agt002_phase_change_analysis_skipped', reason: 'no_authorizing_actor', ...base }); continue; }
      const { requestedMembers, includedCount } = await selectAgt002AutoInitialMembers(database, opportunityId);
      if (includedCount === 0) { await record('not_admitted', { admission_status: 'sin_documentos_legibles' }); events.push({ event: 'agt002_phase_change_analysis_skipped', reason: 'no_readable_documents', ...base }); continue; }
      const profile = await freezeProfile(database, { actorProfileId });
      // Intención registrada ANTES de admitir: el cupo cuenta esta admisión aunque luego falle el registro del
      // resultado (nunca se subcuenta); si este registro falla, no se admite nada.
      await recordState(database, opportunityId, { kind: AGT002_PHASE_CHANGE_KINDS.analysis, notice_uid: noticeUid, outcome: 'admitting', analysis_kind: plan.analysisKind }, { now });
      admittedToday += 1;
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
        attempt: `secop-phase-change:${noticeUid}`,
        analysisKind: plan.analysisKind,
        sourceAnalysisRunId: plan.sourceAnalysisRunId,
        environment,
      });
      const launched = LAUNCHED_ADMISSION_STATUSES.has(admitted.admissionStatus) && Boolean(admitted.jobId);
      await record(launched ? 'launched' : 'not_admitted', { analysis_kind: plan.analysisKind, job_id: admitted.jobId || null, admission_status: admitted.admissionStatus || null });
      events.push({ event: launched ? 'agt002_phase_change_analysis_admitted' : 'agt002_phase_change_analysis_not_admitted', analysisKind: plan.analysisKind, jobId: admitted.jobId || null, admissionStatus: admitted.admissionStatus || null, documents: includedCount, ...base });
    } catch (error) {
      try { await record('failed', { admission_status: String(error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED') }); } catch { /* el evento ya reporta la falla */ }
      events.push({ event: 'agt002_phase_change_analysis_failed', code: error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED', ...base });
    }
  }
  return events;
}
