export const AGT003_BRIDGE_TIMESTAMP_WINDOW_SECONDS = 30;
export const AGT003_BRIDGE_MIN_NONCE_BYTES = 16;

export function isTimestampWithinWindow(timestamp, nowSeconds, windowSeconds = AGT003_BRIDGE_TIMESTAMP_WINDOW_SECONDS) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  return Math.abs(nowSeconds - ts) <= windowSeconds;
}

/**
 * Almacén de nonces en memoria propio de AGT-003. Falla cerrado: un nonce
 * ausente, no textual, demasiado corto o ya visto nunca se consume, aunque la
 * firma que lo acompaña sea criptográficamente válida.
 */
export function createAgt003NonceStore({ ttlMs = 90_000 } = {}) {
  const seen = new Map();
  return {
    consume(nonce, nowMs = Date.now()) {
      for (const [key, expiresAt] of seen) if (expiresAt <= nowMs) seen.delete(key);
      if (typeof nonce !== 'string' || Buffer.byteLength(nonce, 'utf8') < AGT003_BRIDGE_MIN_NONCE_BYTES) return false;
      if (seen.has(nonce)) return false;
      seen.set(nonce, nowMs + ttlMs);
      return true;
    },
    size() {
      return seen.size;
    },
  };
}
