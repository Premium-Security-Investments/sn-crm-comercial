import assert from 'node:assert/strict';
import http from 'node:http';

// P1-1 (PR #229 review, RED): resolveClientArgsForOpportunityUpdate (server/index.js) only calls
// requireSiblingOpportunityAuthorization for the 'syncMaster' plan kind. The 'relink' plan kind
// (PUT /api/opportunities/:id or PUT /api/opportunity with a client_id that differs from the
// opportunity's current client_id) skips it entirely -- attaching an opportunity to an existing
// client master never checks whether the actor is authorized against that client's *other*
// opportunities, even though relinking exposes the actor to every sibling's data going forward and
// the client master fields (which the actor does not own) are pushed onto the opportunity as a
// side effect. prepareClientForNewOpportunity (POST /api/opportunities with client_id set) has the
// exact same gap: a brand-new opportunity can be attached to any existing client master, and its
// siblings, without ever checking the actor's authorization against the sibling owners. Both gaps
// are unconditional (not a race): reproducing them needs no interleaving, only a single request.
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

// comercial-1 is the acting profile; comercial-2 is only ever the sibling's owner -- the acting
// profile is never authorized against comercial-2 directly or via area assignment.
const actor = {
  user: { id: 'comercial-auth', email: 'comercial@example.test' },
  profile: { id: 'comercial-1', full_name: 'Comercial Uno', microsoft_email: 'comercial1@example.test', auth_user_id: 'comercial-auth', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
};

const owners = {
  'comercial-1': { id: 'comercial-1', active: true, role: 'comercial', can_own_opportunities: null },
};

const opportunities = {
  'opp-lonely': {
    id: 'opp-lonely', owner_id: 'comercial-1', client_id: 'client-lonely',
    company_name: 'Empresa Solitaria', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-sibling-owned-by-other': {
    id: 'opp-sibling-owned-by-other', owner_id: 'comercial-2', client_id: 'client-shared',
    company_name: 'Empresa Compartida', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Ana Gomez', decision_maker_email: 'ana@example.test', decision_maker_phone: '3000000001',
  },
};

const clients = {
  'client-lonely': {
    id: 'client-lonely', company_name: 'Empresa Solitaria', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'client-shared': {
    id: 'client-shared', company_name: 'Empresa Compartida', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Ana Gomez', decision_maker_email: 'ana@example.test', decision_maker_phone: '3000000001',
  },
};

const observed = [];
function record(req, url, body = undefined) {
  observed.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), ...(body === undefined ? {} : { body }) });
}
function resetObserved() { observed.length = 0; }
function opportunityWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_opportunities' && ['POST', 'PATCH'].includes(call.method));
}
function clientWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_clients' && ['POST', 'PATCH'].includes(call.method));
}
function rpcWrites() {
  return observed.filter(call => call.path === '/rest/v1/rpc/psi_persist_sales_opportunity' && call.method === 'POST');
}

const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/auth/v1/user') {
    record(req, url);
    return bearer(req) === 'comercial-token' ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    record(req, url);
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    if (authUserId) return json(res, 200, actor.profile);
    const ownerId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
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
    return json(res, 500, { message: 'direct write to psi_sales_opportunities is forbidden; use the atomic RPC' });
  }
  if (url.pathname === '/rest/v1/psi_sales_clients') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    const idParam = url.searchParams.get('id');
    if (req.method === 'GET' && idParam) {
      const id = idParam.replace(/^eq\./, '');
      const client = clients[id];
      return client ? json(res, 200, client) : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
    }
    return json(res, 500, { message: 'direct write to psi_sales_clients is forbidden; use the atomic RPC' });
  }
  if (url.pathname === '/rest/v1/rpc/psi_persist_sales_opportunity') {
    const args = await readJson(req);
    record(req, url, args);
    return json(res, 200, { id: 'rpc-created-opportunity', client_id: args?.p_requested_client_id || 'rpc-created-client' });
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

  // 1) Relink: PUT an opportunity that currently has no siblings, changing its client_id to an
  // existing client master that DOES have a sibling owned by a profile the actor cannot act on.
  // The relink plan kind never runs requireSiblingOpportunityAuthorization, so this must be
  // blocked (403, no writes) but today succeeds.
  {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities/opp-lonely', 'comercial-token', 'PUT', {
      company_name: 'Empresa Solitaria',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      client_id: 'client-shared',
    });
    assert.equal(response.status, 403, `relinking to a client master with an unauthorized sibling must be blocked (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(opportunityWrites().length, 0, 'no opportunity write must happen once the relink is unauthorized');
    assert.equal(clientWrites().length, 0, 'no client master write must happen once the relink is unauthorized');
    assert.equal(rpcWrites().length, 0, 'no persist RPC call must happen once the relink is unauthorized');
  }

  // 2) Create: POST a brand-new opportunity with client_id pointing at an existing client master
  // that has a sibling owned by a profile the actor cannot act on. prepareClientForNewOpportunity
  // never checks sibling authorization for an explicit client_id, so this must be blocked (403, no
  // writes) but today succeeds.
  {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities', 'comercial-token', 'POST', {
      company_name: 'Empresa Compartida',
      owner_id: 'comercial-1',
      service_type_code: 'vigilancia',
      stage_code: 'prospecto',
      customer_segment: 'cliente_actual',
      regional_nombre: 'Nariño',
      client_id: 'client-shared',
    });
    assert.equal(response.status, 403, `creating attached to a client master with an unauthorized sibling must be blocked (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(opportunityWrites().length, 0, 'no opportunity write must happen once the create-with-existing-client is unauthorized');
    assert.equal(clientWrites().length, 0, 'no client master write must happen once the create-with-existing-client is unauthorized');
    assert.equal(rpcWrites().length, 0, 'no persist RPC call must happen once the create-with-existing-client is unauthorized');
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

console.log('SIIO client master sibling authorization gaps (create/relink) regression passed');
