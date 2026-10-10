import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';
process.env.VERCEL = '1';

const { requireSiioEndpointAccess } = await import('../server/index.js');
const profile = role => ({ id: `${role}-profile`, role, active: true, identity_type: 'human', areas: [], permissions: ['modulo_siio_gerencial'] });

test('el historial financiero es legible por gerencia y consulta', () => {
  assert.equal(requireSiioEndpointAccess(profile('admin'), 'GET /api/siio/financial-imports'), true);
  assert.equal(requireSiioEndpointAccess(profile('gerencia'), 'GET /api/siio/financial-imports'), true);
  assert.equal(requireSiioEndpointAccess(profile('consulta'), 'GET /api/siio/financial-imports'), true);
  assert.throws(() => requireSiioEndpointAccess(profile('junta'), 'GET /api/siio/financial-imports'), error => error?.status === 403);
});

test('sólo admin y gerencia pueden cargar y publicar cortes', () => {
  for (const role of ['admin', 'gerencia']) {
    assert.equal(requireSiioEndpointAccess(profile(role), 'POST /api/siio/financial-imports/process-upload'), true);
    assert.equal(requireSiioEndpointAccess(profile(role), 'POST /api/siio/financial-imports/:id/validate'), true);
    assert.equal(requireSiioEndpointAccess(profile(role), 'POST /api/siio/financial-imports/:id/publish'), true);
  }
  for (const role of ['consulta', 'junta', 'director', 'comercial']) {
    assert.throws(() => requireSiioEndpointAccess(profile(role), 'POST /api/siio/financial-imports/process-upload'), error => error?.status === 403);
    assert.throws(() => requireSiioEndpointAccess(profile(role), 'POST /api/siio/financial-imports/:id/validate'), error => error?.status === 403);
  }
});
