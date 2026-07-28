import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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
