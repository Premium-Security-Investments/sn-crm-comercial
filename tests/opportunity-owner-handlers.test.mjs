import assert from 'node:assert/strict';
import http from 'node:http';

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
    const payload = JSON.stringify(body);
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
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

const actors = {
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: 'admin-profile', full_name: 'Admin', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true, commercial_area: null, can_edit_customer_segment: true },
  },
  'gerencia-token': {
    user: { id: 'gerencia-auth', email: 'gerencia@example.test' },
    profile: { id: 'gerencia-profile', full_name: 'Gerencia', microsoft_email: 'gerencia@example.test', auth_user_id: 'gerencia-auth', role: 'gerencia', active: true, commercial_area: null, can_edit_customer_segment: true },
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const owners = {
  'owner-active': { id: 'owner-active', active: true },
  'owner-current': { id: 'owner-current', active: false },
  'owner-inactive': { id: 'owner-inactive', active: false },
};
const existing = { id: 'opportunity-existing', owner_id: 'owner-current', customer_segment: 'cliente_nuevo' };
const observed = [];

function record(req, url, body = undefined) {
  observed.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    ...(body === undefined ? {} : { body }),
  });
}

const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    record(req, url);
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    record(req, url);
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    if (authUserId) {
      const actor = actorByAuthId.get(authUserId);
      assert.ok(actor, `unexpected auth profile lookup ${authUserId}`);
      return json(res, 200, actor.profile);
    }
    const ownerId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    assert.ok(ownerId, 'owner resolver must look up the canonical owner by id');
    if (!owners[ownerId]) return json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
    return json(res, 200, owners[ownerId]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    record(req, url);
    return json(res, 200, []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    record(req, url);
    return json(res, 200, [{ permission_code: 'modulo_oportunidades' }]);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    if (req.method === 'GET') {
      assert.equal(url.searchParams.get('id'), 'eq.opportunity-existing');
      return json(res, 200, existing);
    }
    if (req.method === 'POST') return json(res, 201, { id: 'created-opportunity' });
    if (req.method === 'PATCH') return json(res, 200, { id: 'opportunity-existing' });
  }
  record(req, url);
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

function opportunityPayload(ownerId) {
  return {
    company_name: 'Empresa de prueba',
    owner_id: ownerId,
    service_type_code: 'vigilancia',
    stage_code: 'prospecto',
    customer_segment: 'cliente_nuevo',
  };
}

function resetObserved() {
  observed.length = 0;
}

function salesWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_opportunities' && ['POST', 'PATCH'].includes(call.method));
}

function ownerLookups() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_profiles' && call.query.id);
}

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

  for (const [ownerId, expectedStatus] of [['owner-missing', 404], ['owner-inactive', 400]]) {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities', 'admin-token', 'POST', opportunityPayload(ownerId));
    assert.equal(response.status, expectedStatus, `create rejects ${ownerId}`);
    assert.equal(salesWrites().length, 0, `create with ${ownerId} performs no opportunity write`);
    assert.deepEqual(ownerLookups().map(call => call.query.id), [`eq.${ownerId}`], `create resolves ${ownerId} before any opportunity write`);
  }

  for (const route of [
    { path: '/api/opportunities/opportunity-existing', token: 'admin-token', label: 'canonical' },
    { path: '/api/opportunity?id=opportunity-existing', token: 'gerencia-token', label: 'alias' },
  ]) {
    for (const [ownerId, expectedStatus] of [['owner-missing', 404], ['owner-inactive', 400]]) {
      resetObserved();
      const response = await requestJson(appPort, route.path, route.token, 'PUT', opportunityPayload(ownerId));
      assert.equal(response.status, expectedStatus, `${route.label} reassign rejects ${ownerId}`);
      assert.equal(salesWrites().length, 0, `${route.label} reassign with ${ownerId} performs no opportunity update`);
      assert.deepEqual(ownerLookups().map(call => call.query.id), [`eq.${ownerId}`], `${route.label} reassign validates only the proposed owner after loading the existing opportunity`);
      const existingRead = observed.findIndex(call => call.path === '/rest/v1/psi_sales_opportunities' && call.method === 'GET');
      const targetOwnerRead = observed.findIndex(call => call.path === '/rest/v1/psi_sales_profiles' && call.query.id === `eq.${ownerId}`);
      assert.ok(existingRead >= 0 && targetOwnerRead > existingRead, `${route.label} reassign resolves its target only after existing authorization`);
    }
  }

  for (const route of [
    { path: '/api/opportunities/opportunity-existing', token: 'admin-token', label: 'canonical' },
    { path: '/api/opportunity?id=opportunity-existing', token: 'gerencia-token', label: 'alias' },
  ]) {
    resetObserved();
    const response = await requestJson(appPort, route.path, route.token, 'PUT', opportunityPayload('owner-current'));
    assert.equal(response.status, 200, `${route.label} edit without reassignment remains authorized even when the existing owner is inactive`);
    assert.equal(ownerLookups().length, 0, `${route.label} edit without reassignment does not re-resolve or revalidate the current owner`);
    assert.equal(salesWrites().length, 1, `${route.label} edit without reassignment reaches its authorized opportunity update`);
    assert.equal(salesWrites()[0].method, 'PATCH');
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

console.log('Opportunity owner HTTP handler regression passed');
