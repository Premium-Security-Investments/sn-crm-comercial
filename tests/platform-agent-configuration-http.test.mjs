// IT → Agentes → funciones, modelos y cupos: contrato HTTP mínimo con dobles (Supabase falso para la sesión y
// pools falsos de la plataforma; sin base real). Se ejercitan las rutas reales de server/index.js y api/[...path].js.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { __setPlatformConfigurationPoolsForTests, defaultAgentConfiguration } from '../platform-agent-configuration.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SALES_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';
const COPILOT = 'agt003.opportunity-copilot.preview';

const actors = {
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: ADMIN_ID, full_name: 'Juan Botero', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true },
    permissions: [{ permission_code: 'modulo_usuarios' }],
  },
  'sales-token': {
    user: { id: 'sales-auth', email: 'ventas@example.test' },
    profile: { id: SALES_ID, full_name: 'Ventas', microsoft_email: 'ventas@example.test', auth_user_id: 'sales-auth', role: 'comercial', active: true },
    permissions: [{ permission_code: 'modulo_usuarios' }, { permission_code: 'modulo_oportunidades' }],
  },
};
const byAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const byProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function eqParam(url, name) { const raw = url.searchParams.get(name); return raw && raw.startsWith('eq.') ? raw.slice(3) : null; }
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = eqParam(url, 'auth_user_id');
    if (authUserId !== null) {
      const actor = byAuthId.get(authUserId);
      return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
    }
    return json(res, 200, [
      { id: ADMIN_ID, full_name: 'Juan Botero', active: true, identity_type: 'human' },
      { id: PERSON_ID, full_name: 'Ana Pérez', active: true, identity_type: 'human' },
      { id: '44444444-4444-4444-8444-444444444444', full_name: 'Vig-IA Comercial', active: true, identity_type: 'agent' },
    ]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, byProfileId.get(eqParam(url, 'profile_id'))?.permissions || []);
  return json(res, 404, { message: 'not found' });
});

