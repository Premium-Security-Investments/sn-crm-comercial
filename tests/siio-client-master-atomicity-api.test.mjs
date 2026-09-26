import assert from 'node:assert/strict';
import http from 'node:http';

// Blocker D (PR #229 RED): the API must perform opportunity create/update (after auth/module/
// action/reassign/segment/sibling authorization checks, which stay as reads) through exactly one
// transactional RPC call -- never a sequence of direct psi_sales_clients / psi_sales_opportunities
// writes. This test drives the real Express handlers against a fake Supabase REST backend that
// returns an error on any direct write to those two tables, so the current direct-write
// implementation is caught red-handed; only a POST to /rest/v1/rpc/psi_persist_sales_opportunity
// is accepted.
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

const opportunities = {
  'opp-existing': {
    id: 'opp-existing', owner_id: 'comercial-1', client_id: 'client-existing',
    company_name: 'Empresa Existente', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
};

const observed = [];
const rpcCalls = [];
function record(req, url, body = undefined) {
  observed.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ...(body === undefined ? {} : { body }) });
}
function directWrites() {
  return observed.filter(call =>
    ['POST', 'PATCH'].includes(call.method) &&
    ['/rest/v1/psi_sales_clients', '/rest/v1/psi_sales_opportunities'].includes(call.path));
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
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    const idParam = url.searchParams.get('id');
    if (req.method === 'GET') {
      const clientIdParam = url.searchParams.get('client_id');
      if (clientIdParam) {
        const clientId = clientIdParam.replace(/^eq\./, '');
        const skipId = idParam && idParam.startsWith('neq.') ? idParam.slice(4) : null;
        const siblings = Object.values(opportunities)
          .filter(o => o.client_id === clientId && o.id !== skipId)
          .map(o => ({ id: o.id, owner_id: o.owner_id }));
        return json(res, 200, siblings);
      }
      const id = idParam ? idParam.replace(/^eq\./, '') : null;
      const found = id ? opportunities[id] : null;
      return found ? json(res, 200, found) : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
    }
    if (['POST', 'PATCH'].includes(req.method)) {
      // Direct writes to opportunities are forbidden once atomicity is required: everything must
      // go through the RPC instead.
      return json(res, 500, { message: 'direct write to psi_sales_opportunities is forbidden; use the atomic RPC' });
    }
  }
  if (url.pathname === '/rest/v1/psi_sales_clients') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    if (req.method === 'GET') return json(res, 200, []);
    if (['POST', 'PATCH'].includes(req.method)) {
      return json(res, 500, { message: 'direct write to psi_sales_clients is forbidden; use the atomic RPC' });
    }
  }
  if (url.pathname === '/rest/v1/rpc/psi_persist_sales_opportunity') {
    const args = await readJson(req);
    record(req, url, args);
    rpcCalls.push(args);
    return json(res, 200, { id: 'created-opportunity-1', client_id: 'created-client-1' });
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

  // Create: after authorization, the whole client+opportunity write must be exactly one RPC
  // call, no direct table writes.
  {
    observed.length = 0;
    rpcCalls.length = 0;
    const response = await requestJson(appPort, '/api/opportunities', 'comercial-token', 'POST', {
      company_name: 'Empresa Nueva Atomica',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_nuevo',
      regional_nombre: 'Nariño',
      offer_value: 0,
    });
    assert.equal(response.status, 201, `create must succeed through the atomic RPC alone (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(directWrites().length, 0, 'create must not perform any direct write to psi_sales_clients or psi_sales_opportunities');
    assert.equal(rpcCalls.length, 1, 'create must call the atomic RPC exactly once');
  }

  // Update: same contract for a master-field edit on an existing opportunity.
  {
    observed.length = 0;
    rpcCalls.length = 0;
    const response = await requestJson(appPort, '/api/opportunities/opp-existing', 'comercial-token', 'PUT', {
      company_name: 'Empresa Existente Actualizada',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      sede: 'Sede A',
      quote_city: 'Pasto',
      economic_sector: 'seguridad_fisica',
      decision_maker_name: 'Juan Perez',
      decision_maker_email: 'juan@example.test',
      decision_maker_phone: '3000000000',
      offer_value: 0,
    });
    assert.equal(response.status, 200, `update must succeed through the atomic RPC alone (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(directWrites().length, 0, 'update must not perform any direct write to psi_sales_clients or psi_sales_opportunities');
    assert.equal(rpcCalls.length, 1, 'update must call the atomic RPC exactly once');
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

console.log('SIIO client master atomicity API (single RPC, no direct writes) contract passed');
