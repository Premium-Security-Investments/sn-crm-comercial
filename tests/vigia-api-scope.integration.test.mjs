import assert from 'node:assert/strict';
import http from 'node:http';

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function requestJson(port, path, token, method = 'GET') {
  return new Promise((resolve, reject) => {
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => { let parsed = body; try { parsed = JSON.parse(body); } catch {} resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', reject); req.end();
  });
}

const profiles = {
  'manager-auth': { id: 'manager-profile', full_name: 'Gerencia QA', microsoft_email: 'manager@example.test', auth_user_id: 'manager-auth', role: 'gerencia', active: true, commercial_area: null, can_edit_customer_segment: false },
  'manager-no-module-auth': { id: 'manager-no-module-profile', full_name: 'Gerencia sin módulo', microsoft_email: 'manager-no-module@example.test', auth_user_id: 'manager-no-module-auth', role: 'gerencia', active: true, commercial_area: null, can_edit_customer_segment: false },
  'director-empty-auth': { id: 'director-empty-profile', full_name: 'Director vacío', microsoft_email: 'director-empty@example.test', auth_user_id: 'director-empty-auth', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
  'director-auth': { id: 'director-profile', full_name: 'Director regional', microsoft_email: 'director@example.test', auth_user_id: 'director-auth', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
  'commercial-auth': { id: 'commercial-profile', full_name: 'Comercial', microsoft_email: 'commercial@example.test', auth_user_id: 'commercial-auth', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
};
const tokens = Object.fromEntries(Object.keys(profiles).map(authId => [authId.replace('-auth', '-token'), authId]));
const profileAreas = {
  'manager-profile': [],
  'manager-no-module-profile': [],
  'director-empty-profile': [],
  'director-profile': [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }],
  'commercial-profile': [{ area_code: 'comercial', subarea_code: 'seguridad_fisica' }],
};
const assignments = [
  { profile_id: 'director-profile', area_code: 'comercial', subarea_code: 'seguridad_fisica' },
  { profile_id: 'owner-a', area_code: 'comercial', subarea_code: 'seguridad_fisica' },
  { profile_id: 'owner-b', area_code: 'comercial', subarea_code: 'tecnologia' },
];
const row = (id, ownerId) => ({ id, owner_id: ownerId, owner_name: ownerId, company_name: `Empresa ${id}`, stage_code: 'prospecto', stage_name: 'Prospecto', stage_order: 1, service_type_code: 'vigilancia', service_type_name: 'Vigilancia', regional_nombre: 'Nacional', offer_value: 1, weighted_pipeline_value: 1, next_action_at: null, last_interaction_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', expected_close_date: null, customer_contact_name: 'NO DEBE LEERSE' });
const globalRows = Array.from({ length: 1001 }, (_, index) => row(`global-${String(index).padStart(4, '0')}`, index % 2 ? 'owner-a' : 'owner-b'));
let crmReads = 0;
const crmQueries = [];

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const authId = tokens[bearer(req)];
    return authId ? json(res, 200, { id: authId, email: profiles[authId].microsoft_email }) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authId = url.searchParams.get('auth_user_id')?.replace(/^eq\./, '');
    return json(res, 200, profiles[authId] ?? null);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = url.searchParams.get('profile_id')?.replace(/^eq\./, '');
    return json(res, 200, profileId ? (profileAreas[profileId] || []) : assignments);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = url.searchParams.get('profile_id')?.replace(/^eq\./, '');
    return json(res, 200, profileId === 'manager-no-module-profile' ? [] : [{ permission_code: 'modulo_vig_ia' }]);
  }
  if (url.pathname === '/rest/v1/v_psi_sales_opportunity_enriched') {
    crmReads += 1; crmQueries.push(url);
    const select = String(url.searchParams.get('select') || '').split(',');
    assert.equal(select.includes('customer_contact_name'), false, 'query usa allowlist sin contacto');
    const ownerFilter = url.searchParams.get('owner_id');
    let rows = ownerFilter ? [row('allowed', 'owner-a')] : globalRows;
    if (ownerFilter) assert.match(ownerFilter, /^in\.\([^)]*owner-a[^)]*\)$/);
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Number(url.searchParams.get('limit') || 1000);
    rows = rows.slice(offset, offset + limit).map(item => Object.fromEntries(select.map(key => [key, item[key]])));
    return json(res, 200, rows);
  }
  return json(res, 500, { message: `unexpected database access: ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';
let appServer;
const originalConsoleError = console.error;
try {
  console.error = () => {};
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  let response = await requestJson(appPort, '/api/vigia/priorities');
  assert.equal(response.status, 401);
  assert.equal(crmReads, 0, 'sin Bearer no lee CRM');

  response = await requestJson(appPort, '/api/vigia/priorities', 'manager-no-module-token');
  assert.equal(response.status, 403);
  assert.equal(crmReads, 0, 'rol elegible sin módulo Vig-IA deniega antes de CRM');

  response = await requestJson(appPort, '/api/vigia/priorities', 'commercial-token');
  assert.equal(response.status, 403);
  assert.equal(crmReads, 0, 'role ceiling deniega antes de CRM');

  response = await requestJson(appPort, '/api/vigia/priorities', 'director-empty-token');
  assert.equal(response.status, 403);
  assert.equal(crmReads, 0, 'director sin alcance deniega antes de CRM');

  response = await requestJson(appPort, '/api/vigia/priorities', 'director-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.priorities.length, 1);
  assert.equal(response.body.priorities[0].owner_id, 'owner-a');
  assert.equal('customer_contact_name' in response.body.priorities[0], false);
  assert.ok(crmQueries.at(-1).searchParams.has('owner_id'), 'director consulta CRM con owner_id restringido');

  const readsBeforeGlobal = crmReads;
  response = await requestJson(appPort, '/api/vigia/priorities', 'manager-token');
  assert.equal(response.status, 200);
  assert.equal(response.body.totals.source_rows, 1001, 'paginación no trunca el snapshot');
  assert.equal(crmReads - readsBeforeGlobal, 2, '1.001 filas requieren dos páginas');

  const readsBeforePost = crmReads;
  response = await requestJson(appPort, '/api/vigia/priorities', 'manager-token', 'POST');
  assert.equal(response.status, 405, 'endpoint es exclusivamente GET/read-only');
  assert.equal(crmReads, readsBeforePost, 'POST no lee CRM');
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
}
console.log('Vig-IA authenticated API scope integration passed');
