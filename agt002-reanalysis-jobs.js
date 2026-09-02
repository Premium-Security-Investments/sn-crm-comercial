const CLOSED_ERROR_CODES = new Set(['timeout', 'provider_error', 'invalid_output', 'persistence_failure', 'lease_lost', 'capacity_unavailable']);

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

function requireId(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} es obligatorio.`);
  return value;
}

/** Idempotent create/reuse of one durable psi_agt002_reanalysis_jobs row. */
export async function createAgt002ReanalysisJob(database, { opportunityId, tenderId, snapshotId, contextVersionId, idempotencyKey, frozenEngineInput, requestedBy }) {
  const result = await rpc(database, 'psi_create_agt002_reanalysis_job', {
    p_opportunity_id: requireId(opportunityId, 'La oportunidad'),
    p_tender_id: requireId(tenderId, 'La licitación'),
    p_snapshot_id: requireId(snapshotId, 'El snapshot documental'),
    p_context_version_id: requireId(contextVersionId, 'La versión de contexto'),
    p_idempotency_key: requireId(idempotencyKey, 'La clave de idempotencia'),
    p_frozen_engine_input: frozenEngineInput,
    p_requested_by: requireId(requestedBy, 'El solicitante'),
  });
  if (!result || !['created', 'existing'].includes(result.status) || typeof result.job_id !== 'string') {
    throw new Error('La creación del job de reanálisis AGT-002 no devolvió un resultado válido.');
  }
  return { status: result.status, jobId: result.job_id };
}

/** Claims at most one queued job with a bounded lease; null when nothing is claimable. */
export async function claimAgt002ReanalysisJob(database, { leaseSeconds = 90 } = {}) {
  const claim = await rpc(database, 'psi_claim_agt002_reanalysis_job', { p_lease_seconds: leaseSeconds });
  if (claim?.status === 'empty') return null;
  const requiredFields = [
    'job_id', 'lease_id', 'lease_expires_at', 'opportunity_id', 'tender_id',
    'snapshot_id', 'context_version_id', 'idempotency_key', 'requested_by',
  ];
  if (!claim || claim.status !== 'claimed'
      || requiredFields.some(field => typeof claim[field] !== 'string')
      || !claim.frozen_engine_input || typeof claim.frozen_engine_input !== 'object') {
    throw new Error('El reclamo del job de reanálisis AGT-002 no devolvió un resultado válido.');
  }
  return {
    jobId: claim.job_id,
    leaseId: claim.lease_id,
    leaseExpiresAt: claim.lease_expires_at,
    opportunityId: claim.opportunity_id,
    tenderId: claim.tender_id,
    snapshotId: claim.snapshot_id,
    contextVersionId: claim.context_version_id,
    idempotencyKey: claim.idempotency_key,
    frozenEngineInput: claim.frozen_engine_input,
    requestedBy: claim.requested_by,
  };
}

/** Closes a claimed job as completed against a real canonical analysis run id. */
export async function completeAgt002ReanalysisJob(database, { jobId, leaseId, analysisRunId }) {
  const result = await rpc(database, 'psi_complete_agt002_reanalysis_job', {
    p_job_id: requireId(jobId, 'El job'),
    p_lease_id: requireId(leaseId, 'La reserva'),
    p_analysis_run_id: requireId(analysisRunId, 'La ejecución canónica'),
  });
  if (!result || !['completed', 'existing'].includes(result.status)) {
    throw new Error('La finalización del job de reanálisis AGT-002 no devolvió un resultado válido.');
  }
  return { status: result.status, jobId: result.job_id, analysisRunId: result.analysis_run_id };
}

function requireLeaseSeconds(value) {
  if (!Number.isInteger(value) || value < 1 || value > 600) {
    throw new Error('La duración de renovación de la reserva del job de reanálisis AGT-002 no es válida.');
  }
  return value;
}

/**
 * Deterministic stage-boundary heartbeat: renews an already-claimed job's lease, fenced by BOTH
 * jobId and leaseId in one DB predicate, and only while the job is still 'running'. `status:
 * 'lost'` fails closed with a stable, non-secret lease code so the existing worker classifier
 * (classifyAgt002ReanalysisWorkerError) maps it to the existing closed 'lease_lost' code — never
 * a re-renew, never a follow-up call.
 */
export async function renewAgt002ReanalysisJobLease(database, { jobId, leaseId, leaseSeconds } = {}) {
  const result = await rpc(database, 'psi_renew_agt002_reanalysis_job_lease', {
    p_job_id: requireId(jobId, 'El job'),
    p_lease_id: requireId(leaseId, 'La reserva'),
    p_lease_seconds: requireLeaseSeconds(leaseSeconds),
  });
  if (result?.status === 'lost') {
    const error = new Error('El trabajo de reanálisis AGT-002 perdió su reserva antes de renovarse.');
    error.code = 'AGT002_REANALYSIS_LEASE_LOST';
    throw error;
  }
  if (result?.status !== 'renewed' || typeof result.lease_expires_at !== 'string' || !result.lease_expires_at.trim()) {
    throw new Error('La renovación de la reserva del job de reanálisis AGT-002 no devolvió un resultado válido.');
  }
  return { status: 'renewed', leaseExpiresAt: result.lease_expires_at };
}

/**
 * Closes a claimed job as unavailable using one of a fixed set of error codes; the
 * database derives the closed error message from the code, so no raw provider/model/DB
 * text can ever reach persistence through this wrapper.
 */
export async function failAgt002ReanalysisJob(database, { jobId, leaseId, errorCode }) {
  if (!CLOSED_ERROR_CODES.has(errorCode)) {
    throw new Error('El código de error del job de reanálisis AGT-002 no es válido.');
  }
  const result = await rpc(database, 'psi_fail_agt002_reanalysis_job', {
    p_job_id: requireId(jobId, 'El job'),
    p_lease_id: requireId(leaseId, 'La reserva'),
    p_error_code: errorCode,
  });
  if (!result || !['unavailable', 'existing'].includes(result.status)) {
    throw new Error('El cierre del job de reanálisis AGT-002 no devolvió un resultado válido.');
  }
  return { status: result.status, jobId: result.job_id, errorCode: result.error_code, errorMessage: result.error_message };
}

/**
 * Service-side status read for the human-facing polling surface: only the latest job
 * for the opportunity, and only the fields the browser is ever allowed to see. The
 * frozen engine input and raw error message are deliberately never selected here.
 */
export async function findLatestAgt002ReanalysisStatusForOpportunity(database, opportunityId) {
  const response = await database.from('psi_agt002_reanalysis_jobs')
    .select('id,status,created_at,started_at,completed_at,analysis_run_id,error_code')
    .eq('opportunity_id', requireId(opportunityId, 'La oportunidad'))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (response?.error) throw new Error(response.error.message || String(response.error));
  const row = response?.data;
  if (!row) return null;
  return {
    jobId: row.id,
    status: row.status,
    analysisRunId: row.analysis_run_id || null,
    errorCode: row.error_code || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
  };
}
