// AGT-002 — botón "Volver a analizar" (decisión del dueño, 2026-10-20). Una persona con permiso de análisis pide un
// reanálisis completo de una oportunidad que ya tiene un análisis vigente: con los documentos vigentes y el perfil de la
// empresa de HOY. Caso que lo motivó: la Fiscalía (FGN-NC-IPSE-0054-2026) quedó con el análisis del 6-oct mientras el
// perfil ya registraba la agencia de Bogotá y la experiencia del RUP, y no había forma de pedir otro.
//
// La petición web sólo deja una solicitud (psi_agt002_manual_reanalysis_requests, migración 138); el job del host
// (agt002-auto-initial, cada 2 min) la reclama y admite el reanálisis sucesor del análisis canónico con la misma cadena
// del seguimiento de cambio de fase (admitAgt002InitialAnalysis, migración 108), con quien la pidió como actor
// autorizante. Nunca toca la decisión GO / NO GO, que sigue siendo exclusivamente humana.

import { admitAgt002InitialAnalysis } from './agt002-initial-analysis-admission.js';
import { freezeAgt002CompanyProfileSnapshot } from './agt002-company-profile-snapshot.js';
import { AGT002_AUTO_INITIAL_POLICY_VERSION, agt002BogotaDayStart, selectAgt002AutoInitialMembers } from './agt002-auto-initial.js';
import { readTenderOpportunityInactiveReason } from './tender-opportunity-stage.js';

const TABLE = 'psi_agt002_manual_reanalysis_requests';
const AUTHORIZATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const ACTIVE_JOB_STATUSES = new Set(['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']);
const LAUNCHED_ADMISSION_STATUSES = new Set(['admitted', 'existing']);
// Red de seguridad de costo, igual que la del cambio de fase: por proceso y en total por día (hora Bogotá).
export const AGT002_MANUAL_REANALYSIS_LIMITS = Object.freeze({ perProcessPerDay: 3, totalPerDay: 20 });

const REASON_TEXT = Object.freeze({
  sin_licitacion: 'La oportunidad no está ligada a una licitación del Radar.',
  oportunidad_inactiva: 'La oportunidad ya no está activa (NO GO, cerrada o archivada).',
  sin_analisis_previo: 'Todavía no hay un análisis terminado; el primero se hace solo al convertir.',
  analisis_en_curso: 'Ya hay un análisis en curso para esta oportunidad.',
  solicitud_abierta: 'Ya se pidió un análisis nuevo; arranca en unos minutos.',
  limite_por_proceso: `Ya se hicieron ${AGT002_MANUAL_REANALYSIS_LIMITS.perProcessPerDay} análisis de este proceso hoy.`,
  limite_total: `Ya se hicieron ${AGT002_MANUAL_REANALYSIS_LIMITS.totalPerDay} análisis manuales hoy en total.`,
  sin_documentos_legibles: 'No hay documentos legibles para analizar.',
  analisis_apagado: 'El análisis automático está apagado en el servidor.',
});

export function agt002ManualReanalysisReasonText(reason) {
  return REASON_TEXT[reason] || 'No fue posible lanzar el análisis.';
}

function readFailure(label, error) {
  const wrapped = new Error(`${label}: ${error?.message || 'error de lectura'}`);
  wrapped.code = 'AGT002_MANUAL_REANALYSIS_READ_FAILED';
  return wrapped;
}

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) throw readFailure(label, error);
  return data;
}

function isMissingTable(error) {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return message.includes('42p01') || message.includes('pgrst205') || message.includes(TABLE);
}

function unavailable() {
  const error = new Error('El botón "Volver a analizar" todavía no está habilitado en la base de datos.');
  error.code = 'AGT002_MANUAL_REANALYSIS_UNAVAILABLE';
  error.status = 503;
  return error;
}

async function convertedTenderIdOf(database, opportunityId) {
  const rows = await must(database.from('psi_public_tenders').select('id,converted_opportunity_id')
    .eq('converted_opportunity_id', opportunityId).limit(1), 'licitación convertida');
  return rows?.[0]?.id || null;
}

async function admittedToday(database, now) {
  return (await must(database.from(TABLE).select('opportunity_id,status,finished_at')
    .eq('status', 'admitted').gte('finished_at', agt002BogotaDayStart(now).toISOString()), 'reanálisis manuales de hoy')) || [];
}

/**
 * Las condiciones que impiden un reanálisis, en el orden en que se las explica a una persona. Devuelve el motivo o
 * null, más lo que el host necesita para admitir (licitación y análisis canónico).
 */
