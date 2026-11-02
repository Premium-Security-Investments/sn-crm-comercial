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

/**
 * Tope de la próxima gestión: 90 días (Juan, 2026-11-02), el mismo que ya exigía la base al decidir
 * (`psi_record_opportunity_decision`) y el mismo que el chat aplicaba desde el 15 de octubre. Lo que no lo tenía era
 * el formulario de seguimiento de la ficha, y por ahí se colaron fechas de 2027 y 2030.
 *
 * Una próxima gestión a dos años **esconde la oportunidad**: Mi día, los pendientes por decidir y el estancamiento
 * miran si hay compromiso vigente, y un compromiso en 2027 los deja a todos tranquilos. Medido el 2026-11-02: nueve
 * oportunidades abiertas con fecha a más de 90 días, cinco de ellas a más de un año, y una activa —Central
 * Mayorista— con su próxima gestión en octubre de 2027 y su último seguimiento fechado en noviembre de 2027.
 */
export const NEXT_ACTION_MAX_DAYS = 90;
export const NEXT_ACTION_TOO_FAR_CODE = 'CRM_NEXT_ACTION_TOO_FAR';
export const NEXT_ACTION_TOO_FAR_MESSAGE = `La próxima gestión no puede quedar a más de ${NEXT_ACTION_MAX_DAYS} días. Si el cliente le pidió volver mucho más adelante, congele la oportunidad; y si lo que quiere recordar es cuándo vence el contrato que tiene hoy con otro proveedor, eso va en "Vence el contrato actual", en el perfil del cliente.`;

/** La fecha de un seguimiento es la de algo que YA pasó: no puede ser futura. */
export const FOLLOW_UP_DATE_CODE = 'CRM_FOLLOW_UP_DATE_FUTURE';
export const FOLLOW_UP_DATE_FUTURE_MESSAGE = 'La fecha del seguimiento no puede ser futura: es algo que ya pasó. Si quiere agendar algo, use la próxima gestión.';

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

  const limit = nowMs + NEXT_ACTION_MAX_DAYS * 86_400_000;
  const proposed = ms(proposedNextActionAt);
  if (proposed !== null) {
    if (proposed <= nowMs) return { ok: false, code: NEXT_ACTION_REQUIRED_CODE, message: NEXT_ACTION_PAST_MESSAGE };
    // El tope se revisa aquí y no sólo en la base: la base lo exige al decidir, y el seguimiento de la ficha no pasa
    // por ahí.
    if (proposed > limit) return { ok: false, code: NEXT_ACTION_TOO_FAR_CODE, message: NEXT_ACTION_TOO_FAR_MESSAGE };
    return { ok: true };
  }
  // Sin fecha nueva: sirve la que ya estaba, siempre que siga por delante. El tope NO se le aplica a lo ya guardado:
  // una fecha absurda puesta antes de esta regla no puede impedirle a nadie registrar un seguimiento hoy; lo que se
  // bloquea es escribir una nueva.
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

/**
 * ¿Se puede guardar la fecha de un seguimiento? Sólo se rechaza el futuro. El pasado queda libre a propósito: un
 * comercial que registra hoy la llamada de la semana pasada está haciendo lo correcto, y el chat ya tiene su propia
 * ventana de 30 días para lo que dicta.
 */
export function followUpDateRequirement({ occurredAt = null, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : ms(now);
  const occurred = ms(occurredAt);
  if (occurred === null || !Number.isFinite(nowMs)) return { ok: true };
  // Un minuto de holgura: el reloj del navegador y el del servidor no siempre coinciden al segundo.
  return occurred <= nowMs + 60_000 ? { ok: true } : { ok: false, code: FOLLOW_UP_DATE_CODE, message: FOLLOW_UP_DATE_FUTURE_MESSAGE };
}
