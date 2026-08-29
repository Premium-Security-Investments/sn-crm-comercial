import { isAgt002PreviewReasoningEffort } from './agt002-preview-reasoning-effort.js';

const SAFE_KEYS = ['correlation_id', 'code', 'latency_ms', 'input_tokens', 'output_tokens', 'received_bytes', 'provider_status', 'provider_error_code', 'effort'];
const PROVIDER_ATOM_KEYS = new Set(['provider_status', 'provider_error_code']);

function isSafeProviderAtom(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value);
}

export function logBridgeEvent(event, fields = {}) {
  const sanitized = { event };
  for (const key of SAFE_KEYS) {
    if (!Object.hasOwn(fields, key)) continue;
    if (PROVIDER_ATOM_KEYS.has(key) && !isSafeProviderAtom(fields[key])) continue;
    if (key === 'effort' && !isAgt002PreviewReasoningEffort(fields[key])) continue;
    sanitized[key] = fields[key];
  }
  console.log(JSON.stringify(sanitized));
}
