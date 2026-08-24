import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Formato canónico dedicado del puente AGT-003. Es deliberadamente idéntico,
 * byte a byte, al que ya firma el cliente de Vercel: si divergieran, ninguna
 * petición legítima podría autenticarse.
 *
 * Lo que NO se comparte es el espacio de nombres de cabeceras ni la ruta: ambos
 * viajan dentro del string canónico, de modo que cada firma queda atada a este
 * puente y a su ruta dedicada y no puede reutilizarse contra otro transporte.
 */
export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function buildCanonicalString({ method, path, bodySha256Hex, timestamp, nonce }) {
  return `${method}\n${path}\n${bodySha256Hex}\n${timestamp}\n${nonce}`;
}

export function signCanonicalString(secret, canonical) {
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

export function verifySignatureConstantTime(expectedHex, providedHex) {
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  const provided = Buffer.from(String(providedHex || ''), 'hex');
  if (expected.length === 0 || expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
