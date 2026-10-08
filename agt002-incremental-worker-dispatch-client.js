import { randomUUID } from 'node:crypto';
import { buildCanonicalString, sha256Hex, signCanonicalString } from './agt002-hetzner-bridge-signing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createAgt002IncrementalWorkerDispatchClient({
  url,
  hmacSecret,
  fetchImpl = fetch,
  randomNonce = randomUUID,
  now = () => Math.floor(Date.now() / 1000),
  timeoutMs = 5_000,
} = {}) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('El despacho incremental requiere una URL.');
  if (typeof hmacSecret !== 'string' || hmacSecret.length < 32) throw new Error('El despacho incremental requiere un secreto HMAC.');
  const path = new URL(url).pathname;
  return Object.freeze({
    async wake({ jobId }) {
      if (typeof jobId !== 'string' || !UUID.test(jobId)) throw new Error('El job incremental objetivo no es un UUID válido.');
      const body = JSON.stringify({ job_id: jobId });
      const timestamp = String(now());
      const nonce = randomNonce();
      const signature = signCanonicalString(hmacSecret, buildCanonicalString({
        method: 'POST', path, bodySha256Hex: sha256Hex(body), timestamp, nonce,
      }));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      timer.unref?.();
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-AGT002-Timestamp': timestamp,
            'X-AGT002-Nonce': nonce,
            'X-AGT002-Signature': signature,
          },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 409) return { status: 'busy' };
      if (response.status !== 202) throw new Error('El host no aceptó el despertar incremental.');
      return { status: 'accepted' };
    },
  });
}
