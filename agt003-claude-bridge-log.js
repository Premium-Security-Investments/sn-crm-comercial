/**
 * Log estructurado del puente AGT-003. Es una lista blanca estricta: sólo los
 * campos aquí declarados llegan a stdout. Ni la política, ni la entrada del
 * CRM, ni el contenido devuelto por el proveedor, ni su stderr, ni el secreto
 * HMAC pueden filtrarse a los registros aunque el llamador los pase por error.
 */
const SAFE_KEYS = ['correlation_id', 'code', 'latency_ms', 'input_tokens', 'output_tokens', 'received_bytes', 'provider_error_code'];
const PROVIDER_ATOM_KEYS = new Set(['provider_error_code']);

function isSafeProviderAtom(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value);
}

export function logAgt003BridgeEvent(event, fields = {}) {
  const sanitized = { event };
  for (const key of SAFE_KEYS) {
    if (!Object.hasOwn(fields, key)) continue;
    if (PROVIDER_ATOM_KEYS.has(key) && !isSafeProviderAtom(fields[key])) continue;
    sanitized[key] = fields[key];
  }
  console.log(JSON.stringify(sanitized));
}
