import { sha256Hex, buildCanonicalString, signCanonicalString, verifySignatureConstantTime } from './agt002-hetzner-bridge-signing.js';
import { isTimestampWithinWindow } from './agt002-hetzner-bridge-nonce-store.js';

const REQUIRED_HEADERS = ['x-agt002-timestamp', 'x-agt002-nonce', 'x-agt002-signature'];
const AUTH_INVALID = { ok: false, status: 401, code: 'AGT002_BRIDGE_AUTH_INVALID' };

export function authenticateBridgeRequest({ method, path, rawBody, headers, secret, nonceStore, now = () => Math.floor(Date.now() / 1000) }) {
  for (const header of REQUIRED_HEADERS) {
    if (typeof headers?.[header] !== 'string' || headers[header].length === 0) return AUTH_INVALID;
  }
  const timestamp = headers['x-agt002-timestamp'];
  const nonce = headers['x-agt002-nonce'];
  const signature = headers['x-agt002-signature'];

  if (!isTimestampWithinWindow(timestamp, now(), 30)) return AUTH_INVALID;

  const canonical = buildCanonicalString({ method: method.toUpperCase(), path, bodySha256Hex: sha256Hex(rawBody), timestamp, nonce });
  const expectedSignature = signCanonicalString(secret, canonical);
  if (!verifySignatureConstantTime(expectedSignature, signature)) return AUTH_INVALID;

  if (!nonceStore.consume(nonce, now() * 1000)) return AUTH_INVALID;

  return { ok: true };
}
