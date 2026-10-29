// AGT-002 — botón "Volver a analizar" (decisión del dueño, 2026-10-20). Una persona con permiso de análisis pide un
// análisis completo de una oportunidad con los documentos vigentes y el perfil de la empresa de HOY. Desde el
// 2026-10-29 también lanza el PRIMER análisis cuando el automático no lo hizo (la Fiscalía del Eje Cafetero quedó con
// 12 documentos y sin análisis porque la ventana se contaba desde la conversión). Caso que lo motivó: la Fiscalía (FGN-NC-IPSE-0054-2026) quedó con el análisis del 6-oct mientras el
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
// Red de seguridad de costo, igual que la del cambio de fase: por proceso y en total por día (hora Bogotá). El incremental
// (sólo los documentos cargados a mano, migración 139) es mucho más barato y se dispara solo, así que tiene su propio cupo.
export const AGT002_MANUAL_REANALYSIS_LIMITS = Object.freeze({ perProcessPerDay: 3, totalPerDay: 20 });
export const AGT002_INCREMENTAL_REANALYSIS_LIMITS = Object.freeze({ perProcessPerDay: 10, totalPerDay: 40 });
const MODES = new Set(['full', 'incremental']);
const limitsFor = mode => (mode === 'incremental' ? AGT002_INCREMENTAL_REANALYSIS_LIMITS : AGT002_MANUAL_REANALYSIS_LIMITS);