export async function evaluateAgt002ManualReanalysis(database, opportunityId, {
  now = new Date(),
  limits = AGT002_MANUAL_REANALYSIS_LIMITS,
  inactiveReason = readTenderOpportunityInactiveReason,
} = {}) {
  const tenderId = await convertedTenderIdOf(database, opportunityId);
  if (!tenderId) return { reason: 'sin_licitacion' };
  if (await inactiveReason(database, opportunityId, tenderId)) return { reason: 'oportunidad_inactiva', tenderId };
  const jobs = await must(database.from('psi_agt002_initial_analysis_jobs')
    .select('id,status').eq('opportunity_id', opportunityId), 'análisis de la oportunidad');
  if ((jobs || []).some(job => ACTIVE_JOB_STATUSES.has(job.status))) return { reason: 'analisis_en_curso', tenderId };
  const canonical = await must(database.from('psi_tender_analysis_runs')
    .select('id').eq('opportunity_id', opportunityId).eq('canonical', true).eq('status', 'completed')
    .maybeSingle(), 'análisis canónico');
  if (!canonical?.id) return { reason: 'sin_analisis_previo', tenderId };
  const today = await admittedToday(database, now);
  if (today.filter(row => row.opportunity_id === opportunityId).length >= limits.perProcessPerDay) return { reason: 'limite_por_proceso', tenderId };
  if (today.length >= limits.totalPerDay) return { reason: 'limite_total', tenderId };
  return { reason: null, tenderId, canonicalRunId: canonical.id };
}

async function latestRequest(database, opportunityId) {
  const { data, error } = await database.from(TABLE)
    .select('id,status,requested_at,started_at,finished_at,job_id,reason')
    .eq('opportunity_id', opportunityId).order('requested_at', { ascending: false }).limit(1).maybeSingle();
  if (error) {
    if (isMissingTable(error)) throw unavailable();
    throw readFailure('solicitud de reanálisis', error);
  }
  return data;
}

/**
 * Lo que la ficha muestra junto al botón. `state`: idle | requested | analyzing | completed | failed | rejected.
 * `canRequest` dice si el botón se puede usar ahora, y `blockedReason` por qué no.
 */
export async function readAgt002ManualReanalysisStatus(database, opportunityId, options = {}) {
  const request = await latestRequest(database, opportunityId);
  let state = 'idle';
  let jobStatus = null;
  if (request?.status === 'pending' || request?.status === 'running') state = 'requested';
  else if (request?.status === 'rejected') state = 'rejected';
  else if (request?.status === 'failed') state = 'failed';
  else if (request?.status === 'admitted' && request.job_id) {
    const job = await must(database.from('psi_agt002_initial_analysis_jobs')
      .select('id,status').eq('id', request.job_id).maybeSingle(), 'estado del reanálisis');
    jobStatus = job?.status || null;
    state = ACTIVE_JOB_STATUSES.has(jobStatus) ? 'analyzing' : jobStatus === 'COMPLETED' ? 'completed' : 'failed';
  }
  const evaluation = state === 'requested' ? { reason: 'solicitud_abierta' } : await evaluateAgt002ManualReanalysis(database, opportunityId, options);
  // Un análisis en curso que no salió de este botón (p. ej. el seguimiento de cambio de fase) también se muestra.
  if (state !== 'requested' && state !== 'analyzing' && evaluation.reason === 'analisis_en_curso') state = 'analyzing';
  return {
    state,
    requestedAt: request?.requested_at || null,
    finishedAt: request?.finished_at || null,
    jobStatus,
    reason: request?.reason || null,
    reasonText: request?.reason ? agt002ManualReanalysisReasonText(request.reason) : null,
    canRequest: !evaluation.reason,
    blockedReason: evaluation.reason || null,
    blockedReasonText: evaluation.reason ? agt002ManualReanalysisReasonText(evaluation.reason) : null,
  };
}

/** La petición web: valida y deja la solicitud. Nunca admite ni ejecuta el análisis. */
export async function requestAgt002ManualReanalysis(database, { opportunityId, requestedBy, now = new Date(), ...options }) {
  if (typeof requestedBy !== 'string' || !requestedBy) throw new Error('Debe iniciar sesión para pedir un análisis.');
  const open = await latestRequest(database, opportunityId);
  if (open && (open.status === 'pending' || open.status === 'running')) {
    return { requested: false, alreadyOpen: true, status: await readAgt002ManualReanalysisStatus(database, opportunityId, { now, ...options }) };
  }
  const { reason } = await evaluateAgt002ManualReanalysis(database, opportunityId, { now, ...options });
  if (reason) {
    const error = new Error(agt002ManualReanalysisReasonText(reason));
    error.code = 'AGT002_MANUAL_REANALYSIS_BLOCKED';
    error.reason = reason;
    error.status = 409;
    throw error;
  }
  const inserted = await database.from(TABLE).insert({ opportunity_id: opportunityId, requested_by: requestedBy }).select('id').single();
  // 23505: otra persona lo pidió al mismo tiempo; vale la solicitud que ya quedó abierta.
  if (inserted.error && inserted.error.code !== '23505') {
    if (isMissingTable(inserted.error)) throw unavailable();
    throw readFailure('registro de la solicitud', inserted.error);
  }
  return { requested: !inserted.error, alreadyOpen: Boolean(inserted.error), status: await readAgt002ManualReanalysisStatus(database, opportunityId, { now, ...options }) };
}

