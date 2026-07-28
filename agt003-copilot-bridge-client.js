import { randomUUID } from 'node:crypto';
import { buildCanonicalString, sha256Hex, signCanonicalString } from './agt002-hetzner-bridge-signing.js';

const MAX_RESPONSE_BYTES = 262_144;

function transportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readBoundedJson(response) {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw transportError('La respuesta de Vig-IA no tiene una estructura segura.', 'AGT003_COPILOT_INVALID_RESPONSE');
  if (!response.body || typeof response.body.getReader !== 'function') return response.json();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw transportError('La respuesta de Vig-IA no tiene una estructura segura.', 'AGT003_COPILOT_INVALID_RESPONSE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAgt003CopilotBridgeClient({ url, hmacSecret, wireProtocol = 'agt003', fetchImpl = fetch, randomNonce = randomUUID, now = () => Math.floor(Date.now() / 1000) } = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('El puente AGT-003 requiere una URL HTTPS configurada.'); }
  if (endpoint.protocol !== 'https:') throw new Error('El puente AGT-003 requiere una URL HTTPS configurada.');
  if (typeof hmacSecret !== 'string' || Buffer.byteLength(hmacSecret) < 32) throw new Error('El puente AGT-003 requiere un secreto HMAC de al menos 32 bytes.');
  if (!['agt002', 'agt003'].includes(wireProtocol)) throw new Error('El protocolo wire del puente AGT-003 no es válido.');
  const headerNamespace = wireProtocol.toUpperCase();

  return {
    async run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal } = {}) {
      if (typeof model !== 'string' || !model.trim() || typeof policy !== 'string' || !policy.trim()) throw new Error('Vig-IA requiere modelo y política configurados.');
      if (!isRecord(input) || !isRecord(outputSchema)) throw new Error('Vig-IA requiere entrada y outputSchema cerrados.');
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('El timeout de Vig-IA no es válido.');
      if (signal?.aborted) throw transportError('La ejecución de Vig-IA fue cancelada.', 'AGT003_COPILOT_CANCELLED');

      const body = JSON.stringify({ model, policy, input, outputSchema, timeoutMs, idempotencyKey });
      const timestamp = String(now());
      const nonce = randomNonce();
      const canonical = buildCanonicalString({ method: 'POST', path: endpoint.pathname, bodySha256Hex: sha256Hex(body), timestamp, nonce });
      const controller = new AbortController();
      const callerAbort = () => controller.abort();
      signal?.addEventListener('abort', callerAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs + 2000);
      timer.unref?.();

      let response;
      try {
        response = await fetchImpl(endpoint.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [`X-${headerNamespace}-Timestamp`]: timestamp,
            [`X-${headerNamespace}-Nonce`]: nonce,
            [`X-${headerNamespace}-Signature`]: signCanonicalString(hmacSecret, canonical),
            'Idempotency-Key': idempotencyKey,
          },
          body,
          signal: controller.signal,
        });
      } catch {
        throw transportError('El servicio de Vig-IA no está disponible.', 'AGT003_COPILOT_TRANSPORT_ERROR');
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', callerAbort);
      }

      let payload;
      try { payload = await readBoundedJson(response); }
      catch (error) {
        if (error?.code === 'AGT003_COPILOT_INVALID_RESPONSE') throw error;
        throw transportError('La respuesta de Vig-IA no tiene una estructura segura.', 'AGT003_COPILOT_INVALID_RESPONSE');
      }
      if (!response.ok) throw transportError('El servicio de Vig-IA devolvió un error.', payload?.error?.code || 'AGT003_COPILOT_INTERNAL');
      if (typeof payload.content !== 'string'
        || !Number.isInteger(payload.usage?.input_tokens) || payload.usage.input_tokens < 0
        || !Number.isInteger(payload.usage?.output_tokens) || payload.usage.output_tokens < 0) {
        throw transportError('La respuesta de Vig-IA no tiene una estructura segura.', 'AGT003_COPILOT_INVALID_RESPONSE');
      }
      return { content: payload.content, usage: payload.usage, rate_limit: payload.rate_limit ?? null };
    },
  };
}
