// AGT-002 — seguimiento automático cuando SECOP II publica una fase nueva (o una republicación) de un proceso ya
// convertido en oportunidad (decisiones del dueño, 2026-10-08: "si debe lanzar el análisis de los nuevos documentos sin
// autorización").
//
// Caso típico: el borrador "Presentación de observaciones" pasa al pliego definitivo "<ref> (Presentación de oferta)",
// otro proceso en SECOP (otro id_del_proceso, otro enlace) que COMPARTE el portafolio de documentos con el borrador. La
// importación del Radar cambia el enlace de la oportunidad (tender-phase-identity.js) y, en esa misma corrida, deja la
// marca "detectado" de este módulo. Nunca hay marca para un cambio ya aplicado antes de instalar, salvo la conciliación
// (`reconcileAgt002PendingPhaseChanges`): una convertida abierta cuyo enlace vigente no es el aviso del que vienen sus
// documentos oficiales. En ambos casos sólo si el proceso nuevo está vivo (no terminal, cierre futuro en hora Bogotá) y
// la oportunidad sigue abierta.
//
// Desde ahí, sin intervención humana y sólo desde jobs del host (nunca en una petición web):
//   1. Documentos (revisión programada lun–vie 9/14/19 h y sáb–dom 14 h, con presupuesto de tiempo). "Nuevo" se mide contra
//      la LÍNEA BASE: las versiones que la oportunidad tenía antes de la marca. Cada conjunto nuevo que se mantiene igual
//      en la revisión siguiente se importa una vez (sólo se bajan los nuevos); si después aparecen más (pliego definitivo,
//      adendas), se vuelve a importar mientras el proceso siga abierto. Datos.gov.co va 1–2 días atrás: se reintenta y,
//      pasados ~3 días sin documentos o sin estabilizarse, se deja aviso visible para revisión humana.
//   2. Análisis (timer de auto-initial): por cada importación, UN reanálisis completo sucesor del análisis canónico (o
//      el INITIAL si no hay análisis), autorizado por quien convirtió. Fuera del cupo de 5 del análisis al convertir
//      (decisión del dueño); sólo una red de seguridad técnica (3 por proceso y 20 en total por día). El mismo conjunto
//      nunca se reanaliza dos veces.
//
// El estado vive en interacciones 'documento' con notas JSON (sólo se agregan, nunca se editan); las líneas visibles de
// las observaciones se agregan con un UPDATE atómico del lado SQL (migración 116), sin reescribir el campo completo.

import { createHash } from 'node:crypto';

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import {
  AGT002_AUTO_INITIAL_POLICY_VERSION,
  AGT002_PHASE_CHANGE_ANALYSIS_KIND,
  agt002BogotaDayStart,
  listAgt002PhaseChangeAdmissionsToday,
  selectAgt002AutoInitialMembers,
} from './agt002-auto-initial.js';
import { tenderSourceChangeFollowUpBlocker } from './tender-phase-identity.js';
import { classifyTenderOpportunityStage, latestTenderGoNoGoDecision } from './tender-opportunity-stage.js';

/** Identidad técnica Vig-IA (migración 047): actor de la importación documental y de los registros de estado. */
export const AGT002_VIGIA_AGENT_PROFILE_ID = 'a0020000-0000-4000-8000-000000000002';
export const AGT002_PHASE_CHANGE_KINDS = Object.freeze({
  detected: 'tender_phase_change_detected',
  observed: 'tender_phase_change_documents_observed',
  importFailed: 'tender_phase_change_documents_import_failed',
  imported: 'tender_phase_change_documents_imported',
  analysis: AGT002_PHASE_CHANGE_ANALYSIS_KIND,
  result: 'tender_phase_change_analysis_result',
});
const HOUR_MS = 60 * 60 * 1000;
const AUTHORIZATION_WINDOW_MS = 48 * HOUR_MS;
const ACTIVE_ANALYSIS_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);
const LAUNCHED_ADMISSION_STATUSES = new Set(['admitted', 'existing']);
// Resultados que cierran el análisis de un conjunto importado: nunca se vuelven a intentar para ese conjunto.
const FINAL_ANALYSIS_OUTCOMES = new Set(['launched', 'window_elapsed', 'process_closed']);
// Etapas comerciales cerradas (migración 110): además de la etapa de la bandeja, nunca se sigue una oportunidad así.
export const AGT002_PHASE_CHANGE_CLOSED_STAGES = new Set(['aprobado', 'descartado', 'perdido']);
/** Estable = la revisión SIGUIENTE (9:00, 14:00, 19:00; fines de semana 14:00) encuentra la misma lista de documentos nuevos. */
export const AGT002_PHASE_CHANGE_STABLE_MS = 30 * 60 * 1000;
/**
 * Red de seguridad TÉCNICA contra errores, no límite de negocio (decisión del dueño 2026-10-08: cada tanda nueva de
 * documentos dispara un reanálisis completo, sin límite por proceso y fuera del cupo de 5 del análisis al convertir;
 * el tope de USD 10 por análisis sigue en el runtime). Si se alcanza, aviso visible y se intenta al día siguiente.
 */