async function finish(database, id, patch, now) {
  const { error } = await database.from(TABLE).update({ ...patch, finished_at: now.toISOString() }).eq('id', id).eq('status', 'running');
  if (error) throw readFailure('cierre de la solicitud', error);
}

/**
 * Paso del host: reclama cada solicitud pendiente, vuelve a comprobar las condiciones (pudieron cambiar desde el
 * clic) y admite el reanálisis sucesor. Un evento por solicitud; nunca lanza por una solicitud.
 */
export async function runAgt002ManualReanalysisRequests(database, {
  now = new Date(),
  environment = process.env,
  limits = AGT002_MANUAL_REANALYSIS_LIMITS,
  admit = admitAgt002InitialAnalysis,
  freezeProfile = freezeAgt002CompanyProfileSnapshot,
  selectMembers = selectAgt002AutoInitialMembers,
  inactiveReason = readTenderOpportunityInactiveReason,
} = {}) {
  const { data: pending, error } = await database.from(TABLE)
    .select('id,opportunity_id,requested_by,requested_at').eq('status', 'pending').order('requested_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [{ event: 'agt002_manual_reanalysis_unavailable' }];
    throw readFailure('solicitudes pendientes', error);
  }
  if (!pending?.length) return [{ event: 'agt002_manual_reanalysis_idle' }];
  const switchesOn = environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED === 'true' && environment.AGT002_MODEL_CALLS_ENABLED === 'true';
  const events = [];
  for (const request of pending) {
    const base = { requestId: request.id, opportunityId: request.opportunity_id };
    const claimed = await database.from(TABLE).update({ status: 'running', started_at: now.toISOString() })
      .eq('id', request.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimed.error || !claimed.data) { events.push({ event: 'agt002_manual_reanalysis_not_claimed', ...base }); continue; }
    try {
      if (!switchesOn) {
        await finish(database, request.id, { status: 'rejected', reason: 'analisis_apagado' }, now);
        events.push({ event: 'agt002_manual_reanalysis_rejected', reason: 'analisis_apagado', ...base });
        continue;
      }
      const evaluation = await evaluateAgt002ManualReanalysis(database, request.opportunity_id, { now, limits, inactiveReason });
      if (evaluation.reason) {
        await finish(database, request.id, { status: 'rejected', reason: evaluation.reason }, now);
        events.push({ event: 'agt002_manual_reanalysis_rejected', reason: evaluation.reason, ...base });
        continue;
      }
      const { requestedMembers, includedCount } = await selectMembers(database, request.opportunity_id);
      if (includedCount === 0) {
        await finish(database, request.id, { status: 'rejected', reason: 'sin_documentos_legibles' }, now);
        events.push({ event: 'agt002_manual_reanalysis_rejected', reason: 'sin_documentos_legibles', ...base });
        continue;
      }
      const profile = await freezeProfile(database, { actorProfileId: request.requested_by });
      const admitted = await admit(database, {
        opportunityId: request.opportunity_id,
        tenderId: evaluation.tenderId,
        actorProfileId: request.requested_by,
        requestedMembers,
        scope: 'A_PLUS_B',
        profileSnapshotId: profile.profileSnapshotId,
        profileSnapshotHash: profile.profileSnapshotHash,
        // Ventana G1 derivada de la solicitud, nunca de "ahora": un reintento repite exactamente la misma admisión.
        expiresAt: new Date(Date.parse(request.requested_at) + AUTHORIZATION_WINDOW_MS).toISOString(),
        policyVersion: AGT002_AUTO_INITIAL_POLICY_VERSION,
        attempt: `manual-reanalysis:${request.id}`,
        analysisKind: 'REANALYSIS',
        sourceAnalysisRunId: evaluation.canonicalRunId,
        environment,
      });
      if (LAUNCHED_ADMISSION_STATUSES.has(admitted.admissionStatus) && admitted.jobId) {
        await finish(database, request.id, { status: 'admitted', job_id: admitted.jobId }, now);
        events.push({ event: 'agt002_manual_reanalysis_admitted', jobId: admitted.jobId, admissionStatus: admitted.admissionStatus, documents: includedCount, ...base });
      } else {
        await finish(database, request.id, { status: 'failed', reason: `admision:${admitted.admissionStatus || 'desconocida'}`.slice(0, 500) }, now);
        events.push({ event: 'agt002_manual_reanalysis_not_admitted', admissionStatus: admitted.admissionStatus || null, ...base });
      }
    } catch (cause) {
      const code = String(cause?.code || cause?.diagnostic?.reason || 'ADMISSION_FAILED');
      try { await finish(database, request.id, { status: 'failed', reason: code.slice(0, 500) }, now); } catch { /* el evento ya reporta la falla */ }
      events.push({ event: 'agt002_manual_reanalysis_failed', code, ...base });
    }
  }
  return events;
}
