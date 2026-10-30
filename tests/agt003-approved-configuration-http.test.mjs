// Rutas reales (server/index.js y api/[...path].js) con dobles: la configuración APROBADA de la plataforma gobierna
// Vig-IA Comercial. Función apagada en el copiloto y en el análisis profundo (sin reservar ni llamar al modelo), lectura
// de perfiles de uso para Usuarios y permisos, y el campo "Perfil de uso de IA" (validación y columna aún no creada).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { __setPlatformConfigurationPoolsForTests, defaultAgentConfiguration } from '../platform-agent-configuration.js';
import { __setEffectiveConfigurationReaderForTests } from '../platform-agent-effective-configuration.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SALES_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_ID = '33333333-3333-4333-8333-333333333333';
const OPPORTUNITY_ID = '44444444-4444-4444-8444-444444444444';
const COPILOT = 'agt003.opportunity-copilot.preview';
const LEAD = 'agt003.lead-deep-analysis';

const actors = {
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: ADMIN_ID, full_name: 'Juan Botero', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true },
    permissions: [{ permission_code: 'modulo_usuarios' }],
  },
  'sales-token': {
    user: { id: 'sales-auth', email: 'ventas@example.test' },
    profile: { id: SALES_ID, full_name: 'Ventas', microsoft_email: 'ventas@example.test', auth_user_id: 'sales-auth', role: 'comercial', active: true },
    permissions: [{ permission_code: 'modulo_vig_ia' }, { permission_code: 'modulo_oportunidades' }, { permission_code: 'vigia_copilot_pilot' }],
  },
};
const byAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const byProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

