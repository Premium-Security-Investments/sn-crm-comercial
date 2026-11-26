import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorioCuentas, loginDirectorioActivo } from '../verticales/acceso/directorio-cuentas.js';
// El servidor exige estas variables al cargarse; VERCEL evita que abra un puerto. No se usa Supabase en estas pruebas.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
process.env.VERCEL ||= '1';
const { ensureProfileDirectoryAfterCommit } = await import('../server/index.js');

const PROJECT = 'security-ops-e8534';

/** Directorio de Google simulado: guarda cuentas en memoria y registra cada llamada. */
function fakeIdentity(initial = []) {
  const accounts = new Map(initial.map(a => [a.email, { localId: a.uid, email: a.email, disabled: Boolean(a.disabled) }]));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body, headers: init.headers });
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const path = url.split(`/projects/${PROJECT}/`)[1];
    const ok = payload => ({ ok: true, status: 200, json: async () => payload });
    if (path === 'accounts:lookup') {
      const found = body.email.map(e => accounts.get(e)).filter(Boolean);
      return ok(found.length ? { users: found } : {});
    }
    if (path === 'accounts') {
      if (accounts.has(body.email)) return { ok: false, status: 400, json: async () => ({ error: { message: 'EMAIL_EXISTS' } }) };
      const created = { localId: `uid-${accounts.size + 1}`, email: body.email, disabled: false };
      accounts.set(body.email, created);
      return ok({ localId: created.localId });
    }
    if (path === 'accounts:sendOobCode') return ok(body.returnOobLink ? { oobLink: 'https://enlace-de-clave' } : {});
    throw new Error(`ruta inesperada ${path}`);
  };
  return { fetchImpl, calls, accounts };
}

const directorioCon = fake => createDirectorioCuentas({ projectId: PROJECT, getToken: async () => 'tok', fetchImpl: fake.fetchImpl });
const req = { headers: { host: 'siio.sn.premiumsecurity.ai', 'x-forwarded-proto': 'https' } };

test('interruptor: apagado salvo «on»', () => {
  assert.equal(loginDirectorioActivo({}), false);
  assert.equal(loginDirectorioActivo({ SIIO_LOGIN_DIRECTORIO: 'true' }), false);
  assert.equal(loginDirectorioActivo({ SIIO_LOGIN_DIRECTORIO: ' ON ' }), true);
});

test('asegurar crea la cuenta cuando no existe, sin clave si no se da', async () => {
  const fake = fakeIdentity();
  const cuenta = await directorioCon(fake).asegurar({ email: 'Nuevo@SeguridadNacional.co', nombre: 'Persona Nueva' });
  assert.equal(cuenta.creada, true);
  assert.equal(cuenta.email, 'nuevo@seguridadnacional.co');
  const create = fake.calls.find(c => c.url.endsWith('/accounts'));
  assert.deepEqual(create.body, { email: 'nuevo@seguridadnacional.co', emailVerified: false, displayName: 'Persona Nueva' });
});

test('asegurar reconoce la cuenta existente y no la toca', async () => {
  const fake = fakeIdentity([{ uid: 'u-katherine', email: 'directora.licitaciones@seguridadnacional.co' }]);
  const cuenta = await directorioCon(fake).asegurar({ email: 'directora.licitaciones@seguridadnacional.co', nombre: 'Katherine', clave: 'no-debe-usarse' });
  assert.equal(cuenta.creada, false);
  assert.equal(cuenta.uid, 'u-katherine');
  assert.equal(fake.calls.some(c => c.url.endsWith('/accounts')), false, 'no crea ni reescribe la cuenta');
});

test('correo de clave va en español y vuelve al SIIO', async () => {
  const fake = fakeIdentity();
  await directorioCon(fake).enviarCorreoDeClave('a@b.co', 'https://siio.sn.premiumsecurity.ai');
  const call = fake.calls.at(-1);
  assert.equal(call.headers['X-Firebase-Locale'], 'es');
  assert.deepEqual(call.body, { requestType: 'PASSWORD_RESET', email: 'a@b.co', continueUrl: 'https://siio.sn.premiumsecurity.ai' });
});

test('correo inválido se rechaza antes de llamar a Google', async () => {
  const fake = fakeIdentity();
  await assert.rejects(directorioCon(fake).buscar('no-es-correo'), e => e.code === 'directorio_correo_invalido');
  assert.equal(fake.calls.length, 0);
});

test('alta en el SIIO: crea la cuenta y manda el correo de clave', async () => {
  const fake = fakeIdentity();
  const result = await ensureProfileDirectoryAfterCommit({ email: 'nuevo@seguridadnacional.co', nombre: 'Nuevo', active: true, sendInvite: true, req, directorio: directorioCon(fake) });
  assert.deepEqual(result, { invited: true, accessLink: null, authWarning: null });
  assert.ok(fake.accounts.has('nuevo@seguridadnacional.co'));
});

test('alta en el SIIO de alguien que ya tiene cuenta (p. ej. de SecurityOps): la reconoce, no crea otra', async () => {
  const fake = fakeIdentity([{ uid: 'u-hector', email: 'directoroperaciones@seguridadnacional.co' }]);
  const result = await ensureProfileDirectoryAfterCommit({ email: 'directoroperaciones@seguridadnacional.co', nombre: 'Héctor', active: true, sendInvite: true, req, directorio: directorioCon(fake) });
  assert.equal(result.invited, true);
  assert.equal(fake.accounts.size, 1);
});

test('cuenta cerrada en el directorio: avisa y no manda nada', async () => {
  const fake = fakeIdentity([{ uid: 'u-x', email: 'se.fue@seguridadnacional.co', disabled: true }]);
  const result = await ensureProfileDirectoryAfterCommit({ email: 'se.fue@seguridadnacional.co', active: true, sendInvite: true, req, directorio: directorioCon(fake) });
  assert.equal(result.invited, false);
  assert.match(result.authWarning, /cerrada en el directorio/);
  assert.equal(fake.calls.some(c => c.url.endsWith('accounts:sendOobCode')), false);
});

test('perfil inactivo o sin invitación ni clave: no toca el directorio', async () => {
  const fake = fakeIdentity();
  await ensureProfileDirectoryAfterCommit({ email: 'a@b.co', active: false, sendInvite: true, req, directorio: directorioCon(fake) });
  await ensureProfileDirectoryAfterCommit({ email: 'a@b.co', active: true, sendInvite: false, req, directorio: directorioCon(fake) });
  assert.equal(fake.calls.length, 0);
});

test('si el correo no sale, entrega el enlace para compartir a mano', async () => {
  const fake = fakeIdentity();
  const original = fake.fetchImpl;
  fake.fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url.endsWith('accounts:sendOobCode') && !body.returnOobLink) return { ok: false, status: 400, json: async () => ({ error: { message: 'QUOTA_EXCEEDED' } }) };
    return original(url, init);
  };
  const result = await ensureProfileDirectoryAfterCommit({ email: 'nuevo@seguridadnacional.co', active: true, sendInvite: true, req, directorio: directorioCon(fake) });
  assert.equal(result.invited, false);
  assert.equal(result.accessLink, 'https://enlace-de-clave');
});
