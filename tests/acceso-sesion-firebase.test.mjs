import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  firebaseLoginProjectId,
  isFirebaseIdTokenFor,
  verifyFirebaseIdToken,
  createFirebaseCertsSource,
  FIREBASE_CERTS_URL,
} from '../verticales/acceso/sesion-firebase.js';

const PROJECT = 'security-ops-e8534';
const NOW = 1_800_000_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
// Firebase publica certificados X.509; para la prueba basta la clave pública en PEM (createPublicKey acepta ambos).
const PEM = publicKey.export({ type: 'spki', format: 'pem' });
const getCerts = async () => ({ k1: PEM });

const b64u = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function sign(payload, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) {
  const head = b64u({ alg, kid, typ: 'JWT' });
  const body = b64u(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(key).toString('base64url')}`;
}

const valid = (over = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: 'uid-123',
  email: 'Directora.Licitaciones@SeguridadNacional.co',
  iat: NOW - 60,
  auth_time: NOW - 60,
  exp: NOW + 3000,
  ...over,
});

const verify = (token, opts = {}) => verifyFirebaseIdToken(token, { projectId: PROJECT, getCerts, nowSeconds: () => NOW, ...opts });

test('apagado por defecto: sin variable no hay proyecto', () => {
  assert.equal(firebaseLoginProjectId({}), null);
  assert.equal(firebaseLoginProjectId({ SIIO_FIREBASE_LOGIN_PROJECT: '  ' }), null);
  assert.equal(firebaseLoginProjectId({ SIIO_FIREBASE_LOGIN_PROJECT: 'Bad Project!' }), null);
  assert.equal(firebaseLoginProjectId({ SIIO_FIREBASE_LOGIN_PROJECT: PROJECT }), PROJECT);
});

test('distingue un token de Firebase del proyecto de uno de Supabase', () => {
  assert.equal(isFirebaseIdTokenFor(sign(valid()), PROJECT), true);
  assert.equal(isFirebaseIdTokenFor(sign(valid({ iss: 'https://tyfzjqzcpgwcjnxozaaf.supabase.co/auth/v1' })), PROJECT), false);
  assert.equal(isFirebaseIdTokenFor(sign(valid({ iss: 'https://securetoken.google.com/otro-proyecto' })), PROJECT), false);
  assert.equal(isFirebaseIdTokenFor('no-es-un-jwt', PROJECT), false);
  assert.equal(isFirebaseIdTokenFor(sign(valid()), null), false);
});

test('acepta un token válido y normaliza el correo', async () => {
  const result = await verify(sign(valid()));
  assert.equal(result.uid, 'uid-123');
  assert.equal(result.email, 'directora.licitaciones@seguridadnacional.co');
});

const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('rechaza firma de otra clave', () => rejects(verify(sign(valid(), { key: other.privateKey })), 'firebase_token_signature'));
test('rechaza kid desconocido', () => rejects(verify(sign(valid(), { kid: 'k9' })), 'firebase_token_unknown_kid'));
test('rechaza algoritmo distinto de RS256', () => rejects(verify(sign(valid(), { alg: 'HS256' })), 'firebase_token_header'));
test('rechaza otra audiencia', () => rejects(verify(sign(valid({ aud: 'otro-proyecto' }))), 'firebase_token_audience'));
test('rechaza otro emisor', () => rejects(verify(sign(valid({ iss: 'https://securetoken.google.com/otro' }))), 'firebase_token_issuer'));
test('rechaza token vencido', () => rejects(verify(sign(valid({ exp: NOW - 1 }))), 'firebase_token_expired'));
test('rechaza emitido en el futuro', () => rejects(verify(sign(valid({ iat: NOW + 3600 }))), 'firebase_token_issued_in_future'));
test('rechaza sin sujeto', () => rejects(verify(sign(valid({ sub: '' }))), 'firebase_token_subject'));
test('rechaza sin correo', () => rejects(verify(sign(valid({ email: undefined }))), 'firebase_token_email'));
test('rechaza token mal formado', () => rejects(verify('a.b'), 'firebase_token_malformed'));
test('rechaza payload alterado', async () => {
  const [h, , s] = sign(valid()).split('.');
  await rejects(verify(`${h}.${b64u(valid({ email: 'juanbotero@premiumsecurity.ai' }))}.${s}`), 'firebase_token_signature');
});

test('certificados: se piden a Google y se guardan según cache-control', async () => {
  let calls = 0;
  let clock = 0;
  const source = createFirebaseCertsSource({
    now: () => clock,
    fetchImpl: async url => {
      calls += 1;
      assert.equal(url, FIREBASE_CERTS_URL);
      return { ok: true, json: async () => ({ k1: PEM }), headers: { get: () => 'public, max-age=100' } };
    },
  });
  await source();
  await source();
  assert.equal(calls, 1);
  clock = 101_000;
  await source();
  assert.equal(calls, 2);
});

test('getAuthContext: el camino de Firebase solo existe con la variable y cruza por microsoft_email', async () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /firebaseLoginProjectId\(process\.env\)/);
    assert.match(source, /viaFirebase \? profileQuery\.eq\('microsoft_email', userData\.user\.email\) : profileQuery\.eq\('auth_user_id', userData\.user\.id\)/);
  }
});

