import { randomUUID } from 'node:crypto';
import { sha256Hex, buildCanonicalString, signCanonicalString } from './agt002-hetzner-bridge-signing.js';

function transportError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MAX_RESPONSE_BYTES = 262_144;

/**
 * Reads and JSON-parses the bridge response bounded to MAX_RESPONSE_BYTES,
 * regardless of whether the server sent a (possibly forged) Content-Length —
 * the byte count is enforced against the actual stream, not the header.
 * Falls back to response.json() for fakes that don't expose a readable body
 * (existing tests), since those never stream untrusted bytes anyway.
 */
async function readBoundedJson(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    return response.json();
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* best effort */ }
  }
  return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
}

export function createAgt002HetznerBridgeClient({ url, hmacSecret, fetchImpl = fetch, randomNonce = () => randomUUID(), now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('El puente AGT-002 requiere una URL configurada.');
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El puente AGT-002 requiere un secreto HMAC de al menos 32 bytes.');
  const path = new URL(url).pathname;

  return {
    async run({ model, policy, input, outputSchema, timeoutMs = 30_000, idempotencyKey = randomUUID(), signal } = {}) {
      if (typeof model !== 'string' || !model.trim()) throw new Error('AGT-002 Preview requiere un modelo configurado.');
      if (typeof policy !== 'string' || !policy.trim()) throw new Error('AGT-002 Preview requiere una política (baseInstructions) configurada.');
      if (!isPlainObject(input)) throw new Error('AGT-002 Preview requiere una entrada cerrada.');
      if (!isPlainObject(outputSchema)) throw new Error('AGT-002 Preview requiere un outputSchema cerrado.');
      if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('El timeout de AGT-002 Preview no es válido.');
      if (signal?.aborted) throw transportError('La ejecución de AGT-002 Preview fue cancelada.', 'AGT002_CODEX_CANCELLED');

      const body = JSON.stringify({ model, policy, input, outputSchema, timeoutMs, idempotencyKey });
      const timestamp = String(now());
      const nonce = randomNonce();
      const canonical = buildCanonicalString({ method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce });
      const signature = signCanonicalString(hmacSecret, canonical);

      const controller = new AbortController();
      const onCallerAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
      const marginTimer = setTimeout(() => controller.abort(), timeoutMs + 2_000);
      marginTimer.unref?.();

      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AGT002-Timestamp': timestamp,
            'X-AGT002-Nonce': nonce,
            'X-AGT002-Signature': signature,
            'Idempotency-Key': idempotencyKey,
          },
          body,
          signal: controller.signal,
        });
      } catch {
        throw transportError('El servicio de AGT-002 Preview no está disponible.', 'AGT002_CODEX_TRANSPORT_ERROR');
      } finally {
        clearTimeout(marginTimer);
        if (signal) signal.removeEventListener('abort', onCallerAbort);
      }

      let payload;
      try { payload = await readBoundedJson(response, MAX_RESPONSE_BYTES); }
      catch (error) {
        if (error?.code === 'AGT002_CODEX_INVALID_RESPONSE') throw error;
        throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
      }

      if (!response.ok) {
        throw transportError('El servicio de AGT-002 Preview devolvió un error.', payload?.error?.code || 'AGT002_BRIDGE_INTERNAL');
      }
      if (typeof payload.content !== 'string'
        || !Number.isInteger(payload.usage?.input_tokens) || payload.usage.input_tokens < 0
        || !Number.isInteger(payload.usage?.output_tokens) || payload.usage.output_tokens < 0) {
        throw transportError('La respuesta de AGT-002 Preview no tiene una estructura segura.', 'AGT002_CODEX_INVALID_RESPONSE');
      }
      return { content: payload.content, usage: payload.usage, rate_limit: payload.rate_limit ?? null };
    },
  };
}
