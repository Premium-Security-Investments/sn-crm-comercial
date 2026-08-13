const SAFE_KEYS = ['correlation_id', 'code', 'latency_ms', 'input_tokens', 'output_tokens', 'received_bytes'];

export function logBridgeEvent(event, fields = {}) {
  const sanitized = { event };
  for (const key of SAFE_KEYS) {
    if (Object.hasOwn(fields, key)) sanitized[key] = fields[key];
  }
  console.log(JSON.stringify(sanitized));
}
