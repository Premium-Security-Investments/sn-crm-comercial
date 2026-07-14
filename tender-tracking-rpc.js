const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACKING_STATUSES = new Set(['pendiente_revision', 'analizando', 'esperando_informacion', 'listo_para_decision', 'bloqueado']);
const TERMINAL_STATUSES = new Set(['nueva', 'descartada', 'convertida_oportunidad']);

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

export async function callTenderTrackingTransition(database, tenderId, input, currentProfile) {
  const id = requireUuid(tenderId, 'una licitación válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  rejectClientEventType(input);
  const internalStatus = String(input?.internal_status || '').trim();
  if (!TERMINAL_STATUSES.has(internalStatus)) throw trackingError('Transición de seguimiento inválida.');
  const opportunityId = internalStatus === 'convertida_oportunidad'
    ? requireUuid(input?.converted_opportunity_id, 'una oportunidad válida')
    : null;

  return rpc(database, 'psi_transition_tender_tracking', {
    p_tender_id: id,
    p_actor_id: actorId,
    p_internal_status: internalStatus,
    p_converted_opportunity_id: opportunityId,
    p_note: nullableText(input?.note),
    // Initial nueva → descartada/convertida_oportunidad transitions intentionally carry
    // a null token; the transactional RPC validates token requirements by source state.
    p_expected_tracking_updated_at: nullableTimestamp(input?.expected_tracking_updated_at),
  });
}