export const AGT002_PHASE_CHANGE_SAFETY_LIMITS = Object.freeze({ perProcessPerDay: 3, totalPerDay: 20 });
/** Tras una importación fallida (descarga, migración 116 sin aplicar) no se reintenta el mismo conjunto antes de esto. */
export const AGT002_PHASE_CHANGE_IMPORT_RETRY_MS = 3 * HOUR_MS;
/** ~3 días antes de pedir revisión humana (sin documentos nuevos, o un conjunto que no se estabiliza). */
export const AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS = 3 * 24 * HOUR_MS - 6 * HOUR_MS;
/** Presupuesto de tiempo por pasada del servicio de documentos; lo que no alcance sigue en la siguiente. */
export const AGT002_PHASE_CHANGE_DOCUMENTS_DEFAULT_BUDGET_MS = 10 * 60 * 1000;

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

// Sin códigos internos (nada de "CO1.NTC…"): el texto dice qué publicó SECOP y cuándo se vio; el enlace va aparte.
function phaseChangeHead({ change, newPhase, ref, detectedAt } = {}) {
  const offer = /presentaci[oó]n de oferta/i.test(`${newPhase || ''} ${ref || ''}`);
  const what = change === 'republication' ? 'una versión nueva del proceso'
    : offer ? 'el pliego definitivo (fase de oferta)' : 'una fase nueva del proceso';
  const seen = bogotaDayLabel(detectedAt);
  return `SECOP publicó ${what}${seen ? ` (visto el ${seen})` : ''}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** '2026-10-12T15:00:00Z' → '12-oct' (día Bogotá). Distingue los avisos de cada importación. */
export function bogotaDayLabel(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const local = new Date(ms - 5 * HOUR_MS);
  return `${local.getUTCDate()}-${MONTHS[local.getUTCMonth()]}`;
}

export function phaseChangeDetectedLine(change) {
  return `${phaseChangeHead(change)}; el enlace de la oportunidad se actualizó${change?.url ? ` (${change.url})` : ''} y Vig-IA bajará sus documentos y lanzará el reanálisis.`;
}

export function phaseChangeDocumentsMissingLine(change) {
  return `${phaseChangeHead(change)}, pero datos.gov.co aún no publica sus documentos nuevos; revisar e importar a mano.`;
}

export function phaseChangeDocumentsIncompleteLine(change) {
  return `${phaseChangeHead(change)}, pero sus documentos en datos.gov.co están incompletos; revisar e importar a mano.`;
}

export function phaseChangeDocumentsUnstableLine(change) {
  return `${phaseChangeHead(change)}, pero sus documentos en datos.gov.co siguen cambiando desde hace 3 días; revisar e importar a mano.`;
}

const listNames = (names, max = 6) => {
  const list = (names || []).filter(Boolean);
  return list.length <= max ? list.join(', ') : `${list.slice(0, max).join(', ')} y ${list.length - max} más`;
};

export function phaseChangeDocumentsLine(change, { newCount = 0, importedAt, incomingNames = [], archived = [], doubts = [] } = {}) {
  const parts = [`${phaseChangeHead(change)}; el ${bogotaDayLabel(importedAt)} se bajaron ${newCount} documento(s) nuevo(s)${incomingNames.length ? `: ${listNames(incomingNames)}` : ''}`];
  if (archived.length) parts.push(`pasaron a historial (no entran al análisis): ${listNames(archived.map(item => item.name))}`);
  if (doubts.length) parts.push(`por duda NO se archivó: ${listNames(doubts.map(item => item.name))} (revisar)`);
  return `${parts.join('; ')}.`;
}

export function phaseChangeAnalysisResultLine(change, { importedAt, status, verdict } = {}) {
  const prefix = `${phaseChangeHead(change)}; documentos del ${bogotaDayLabel(importedAt)}: `;
  if (status === 'COMPLETED') return `${prefix}el reanálisis terminó${verdict ? ` — ${verdict}` : ''}.`;
  if (status === 'NEEDS_ATTENTION') return `${prefix}el reanálisis quedó en espera de atención; se informará el resultado final cuando termine.`;
  return `${prefix}el reanálisis no terminó (${String(status || 'falló').toLowerCase()}); requiere revisión humana.`;
}

export function phaseChangeAnalysisLine(change, { outcome, analysisKind, admissionStatus, importedAt } = {}) {
  const prefix = `${phaseChangeHead(change)}; documentos del ${bogotaDayLabel(importedAt)}: `;
  if (outcome === 'launched') return `${prefix}se lanzó ${analysisKind === 'INITIAL' ? 'el análisis inicial' : 'el reanálisis'} automático.`;
  if (outcome === 'safety_limit') return `${prefix}reanálisis automático pendiente: se alcanzó el límite técnico de seguridad del día; se intenta mañana (revisar si hay un error).`;
  if (outcome === 'window_elapsed') return `${prefix}el reanálisis automático no se lanzó en 48 horas; requiere lanzarse manualmente.`;
  if (outcome === 'process_closed') return `${prefix}el proceso ya cerró o terminó en SECOP, o la oportunidad se cerró; no se reanaliza.`;
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
// Una importación que no trajo NINGÚN documento nuevo o actualizado por contenido (SECOP repite el mismo archivo con otro
// id al crear una fase) queda registrada, pero nunca dispara reanálisis ni correo de reanálisis.
export const importBroughtChanges = row => row.payload.changed_count === undefined || row.payload.changed_count === null || Number(row.payload.changed_count) > 0;
const ageMs = (since, now) => now.getTime() - Date.parse(since || '');

/** Línea visible en observaciones: UPDATE atómico del lado SQL, sólo si no está (migración 116). */
export async function appendAgt002ObservationLine(database, opportunityId, line) {
  const { error } = await database.rpc('psi_append_opportunity_observation_line', { p_opportunity_id: opportunityId, p_line: line });
  if (error) throw new Error(`aviso en la oportunidad: ${error.message || 'falló'}`);
}

/**
 * Marca "detectado". La llama la importación del Radar en la corrida que cambia el enlace de la oportunidad
 * (`sourceChange` del plan, sin bloqueo), ANTES de guardar el enlace nuevo, o la conciliación. Idempotente por aviso.
 * Su fecha es la línea base de "documentos nuevos".
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
    detected_at: sourceChange.detectedAt || now.toISOString(), origin: sourceChange.origin || 'radar',
  }, { now });
  return true;
}

/** La llama la importación oficial (api) sólo después de publicar el snapshot documental del proceso nuevo. */
export async function recordAgt002PhaseChangeDocumentsImported(database, opportunityId, { actorId, noticeUid, newSetHash, snapshotId, startedAt, documentCount, newDocumentCount, changedCount, retiredCount, incomingNames = [], archived = [], doubts = [] }) {
  await recordState(database, opportunityId, {
    kind: AGT002_PHASE_CHANGE_KINDS.imported, notice_uid: noticeUid, new_set_hash: newSetHash, snapshot_id: snapshotId,
    started_at: startedAt, document_count: documentCount, new_document_count: newDocumentCount, changed_count: changedCount ?? null, retired_count: retiredCount,
    incoming_names: incomingNames, archived, doubts,
  }, { actorId: actorId || AGT002_VIGIA_AGENT_PROFILE_ID });
}

function changeOf(detected, noticeUid) {
  return { change: detected?.change || 'phase', newPhase: detected?.new_phase || null, ref: detected?.ref || null, url: detected?.url || null, detectedAt: detected?.detected_at || detected?.recorded_at || null, noticeUid };
}

/**
 * Sólo oportunidades ACTIVAS (decisión del dueño): etapa derivada "Por decidir" o "En curso" de la bandeja
 * (tender-opportunity-stage.js = classifyOpportunityStage del frontend). "Cerradas" (NO GO, adjudicada, no
 * adjudicada, cerrada) y las etapas comerciales perdida/descartada/aprobada nunca disparan descarga ni reanálisis.
 */
export async function agt002PhaseChangeOpportunityBlocker(database, opportunityId, tenderId) {
  const opportunity = await must(database.from('psi_sales_opportunities')
    .select('id,stage_code,tender_offer_status').eq('id', opportunityId).maybeSingle(), 'oportunidad');
  if (!opportunity) return 'opportunity_missing';
  if (AGT002_PHASE_CHANGE_CLOSED_STAGES.has(opportunity.stage_code)) return 'opportunity_closed';
  let decisions = database.from('psi_tender_go_no_go_decisions')
    .select('id,decision,decided_at,supersedes_decision_id').eq('opportunity_id', opportunityId);
  if (tenderId) decisions = decisions.eq('tender_id', tenderId);
  const latest = latestTenderGoNoGoDecision((await must(decisions, 'decisión GO/NO GO')) || []);
  const stage = classifyTenderOpportunityStage({ decision: latest?.decision || null, tender_offer_status: opportunity.tender_offer_status });
  return stage === 'cerradas' ? 'opportunity_closed' : null;
}

/** Convertida ACTIVA (Por decidir / En curso y etapa comercial abierta): la revisión programada sólo mira éstas. */
export async function isAgt002PhaseChangeActiveOpportunity(database, tender) {
  return !(await agt002PhaseChangeOpportunityBlocker(database, tender.converted_opportunity_id, tender.id));
}

/**
 * Oportunidades convertidas cuya fuente oficial ACTUAL es un aviso con marca "detectado". Cada candidata trae el
 * bloqueo vigente (proceso terminal, cierre pasado u oportunidad cerrada): se vuelve a mirar en cada paso.
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
    const blocker = tenderSourceChangeFollowUpBlocker({ status: tender.status, deadline: tender.deadline_at }, now)
      || await agt002PhaseChangeOpportunityBlocker(database, opportunityId, tender.id);
    candidates.push({ tender, opportunityId, noticeUid, detected: notice, baselineAt: notice.recorded_at || notice.detected_at, change: changeOf(notice, noticeUid), blocker });
  }
  return candidates;
}

/**
 * Salvaguarda (instalación y fallas): una convertida abierta cuyo enlace vigente es un aviso SECOP sin marca, pero cuyos
 * documentos oficiales se importaron desde OTRO aviso (la importación oficial registra el `notice_uid` de origen), es un
 * cambio de fuente pendiente: se marca ahora, con línea base = lo que ya tiene. Nunca para un proceso cerrado.
 */
export async function reconcileAgt002PendingPhaseChanges(database, { now = new Date() } = {}) {
  const tenders = await must(database.from('psi_public_tenders')
    .select('id,ref,url,status,deadline_at,converted_opportunity_id,internal_status,source')
    .eq('internal_status', 'convertida_oportunidad'), 'convertidas');
  const events = [];
  for (const tender of tenders || []) {
    const opportunityId = tender.converted_opportunity_id;
    const noticeUid = noticeUidFromTenderUrl(tender.url);
    if (!opportunityId || !noticeUid || (tender.source && tender.source !== 'SECOP II')) continue;
    const state = await readAgt002PhaseChangeState(database, opportunityId);
    if (ofKind(state, AGT002_PHASE_CHANGE_KINDS.detected, noticeUid).length) continue;
    const refreshes = await must(database.from('psi_sales_interactions')
      .select('notes,created_at').eq('opportunity_id', opportunityId).eq('interaction_type', 'documento')
      .like('notes', '%"kind":"tender_document_refresh"%'), 'importaciones oficiales');
    const origins = (refreshes || []).map(row => ({ ...row, payload: parseNotes(row.notes) }))
      .filter(row => row.payload?.notice_uid)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const lastOrigin = origins.at(-1)?.payload.notice_uid;
    if (!lastOrigin || lastOrigin === noticeUid) continue;
    const blocker = tenderSourceChangeFollowUpBlocker({ status: tender.status, deadline: tender.deadline_at }, now)
      || await agt002PhaseChangeOpportunityBlocker(database, opportunityId, tender.id);
    if (blocker) { events.push({ event: 'agt002_phase_change_reconcile_skipped', opportunityId, noticeUid, reason: blocker }); continue; }
    await recordAgt002PhaseChangeDetected(database, opportunityId, {
      change: 'phase', url: tender.url, ref: tender.ref, newPhase: tender.status, deadline: tender.deadline_at,
      detectedAt: now.toISOString(), origin: 'reconciliation', previousUrl: null,
    }, { now });
    events.push({ event: 'agt002_phase_change_reconciled', opportunityId, noticeUid, previousNotice: lastOrigin });
  }
  return events;
}

/**
 * Paso 1 (documentos, sin costo de modelo). `probeDocuments` e `importDocuments` son la lectura e importación oficial
 * del CRM (api: probePhaseChangeTenderDocumentSet / importPhaseChangeTenderDocuments). Nunca lanza por una candidata;
 * respeta `budgetMs` (lo que no alcance queda para la siguiente pasada).
 */
export async function runAgt002PhaseChangeDocumentRefresh(database, {
  probeDocuments, importDocuments, actorProfileId = AGT002_VIGIA_AGENT_PROFILE_ID, now = new Date(),
  budgetMs = AGT002_PHASE_CHANGE_DOCUMENTS_DEFAULT_BUDGET_MS, clock = () => Date.now(),
} = {}) {
  if (typeof probeDocuments !== 'function' || typeof importDocuments !== 'function') throw new Error('probeDocuments e importDocuments son obligatorios.');
  const startedMs = clock();
  const events = [];
  for (const { opportunityId, noticeUid, detected, baselineAt, change, blocker } of await findAgt002PhaseChangeOpportunities(database, { now })) {
    const base = { opportunityId, noticeUid, change };
    if (clock() - startedMs >= budgetMs) { events.push({ event: 'agt002_phase_change_documents_deferred', reason: 'time_budget', ...base }); continue; }
    try {
      if (blocker) { events.push({ event: 'agt002_phase_change_documents_skipped', reason: blocker, ...base }); continue; }
      const state = await readAgt002PhaseChangeState(database, opportunityId);
      const lastImport = ofKind(state, AGT002_PHASE_CHANGE_KINDS.imported, noticeUid).at(-1) || null;
      const waitedLongEnough = !lastImport && ageMs(detected.detected_at || detected.recorded_at, now) >= AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS;
      let probe;
      try {
        probe = await probeDocuments(opportunityId, { noticeUid, baselineAt });
      } catch (error) {
        // datos.gov.co va 1–2 días atrás: el proceso nuevo o sus documentos aún no están. Se reintenta.
        if (waitedLongEnough) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsMissingLine(change));
        events.push({ event: 'agt002_phase_change_documents_pending', message: String(error?.message || error).slice(0, 200), ...(waitedLongEnough ? { review: 'documents_missing' } : {}), ...base });
        continue;
      }
      if (!Number(probe.new_document_count || 0)) {
        if (waitedLongEnough) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsMissingLine(change));
        events.push({ event: 'agt002_phase_change_documents_waiting_new_documents', documents: probe.document_count, ...(waitedLongEnough ? { review: 'documents_missing' } : {}), ...base });
        continue;
      }
      if (lastImport && lastImport.payload.new_set_hash === probe.new_set_hash) {
        if (importBroughtChanges(lastImport)) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsLine(change, { newCount: lastImport.payload.new_document_count, importedAt: lastImport.created_at, incomingNames: lastImport.payload.incoming_names, archived: lastImport.payload.archived || [], doubts: lastImport.payload.doubts || [] }));
        events.push({ event: 'agt002_phase_change_documents_already_imported', ...base });
        continue;
      }
      // Observaciones desde la última importación: la revisión siguiente debe encontrar la misma lista de documentos nuevos.
      const observations = ofKind(state, AGT002_PHASE_CHANGE_KINDS.observed, noticeUid)
        .filter(row => !lastImport || String(row.created_at) > String(lastImport.created_at));
      const lastObserved = observations.at(-1);
      const unstableTooLong = observations.length > 0 && ageMs(observations[0].created_at, now) >= AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS;
      if (!lastObserved || lastObserved.payload.new_set_hash !== probe.new_set_hash) {
        await recordState(database, opportunityId, {
          kind: AGT002_PHASE_CHANGE_KINDS.observed, notice_uid: noticeUid, new_set_hash: probe.new_set_hash,
          document_count: probe.document_count, new_document_count: probe.new_document_count, current_official_count: probe.current_official_count,
        }, { now });
        if (unstableTooLong) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsUnstableLine(change));
        events.push({ event: 'agt002_phase_change_documents_waiting_stability', documents: probe.document_count, newDocuments: probe.new_document_count, ...(unstableTooLong ? { review: 'documents_unstable' } : {}), ...base });
        continue;
      }
      if (ageMs(lastObserved.created_at, now) < AGT002_PHASE_CHANGE_STABLE_MS) {
        events.push({ event: 'agt002_phase_change_documents_waiting_stability', documents: probe.document_count, newDocuments: probe.new_document_count, ...base });
        continue;
      }
      if (isPhaseChangeDocumentSetTooSmall({ documentCount: probe.document_count, currentOfficialCount: probe.current_official_count })) {
        // No queda esperando en silencio: tras ~3 días con el mismo conjunto incompleto, aviso visible (una vez).
        const incompleteTooLong = ageMs(lastObserved.created_at, now) >= AGT002_PHASE_CHANGE_HUMAN_REVIEW_AFTER_MS;
        if (incompleteTooLong) await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsIncompleteLine(change));
        events.push({ event: 'agt002_phase_change_documents_waiting_smaller_set', documents: probe.document_count, current: probe.current_official_count, ...(incompleteTooLong ? { review: 'documents_incomplete' } : {}), ...base });
        continue;
      }
      const lastFailure = ofKind(state, AGT002_PHASE_CHANGE_KINDS.importFailed, noticeUid)
        .filter(row => row.payload.new_set_hash === probe.new_set_hash).at(-1);
      if (lastFailure && ageMs(lastFailure.created_at, now) < AGT002_PHASE_CHANGE_IMPORT_RETRY_MS) {
        events.push({ event: 'agt002_phase_change_documents_deferred', reason: 'retry_after_failure', ...base });
        continue;
      }
      let result;
      try {
        result = await importDocuments(opportunityId, { noticeUid, actorProfileId, expectedNewSetHash: probe.new_set_hash, baselineAt });
      } catch (error) {
        const message = String(error?.message || error).slice(0, 200);
        await recordState(database, opportunityId, { kind: AGT002_PHASE_CHANGE_KINDS.importFailed, notice_uid: noticeUid, new_set_hash: probe.new_set_hash, code: error?.code || null, message }, { now });
        events.push({ event: 'agt002_phase_change_documents_pending', reason: 'import_failed', failure: 'import_failed', setHash: probe.new_set_hash, message, ...base });
        continue;
      }
      const retiredCount = Number(result?.retired_count || 0);
      if (result && result.changed_count !== undefined && result.changed_count !== null && Number(result.changed_count) === 0) {
        // Mismo contenido que ya tenía (otro id en SECOP): queda registrada, sin aviso de documentos ni reanálisis.
        events.push({ event: 'agt002_phase_change_documents_imported_without_changes', documents: probe.document_count, setHash: probe.new_set_hash, ...base });
        continue;
      }
      const detail = { incomingNames: result?.incoming_names || [], archived: result?.archived || [], doubts: result?.archive_doubts || [] };
      await appendAgt002ObservationLine(database, opportunityId, phaseChangeDocumentsLine(change, { newCount: probe.new_document_count, importedAt: now.toISOString(), ...detail }));
      events.push({ event: 'agt002_phase_change_documents_imported', documents: probe.document_count, newDocuments: probe.new_document_count, retired: retiredCount, setHash: probe.new_set_hash, ...detail, ...base });
    } catch (error) {
      events.push({ event: 'agt002_phase_change_documents_pending', message: String(error?.message || error).slice(0, 200), ...base });
    }
  }
  return events;
}

/**
 * Decide, sin efectos, qué hacer con la última importación de un aviso. El orden importa: lo ya resuelto para ese
 * conjunto, luego el proceso cerrado, la espera del día, la ventana de 48 h (antes que la espera por un análisis en
 * curso, para que un job atascado en NEEDS_ATTENTION no deje el cambio esperando para siempre).
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
  // Hay un análisis completado (aunque sea de un motor anterior, sin tipo): se reanaliza sobre él.
  if (canonical?.id) return { action: 'admit', analysisKind: 'REANALYSIS', sourceAnalysisRunId: canonical.id };
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
 * Paso 2 (análisis). Interruptores encendidos, actor = quien convirtió, ventana G1 determinista desde la importación,
 * un reanálisis COMPLETO por conjunto importado (misma instancia de flujo en cada reintento; nunca dos del mismo
 * conjunto). No consume ni espera el cupo de 5 del análisis al convertir; sólo la red de seguridad técnica.
 */
export async function runAgt002PhaseChangeAnalysisAdmissions(database, {
  safetyLimits = AGT002_PHASE_CHANGE_SAFETY_LIMITS,
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
    const base = { opportunityId, noticeUid, change };
    let imported = null;
    const record = async (outcome, extra = {}) => {
      await recordState(database, opportunityId, { kind: AGT002_PHASE_CHANGE_KINDS.analysis, notice_uid: noticeUid, new_set_hash: imported.payload.new_set_hash, outcome, ...extra }, { now });
      await appendAgt002ObservationLine(database, opportunityId, phaseChangeAnalysisLine(change, { outcome, analysisKind: extra.analysis_kind, admissionStatus: extra.admission_status, importedAt: imported.created_at }));
    };
    try {
      const state = await readAgt002PhaseChangeState(database, opportunityId);
      imported = ofKind(state, AGT002_PHASE_CHANGE_KINDS.imported, noticeUid).filter(importBroughtChanges).at(-1) || null;
      if (!imported) { events.push({ event: 'agt002_phase_change_analysis_waiting_documents', ...(blocker ? { reason: blocker } : {}), ...base }); continue; }
      const setHash = imported.payload.new_set_hash;
      Object.assign(base, { setHash, importedAt: imported.created_at });
      const analysisRecords = ofKind(state, AGT002_PHASE_CHANGE_KINDS.analysis, noticeUid).filter(row => row.payload.new_set_hash === setHash);
      const jobs = await must(database.from('psi_agt002_initial_analysis_jobs')
        .select('id,status,analysis_kind,created_at').eq('opportunity_id', opportunityId), 'análisis de la oportunidad');
      const canonical = await must(database.from('psi_tender_analysis_runs')
        .select('id,analysis_kind,status,canonical').eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
        .maybeSingle(), 'análisis canónico');
      const plan = planAgt002PhaseChangeAnalysis({ imported, analysisRecords, jobs: jobs || [], canonical, blocker, now });
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
      // Fuera del cupo de 5 del análisis al convertir; sólo la red de seguridad técnica.
      if (admittedToday === null) admittedToday = await listAgt002PhaseChangeAdmissionsToday(database, now);
      const processToday = admittedToday.filter(row => row.opportunityId === opportunityId).length;
      if (processToday >= safetyLimits.perProcessPerDay || admittedToday.length >= safetyLimits.totalPerDay) {
        await record('safety_limit', { analysis_kind: plan.analysisKind, admission_status: processToday >= safetyLimits.perProcessPerDay ? 'limite_por_proceso' : 'limite_total' });
        events.push({ event: 'agt002_phase_change_analysis_deferred', reason: 'safety_limit', processToday, totalToday: admittedToday.length, ...base });
        continue;
      }
      const actorProfileId = await resolveAuthorizingActor(database, opportunityId, tender);
      if (!actorProfileId) { await record('not_admitted', { admission_status: 'sin_actor_autorizante' }); events.push({ event: 'agt002_phase_change_analysis_skipped', reason: 'no_authorizing_actor', ...base }); continue; }
      const { requestedMembers, includedCount } = await selectAgt002AutoInitialMembers(database, opportunityId);
      if (includedCount === 0) { await record('not_admitted', { admission_status: 'sin_documentos_legibles' }); events.push({ event: 'agt002_phase_change_analysis_skipped', reason: 'no_readable_documents', ...base }); continue; }
      const profile = await freezeProfile(database, { actorProfileId });
      // Intención registrada ANTES de admitir: el cupo cuenta esta admisión aunque luego falle el registro del
      // resultado (nunca se subcuenta); si este registro falla, no se admite nada.
      await recordState(database, opportunityId, { kind: AGT002_PHASE_CHANGE_KINDS.analysis, notice_uid: noticeUid, new_set_hash: setHash, outcome: 'admitting', analysis_kind: plan.analysisKind }, { now });
      admittedToday.push({ opportunityId, analysisKind: plan.analysisKind });
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
        // Una instancia de flujo propia por conjunto importado: un reintento repite exactamente la misma admisión.
        attempt: `secop-phase-change:${noticeUid}:${String(setHash || '').slice(0, 16)}`,
        analysisKind: plan.analysisKind,
        sourceAnalysisRunId: plan.sourceAnalysisRunId,
        environment,
      });
      const launched = LAUNCHED_ADMISSION_STATUSES.has(admitted.admissionStatus) && Boolean(admitted.jobId);
      await record(launched ? 'launched' : 'not_admitted', { analysis_kind: plan.analysisKind, job_id: admitted.jobId || null, admission_status: admitted.admissionStatus || null });
      events.push({ event: launched ? 'agt002_phase_change_analysis_admitted' : 'agt002_phase_change_analysis_not_admitted', analysisKind: plan.analysisKind, jobId: admitted.jobId || null, admissionStatus: admitted.admissionStatus || null, documents: includedCount, ...base });
    } catch (error) {
      try { if (imported) await record('failed', { admission_status: String(error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED') }); } catch { /* el evento ya reporta la falla */ }
      events.push({ event: 'agt002_phase_change_analysis_failed', code: error?.code || error?.diagnostic?.reason || 'ADMISSION_FAILED', ...base });
    }
  }
  return events;
}

/** Veredicto legible del análisis (pre_go_analysis.v2: `recommendation.label`, con su confianza). */
export function agt002AnalysisVerdictText(result) {
  const recommendation = result?.recommendation || result?.output?.recommendation || result?.aggregate?.recommendation || null;
  const label = typeof recommendation?.label === 'string' ? recommendation.label.trim() : '';
  const confidence = typeof recommendation?.confidence === 'string' ? recommendation.confidence.trim() : '';
  return label ? `${label}${confidence ? ` (confianza ${confidence.toLowerCase()})` : ''}` : '';
}

/**
 * Resultado de los reanálisis lanzados por este seguimiento: un reanálisis tarda ~10 min, así que la revisión siguiente
 * informa cómo terminó (veredicto o falla). Se registra una vez por job y deja aviso visible.
 */
export async function collectAgt002PhaseChangeAnalysisResults(database, { now = new Date() } = {}) {
  const rows = await must(database.from('psi_sales_interactions')
    .select('opportunity_id,notes,created_at').eq('interaction_type', 'documento')
    .like('notes', '%"kind":"tender_phase_change_analysis%'), 'reanálisis lanzados');
  const parsed = (rows || []).map(row => ({ ...row, payload: parseNotes(row.notes) })).filter(row => row.payload);
  // Por job: lo ya informado. NEEDS_ATTENTION es intermedio: se informa una vez y, si después termina, se informa el
  // resultado final también una vez.
  const reported = new Map();
  for (const row of parsed.filter(item => item.payload.kind === AGT002_PHASE_CHANGE_KINDS.result)) {
    if (!reported.has(row.payload.job_id)) reported.set(row.payload.job_id, new Set());
    reported.get(row.payload.job_id).add(row.payload.status);
  }
  const isFinal = status => status === 'COMPLETED' || status === 'FAILED';
  const launched = parsed.filter(row => row.payload.kind === AGT002_PHASE_CHANGE_KINDS.analysis && row.payload.outcome === 'launched' && row.payload.job_id
    && ![...(reported.get(row.payload.job_id) || [])].some(isFinal));
  const items = [];
  for (const row of launched) {
    const job = await must(database.from('psi_agt002_initial_analysis_jobs')
      .select('id,status,analysis_run_id,error_code').eq('id', row.payload.job_id).maybeSingle(), 'estado del reanálisis');
    if (!job || !['COMPLETED', 'FAILED', 'NEEDS_ATTENTION'].includes(job.status)) continue;
    if (job.status === 'NEEDS_ATTENTION' && reported.has(job.id)) continue;
    let verdict = '';
    if (job.status === 'COMPLETED' && job.analysis_run_id) {
      const run = await must(database.from('psi_tender_analysis_runs').select('id,result').eq('id', job.analysis_run_id).maybeSingle(), 'resultado del reanálisis');
      verdict = agt002AnalysisVerdictText(run?.result);
    }
    const state = await readAgt002PhaseChangeState(database, row.opportunity_id);
    const detected = ofKind(state, AGT002_PHASE_CHANGE_KINDS.detected, row.payload.notice_uid).at(-1)?.payload;
    const imported = ofKind(state, AGT002_PHASE_CHANGE_KINDS.imported, row.payload.notice_uid).filter(item => item.payload.new_set_hash === row.payload.new_set_hash).at(-1);
    const change = changeOf(detected, row.payload.notice_uid);
    await recordState(database, row.opportunity_id, { kind: AGT002_PHASE_CHANGE_KINDS.result, notice_uid: row.payload.notice_uid, new_set_hash: row.payload.new_set_hash, job_id: job.id, status: job.status, analysis_run_id: job.analysis_run_id || null, verdict }, { now });
    await appendAgt002ObservationLine(database, row.opportunity_id, phaseChangeAnalysisResultLine(change, { importedAt: imported?.created_at || row.created_at, status: job.status, verdict }));
    items.push({ event: 'agt002_phase_change_analysis_result', opportunityId: row.opportunity_id, noticeUid: row.payload.notice_uid, change, jobId: job.id, status: job.status, verdict, setHash: row.payload.new_set_hash, importedAt: imported?.created_at || null, analysisKind: row.payload.analysis_kind });
  }
  return items;
}