const REASON_TEXT = Object.freeze({
  sin_licitacion: 'La oportunidad no está ligada a una licitación del Radar.',
  oportunidad_inactiva: 'La oportunidad ya no está activa (NO GO, cerrada o archivada).',
  sin_analisis_previo: 'Todavía no hay un análisis terminado de esta licitación.',
  analisis_en_curso: 'Ya hay un análisis en curso para esta oportunidad.',
  solicitud_abierta: 'Ya se pidió un análisis nuevo; arranca en unos minutos.',
  limite_por_proceso: `Ya se hicieron ${AGT002_MANUAL_REANALYSIS_LIMITS.perProcessPerDay} análisis de este proceso hoy.`,
  limite_total: `Ya se hicieron ${AGT002_MANUAL_REANALYSIS_LIMITS.totalPerDay} análisis manuales hoy en total.`,
  sin_documentos_nuevos: 'No hay documentos ni aclaraciones nuevas frente al análisis vigente.',
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

async function admittedToday(database, now, mode) {
  const rows = (await must(database.from(TABLE).select('opportunity_id,status,finished_at,mode')
    .eq('status', 'admitted').gte('finished_at', agt002BogotaDayStart(now).toISOString()), 'reanálisis manuales de hoy')) || [];
  return rows.filter(row => (row.mode || 'full') === mode);
}

/**
 * Las condiciones que impiden un reanálisis, en el orden en que se las explica a una persona. Devuelve el motivo o
 * null, más lo que el host necesita para admitir (licitación y análisis canónico).
 */
export async function evaluateAgt002ManualReanalysis(database, opportunityId, {
  now = new Date(),
  mode = 'full',
  limits = limitsFor(mode),
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
  // Primer análisis a mano (Juan, 2026-10-29): el automático arranca solo al llegar los documentos, pero cuando no
  // arrancó —la Fiscalía del Eje Cafetero quedó con 12 documentos y sin análisis— no había ninguna puerta. El botón
  // lanza también el primero, sólo si no hay ningún análisis admitido todavía y ya hay documentos de la entidad. El
  // incremental sigue necesitando un análisis vigente contra el que comparar.
  if (!canonical?.id) {
    if (mode !== 'full' || (jobs || []).length > 0) return { reason: 'sin_analisis_previo', tenderId };
    const documents = await must(database.from('psi_tender_document_versions')
      .select('id').eq('opportunity_id', opportunityId).eq('current', true).limit(1), 'documentos vigentes');
    if (!(documents || []).length) return { reason: 'sin_documentos_legibles', tenderId };
  }
  const today = await admittedToday(database, now, mode);
  if (today.filter(row => row.opportunity_id === opportunityId).length >= limits.perProcessPerDay) return { reason: 'limite_por_proceso', tenderId };
  if (today.length >= limits.totalPerDay) return { reason: 'limite_total', tenderId };
  return { reason: null, tenderId, canonicalRunId: canonical?.id || null };
}

const textOfClaim = (result, claimId) => (result?.claims || []).find(claim => claim?.claim_id === claimId)?.display_text || null;

/**
 * Qué cambió entre dos análisis (para la ficha, tras un reanálisis): la recomendación, los requisitos cuya evaluación
 * de la empresa cambió, y los hallazgos nuevos o retirados. Puro: no lee la base.
 */
export function agt002AnalysisChanges(prior, next) {
  if (!prior || !next) return null;
  const recommendation = prior.recommendation?.kind !== next.recommendation?.kind || prior.recommendation?.label !== next.recommendation?.label
    ? { from: prior.recommendation?.label || null, to: next.recommendation?.label || null, kindChanged: prior.recommendation?.kind !== next.recommendation?.kind }
    : null;
  const priorRequirements = new Map((prior.requirements || []).map(item => [item?.requirement_id, item]));
  const requirements = (next.requirements || []).flatMap(item => {
    const before = priorRequirements.get(item?.requirement_id);
    if (!before || before.company_evaluation === item.company_evaluation) return [];
    return [{ requirementId: item.requirement_id, text: textOfClaim(next, item.text_claim_id), from: before.company_evaluation, to: item.company_evaluation }];
  });
  const priorFindings = new Map((prior.findings || []).map(item => [item?.finding_id, item]));
  const nextFindings = new Map((next.findings || []).map(item => [item?.finding_id, item]));
  const addedFindings = [...nextFindings.values()].filter(item => !priorFindings.has(item?.finding_id)).map(item => ({ title: item.title, severity: item.severity }));
  const removedFindings = [...priorFindings.values()].filter(item => !nextFindings.has(item?.finding_id)).map(item => ({ title: item.title, severity: item.severity }));
  return { recommendation, requirements: requirements.slice(0, 15), addedFindings: addedFindings.slice(0, 15), removedFindings: removedFindings.slice(0, 15) };
}

async function loadAnalysisChanges(database, sourceRunId, runId) {
  const rows = await must(database.from('psi_tender_analysis_runs').select('id,result').in('id', [sourceRunId, runId]), 'análisis a comparar');
  const byId = new Map((rows || []).map(row => [row.id, row.result]));
  return agt002AnalysisChanges(byId.get(sourceRunId), byId.get(runId));
}

async function latestRequest(database, opportunityId) {
  const { data, error } = await database.from(TABLE)
    .select('id,status,requested_at,started_at,finished_at,job_id,reason,mode')
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
  let changes = null;
  if (request?.status === 'admitted' && request.job_id) {
    const job = await must(database.from('psi_agt002_initial_analysis_jobs')
      .select('id,status,analysis_run_id,source_analysis_run_id').eq('id', request.job_id).maybeSingle(), 'estado del reanálisis');
    jobStatus = job?.status || null;
    state = ACTIVE_JOB_STATUSES.has(jobStatus) ? 'analyzing' : jobStatus === 'COMPLETED' ? 'completed' : 'failed';
    if (state === 'completed' && job.analysis_run_id && job.source_analysis_run_id) changes = await loadAnalysisChanges(database, job.source_analysis_run_id, job.analysis_run_id);
  }
  const { mode: _ignored, ...evaluationOptions } = options;
  const evaluation = state === 'requested' ? { reason: 'solicitud_abierta' } : await evaluateAgt002ManualReanalysis(database, opportunityId, { ...evaluationOptions, mode: 'full' });
  // Un análisis en curso que no salió de este botón (p. ej. el seguimiento de cambio de fase) también se muestra.
  if (state !== 'requested' && state !== 'analyzing' && evaluation.reason === 'analisis_en_curso') state = 'analyzing';
  return {
    state,
    mode: request?.mode || 'full',
    changes,
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
export async function requestAgt002ManualReanalysis(database, { opportunityId, requestedBy, mode = 'full', now = new Date(), ...options }) {
  if (typeof requestedBy !== 'string' || !requestedBy) throw new Error('Debe iniciar sesión para pedir un análisis.');
  if (!MODES.has(mode)) throw new Error('El modo de análisis no es válido.');
  const open = await latestRequest(database, opportunityId);
  if (open && (open.status === 'pending' || open.status === 'running')) {
    return { requested: false, alreadyOpen: true, status: await readAgt002ManualReanalysisStatus(database, opportunityId, { now, ...options }) };
  }
  const { reason } = await evaluateAgt002ManualReanalysis(database, opportunityId, { now, mode, ...options });
  // El incremental tras una carga espera su turno si ya hay un análisis corriendo: el host lo lanza cuando termine.
  if (reason && !(mode === 'incremental' && reason === 'analisis_en_curso')) {
    const error = new Error(agt002ManualReanalysisReasonText(reason));
    error.code = 'AGT002_MANUAL_REANALYSIS_BLOCKED';
    error.reason = reason;
    error.status = 409;
    throw error;
  }
  const inserted = await database.from(TABLE).insert({ opportunity_id: opportunityId, requested_by: requestedBy, mode }).select('id').single();
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
  limits = { full: AGT002_MANUAL_REANALYSIS_LIMITS, incremental: AGT002_INCREMENTAL_REANALYSIS_LIMITS },
  admit = admitAgt002InitialAnalysis,
  freezeProfile = freezeAgt002CompanyProfileSnapshot,
  selectMembers = selectAgt002AutoInitialMembers,
  inactiveReason = readTenderOpportunityInactiveReason,
} = {}) {
  const { data: pending, error } = await database.from(TABLE)
    .select('id,opportunity_id,requested_by,requested_at,mode').eq('status', 'pending').order('requested_at', { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [{ event: 'agt002_manual_reanalysis_unavailable' }];
    throw readFailure('solicitudes pendientes', error);
  }
  if (!pending?.length) return [{ event: 'agt002_manual_reanalysis_idle' }];
  const switchesOn = environment.AGT002_INITIAL_ANALYSIS_ADMISSION_ENABLED === 'true' && environment.AGT002_MODEL_CALLS_ENABLED === 'true';
  const events = [];
  for (const request of pending) {
    const mode = request.mode || 'full';
    const base = { requestId: request.id, opportunityId: request.opportunity_id, mode };
    const claimed = await database.from(TABLE).update({ status: 'running', started_at: now.toISOString() })
      .eq('id', request.id).eq('status', 'pending').select('id').maybeSingle();
    if (claimed.error || !claimed.data) { events.push({ event: 'agt002_manual_reanalysis_not_claimed', ...base }); continue; }
    try {
      if (!switchesOn) {
        await finish(database, request.id, { status: 'rejected', reason: 'analisis_apagado' }, now);
        events.push({ event: 'agt002_manual_reanalysis_rejected', reason: 'analisis_apagado', ...base });
        continue;
      }
      const evaluation = await evaluateAgt002ManualReanalysis(database, request.opportunity_id, { now, mode, limits: limits?.[mode] ?? limitsFor(mode), inactiveReason });
      if (mode === 'incremental' && evaluation.reason === 'analisis_en_curso') {
        // Vuelve a la cola: se lanza cuando termine el análisis en curso (si ese ya leyó los documentos, no habrá nada nuevo).
        const { error: requeueError } = await database.from(TABLE).update({ status: 'pending', started_at: null }).eq('id', request.id).eq('status', 'running');
        if (requeueError) throw readFailure('reencolar la solicitud', requeueError);
        events.push({ event: 'agt002_manual_reanalysis_deferred', reason: 'analisis_en_curso', ...base });
        continue;
      }
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
        // Sin análisis canónico es el PRIMERO de la oportunidad: INITIAL sin corrida fuente, no un sucesor.
        analysisKind: evaluation.canonicalRunId ? 'REANALYSIS' : 'INITIAL',
        sourceAnalysisRunId: evaluation.canonicalRunId || null,
        incremental: mode === 'incremental',
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
      // Migración 139: sin documentos nuevos frente al análisis vigente no hay nada que analizar (no es una falla).
      if (mode === 'incremental' && /No hay documentos nuevos/.test(String(cause?.message || ''))) {
        try { await finish(database, request.id, { status: 'rejected', reason: 'sin_documentos_nuevos' }, now); } catch { /* el evento lo reporta */ }
        events.push({ event: 'agt002_manual_reanalysis_rejected', reason: 'sin_documentos_nuevos', ...base });
        continue;
      }
      try { await finish(database, request.id, { status: 'failed', reason: code.slice(0, 500) }, now); } catch { /* el evento ya reporta la falla */ }
      events.push({ event: 'agt002_manual_reanalysis_failed', code, ...base });
    }
  }
  return events;
}
