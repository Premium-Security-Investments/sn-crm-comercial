// Vig-IA Comercial (AGT-003) — puerta única de modelos, Paso 3: fallas del puente o del modelo (Juan Botero, 2026-10-09).
//
// Plan B aprobado: si Claude no responde, la función se PAUSA Y AVISA. No se cambia a otro modelo ni a otro proveedor y
// no sale información hacia un proveedor nuevo. Por eso el único plan B activo de la configuración es `notify`.
//
// Este módulo es puro (sin red, base de datos ni entorno) y lo usan el servidor y la interfaz:
// - `classifyAgt003ModelFailure(code)`: lleva cualquier código que hoy devuelven el puente
//   (agt003-claude-bridge-server.js), el cliente del proveedor (agt003-claude-client.js) o el cliente del puente
//   (agt003-copilot-bridge-client.js) a una de cuatro categorías estables, o a null si no es una falla del proveedor
//   (cancelación, puente ocupado, cupo agotado, función apagada).
// - Mensajes al usuario en lenguaje común, distintos por categoría, para las dos funciones.
// - Textos para IT → Agentes, sin nombres técnicos.

/** Categorías estables. Dos reutilizan códigos que ya existían con ese mismo significado. */
export const AGT003_MODEL_FAILURE = Object.freeze({
  /** Sesión de Claude vencida o no iniciada (código existente del cliente del proveedor). */
  LOGIN_REQUIRED: 'AGT003_CLAUDE_LOGIN_REQUIRED',
  /** Puente caído, sin respuesta, con tiempo agotado o que rechaza la conexión. */
  BRIDGE_UNAVAILABLE: 'AGT003_BRIDGE_UNAVAILABLE',
  /** Límite de la suscripción alcanzado (código existente; "Uso de IA" ya lo cuenta como `%SESSION_LIMIT`). */
  SESSION_LIMIT: 'AGT003_CLAUDE_SESSION_LIMIT',
  /** Cualquier otro error del modelo o del intercambio con él. */
  MODEL_ERROR: 'AGT003_MODEL_ERROR',
});

export const AGT003_MODEL_FAILURE_CODES = Object.freeze(Object.values(AGT003_MODEL_FAILURE));

// Se comparan sin el prefijo del agente: en modo compartido el puente de Vig-IA Licitaciones responde los mismos
// sufijos con prefijo AGT002_. Es sólo comparación de texto; no hay ningún import de AGT-002.
const LOGIN_SUFFIXES = new Set(['CLAUDE_LOGIN_REQUIRED']);
const SESSION_LIMIT_SUFFIXES = new Set(['CLAUDE_SESSION_LIMIT']);
const BRIDGE_SUFFIXES = new Set([
  'BRIDGE_UNAVAILABLE',
  'CLAUDE_TIMEOUT', // el turno del proveedor superó el tiempo (504 del puente)
  'CLAUDE_TRANSPORT_ERROR', // el puente no pudo lanzar o completar el proceso del proveedor
  'COPILOT_TRANSPORT_ERROR', // el CRM no llegó al puente: red, caída o tiempo agotado del lado del CRM
  'BRIDGE_AUTH_INVALID', // el puente rechazó la firma del CRM (secreto o reloj desalineados): sin conexión útil
  'BRIDGE_INTERNAL', // error interno del puente (500)
]);
// No son fallas del proveedor: no generan aviso ni cambian el mensaje de cupo, apagado o saturación.
const NOT_A_PROVIDER_FAILURE = /(?:^|_)(?:CANCELLED|BUSY|QUOTA|SATURATED|CAPABILITY_DISABLED|IN_PROGRESS|RETRY_LIMIT)$/;

function normalizeCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

/**
 * Categoría estable de una falla, a partir del código (o de un error con `.code`). Devuelve uno de
 * `AGT003_MODEL_FAILURE_CODES` o null cuando no es una falla del proveedor. Un código desconocido o vacío es
 * "otro error del modelo": nunca se pierde una falla.
 */
