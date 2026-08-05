import { strict as assert } from 'node:assert';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const COMMERCIAL_ID = '44444444-4444-4444-8444-444444444444';
const TENDER_ID = '55555555-5555-4555-8555-555555555555';
const TRACKING_TOKEN = '2026-08-04T12:00:00.000Z';

const scenarios = {
  'admin-token': {
    user: { id: 'admin-auth' },
    profile: { id: ADMIN_ID, full_name: 'Admin', microsoft_email: 'admin@example.test', role: 'admin', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'commercial-token': {
    user: { id: 'commercial-auth' },
    profile: { id: COMMERCIAL_ID, full_name: 'Comercial', microsoft_email: 'commercial@example.test', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: [],
    permissions: [],
  },
};
const byAuthId = new Map(Object.values(scenarios).map(value => [value.user.id, value]));
const byProfileId = new Map(Object.values(scenarios).map(value => [value.profile.id, value]));
const rpcCalls = [];

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function postJson(port, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, method: 'POST', path: '/api/tender-opportunity-exit',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const scenario = scenarios[bearer(req)];
  if (url.pathname === '/auth/v1/user') return scenario ? json(res, 200, scenario.user) : json(res, 401, { message: 'invalid token' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    return json(res, 200, byAuthId.get(authId)?.profile || null);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    if (profileId === OWNER_ID) return json(res, 200, [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }]);
    return json(res, 200, byProfileId.get(profileId)?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    return json(res, 200, byProfileId.get(profileId)?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: OWNER_ID, customer_segment: 'cliente_nuevo' });
  }
  if (url.pathname === '/rest/v1/v_psi_sales_opportunity_enriched') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: OWNER_ID, service_type_code: 'licitacion_publica' });
  }
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    return json(res, 200, { id: TENDER_ID, internal_status: 'convertida_oportunidad', tracking_updated_at: TRACKING_TOKEN });
  }
  if (url.pathname === '/rest/v1/rpc/psi_exit_tender_opportunity') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const args = JSON.parse(raw || '{}');
    rpcCalls.push(args);
    if (args.p_note === 'stale') return json(res, 400, { message: 'Seguimiento desactualizado. Recargue y vuelva a intentar.', code: 'P0001' });
    return json(res, 200, { opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, destination: args.p_destination, tracking_updated_at: '2026-08-04T12:01:00.000Z' });
  }
  return json(res, 404, { message: `Unhandled Supabase path ${url.pathname}` });
});

const originalEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

try {
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    const server = http.createServer(module.default);
    const port = await listen(server);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      assert.equal((await postJson(port, null, { opportunity_id: OPPORTUNITY_ID, destination: 'radar' })).status, 401, `backend ${index} must reject unauthenticated requests`);
      assert.equal((await postJson(port, 'commercial-token', { opportunity_id: OPPORTUNITY_ID, destination: 'radar' })).status, 403, `backend ${index} must enforce opportunity access`);
      assert.equal((await postJson(port, 'admin-token', { opportunity_id: OPPORTUNITY_ID, destination: 'invalid' })).status, 400, `backend ${index} must reject invalid destinations`);
      assert.equal((await postJson(port, 'admin-token', { opportunity_id: OPPORTUNITY_ID, destination: 'radar', reason: 'stale' })).status, 409, `backend ${index} must map stale CAS to 409`);
      const success = await postJson(port, 'admin-token', { opportunity_id: OPPORTUNITY_ID, destination: 'seguimiento', reason: 'Conservar seguimiento' });
      assert.equal(success.status, 200, `backend ${index} must return success`);
      assert.equal(success.body.destination, 'seguimiento');
      assert.equal(rpcCalls.at(-1).p_expected_tracking_updated_at, TRACKING_TOKEN, 'the exact persisted token must reach the RPC');
      assert.equal(rpcCalls.at(-1).p_actor_id, ADMIN_ID);
    } finally {
      console.error = originalConsoleError;
      await new Promise(resolve => server.close(resolve));
    }
  }
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('tender opportunity exit HTTP contract passed for Node and Vercel');
