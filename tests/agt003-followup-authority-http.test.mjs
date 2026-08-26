import assert from 'node:assert/strict';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const ADMIN_TOKEN = 'admin-token';
const scenario = {
  user: { id: 'admin-auth', email: 'admin@example.test' },
  profile: { id: ADMIN_ID, full_name: 'Admin Autenticada', microsoft_email: 'admin@example.test', role: 'admin', active: true, commercial_area: null, can_edit_customer_segment: false },
};

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
async function requestJson(port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody || '{}') }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

let interactionInserts = [];
let opportunityUpdates = [];
const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return bearer(req) === ADMIN_TOKEN ? json(res, 200, scenario.user) : json(res, 401, { message: 'invalid token' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') return json(res, 200, scenario.profile);
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'modulo_oportunidades' }]);
  if (url.pathname === '/rest/v1/psi_sales_opportunities' && req.method === 'GET') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: OWNER_ID, customer_segment: 'cliente_nuevo' });
  }
  if (url.pathname === '/rest/v1/psi_sales_interactions' && req.method === 'POST') {
    interactionInserts.push(await readJson(req));
    return json(res, 201, { id: `interaction-${interactionInserts.length}` });
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities' && req.method === 'PATCH') {
    opportunityUpdates.push(await readJson(req));
    return json(res, 200, { id: OPPORTUNITY_ID });
  }
  return json(res, 500, { message: `Unexpected Supabase request ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const observations = [];
try {
  const backends = [await import('../server/index.js'), await import('../api/[...path].js')];
  const routes = [
    `/api/opportunities/${OPPORTUNITY_ID}/interactions`,
    `/api/opportunity-interactions?id=${OPPORTUNITY_ID}`,
  ];
  for (const [backendIndex, backend] of backends.entries()) {
    const appServer = http.createServer(backend.default);
    const appPort = await listen(appServer);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      for (const route of routes) {
        interactionInserts = [];
        opportunityUpdates = [];
        const forged = await requestJson(appPort, route, { notes: 'Intento de suplantación', interaction_type: 'nota', occurred_at: '2026-08-26T17:00:00.000Z', created_by: OTHER_PROFILE_ID });
        const forgedObservation = { status: forged.status, interactionInserts: interactionInserts.length, opportunityUpdates: opportunityUpdates.length };

        interactionInserts = [];
        opportunityUpdates = [];
        const accepted = await requestJson(appPort, route, { notes: 'Seguimiento legítimo', interaction_type: 'nota', occurred_at: '2026-08-26T17:00:00.000Z' });
        observations.push({
          backendIndex,
          route: route.startsWith('/api/opportunities/') ? 'canonical' : 'alias',
          forged: forgedObservation,
          accepted: { status: accepted.status, createdBy: interactionInserts[0]?.created_by, interactionInserts: interactionInserts.length, opportunityUpdates: opportunityUpdates.length },
        });
      }
    } finally {
      console.error = originalConsoleError;
      await new Promise(resolve => appServer.close(resolve));
    }
  }
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

assert.deepEqual(observations, [0, 1].flatMap(backendIndex => ['canonical', 'alias'].map(route => ({
  backendIndex,
  route,
  forged: { status: 403, interactionInserts: 0, opportunityUpdates: 0 },
  accepted: { status: 201, createdBy: ADMIN_ID, interactionInserts: 1, opportunityUpdates: 1 },
}))));

console.log('AGT-003 authenticated follow-up authority HTTP checks passed for both routes and backends');
