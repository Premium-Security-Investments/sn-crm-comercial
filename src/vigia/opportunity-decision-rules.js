// CRM comercial — toda oportunidad abierta tiene una decisión vigente (decisión del dueño, 2026-10-07).
//
// Regla única, usada por el servidor (bloqueo de oportunidades nuevas, prioridades) y por las pantallas (Mi día,
// tableros): una oportunidad comercial activa está "pendiente de decisión" cuando su próxima gestión se venció o no
// existe. Congelada vigente o con solicitud de eliminación ya está decidida y además sale del pipeline activo.

import { isAgt003CommercialOpportunity } from './commercial-scope.js';

export const TERMINAL_STAGES = Object.freeze(['aprobado', 'descartado', 'perdido']);
export const DECISIONS = Object.freeze(['continue', 'advance', 'freeze', 'discard', 'lose', 'request_delete']);
export const FREEZE_DAYS = Object.freeze([30, 60, 90]);
export const FOLLOW_UP_TYPES = Object.freeze(['llamada', 'correo', 'reunion', 'whatsapp', 'nota']);
export const DELETE_PERMISSION = 'crm_eliminar_oportunidades';

const BOGOTA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Día calendario de Bogotá (YYYY-MM-DD) de un instante. */
export function bogotaDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : BOGOTA_DAY.format(date);
}

export function isTerminalStage(stageCode) {
  return TERMINAL_STAGES.includes(stageCode || '');
}

/** Congelada y todavía vigente (vence el día `frozen_until`, inclusive). */
export function isFrozen(opportunity, now = new Date()) {
  const until = String(opportunity?.frozen_until || '').slice(0, 10);
  return Boolean(until) && until >= bogotaDay(now);
}

export function isDeleteRequested(opportunity) {
  return Boolean(opportunity?.delete_requested_at);
}

/** Ya no cuenta en pipeline, forecast ni alertas: congelada vigente o pendiente de eliminación. */
export function isOutOfActivePipeline(opportunity, now = new Date()) {
  return isFrozen(opportunity, now) || isDeleteRequested(opportunity);
}

/** Oportunidad comercial abierta, sin decisión vigente: gestión vencida (antes de hoy, Bogotá) o sin gestión. */
export function isPendingDecision(opportunity, now = new Date()) {
  if (!isAgt003CommercialOpportunity(opportunity) || isTerminalStage(opportunity.stage_code)) return false;
  if (isOutOfActivePipeline(opportunity, now)) return false;
  if (!opportunity.next_action_at) return true;
  const nextDay = bogotaDay(opportunity.next_action_at);
  return nextDay === null || nextDay < bogotaDay(now);
}

export function pendingDecisions(opportunities = [], now = new Date()) {
  return (Array.isArray(opportunities) ? opportunities : []).filter(opportunity => isPendingDecision(opportunity, now));
}

function fail(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

/**
 * Valida y normaliza una decisión que llega por HTTP. Esquema cerrado: sólo se leen los campos conocidos y cada uno
 * con su tipo; la base de datos vuelve a validar las reglas de negocio de forma atómica.
 */
export function normalizeDecisionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Decisión inválida.');
  const decision = body.decision;
  if (!DECISIONS.includes(decision)) fail('Decisión no reconocida.');
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (notes.length < 5) fail('Escriba en una frase qué pasó o por qué decide esto.');
  if (notes.length > 2000) fail('El texto es demasiado largo.');
  const params = {
    p_decision: decision,
    p_notes: notes,
    p_interaction_type: null,
    p_next_action_at: null,
    p_stage_code: null,
    p_offer_value: null,
    p_freeze_days: null,
    p_loss_reason_code: null,
  };
  if (body.next_action_at !== undefined && body.next_action_at !== null && body.next_action_at !== '') {
    const next = new Date(body.next_action_at);
    if (typeof body.next_action_at !== 'string' || Number.isNaN(next.getTime())) fail('Fecha de próxima gestión inválida.');
    params.p_next_action_at = next.toISOString();
  }
  if (body.offer_value !== undefined && body.offer_value !== null && body.offer_value !== '') {
    const value = Number(body.offer_value);
    if (!Number.isFinite(value) || value < 0) fail('Valor inválido.');
    params.p_offer_value = value;
  }
  if (decision === 'continue') {
    const type = body.interaction_type || 'nota';
    if (!FOLLOW_UP_TYPES.includes(type)) fail('Tipo de seguimiento no válido.');
    params.p_interaction_type = type;
    if (!params.p_next_action_at) fail('Indique la próxima gestión.');
  }
  if (decision === 'advance') {
    if (typeof body.stage_code !== 'string' || !body.stage_code) fail('Escoja la nueva etapa.');
    params.p_stage_code = body.stage_code;
  }
  if (decision === 'freeze') {
    const days = Number(body.freeze_days);
    if (!FREEZE_DAYS.includes(days)) fail('Se puede congelar 30, 60 o 90 días.');
    params.p_freeze_days = days;
  }
  if (decision === 'discard' || decision === 'lose') {
    if (typeof body.loss_reason_code !== 'string' || !body.loss_reason_code) fail('Escoja el motivo.');
    params.p_loss_reason_code = body.loss_reason_code;
  }
  return params;
}
