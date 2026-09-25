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

// Actors: a comercial owner without global customer-segment override rights,
// a second comercial owner used only as the sibling opportunity's owner (the
// acting profile is never authorized against it), and an admin used for the
// service_type_code=licitacion_publica creation regression.
const actors = {
  'comercial-token': {
    user: { id: 'comercial-auth', email: 'comercial@example.test' },
    profile: { id: 'comercial-1', full_name: 'Comercial Uno', microsoft_email: 'comercial1@example.test', auth_user_id: 'comercial-auth', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: false },
  },
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: 'admin-profile', full_name: 'Admin', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true, commercial_area: null, can_edit_customer_segment: true },
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));

// Owner profiles resolved by id (resolveActiveOpportunityOwner / owner reassignment checks).
const owners = {
  'owner-lic': { id: 'owner-lic', active: true, role: 'comercial', can_own_opportunities: null },
};

const opportunities = {
  'opp-priv': {
    id: 'opp-priv', owner_id: 'comercial-1', client_id: 'client-current',
    company_name: 'Empresa Actual', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-a': {
    id: 'opp-a', owner_id: 'comercial-1', client_id: 'client-shared',
    company_name: 'Empresa Original', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'opp-b': {
    id: 'opp-b', owner_id: 'comercial-2', client_id: 'client-shared',
    company_name: 'Empresa Original', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
};

const clients = {
  'client-current': {
    id: 'client-current', company_name: 'Empresa Actual', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
  'client-other': {
    id: 'client-other', company_name: 'Empresa Distinta', customer_segment: 'cliente_nuevo', regional_nombre: 'Cauca',
    sede: 'Sede B', quote_city: 'Popayán', economic_sector: 'tecnologia',
    decision_maker_name: 'Ana Gomez', decision_maker_email: 'ana@example.test', decision_maker_phone: '3000000001',
  },
  'client-shared': {
    id: 'client-shared', company_name: 'Empresa Original', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
    sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
    decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
  },
};

let clientCounter = 0;
let opportunityCounter = 0;
const observed = [];

function record(req, url, body = undefined) {
  observed.push({
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    ...(body === undefined ? {} : { body }),
  });
}

function resetObserved() {
  observed.length = 0;
}

function opportunityWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_opportunities' && ['POST', 'PATCH'].includes(call.method));
}

function clientWrites() {
  return observed.filter(call => call.path === '/rest/v1/psi_sales_clients' && ['POST', 'PATCH'].includes(call.method));
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
    if (req.method === 'POST') {
      const id = `created-opportunity-${++opportunityCounter}`;
      opportunities[id] = { id, ...body };
      return json(res, 201, { id });
    }
    if (req.method === 'PATCH') {
      if (idParam && idParam.startsWith('eq.')) {
        const id = idParam.slice(3);
        opportunities[id] = { ...opportunities[id], ...body };
        return json(res, 200, { id });
      }
      // Sibling sync update filtered by client_id (and id=neq.<skip>), not a single-row PATCH.
      return json(res, 200, []);
    }
  }

  if (url.pathname === '/rest/v1/psi_sales_clients') {
    const body = ['POST', 'PATCH'].includes(req.method) ? await readJson(req) : undefined;
    record(req, url, body);
    const idParam = url.searchParams.get('id');
    if (req.method === 'GET') {
      if (idParam) {
        const id = idParam.replace(/^eq\./, '');
        const client = clients[id];
        return client ? json(res, 200, client) : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
      }
      return json(res, 200, Object.values(clients));
    }
    if (req.method === 'POST') {
      const id = `created-client-${++clientCounter}`;
      const created = { id, ...body };
      clients[id] = created;
      return json(res, 201, created);
    }
    if (req.method === 'PATCH' && idParam) {
      const id = idParam.replace(/^eq\./, '');
      clients[id] = { ...clients[id], ...body };
      return json(res, 200, { id });
    }
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

  // 1) A profile lacking can_edit_customer_segment PUTs an existing private
  // opportunity with an unchanged customer_segment in the request body, but
  // also supplies client_id for a client master whose own customer_segment
  // differs. The 403 check must see the value that ends up written, not the
  // pre-client-resolution value; the handler must reject before mutating
  // either the opportunity or the client master.
  {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities/opp-priv', 'comercial-token', 'PUT', {
      company_name: 'Empresa Actual',
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
      client_id: 'client-other',
    });
    assert.equal(response.status, 403, 'reassigning to a client master with a different customer_segment must be blocked for a profile without can_edit_customer_segment');
    assert.equal(opportunityWrites().length, 0, 'no opportunity write must happen once the effective customer_segment change is unauthorized');
    assert.equal(clientWrites().length, 0, 'no client master write must happen once the request is rejected');
  }

  // 2) A user authorized to edit opportunity A but not sibling opportunity B
  // (same client_id, different owner) edits a master field on A. Because
  // master-field edits sync to every opportunity sharing the client master,
  // the request must fail closed before any mutation: the actor is never
  // authorized against B.
  {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities/opp-a', 'comercial-token', 'PUT', {
      company_name: 'Empresa Actualizada',
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
    });
    assert.equal(response.status, 403, 'a master-field edit that would sync to an unauthorized sibling opportunity must fail closed');
    assert.equal(opportunityWrites().length, 0, 'neither the target opportunity nor its sibling may be written when sibling authorization cannot be established');
    assert.equal(clientWrites().length, 0, 'the shared client master must not be updated when sibling authorization cannot be established');
  }

  // 3) POSTing a licitacion_publica opportunity with company_name must not
  // create or link a psi_sales_clients master row: tender-sourced
  // opportunities are not customer-master candidates.
  {
    resetObserved();
    const response = await requestJson(appPort, '/api/opportunities', 'admin-token', 'POST', {
      company_name: 'Empresa Licitación',
      owner_id: 'owner-lic',
      service_type_code: 'licitacion_publica',
      stage_code: 'prospecto',
      customer_segment: 'cliente_nuevo',
      regional_nombre: 'Nariño',
    });
    assert.equal(response.status, 201, 'licitacion_publica opportunities must still be creatable');
    assert.equal(clientWrites().filter(call => call.method === 'POST').length, 0, 'licitacion_publica creation must not insert into psi_sales_clients');
    const insertedOpportunity = opportunityWrites().find(call => call.method === 'POST');
    assert.ok(insertedOpportunity, 'creation must perform an opportunity insert');
    assert.equal(insertedOpportunity.body.client_id ?? null, null, 'licitacion_publica opportunities must be created with client_id null');
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

console.log('SIIO client master authorization HTTP handler regression passed');
