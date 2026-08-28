import { jobIdempotencyKey } from './tender-pipeline-idempotency.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_STATUSES = new Set(['pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado']);
const GENERIC_TRANSITION_STATUSES = new Set(['nueva', 'descartada']);

function trackingError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUuid(value, label) {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) throw trackingError(`Debe indicar ${label}.`);
  return id;
}

function nullableText(value, max = 1200) {
  return String(value || '').trim().slice(0, max) || null;
}

function nullableTimestamp(value, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw trackingError('Debe indicar la versión de seguimiento para evitar conflictos.');
    return null;
  }
  const timestamp = String(value).trim();
  if (Number.isNaN(Date.parse(timestamp))) throw trackingError('La versión de seguimiento no es una fecha válida.');
  return timestamp;
}

function rejectClientEventType(input) {
  if (input?.event_type !== undefined) throw trackingError('El tipo de evento no se selecciona desde el cliente.');
}

async function rpc(database, name, args) {
  const { data, error } = await database.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function callTenderTrackingUpdate(database, tenderId, input, currentProfile) {
  const id = requireUuid(tenderId, 'una licitación válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);
  const trackingStatus = String(input?.tracking_status || 'pendiente_revision').trim();
  if (!TRACKING_STATUSES.has(trackingStatus)) throw trackingError('Estado de seguimiento inválido.');
  const ownerId = input?.tracking_owner_id === undefined || input?.tracking_owner_id === null || input?.tracking_owner_id === ''
    ? actorId
    : requireUuid(input.tracking_owner_id, 'un responsable válido');

  return rpc(database, 'psi_update_tender_tracking', {
    p_tender_id: id,
    p_actor_id: actorId,
    p_tracking_owner_id: ownerId,
    p_tracking_status: trackingStatus,
    p_tracking_next_action: nullableText(input?.tracking_next_action, 500),
    p_tracking_due_at: nullableTimestamp(input?.tracking_due_at),
    p_tracking_blocker: nullableText(input?.tracking_blocker),
    p_note: nullableText(input?.note),
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at),
  });
}

export async function callTenderOpportunityDiscard(database, opportunityId, input, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);

  return rpc(database, 'psi_discard_tender_opportunity', {
    p_opportunity_id: id,
    p_actor_id: actorId,
    p_note: nullableText(input?.note),
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at),
  });
}

const OPPORTUNITY_EXIT_DESTINATIONS = new Set(['radar', 'seguimiento']);

export async function callTenderOpportunityExit(database, opportunityId, input, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);
  const destination = String(input?.destination || '').trim();
  if (!OPPORTUNITY_EXIT_DESTINATIONS.has(destination)) throw trackingError('Destino de salida inválido.');

  return rpc(database, 'psi_exit_tender_opportunity', {
    p_opportunity_id: id,
    p_actor_id: actorId,
    p_destination: destination,
    p_note: nullableText(input?.note),
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at, true),
  });
}

export async function callTenderOpportunityConversion(database, tenderId, payload, expectedTrackingUpdatedAt, currentProfile) {
  const id = requireUuid(tenderId, 'una licitación válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  const ownerId = requireUuid(payload?.owner_id, 'un responsable válido');
  const externalSource = String(payload?.external_source || '').trim();
  if (!externalSource.startsWith('secop_radar:')) throw trackingError('El origen externo de la licitación es inválido.');

  return rpc(database, 'psi_convert_tender_to_opportunity', {
    p_tender_id: id,
    p_actor_id: actorId,
    p_external_source: payload.external_source,
    p_company_name: payload.company_name,
    p_owner_id: ownerId,
    p_stage_code: payload.stage_code,
    p_service_type_code: payload.service_type_code,
    p_offer_value: payload.offer_value,
    p_expected_close_date: payload.expected_close_date,
    p_quote_city: payload.quote_city,
    p_regional_nombre: payload.regional_nombre,
    p_sede: payload.sede,
    p_economic_sector: payload.economic_sector,
    p_tipo_producto_original: payload.tipo_producto_original,
    p_observaciones: payload.observaciones,
    p_expected_tracking_updated_at: nullableTimestamp(expectedTrackingUpdatedAt),
  });
}

/** Idempotent: a repeated call for the same tender/opportunity/pipeline version
 * recovers the active job instead of creating a duplicate. Returns `outcome`
 * ('created'|'existing', from the RPC) separately from `status`, the job's
 * durable pipeline status (e.g. 'queued') read back from the row — callers that
 * gate on newly-created jobs must check `outcome`, not `status`. */
export async function callCreateTenderProcessingJob(database, { tenderId, opportunityId, pipelineVersion, requestedBy }) {
  const id = requireUuid(tenderId, 'una licitación válida');
  const opportunity = requireUuid(opportunityId, 'una oportunidad válida');
  const actorId = requireUuid(requestedBy, 'un actor válido');
  const version = String(pipelineVersion || '').trim();
  if (!version) throw trackingError('Debe indicar la versión del pipeline.');

  const idempotencyKey = jobIdempotencyKey({ tenderId: id, opportunityId: opportunity, pipelineVersion: version });
  const created = await rpc(database, 'psi_create_tender_processing_job', {
    p_tender_id: id,
    p_opportunity_id: opportunity,
    p_pipeline_version: version,
    p_idempotency_key: idempotencyKey,
    p_requested_by: actorId,
  });

  const { data: job, error } = await database
    .from('psi_tender_processing_jobs')
    .select('status,current_step')
    .eq('id', created.job_id)
    .single();
  if (error) throw error;

  return { job_id: created.job_id, outcome: created.status, status: job.status, current_step: job.current_step };
}

export async function callTenderTrackingTransition(database, tenderId, input, currentProfile) {
  const id = requireUuid(tenderId, 'una licitación válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);
  const internalStatus = String(input?.internal_status || '').trim();
  if (internalStatus === 'convertida_oportunidad') {
    throw trackingError('La conversión debe usar el flujo de convertir a oportunidad.');
  }
  if (!GENERIC_TRANSITION_STATUSES.has(internalStatus)) throw trackingError('Transición de seguimiento inválida.');
  if (input?.converted_opportunity_id !== undefined && input?.converted_opportunity_id !== null && input?.converted_opportunity_id !== '') {
    throw trackingError('La transición de seguimiento no admite una oportunidad convertida.');
  }

  return rpc(database, 'psi_transition_tender_tracking', {
    p_tender_id: id,
    p_actor_id: actorId,
    p_internal_status: internalStatus,
    p_converted_opportunity_id: null,
    p_note: nullableText(input?.note),
    // Initial nueva → descartada transitions intentionally carry
    // a null token; the transactional RPC validates token requirements by source state.
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at),
  });
}
