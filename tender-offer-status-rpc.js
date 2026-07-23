import { ACTIONS, requireAction } from './access-control.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSITIONS = Object.freeze({
  en_preparacion: ['lista_para_presentar'],
  lista_para_presentar: ['presentada'],
  presentada: ['adjudicada', 'no_adjudicada'],
});

function offerStatusError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireUuid(value, label) {
  const id = String(value || '').trim();
  if (!UUID_PATTERN.test(id)) throw offerStatusError(`Debe indicar ${label}.`);
  return id;
}

function requireStatus(value, label) {
  const status = String(value || '').trim();
  if (!Object.hasOwn(TRANSITIONS, status) && !Object.values(TRANSITIONS).flat().includes(status)) {
    throw offerStatusError(`Debe indicar ${label}.`);
  }
  return status;
}

function nullableNote(value) {
  return String(value || '').trim().slice(0, 1200) || null;
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function databaseError(error) {
  if (error?.status) return error;
  if (error?.code === '42501') error.status = 403;
  if (['40001', '23514'].includes(error?.code)) error.status = 409;
  return error;
}

async function resolveOffer(database, opportunityId) {
  const opportunity = await must(database.from('psi_sales_opportunities').select('id,tender_offer_status').eq('id', opportunityId).single());
  const tender = await must(database.from('psi_public_tenders').select('id,converted_opportunity_id').eq('converted_opportunity_id', opportunityId).maybeSingle());
  if (!tender?.id || tender.converted_opportunity_id !== opportunityId) throw offerStatusError('No existe una licitación vinculada a la oportunidad.', 404);
  return { opportunity, tender };
}

/** Read-only current offer status and immutable audit history. */
export async function getTenderOfferStatus(database, opportunityId, currentProfile) {
  const id = requireUuid(opportunityId, 'una oportunidad válida');
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const { opportunity, tender } = await resolveOffer(database, id);
  const history = await must(database.from('psi_tender_offer_status_transitions')
    .select('id,opportunity_id,tender_id,actor_id,from_status,to_status,note,changed_at,psi_sales_profiles(full_name)')
    .eq('opportunity_id', id)
    .eq('tender_id', tender.id)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false }));
  return { status: opportunity.tender_offer_status || 'pendiente_decision', history: history || [] };
}

/** Authoritative post-GO transition path; authorization happens before any target DB read. */
export async function callTenderOfferStatusTransition(database, input, currentProfile) {
  const opportunityId = requireUuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = requireUuid(currentProfile?.id, 'un actor válido');
  const toStatus = requireStatus(input?.to_status, 'un estado destino válido');
  const expectedCurrentStatus = requireStatus(input?.expected_current_status, 'el estado actual esperado');
  if (!(TRANSITIONS[expectedCurrentStatus] || []).includes(toStatus)) throw offerStatusError('Transición de estado no permitida.', 409);
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);

  try {
    const { data, error } = await database.rpc('psi_transition_tender_offer_status', {
      p_opportunity_id: opportunityId,
      p_actor_id: actorId,
      p_to_status: toStatus,
      p_expected_current_status: expectedCurrentStatus,
      p_note: nullableNote(input?.note),
    });
    if (error) throw error;
    return data;
  } catch (error) {
    throw databaseError(error);
  }
}

export { TRANSITIONS };
