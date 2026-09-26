import assert from 'node:assert/strict';
import http from 'node:http';

// P2-2 (PR #229 review, RED): sendError (server/index.js and its byte-identical api/[...path].js
// twin, enforced by tests/backend-parity.test.mjs) only includes `code` in the JSON error body
// when the error ALSO carries a `.stage`: `if (error?.stage && error?.code) return res.status(
// status).json({ error: error.message, stage: error.stage, code: error.code });`. Both
// clientDuplicateNameError (CLIENT_NAME_DUPLICATE) and the CLIENT_REFERENCE_INVALID error set
// `.code` and `.status` but never `.stage`, so that condition is false and execution falls through
// to the generic branch, which drops `code` entirely: `res.status(status).json({ error:
// error?.message || String(error) })`. Callers that branch on the HTTP JSON `code` field (e.g. the
// client UI distinguishing "pick the existing client" from "invalid client reference") get no
// machine-readable signal at all today, on either backend entry point.
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
const owners = {
  'comercial-1': { id: 'comercial-1', active: true, role: 'comercial', can_own_opportunities: null },
};
const existingClient = {
  id: 'client-existing', company_name: 'Empresa Existente', customer_segment: 'cliente_actual', regional_nombre: 'Nariño',
  sede: 'Sede A', quote_city: 'Pasto', economic_sector: 'seguridad_fisica',
  decision_maker_name: 'Juan Perez', decision_maker_email: 'juan@example.test', decision_maker_phone: '3000000000',
};

// Monotonic counter appended to every dynamic-import query string. fakeSupabasePort alone is not
// enough to bust the ESM module cache: the OS can hand out the same ephemeral port to a later
// listen() call in this same serial run, which would make Node treat the import as a cache hit
// against a previous invocation's module instance instead of loading fresh.
let importInvocationCounter = 0;

