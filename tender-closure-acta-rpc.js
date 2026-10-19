import { ACTIONS, requireAction } from './access-control.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEXT_LIMITS = { closing_note: 4000, decision_summary: 4000, decision_quote: 2000, recommendation: 4000, system_lesson: 4000 };
const LIST_FIELDS = ['requirements_unmet', 'factors_against', 'gaps_to_compete'];
const MAX_LIST_ENTRIES = 40;
const MAX_REASONS = 12;
const MAX_REASON_LENGTH = 120;

function actaError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function uuid(value, label) { const id = String(value || '').trim(); if (!UUID_PATTERN.test(id)) throw actaError('Debe indicar ' + label + '.'); return id; }
function text(value, field) { const trimmed = String(value ?? '').trim(); return trimmed ? trimmed.slice(0, TEXT_LIMITS[field]) : null; }
function expectedUpdatedAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const stamp = new Date(String(value));
  if (Number.isNaN(stamp.getTime())) throw actaError('La versión del acta no es válida.');
  return stamp.toISOString();
}
function list(value, field) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw actaError('El campo ' + field + ' debe ser una lista.');
  if (value.length > MAX_LIST_ENTRIES) throw actaError('El campo ' + field + ' trae demasiadas entradas.');
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw actaError('Cada entrada de ' + field + ' debe ser un objeto.');
    return entry;
  });
}
function reasons(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw actaError('Los motivos deben venir en una lista.');
  const unique = [];
  for (const entry of value) {
    const label = String(entry ?? '').trim().slice(0, MAX_REASON_LENGTH);
    if (label && !unique.includes(label)) unique.push(label);
  }
  if (unique.length > MAX_REASONS) throw actaError('El acta no puede tener más de ' + MAX_REASONS + ' motivos.');
  return unique;
}

function mapError(error) {
  if (error?.code === '42501') error.status = 403;
  if (['40001', '23514', '23505'].includes(error?.code)) error.status = 409;
  if (error?.code === 'P0002') error.status = 404;
  return error;
}

const CLOSED_OFFER_STATUSES = new Set(['cerrada_no_go', 'adjudicada', 'no_adjudicada']);

/** Cómo se cerró la licitación, o null si sigue abierta. La vista de la ficha no trae `archived_at`. */
function closureKind(opportunity) {
  if (opportunity?.archived_at) return 'archivada';
  const status = String(opportunity?.tender_offer_status || '');
  return CLOSED_OFFER_STATUSES.has(status) ? status : null;
}

export async function getTenderClosureActa(database, opportunityId, currentProfile) {
  requireAction(currentProfile, ACTIONS.LICITACIONES_VIEW);
  const id = uuid(opportunityId, 'una oportunidad válida');
  const { data: acta, error } = await database.rpc('psi_get_tender_closure_acta', { p_opportunity_id: id });
  if (error) throw mapError(error);
  const { data: opportunity, error: readError } = await database.from('psi_sales_opportunities').select('archived_at, tender_offer_status').eq('id', id).maybeSingle();
  if (readError) throw mapError(readError);
  return { closure_kind: closureKind(opportunity), acta: acta ?? null };
}

export async function callUpsertTenderClosureActa(database, input, currentProfile) {
  const opportunityId = uuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = uuid(currentProfile?.id, 'un actor válido');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  const payload = {
    closing_note: text(input?.closing_note, 'closing_note'),
    decision_summary: text(input?.decision_summary, 'decision_summary'),
    decision_quote: text(input?.decision_quote, 'decision_quote'),
    recommendation: text(input?.recommendation, 'recommendation'),
    system_lesson: text(input?.system_lesson, 'system_lesson'),
    reasons: reasons(input?.reasons),
  };
  for (const field of LIST_FIELDS) payload[field] = list(input?.[field], field);
  const { data, error } = await database.rpc('psi_upsert_tender_closure_acta', {
    p_opportunity_id: opportunityId,
    p_actor_id: actorId,
    p_payload: payload,
    p_expected_updated_at: expectedUpdatedAt(input?.expected_updated_at),
  });
  if (error) throw mapError(error);
  return data;
}

export async function callConfirmTenderClosureActa(database, input, currentProfile) {
  return callActaDecision(database, input, currentProfile, 'psi_confirm_tender_closure_acta');
}

export async function callReopenTenderClosureActa(database, input, currentProfile) {
  return callActaDecision(database, input, currentProfile, 'psi_reopen_tender_closure_acta');
}

async function callActaDecision(database, input, currentProfile, rpcName) {
  const opportunityId = uuid(input?.opportunity_id, 'una oportunidad válida');
  const actorId = uuid(currentProfile?.id, 'un actor válido');
  requireAction(currentProfile, ACTIONS.LICITACIONES_GO_NO_GO_APPROVE);
  const version = expectedUpdatedAt(input?.expected_updated_at);
  if (!version) throw actaError('Debe indicar la versión del acta que está revisando.');
  const { data, error } = await database.rpc(rpcName, { p_opportunity_id: opportunityId, p_actor_id: actorId, p_expected_updated_at: version });
  if (error) throw mapError(error);
  return data;
}

export { MAX_REASONS, MAX_REASON_LENGTH };
