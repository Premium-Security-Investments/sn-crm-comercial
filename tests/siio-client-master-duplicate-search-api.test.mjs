import assert from 'node:assert/strict';
import http from 'node:http';

// Blocker C (PR #229 RED): cross-layer canonicalization must be identical wherever a duplicate
// company name is detected, including the live API contract used by POST /api/opportunities
// (duplicate-name rejection) and GET /api/client-typeahead (search). This test exercises both
// through the real Express handlers against a fake Supabase REST backend, using a company name
// that differs from an existing client only by NBSP.
const NBSP = String.fromCharCode(160);

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : null); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
function requestJson(port, path, token, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const actor = {
  user: { id: 'comercial-auth', email: 'comercial@example.test' },
  profile: { id: 'comercial-1', full_name: 'Comercial Uno', microsoft_email: 'comercial1@example.test', auth_user_id: 'comercial-auth', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
};

const clients = {
  'client-existing': {
    id: 'client-existing', company_name: 'Acme Ltd', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
};

const observed = [];
function record(req, url, body = undefined) {
  observed.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ...(body === undefined ? {} : { body }) });
}
function clientWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_clients' && ['POST', 'PATCH'].includes(call.method));
}

const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/auth/v1/user') {
    record(req, url);
    return bearer(req) === 'comercial-token' ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    record(req, url);
    return json(res, 200, actor.profile);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    record(req, url);
    return json(res, 200, []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    record(req, url);
    return json(res, 200, [{ permission_code: 'modulo_oportunidades' }]);
  }
  if (url.pathname === '/rest/v1/psi_sales_clients') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    if (req.method === 'GET') return json(res, 200, Object.values(clients));
    if (req.method === 'POST') return json(res, 500, { message: 'unexpected client creation in this scenario' });
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    if (req.method === 'POST') return json(res, 500, { message: 'unexpected opportunity creation in this scenario' });
  }

  record(req, url);
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
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

  // POSTing an opportunity whose company_name differs from an existing client only by NBSP must
  // be treated as the same duplicate the API already rejects for a plain-space variant: reject
  // with 409, never silently create a second client master.
  {
    observed.length = 0;
    const response = await requestJson(appPort, '/api/opportunities', 'comercial-token', 'POST', {
      company_name: `Acme${NBSP}Ltd`,
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      offer_value: 0,
    });
    assert.equal(response.status, 409, 'a company_name differing from an existing client only by NBSP must be rejected as a duplicate (409), not silently create a new client');
    assert.equal(clientWrites().length, 0, 'no client master write must happen once the NBSP-variant duplicate is detected');
  }

  // GET /api/client-typeahead?q=<NBSP-variant query> must still find the existing client, since
  // the search must canonicalize the query the same way duplicate detection does.
  {
    observed.length = 0;
    const response = await requestJson(appPort, `/api/client-typeahead?q=${encodeURIComponent(`acme${NBSP}ltd`)}`, 'comercial-token', 'GET', undefined);
    assert.equal(response.status, 200, 'typeahead search must succeed');
    assert.ok(Array.isArray(response.body), 'typeahead must return a list');
    assert.ok(response.body.some(client => client.id === 'client-existing'), 'an NBSP-normalized query must still match the existing client by canonical name');
  }
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('SIIO client master duplicate search API (NBSP) contract passed');
