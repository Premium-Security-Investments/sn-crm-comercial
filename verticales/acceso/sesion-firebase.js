// Inicio de sesión común (decisión de Juan, 25-nov-2026, opción A): el directorio de personas es el de SecurityOps
// (Firebase Auth del proyecto security-ops-e8534) y el SIIO acepta esa sesión además de la suya. Este módulo solo
// verifica el token de identidad de Firebase; los permisos siguen en el SIIO (psi_sales_profiles y sus tablas).
//
// Apagado por defecto: si SIIO_FIREBASE_LOGIN_PROJECT no está definida, el SIIO no acepta tokens de Firebase.
// La verificación sigue la guía de Firebase para tokens de identidad de terceros: RS256, `kid` entre los certificados
// públicos de Google, `aud` = proyecto, `iss` = https://securetoken.google.com/<proyecto>, `exp` futuro, `iat` y
// `auth_time` pasados, `sub` no vacío. Sin dependencias nuevas: node:crypto.
import { createPublicKey, createVerify } from 'node:crypto';

export const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_SECONDS = 300;
const DEFAULT_CERTS_TTL_MS = 60 * 60 * 1000;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function firebaseLoginProjectId(environment = process.env) {
  const value = typeof environment?.SIIO_FIREBASE_LOGIN_PROJECT === 'string' ? environment.SIIO_FIREBASE_LOGIN_PROJECT.trim() : '';
  return PROJECT_ID_PATTERN.test(value) ? value : null;
}

function base64UrlToBuffer(segment) {
  return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment(segment) {
  return JSON.parse(base64UrlToBuffer(segment).toString('utf8'));
}

function splitToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  return parts;
}

/** Lectura SIN verificar, solo para decidir qué verificador usar. Nunca se confía en su contenido. */
export function isFirebaseIdTokenFor(token, projectId) {
  const parts = splitToken(token);
  if (!parts || !projectId) return false;
  try {
    return decodeSegment(parts[1])?.iss === `https://securetoken.google.com/${projectId}`;
  } catch {
    return false;
  }
}

export function createFirebaseCertsSource({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  let cached = null;
  let expiresAt = 0;
  return async function getCerts() {
    if (cached && now() < expiresAt) return cached;
    const response = await fetchImpl(FIREBASE_CERTS_URL);
    if (!response.ok) throw new Error(`firebase_certs_http_${response.status}`);
    const certs = await response.json();
    if (!certs || typeof certs !== 'object') throw new Error('firebase_certs_invalid');
    const maxAge = /max-age=(\d+)/.exec(response.headers?.get?.('cache-control') || '');
    cached = certs;
    expiresAt = now() + (maxAge ? Number(maxAge[1]) * 1000 : DEFAULT_CERTS_TTL_MS);
    return cached;
  };
}

const defaultCertsSource = createFirebaseCertsSource();

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export async function verifyFirebaseIdToken(token, { projectId, getCerts = defaultCertsSource, nowSeconds = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!projectId) reject('firebase_project_missing');
  const parts = splitToken(token);
  if (!parts) reject('firebase_token_malformed');
  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    reject('firebase_token_malformed');
  }
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string') reject('firebase_token_header');
  const certs = await getCerts();
  const pem = certs[header.kid];
  if (typeof pem !== 'string') reject('firebase_token_unknown_kid');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(createPublicKey(pem), base64UrlToBuffer(parts[2]))) reject('firebase_token_signature');
  const now = nowSeconds();
  if (payload.aud !== projectId) reject('firebase_token_audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) reject('firebase_token_issuer');
  if (!Number.isFinite(payload.exp) || payload.exp <= now) reject('firebase_token_expired');
  if (!Number.isFinite(payload.iat) || payload.iat > now + CLOCK_SKEW_SECONDS) reject('firebase_token_issued_in_future');
  if (!Number.isFinite(payload.auth_time) || payload.auth_time > now + CLOCK_SKEW_SECONDS) reject('firebase_token_auth_time');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) reject('firebase_token_subject');
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) reject('firebase_token_email');
  return { uid: payload.sub, email, claims: payload };
}
