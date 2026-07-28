export function isTimestampWithinWindow(timestamp, nowSeconds, windowSeconds = 30) {
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return false;
  return Math.abs(nowSeconds - ts) <= windowSeconds;
}

export function createNonceStore({ ttlMs = 90_000 } = {}) {
  const seen = new Map();
  return {
    consume(nonce, nowMs = Date.now()) {
      for (const [key, expiresAt] of seen) if (expiresAt <= nowMs) seen.delete(key);
      if (typeof nonce !== 'string' || Buffer.byteLength(nonce, 'utf8') < 16) return false;
      if (seen.has(nonce)) return false;
      seen.set(nonce, nowMs + ttlMs);
      return true;
    },
    size() {
      return seen.size;
    },
  };
}
