/**
 * Neutral initial-analysis queue adapter (docs/agt002/initial-analysis/CURRENT.md). This is the
 * FIRST analysis run for an opportunity, never a subsequent run of any kind.
 */

export const AGT002_INITIAL_ANALYSIS_WORKER_ID = 'agt002-initial-analysis-worker';

export const AGT002_INITIAL_ANALYSIS_ACTIVE_JOB_STATUSES = Object.freeze([
  'QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION',
]);
const ACTIVE_STATUS_SET = new Set(AGT002_INITIAL_ANALYSIS_ACTIVE_JOB_STATUSES);

export function isAgt002InitialAnalysisJobStatusActive(status) {
  return ACTIVE_STATUS_SET.has(status);
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) {
    const wrapped = new Error(error.message || String(error));
    if (error.code != null) wrapped.code = error.code;
    if (error.status != null) wrapped.status = error.status;
    throw wrapped;
  }
  return data;
}

function requireNonBlank(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} es obligatorio.`);
  }
  return value;
}

/**
 * Atomically consumes one exact G1 authorization and admits its durable INITIAL job. The
 * database constructs payload.persistence from the governed bindings; callers cannot supply a
 * different lineage envelope through payload. With `sourceAnalysisRunId` the job is a REANALYSIS
 * (migration 108): the successor of that run, which must be the opportunity's current canonical
 * analysis.
 */
export async function admitAgt002InitialAnalysisJob(database, {
  authorizationId, workflowInstanceId, opportunityId, tenderId, packageVersionId, packageHash,
  g1Scope, policyVersion, idempotencyKey, payload, requestedBy, sourceAnalysisRunId = null,
} = {}) {
  requireNonBlank(authorizationId, 'La autorización G1');
  requireNonBlank(workflowInstanceId, 'La instancia de flujo de trabajo');
  requireNonBlank(opportunityId, 'La oportunidad');
  requireNonBlank(tenderId, 'La licitación');
  requireNonBlank(packageVersionId, 'La versión del paquete de evidencia');
  requireNonBlank(packageHash, 'La huella del paquete de evidencia');
  requireNonBlank(g1Scope, 'El alcance G1');
  requireNonBlank(policyVersion, 'La versión de política');
  requireNonBlank(idempotencyKey, 'La clave de idempotencia');
  requireNonBlank(requestedBy, 'El solicitante');
  if (!/^[0-9a-f]{64}$/.test(packageHash)) {
    throw new Error('La huella del paquete de evidencia debe ser SHA-256 hexadecimal en minúscula.');
  }
  if (!['A', 'A_PLUS_B'].includes(g1Scope)) {
    throw new Error('El alcance G1 no es válido.');
  }
  if (payload != null && (typeof payload !== 'object' || Array.isArray(payload))) {
    throw new Error('El payload del análisis inicial debe ser un objeto.');
  }

  const reanalysis = sourceAnalysisRunId !== null && sourceAnalysisRunId !== undefined;
  if (reanalysis) requireNonBlank(sourceAnalysisRunId, 'La corrida fuente del reanálisis');

  const data = await rpc(database, reanalysis
    ? 'psi_admit_authorized_agt002_initial_reanalysis_job'
    : 'psi_admit_authorized_agt002_initial_analysis_job', {
    p_authorization_id: authorizationId,
    p_workflow_instance_id: workflowInstanceId,
    p_opportunity_id: opportunityId,
    p_tender_id: tenderId,
    p_package_version_id: packageVersionId,
    p_package_hash: packageHash,
    p_g1_scope: g1Scope,
    p_policy_version: policyVersion,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
    p_actor_profile_id: requestedBy,
    ...(reanalysis ? { p_source_analysis_run_id: sourceAnalysisRunId } : {}),
  });

  if (!data || data.status === 'payload_mismatch') {
    throw new Error('El payload no coincide con la admisión existente bajo la misma clave de idempotencia.');
  }

  return {
    status: data.status,
    jobId: data.job_id,
    opportunityId: data.opportunity_id,
    tenderId: data.tender_id,
    idempotencyKey: data.idempotency_key,
    payload: data.payload,
    requestedBy: data.requested_by,
    jobStatus: data.job_status,
  };
}

/** Claims at most one due job (queued or with an expired lease) under the fixed worker identity. */
export async function claimAgt002InitialAnalysisJob(database, { workerId, leaseSeconds } = {}) {
  if (workerId !== AGT002_INITIAL_ANALYSIS_WORKER_ID) {
    throw new Error('Identidad de worker AGT-002 initial-analysis inválida.');
  }

  const data = await rpc(database, 'psi_claim_agt002_initial_analysis_job', {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (!data || data.status !== 'claimed') return null;

  return {
    jobId: data.job_id,
    leaseId: data.lease_id,
    fenceVersion: data.fence_version,
    leaseExpiresAt: data.lease_expires_at,
    opportunityId: data.opportunity_id,
    tenderId: data.tender_id,
    idempotencyKey: data.idempotency_key,
    payload: data.payload,
    requestedBy: data.requested_by,
  };
}

/** Fenced lease renewal: a stale or lost fence must never be silently accepted. */
export async function renewAgt002InitialAnalysisJobLease(database, { jobId, leaseId, fenceVersion, leaseSeconds } = {}) {
  const data = await rpc(database, 'psi_renew_agt002_initial_analysis_job_lease', {
    p_job_id: jobId,
    p_lease_id: leaseId,
    p_fence_version: fenceVersion,
    p_lease_seconds: leaseSeconds,
  });

  if (!data || data.status !== 'renewed') {
    throw new Error('La renovación de la reserva del job de análisis inicial AGT-002 no fue exitosa.');
  }

  return { status: 'renewed', leaseExpiresAt: data.lease_expires_at };
}

const AGT002_INITIAL_ANALYSIS_ERROR_CODE_PATTERN = /^[a-z0-9_]{3,80}$/;

/**
 * Closes a claimed job as FAILED using a closed snake_case error code; the database never
 * receives raw provider/model/DB text through this wrapper, and a raw DB-side rejection is never
 * relayed to the caller verbatim — only a sanitized, closed message is ever thrown.
 */
export async function failAgt002InitialAnalysisJob(database, { jobId, leaseId, fenceVersion, errorCode } = {}) {
  requireNonBlank(jobId, 'El job');
  requireNonBlank(leaseId, 'La reserva');
  if (!Number.isInteger(fenceVersion)) {
    throw new Error('La versión de fence del job de análisis inicial AGT-002 es obligatoria.');
  }
  if (typeof errorCode !== 'string' || !AGT002_INITIAL_ANALYSIS_ERROR_CODE_PATTERN.test(errorCode)) {
    throw new Error('El código de error del job de análisis inicial AGT-002 no es válido.');
  }

  let data;
  try {
    data = await rpc(database, 'psi_fail_agt002_initial_analysis_job', {
      p_job_id: jobId, p_lease_id: leaseId, p_fence_version: fenceVersion, p_error_code: errorCode,
    });
  } catch {
    throw new Error('El cierre del job de análisis inicial AGT-002 no pudo completarse.');
  }

  if (!data || !['unavailable', 'existing'].includes(data.status)) {
    throw new Error('El cierre del job de análisis inicial AGT-002 no devolvió un resultado válido.');
  }
  return { status: data.status, jobId: data.job_id, errorCode: data.error_code };
}