export function classifyAgt003ModelFailure(codeOrError) {
  const code = normalizeCode(codeOrError && typeof codeOrError === 'object' ? codeOrError.code : codeOrError);
  if (AGT003_MODEL_FAILURE_CODES.includes(code)) return code;
  if (code && NOT_A_PROVIDER_FAILURE.test(code)) return null;
  const suffix = code.replace(/^AGT00[0-6]_/, '');
  if (LOGIN_SUFFIXES.has(suffix)) return AGT003_MODEL_FAILURE.LOGIN_REQUIRED;
  if (SESSION_LIMIT_SUFFIXES.has(suffix)) return AGT003_MODEL_FAILURE.SESSION_LIMIT;
  if (BRIDGE_SUFFIXES.has(suffix)) return AGT003_MODEL_FAILURE.BRIDGE_UNAVAILABLE;
  return AGT003_MODEL_FAILURE.MODEL_ERROR;
}

const IT_RECORDED = 'Ya quedó registrado para el equipo de IT.';
const WHAT = Object.freeze({ copilot: 'el seguimiento', lead_analysis: 'el análisis' });

/**
 * Mensaje para quien usa la función (plan B "avisar"). `feature`: 'copilot' | 'lead_analysis'. Nunca contiene
 * códigos, nombres de servidores ni texto del proveedor.
 */
export function agt003ModelFailureMessage(category, feature = 'copilot') {
  const what = WHAT[feature] || WHAT.copilot;
  switch (category) {
    case AGT003_MODEL_FAILURE.LOGIN_REQUIRED:
      return `Vig-IA no está disponible por ahora: su acceso al servicio de IA necesita renovarse. ${IT_RECORDED} Intenta más tarde.`;
    case AGT003_MODEL_FAILURE.BRIDGE_UNAVAILABLE:
      return `Vig-IA no está disponible por ahora: no logró comunicarse con el servicio de IA. ${IT_RECORDED} Intenta de nuevo en unos minutos.`;
    case AGT003_MODEL_FAILURE.SESSION_LIMIT:
      return `Vig-IA alcanzó por ahora el límite de uso del servicio de IA. ${IT_RECORDED} Intenta de nuevo en un rato.`;
    default:
      return `Vig-IA no pudo preparar ${what} esta vez. Intenta de nuevo en unos minutos; si vuelve a pasar, el equipo de IT ya tiene el registro.`;
  }
}

/** Todos los mensajes posibles (para que la interfaz sepa que puede mostrarlos tal cual). */
export const AGT003_MODEL_FAILURE_MESSAGES = Object.freeze(
  ['copilot', 'lead_analysis'].flatMap(feature => AGT003_MODEL_FAILURE_CODES.map(category => agt003ModelFailureMessage(category, feature))),
);

export function isAgt003ModelFailureMessage(message) {
  return typeof message === 'string' && AGT003_MODEL_FAILURE_MESSAGES.includes(message);
}

/** Textos de IT → Agentes (lenguaje común, sin nombres técnicos). */
export const AGT003_MODEL_FAILURE_IT_TEXT = Object.freeze({
  [AGT003_MODEL_FAILURE.LOGIN_REQUIRED]: Object.freeze({
    title: 'La sesión de Claude venció',
    help: 'Vig-IA no puede usar la IA hasta que alguien de IT vuelva a iniciar la sesión de Claude en el servidor de Vig-IA.',
  }),
  [AGT003_MODEL_FAILURE.BRIDGE_UNAVAILABLE]: Object.freeze({
    title: 'Sin conexión con el servicio de IA',
    help: 'El servidor que conecta a Vig-IA con Claude no respondió, tardó demasiado o rechazó la conexión.',
  }),
  [AGT003_MODEL_FAILURE.SESSION_LIMIT]: Object.freeze({
    title: 'Se alcanzó el límite de la suscripción',
    help: 'La suscripción de Claude llegó a su tope de uso por un rato. Suele liberarse sola.',
  }),
  [AGT003_MODEL_FAILURE.MODEL_ERROR]: Object.freeze({
    title: 'La IA respondió con un error',
    help: 'Claude devolvió un error o una respuesta que no se pudo usar.',
  }),
});

/**
 * Categorías que dependen de la conexión compartida (sesión, servidor, suscripción): un uso exitoso de CUALQUIER
 * función del agente demuestra que ya se resolvieron. "Otro error del modelo" se resuelve sólo con un uso exitoso de
 * la misma función.
 */
export const AGT003_SHARED_FAILURE_CATEGORIES = Object.freeze([
  AGT003_MODEL_FAILURE.LOGIN_REQUIRED,
  AGT003_MODEL_FAILURE.BRIDGE_UNAVAILABLE,
  AGT003_MODEL_FAILURE.SESSION_LIMIT,
]);