const fake = { rpcCalls: [], aiColumnMissing: false, storedAiProfile: { [SALES_ID]: 'comercial', [TARGET_ID]: null } };
function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function eqParam(url, name) { const raw = url.searchParams.get(name); return raw && raw.startsWith('eq.') ? raw.slice(3) : null; }
function one(req, res, row) {
  const wantsObject = String(req.headers.accept || '').includes('vnd.pgrst.object');
  return json(res, 200, wantsObject ? row : [row]);
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    fake.rpcCalls.push(url.pathname.slice('/rest/v1/rpc/'.length));
    return json(res, 404, { code: 'PGRST202', message: 'Could not find the function' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const select = url.searchParams.get('select') || '';
    if (select.includes('ai_usage_profile') && fake.aiColumnMissing) return json(res, 400, { code: '42703', message: 'column psi_sales_profiles.ai_usage_profile does not exist' });
    const authUserId = eqParam(url, 'auth_user_id');
    if (authUserId !== null) {
      const actor = byAuthId.get(authUserId);
      return actor ? one(req, res, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
    }
    const id = eqParam(url, 'id');
    if (id !== null && select === 'ai_usage_profile') return one(req, res, { ai_usage_profile: fake.storedAiProfile[id] ?? null });
    if (id === TARGET_ID) return one(req, res, { id: TARGET_ID, full_name: 'Ana Pérez', microsoft_email: 'ana@example.test', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false, identity_type: 'human' });
    return json(res, 200, [
      { id: ADMIN_ID, full_name: 'Juan Botero', microsoft_email: 'admin@example.test', role: 'admin', active: true, identity_type: 'human', ...(select.includes('ai_usage_profile') ? { ai_usage_profile: null } : {}) },
      { id: TARGET_ID, full_name: 'Ana Pérez', microsoft_email: 'ana@example.test', role: 'comercial', active: true, identity_type: 'human', ...(select.includes('ai_usage_profile') ? { ai_usage_profile: 'comercial' } : {}) },
    ]);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') return one(req, res, { id: OPPORTUNITY_ID, owner_id: SALES_ID });
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    if (String(url.searchParams.get('profile_id') || '').startsWith('in.')) return json(res, 200, []);
    return json(res, 200, [{ area_code: 'comercial', subarea_code: null }]);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = eqParam(url, 'profile_id');
    return json(res, 200, profileId ? (byProfileId.get(profileId)?.permissions || []) : []);
  }
  if (url.pathname === '/rest/v1/psi_org_areas') return json(res, 200, [{ code: 'comercial', name: 'Comercial' }]);
  if (url.pathname === '/rest/v1/psi_org_subareas') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_access_permissions') return json(res, 200, [{ code: 'modulo_oportunidades', name: 'Oportunidades', description: '' }]);
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

function platformReader({ disabled = [], down = false } = {}) {
  const configuration = defaultAgentConfiguration('AGT-003');
  for (const capability of disabled) configuration.capabilities[capability].enabled = false;
  const queries = [];
  return {
    queries,
    async connect() {
      if (down) throw new Error('connection refused db.internal');
      return { async query(sql) {
        queries.push(sql);
        if (sql.includes('from platform.current_agent_configuration')) return { rows: [{ configuration_version_id: '9', version_number: 2, configuration }] };
        if (sql.includes('from platform.ai_usage_profile')) return { rows: [{ profile_id: 'comercial', display_name: 'Comercial' }, { profile_id: 'viejo', display_name: 'Viejo', archived_at: '2026-10-01T00:00:00Z' }] };
        return { rows: [] };
      }, release() {} };
    },
  };
}

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL', 'VERCEL_ENV', 'PLATFORM_GATEWAY_DATABASE_URL', 'AGT003_COPILOT_ENGINE', 'AGT003_COPILOT_MODEL', 'AGT003_COPILOT_BRIDGE_URL', 'AGT003_COPILOT_HMAC_SECRET', 'AGT003_COPILOT_WIRE_PROTOCOL'];
const savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
process.env.VERCEL_ENV = 'production';
delete process.env.PLATFORM_GATEWAY_DATABASE_URL;
process.env.AGT003_COPILOT_ENGINE = 'agt003_bridge_preview';
process.env.AGT003_COPILOT_MODEL = 'sonnet';
process.env.AGT003_COPILOT_BRIDGE_URL = 'https://agents.example.test/v1/agt003-copilot/run';
process.env.AGT003_COPILOT_HMAC_SECRET = 's'.repeat(40);
process.env.AGT003_COPILOT_WIRE_PROTOCOL = 'agt003';

const quiet = { error: console.error, warn: console.warn, info: console.info };
console.error = () => {};
console.warn = () => {};
console.info = () => {};
const modules = [await import('../server/index.js'), await import('../api/[...path].js')];

test.after(() => {
  __setPlatformConfigurationPoolsForTests(null);
  __setEffectiveConfigurationReaderForTests(null);
  fakeSupabase.close();
  Object.assign(console, quiet);
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

for (const [index, module] of modules.entries()) {
  test(`backend ${index}: configuración aprobada gobierna Vig-IA Comercial y el perfil de uso de IA`, async () => {
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      // Copiloto apagado en la versión vigente: 503 claro, sin reservar (ninguna RPC) ni llamar al modelo.
      __setEffectiveConfigurationReaderForTests(null);
      const reader = platformReader({ disabled: [COPILOT, LEAD] });
      __setPlatformConfigurationPoolsForTests({ reader });
      fake.rpcCalls.length = 0;
      const copilot = await request(port, '/api/vigia/copilot/generate', 'sales-token', 'POST', { opportunity_id: OPPORTUNITY_ID, contact_channel: 'email' });
      assert.equal(copilot.status, 503);
      assert.match(copilot.body.error, /apagada/);
      assert.ok(reader.queries.some(sql => sql.includes('from platform.current_agent_configuration')), 'se leyó la configuración vigente');
      // Análisis profundo apagado: igual.
      const lead = await request(port, `/api/agt003/lead-analysis?id=${OPPORTUNITY_ID}`, 'sales-token', 'POST', {});
      assert.equal(lead.status, 503);
      assert.match(lead.body.error, /apagada/);
      assert.deepEqual(fake.rpcCalls, [], 'no se reservó cupo');

      // Perfiles de uso para Usuarios y permisos: sólo los no archivados; protegido; plataforma caída → 503 neutro.
      assert.equal((await request(port, '/api/platform/ai-usage-profiles', 'sales-token')).status, 403);
      const profiles = await request(port, '/api/platform/ai-usage-profiles', 'admin-token');
      assert.equal(profiles.status, 200);
      assert.deepEqual(profiles.body, { profiles: [{ profile_id: 'comercial', display_name: 'Comercial' }] });

      // GET /api/users trae el perfil de uso de IA; sin la columna (migración 119 sin aplicar) sigue funcionando.
      fake.aiColumnMissing = false;
      const users = await request(port, '/api/users', 'admin-token');
      assert.equal(users.status, 200, JSON.stringify(users.body));
      assert.equal(users.body.find(user => user.id === TARGET_ID).ai_usage_profile, 'comercial');
      fake.aiColumnMissing = true;
      const usersNoColumn = await request(port, '/api/users', 'admin-token');
      assert.equal(usersNoColumn.status, 200);
      assert.equal(usersNoColumn.body.find(user => user.id === TARGET_ID).ai_usage_profile, null);
      fake.aiColumnMissing = false;

      // Guardar un perfil archivado, inexistente o mal formado → 400 antes de guardar nada.
      const patch = value => request(port, `/api/users?id=${TARGET_ID}`, 'admin-token', 'PATCH', {
        full_name: 'Ana Pérez', microsoft_email: 'ana@example.test', role: 'comercial', active: true, areas: [], permissions: [], ai_usage_profile: value,
      });
      fake.rpcCalls.length = 0;
      for (const value of ['viejo', 'no_existe']) {
        const response = await patch(value);
        assert.equal(response.status, 400, value);
        assert.match(response.body.error, /no existe o está archivado/);
      }
      assert.equal((await patch('Mal Valor')).status, 400);
      // Plataforma caída al cambiar el perfil → 503 claro (la pantalla no lo envía en ese caso).
      __setPlatformConfigurationPoolsForTests({ reader: platformReader({ down: true }) });
      const down = await patch('comercial');
      assert.equal(down.status, 503);
      assert.match(down.body.error, /plataforma de agentes no responde/);
      assert.equal((await request(port, '/api/platform/ai-usage-profiles', 'admin-token')).status, 503);
      assert.deepEqual(fake.rpcCalls, [], 'nada se guardó');
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  });
}