function request(port, path, token, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
    } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { let parsed = null; try { parsed = JSON.parse(text); } catch { /* sin JSON */ } resolve({ status: response.statusCode, body: parsed }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Plataforma falsa: v1 vigente, v2 pendiente, v3 aprobada no vigente, v4 rechazada; perfiles comercial y viejo (archivado).
function platformState() {
  const base = defaultAgentConfiguration('AGT-003');
  const version = (id, number, extra) => ({ configuration_version_id: String(id), agent_id: 'AGT-003', environment: 'production', version_number: number, configuration: base, created_at: '2026-10-09T10:00:00Z', proposed_by: 'Juan Botero', proposal_reason: 'motivo', proposed_at: '2026-10-09T10:00:00Z', is_current: false, ...extra });
  return {
    versions: [
      version(4, 4, { rejected_by: 'Juan Botero', rejected_at: '2026-10-09T13:00:00Z', rejection_reason: 'no' }),
      version(3, 3, { approved_by: 'Juan Botero', approved_at: '2026-10-09T12:00:00Z' }),
      version(2, 2, {}),
      version(1, 1, { approved_by: 'Juan Botero', approved_at: '2026-10-09T11:00:00Z', is_current: true }),
    ],
    profiles: [{ profile_id: 'comercial', display_name: 'Comercial' }, { profile_id: 'viejo', display_name: 'Viejo', archived_at: '2026-10-01T00:00:00Z' }],
  };
}
function fakeReader(state) {
  return { async connect() { return { async query(sql) {
    if (sql.includes('from platform.agent_configuration_version')) return { rows: state.versions };
    if (sql.includes('from platform.ai_usage_profile')) return { rows: state.profiles };
    return { rows: [] };
  }, release() {} }; } };
}
function fakeAdmin({ failOn } = {}) {
  const calls = [];
  return { calls, async connect() { return { async query(sql, params) {
    if (sql.startsWith('select platform.')) {
      calls.push({ sql, params });
      if (failOn && sql.includes(failOn)) throw Object.assign(new Error('duplicate key value violates unique constraint at db.internal'), { code: '23505' });
      return { rows: [{ result: sql.includes('propose_configuration') ? '5' : sql.includes('create_ai_usage_profile') ? params[0] : sql.includes('approve') || sql.includes('reactivate') ? params[0] : null }] };
    }
    return { rows: [] };
  }, release() {} }; } };
}

function proposalBody(overrides = {}) {
  const configuration = defaultAgentConfiguration('AGT-003');
  configuration.capabilities[COPILOT].team_cap.max = 30;
  configuration.capabilities[COPILOT].profile_caps = { comercial: { per: 'day', max: 5 } };
  configuration.capabilities[COPILOT].exceptions = [{ person: PERSON_ID, extra: 10, per: 'day', expires: '2099-12-31' }];
  return { agent_id: 'AGT-003', configuration, reason: 'Más demanda en cierre de mes', proposed_by: 'Alguien Falso', ...overrides };
}

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV', 'PLATFORM_ADMIN_DATABASE_URL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
delete process.env.PLATFORM_ADMIN_DATABASE_URL;

const quiet = { error: console.error, warn: console.warn };
console.error = () => {};
console.warn = () => {};
const modules = [await import('../server/index.js'), await import('../api/[...path].js')];

test.after(() => {
  __setPlatformConfigurationPoolsForTests(null);
  fakeSupabase.close();
  console.error = quiet.error;
  console.warn = quiet.warn;
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

for (const [index, module] of modules.entries()) {
  test(`backend ${index}: rutas de configuración de agentes`, async () => {
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      const state = platformState();
      // Sin sesión / sin permiso de administrar usuarios.
      __setPlatformConfigurationPoolsForTests({ reader: fakeReader(state), admin: fakeAdmin() });
      assert.equal((await request(port, '/api/platform/agent-configuration', null)).status, 401);
      assert.equal((await request(port, '/api/platform/agent-configuration', 'sales-token')).status, 403);
      assert.equal((await request(port, '/api/platform/agent-configuration/proposals', 'sales-token', 'POST', proposalBody())).status, 403);
      assert.equal((await request(port, '/api/platform/ai-usage-profiles', 'sales-token', 'POST', { profile_id: 'x_y', display_name: 'XY' })).status, 403);

      // Lectura.
      const read = await request(port, '/api/platform/agent-configuration', 'admin-token');
      assert.equal(read.status, 200);
      assert.equal(read.body.environment, 'production');
      assert.equal(read.body.pending_count, 1);
      assert.equal(read.body.current['AGT-003'], '1');
      assert.deepEqual(read.body.versions.map(version => version.status), ['rechazada', 'aprobada', 'pendiente', 'vigente']);
      assert.deepEqual(read.body.people.map(person => person.full_name), ['Juan Botero', 'Ana Pérez'], 'sin identidades de agentes');
      assert.equal(read.body.admin_connected, true);

      // Proponer: firma el perfil autenticado, nunca el cuerpo.
      let admin = fakeAdmin();
      __setPlatformConfigurationPoolsForTests({ reader: fakeReader(state), admin });
      const proposed = await request(port, '/api/platform/agent-configuration/proposals', 'admin-token', 'POST', proposalBody());
      assert.equal(proposed.status, 201);
      assert.deepEqual(proposed.body, { ok: true, version_id: '5' });
      assert.equal(admin.calls.length, 1);
      assert.match(admin.calls[0].sql, /^select platform\.propose_configuration\(/);
      assert.equal(admin.calls[0].params[0], 'AGT-003');
      assert.equal(admin.calls[0].params[1], 'production');
      assert.equal(JSON.parse(admin.calls[0].params[2]).capabilities[COPILOT].team_cap.max, 30);
      assert.equal(admin.calls[0].params[3], 'Juan Botero');
      assert.equal(admin.calls[0].params[4], 'Más demanda en cierre de mes');

      // Validaciones en servidor.
      const badCap = proposalBody(); badCap.configuration.capabilities[COPILOT].team_cap.max = 5000;
      const badProfile = proposalBody(); badProfile.configuration.capabilities[COPILOT].profile_caps = { viejo: { per: 'day', max: 1 } };
      const badPerson = proposalBody(); badPerson.configuration.capabilities[COPILOT].exceptions[0].person = '44444444-4444-4444-8444-444444444444';
      const pastDate = proposalBody(); pastDate.configuration.capabilities[COPILOT].exceptions[0].expires = '2020-01-01';
      const badModel = proposalBody(); badModel.configuration.capabilities[COPILOT].model = 'opus';
      for (const [body, pattern] of [[badCap, /cupo del equipo/], [badProfile, /archivado/], [badPerson, /persona activa/], [pastDate, /pasado/], [badModel, /modelo/], [proposalBody({ reason: '' }), /motivo/], [proposalBody({ agent_id: 'AGT-002' }), /no tiene funciones/]]) {
        const response = await request(port, '/api/platform/agent-configuration/proposals', 'admin-token', 'POST', body);
        assert.equal(response.status, 400, String(pattern));
        assert.match(response.body.error, pattern);
      }
      assert.equal(admin.calls.length, 1, 'nada inválido llega a la plataforma');

      // Aprobar, rechazar, volver.
      admin = fakeAdmin();
      __setPlatformConfigurationPoolsForTests({ reader: fakeReader(state), admin });
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/2/approve', 'admin-token', 'POST', { approved_by: 'Falso' })).status, 200);
      assert.deepEqual(admin.calls.at(-1).params, ['2', 'Juan Botero']);
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/3/approve', 'admin-token', 'POST', {})).status, 409, 'una aprobada no se vuelve a aprobar');
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/2/reject', 'admin-token', 'POST', {})).status, 400, 'rechazar exige motivo');
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/2/reject', 'admin-token', 'POST', { reason: 'No ahora' })).status, 200);
      assert.deepEqual(admin.calls.at(-1).params, ['2', 'Juan Botero', 'No ahora']);
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/3/reactivate', 'admin-token', 'POST', {})).status, 200);
      assert.match(admin.calls.at(-1).sql, /reactivate_configuration/);
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/1/reactivate', 'admin-token', 'POST', {})).status, 409, 'la vigente no se reactiva');
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/4/reactivate', 'admin-token', 'POST', {})).status, 409, 'una rechazada no se reactiva');
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/99/approve', 'admin-token', 'POST', {})).status, 404);
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/abc/approve', 'admin-token', 'POST', {})).status, 400);
      assert.equal((await request(port, '/api/platform/agent-configuration/versions/2/borrar', 'admin-token', 'POST', {})).status, 404);
      assert.equal(admin.calls.length, 3);

      // Perfiles.
      const created = await request(port, '/api/platform/ai-usage-profiles', 'admin-token', 'POST', { profile_id: 'gerencia_comercial', display_name: 'Gerencia comercial', description: '', created_by: 'Falso' });
      assert.equal(created.status, 201);
      assert.deepEqual(admin.calls.at(-1).params, ['gerencia_comercial', 'Gerencia comercial', '', 'Juan Botero']);
      assert.equal((await request(port, '/api/platform/ai-usage-profiles', 'admin-token', 'POST', { profile_id: 'Mal Id', display_name: 'X' })).status, 400);
      assert.equal((await request(port, '/api/platform/ai-usage-profiles/comercial/archive', 'admin-token', 'POST', {})).status, 200);
      assert.deepEqual(admin.calls.at(-1).params, ['comercial', 'Juan Botero']);

      // Errores de la base → mensaje neutro; sin conexión de administración → 503.
      __setPlatformConfigurationPoolsForTests({ reader: fakeReader(state), admin: fakeAdmin({ failOn: 'create_ai_usage_profile' }) });
      const duplicate = await request(port, '/api/platform/ai-usage-profiles', 'admin-token', 'POST', { profile_id: 'comercial', display_name: 'Comercial' });
      assert.equal(duplicate.status, 409);
      assert.doesNotMatch(duplicate.body.error, /duplicate|db\.internal|constraint/);
      __setPlatformConfigurationPoolsForTests({ reader: fakeReader(state), admin: null });
      const offline = await request(port, '/api/platform/agent-configuration/versions/2/approve', 'admin-token', 'POST', {});
      assert.equal(offline.status, 503);
      assert.equal(offline.body.error, 'La administración de la plataforma no está conectada.');
      assert.equal((await request(port, '/api/platform/agent-configuration', 'admin-token')).body.admin_connected, false);

      // Lectura caída → 503 neutro.
      __setPlatformConfigurationPoolsForTests({ reader: { async connect() { throw new Error('connection refused db.internal'); } }, admin: null });
      const down = await request(port, '/api/platform/agent-configuration', 'admin-token');
      assert.equal(down.status, 503);
      assert.equal(down.body.error, 'La plataforma de agentes no está conectada.');
      assert.equal((await request(port, '/api/platform/agent-configuration', 'admin-token', 'DELETE')).status, 405);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  });
}