// Runs the create-opportunity flow against a given backend entry point module, forcing the RPC to
// fail with the given Postgres-style error code, and returns the parsed HTTP JSON response.
async function createOpportunityWithForcedRpcError(modulePath, { rpcErrorCode, rpcErrorMessage, requestBody }) {
  const fakeSupabase = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/auth/v1/user') {
      return bearer(req) === 'comercial-token' ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
    }
    if (url.pathname === '/rest/v1/psi_sales_profiles') {
      const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
      if (authUserId) return json(res, 200, actor.profile);
      const ownerId = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      if (!owners[ownerId]) return json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
      return json(res, 200, owners[ownerId]);
    }
    if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
    if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'modulo_oportunidades' }]);
    if (url.pathname === '/rest/v1/psi_sales_clients') {
      const idParam = url.searchParams.get('id');
      if (req.method === 'GET' && idParam) {
        const id = idParam.replace(/^eq\./, '');
        return id === existingClient.id
          ? json(res, 200, existingClient)
          : json(res, 406, { code: 'PGRST116', message: 'The result contains 0 rows' });
      }
      if (req.method === 'GET') return json(res, 200, []);
      return json(res, 500, { message: 'direct write to psi_sales_clients is forbidden; use the atomic RPC' });
    }
    if (url.pathname === '/rest/v1/psi_sales_opportunities') {
      if (req.method === 'GET') return json(res, 200, []);
      return json(res, 500, { message: 'direct write to psi_sales_opportunities is forbidden; use the atomic RPC' });
    }
    if (url.pathname === '/rest/v1/rpc/psi_persist_sales_opportunity') {
      await readJson(req);
      return json(res, 409, { message: rpcErrorMessage, code: rpcErrorCode, details: null, hint: null });
    }
    return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
  });

  const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
  const fakePort = await listen(fakeSupabase);
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.VERCEL = '1';

  let appServer;
  const originalConsoleError = console.error;
  let consoleErrorCallCount = 0;
  try {
    console.error = () => { consoleErrorCallCount += 1; };
    const { default: app } = await import(`${modulePath}?fakeSupabasePort=${fakePort}&importInvocation=${++importInvocationCounter}`);
    appServer = http.createServer(app);
    const appPort = await listen(appServer);
    const result = await requestJson(appPort, '/api/opportunities', 'comercial-token', 'POST', requestBody);
    return { ...result, consoleErrorCallCount };
  } finally {
    console.error = originalConsoleError;
    if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
    await new Promise(resolve => fakeSupabase.close(resolve));
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const CREATE_BODY = {
  company_name: 'Empresa Nueva',
  owner_id: 'comercial-1',
  service_type_code: 'vigilancia',
  stage_code: 'prospecto',
  customer_segment: 'cliente_nuevo',
  regional_nombre: 'Nariño',
};
const RELINK_BODY = { ...CREATE_BODY, company_name: existingClient.company_name, client_id: existingClient.id };

async function assertErrorShape(modulePath, label) {
  // CLIENT_NAME_DUPLICATE (Postgres unique_violation, 23505 on the client-master unique index).
  {
    const response = await createOpportunityWithForcedRpcError(modulePath, {
      rpcErrorCode: '23505',
      rpcErrorMessage: 'duplicate key value violates unique constraint "psi_sales_clients_normalized_name_key"',
      requestBody: CREATE_BODY,
    });
    assert.equal(response.status, 409, `${label}: CLIENT_NAME_DUPLICATE must respond 409 (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(response.body?.code, 'CLIENT_NAME_DUPLICATE', `${label}: the JSON body must include code=CLIENT_NAME_DUPLICATE even though the error has no .stage (got ${JSON.stringify(response.body)})`);
    assert.equal(typeof response.body?.error, 'string', `${label}: the JSON body must still include a human-readable error message`);
    assert.equal(response.body?.stage, undefined, `${label}: CLIENT_NAME_DUPLICATE must not fabricate a stage field`);
  }

  // CLIENT_REFERENCE_INVALID (Postgres foreign_key_violation, 23503 on client_id).
  {
    const response = await createOpportunityWithForcedRpcError(modulePath, {
      rpcErrorCode: '23503',
      rpcErrorMessage: 'insert or update on table "psi_sales_opportunities" violates foreign key constraint',
      requestBody: RELINK_BODY,
    });
    assert.equal(response.status, 400, `${label}: CLIENT_REFERENCE_INVALID must respond 400 (got ${response.status}: ${JSON.stringify(response.body)})`);
    assert.equal(response.body?.code, 'CLIENT_REFERENCE_INVALID', `${label}: the JSON body must include code=CLIENT_REFERENCE_INVALID even though the error has no .stage (got ${JSON.stringify(response.body)})`);
    assert.equal(typeof response.body?.error, 'string', `${label}: the JSON body must still include a human-readable error message`);
    assert.equal(response.body?.stage, undefined, `${label}: CLIENT_REFERENCE_INVALID must not fabricate a stage field`);
  }

  // Unmapped raw DB/PostgREST error (e.g. 42501 insufficient_privilege): mapClientWriteError only
  // recognizes 23505/23503 and passes every other error straight through with its original,
  // unrelated-to-our-domain `.code` intact, so sendError's generic `if (error?.code) return ...
  // {code: error.code}` branch forwards that raw internal Postgres/PostgREST code to the HTTP JSON
  // body verbatim -- and, because that branch returns before ever reaching `console.error(error)`,
  // this genuinely-unexpected failure is never logged server-side either.
  {
    const response = await createOpportunityWithForcedRpcError(modulePath, {
      rpcErrorCode: '42501',
      rpcErrorMessage: 'synthetic internal DB error',
      requestBody: CREATE_BODY,
    });
    assert.equal(typeof response.body?.error, 'string', `${label}: an unexpected raw DB error must still surface a human-readable error message`);
    assert.equal(response.body?.code, undefined, `${label}: an unrecognized raw Postgres/PostgREST error code (42501) must never be forwarded to the HTTP JSON body as-is (got ${JSON.stringify(response.body)})`);
    assert.ok(response.consoleErrorCallCount > 0, `${label}: an unexpected/unmapped RPC error must still reach console.error server-side, not be silently swallowed (got ${response.consoleErrorCallCount} calls)`);
  }
}

await assertErrorShape('../server/index.js', 'server/index.js');
await assertErrorShape('../api/[...path].js', 'api/[...path].js');

console.log('SIIO client master {error,code} shape (no stage) parity regression passed');
