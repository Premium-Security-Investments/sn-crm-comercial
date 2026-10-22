// AGT-003 — toda oportunidad abierta queda con próxima gestión (F4 de la especificación; Juan, 2026-10-22).
//
// Regla hermana de la fecha de entrada a etapa: aquella mide lo que se enfría, esta evita que se enfríe. Cuando el
// comercial registra un seguimiento, o mueve la oportunidad de etapa, tiene que quedar dicho cuándo es el siguiente
// contacto. Dos excepciones, las que pide la especificación:
//   · la oportunidad se cerró (aprobada, perdida o descartada): no hay siguiente contacto que agendar;
//   · ya hay una próxima gestión con fecha futura: el compromiso existe y no se vuelve a pedir.
//
// Una fecha que ya pasó no cuenta como compromiso: es justamente lo que Mi día viene señalando como vencido.
//
// Módulo puro: no lee red ni base, y no altera lo que recibe.

export const NEXT_ACTION_REQUIRED_CODE = 'CRM_NEXT_ACTION_REQUIRED';
export const NEXT_ACTION_REQUIRED_MESSAGE = 'Falta la próxima gestión: indique la fecha del siguiente contacto. Si el negocio ya se cerró, registre la oportunidad como aprobada, perdida o descartada.';
export const NEXT_ACTION_PAST_MESSAGE = 'La próxima gestión tiene que quedar con fecha futura.';
export const NEXT_ACTION_TERMINAL_STAGES = Object.freeze(['aprobado', 'perdido', 'descartado']);

const ms = value => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * ¿Se puede guardar? `{ ok: true }` o `{ ok: false, code, message }`.
 * `stageCode` es la etapa que queda después del cambio; `currentNextActionAt` la fecha guardada; `proposedNextActionAt`
 * la que viene en la solicitud (null si no viene).
 */
export function nextActionRequirement({ stageCode, currentNextActionAt = null, proposedNextActionAt = null, now = new Date() } = {}) {
  if (NEXT_ACTION_TERMINAL_STAGES.includes(String(stageCode || '').trim())) return { ok: true };
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  if (!Number.isFinite(nowMs)) return { ok: true };

  const proposed = ms(proposedNextActionAt);
  if (proposed !== null) {
    return proposed > nowMs ? { ok: true } : { ok: false, code: NEXT_ACTION_REQUIRED_CODE, message: NEXT_ACTION_PAST_MESSAGE };
  }
  // Sin fecha nueva: sirve la que ya estaba, siempre que siga por delante.
  const current = ms(currentNextActionAt);
  if (current !== null && current > nowMs) return { ok: true };
  return { ok: false, code: NEXT_ACTION_REQUIRED_CODE, message: NEXT_ACTION_REQUIRED_MESSAGE };
}

/** La próxima gestión guardada sigue vigente (hay compromiso y no hay que pedir otro). */
export function hasLiveNextAction({ nextActionAt = null, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  const next = ms(nextActionAt);
  return next !== null && Number.isFinite(nowMs) && next > nowMs;
}
