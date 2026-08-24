import { sha256Hex, buildCanonicalString, signCanonicalString, verifySignatureConstantTime } from './agt003-claude-bridge-signing.js';
import { isTimestampWithinWindow, AGT003_BRIDGE_TIMESTAMP_WINDOW_SECONDS } from './agt003-claude-bridge-nonce-store.js';

/**
 * Cabeceras propias del puente dedicado. El espacio de nombres no se comparte
 * con ningún otro transporte: una petición firmada con las cabeceras de otro
 * puente no se autentica aquí, aunque su firma sea válida sobre el mismo string
 * canónico, porque este verificador sólo mira `x-agt003-*`.
 */
const REQUIRED_HEADERS = ['x-agt003-timestamp', 'x-agt003-nonce', 'x-agt003-signature'];
const AUTH_INVALID = { ok: false, status: 401, code: 'AGT003_BRIDGE_AUTH_INVALID' };

export function authenticateAgt003BridgeRequest({ method, path, rawBody, headers, secret, nonceStore, now = () => Math.floor(Date.now() / 1000) }) {
  for (const header of REQUIRED_HEADERS) {
    if (typeof headers?.[header] !== 'string' || headers[header].length === 0) return AUTH_INVALID;
  }
  const timestamp = headers['x-agt003-timestamp'];
  const nonce = headers['x-agt003-nonce'];
  const signature = headers['x-agt003-signature'];

  if (!isTimestampWithinWindow(timestamp, now(), AGT003_BRIDGE_TIMESTAMP_WINDOW_SECONDS)) return AUTH_INVALID;

  // La ruta forma parte del string canónico: una firma emitida para otra ruta
  // nunca puede reutilizarse contra la ruta dedicada de AGT-003.
  const canonical = buildCanonicalString({ method: String(method).toUpperCase(), path, bodySha256Hex: sha256Hex(rawBody), timestamp, nonce });
  if (!verifySignatureConstantTime(signCanonicalString(secret, canonical), signature)) return AUTH_INVALID;

  // El nonce se consume al final y sólo tras verificar la firma, para no
  // quemar nonces legítimos con peticiones falsificadas.
  if (!nonceStore.consume(nonce, now() * 1000)) return AUTH_INVALID;

  return { ok: true };
}
