// Revisión previa retirada: POST /api/vigia/copilot/preflight responde 410 sin llamar al puente ni reservar cupo.
// También cubre GET /api/platform/model-usage: sólo administración de usuarios y 503 neutro sin plataforma.
// Rutas reales de server/index.js y api/[...path].js contra un Supabase falso.
import assert from 'node:assert/strict';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const BRIDGE_HOST = 'agents.bridge.example.test';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
function request(port, path, token, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { let parsed = null; try { parsed = JSON.parse(text); } catch { /* */ } resolve({ status: response.statusCode, body: parsed }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const actors = {
  'comercial-token': {
    user: { id: 'comercial-auth', email: 'comercial@example.test' },
    profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', full_name: 'Comercial', microsoft_email: 'comercial@example.test', auth_user_id: 'comercial-auth', role: 'comercial', active: true, identity_type: 'human' },
    permissions: [{ permission_code: 'modulo_vig_ia' }, { permission_code: 'modulo_oportunidades' }, { permission_code: 'vigia_copilot_pilot' }],
  },
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Admin', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true, identity_type: 'human' },
    permissions: [{ permission_code: 'modulo_usuarios' }],
  },
};
const byAuth = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const byProfile = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));
const eq = (url, name) => (url.searchParams.has(name) ? String(url.searchParams.get(name)).replace(/^eq\./, '') : null);

const observed = { rpc: [], other: [] };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const actor = byAuth.get(eq(url, 'auth_user_id'));
    return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, byProfile.get(eq(url, 'profile_id'))?.permissions || []);
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    observed.rpc.push(url.pathname);
    return json(res, 200, null);
  }
  observed.other.push(url.pathname);
  return json(res, 500, { message: 'unexpected' });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'PLATFORM_DATABASE_URL', 'AGT003_COPILOT_ENGINE', 'AGT003_COPILOT_MODEL', 'AGT003_COPILOT_BRIDGE_URL', 'AGT003_COPILOT_HMAC_SECRET'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
delete process.env.PLATFORM_DATABASE_URL;
// El puente está "configurado": si la ruta lo llamara, el espía de fetch lo vería.
process.env.AGT003_COPILOT_ENGINE = 'agt003_bridge_preview';
process.env.AGT003_COPILOT_MODEL = 'synthetic-model';
process.env.AGT003_COPILOT_BRIDGE_URL = `https://${BRIDGE_HOST}/v1/agt003-copilot/run`;
process.env.AGT003_COPILOT_HMAC_SECRET = 's'.repeat(32);

const originalFetch = globalThis.fetch;
const bridgeCalls = [];
globalThis.fetch = (input, init) => {
  const target = String(input?.url || input);
  if (target.includes(BRIDGE_HOST)) { bridgeCalls.push(target); return Promise.reject(new Error('bridge must not be called')); }
  return originalFetch(input, init);
};

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
try {
  console.error = () => {};
  console.warn = () => {};
  for (const [index, module] of [await import('../server/index.js'), await import('../api/[...path].js')].entries()) {
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      observed.rpc.length = 0;
      observed.other.length = 0;

      const anonymous = await request(port, '/api/vigia/copilot/preflight', null, 'POST', { opportunity_id: OPPORTUNITY_ID });
      assert.equal(anonymous.status, 401, `backend ${index}: sin sesión sigue siendo 401`);

      const retired = await request(port, '/api/vigia/copilot/preflight', 'comercial-token', 'POST', { opportunity_id: OPPORTUNITY_ID });
      assert.equal(retired.status, 410, `backend ${index}: preflight retirado responde 410`);
      assert.deepEqual(retired.body, { error: 'La revisión previa de Vig-IA está retirada.' });
      assert.deepEqual(bridgeCalls, [], `backend ${index}: no se llama al puente`);
      assert.deepEqual(observed.rpc.filter(path => /claim|agt003/i.test(path)), [], `backend ${index}: no reserva cupo`);
      assert.deepEqual(observed.other, [], `backend ${index}: no lee oportunidades ni contexto`);

      const wrongMethod = await request(port, '/api/vigia/copilot/preflight', 'comercial-token', 'GET');
      assert.equal(wrongMethod.status, 405);

      const forbidden = await request(port, '/api/platform/model-usage', 'comercial-token');
      assert.equal(forbidden.status, 403, `backend ${index}: un comercial no ve Uso de IA`);
      const unavailable = await request(port, '/api/platform/model-usage', 'admin-token');
      assert.equal(unavailable.status, 503, `backend ${index}: sin plataforma → 503`);
      assert.deepEqual(unavailable.body, { error: 'La plataforma de agentes no está conectada.' });
      const usageWrongMethod = await request(port, '/api/platform/model-usage', 'admin-token', 'POST', {});
      assert.equal(usageWrongMethod.status, 405);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
  console.log('AGT-003 preflight retired (410) and model-usage HTTP contract passed');
} finally {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await new Promise(resolve => fakeSupabase.close(resolve));
}
