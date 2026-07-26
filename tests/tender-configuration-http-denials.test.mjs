import assert from 'node:assert/strict';
import http from 'node:http';

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

function requestJson(port, path, token, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const actors = {
  'commercial-token': {
    user: { id: 'commercial-auth', email: 'commercial@example.test' },
    profile: { id: 'commercial-profile', full_name: 'Comercial', microsoft_email: 'commercial@example.test', auth_user_id: 'commercial-auth', role: 'comercial', active: true },
    permissions: ['licitaciones'],
  },
  'director-no-permission-token': {
    user: { id: 'director-auth', email: 'director@example.test' },
    profile: { id: 'director-profile', full_name: 'Director', microsoft_email: 'director@example.test', auth_user_id: 'director-auth', role: 'director', active: true },
    permissions: [],
  },
  'agent-token': {
    user: { id: 'agent-auth', email: 'agent@example.test' },
    profile: { id: 'agent-profile', full_name: 'Agente', microsoft_email: 'agent@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    permissions: ['licitaciones'],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const observedTargetAccess = [];

function observeTarget(req, url) {
  observedTargetAccess.push({ method: req.method, path: url.pathname });
}

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    const actor = actorByAuthId.get(authUserId);
    if (actor) return json(res, 200, actor.profile);
    return json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    const actor = Object.values(actors).find(candidate => candidate.profile.id === profileId);
    return json(res, 200, (actor?.permissions || []).map(permission_code => ({ permission_code })));
  }
  if (url.pathname === '/rest/v1/psi_company_procurement_profile') {
    observeTarget(req, url);
    if (req.method === 'GET') return json(res, 200, { singleton_key: 'seguridad_nacional', legal_name: 'Seguridad Nacional', updated_by: null });
    return json(res, 500, { message: `denied request reached target storage/database: ${req.method} ${url.pathname}` });
  }
  if (url.pathname === '/rest/v1/psi_tender_radar_runs' || url.pathname.includes('/storage/v1/')) {
    observeTarget(req, url);
    return json(res, 500, { message: `denied request reached target storage/database: ${req.method} ${url.pathname}` });
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
try {
  console.error = () => {};
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  observedTargetAccess.length = 0;
  const readable = await requestJson(appPort, '/api/tender-company-profile', 'commercial-token');
  assert.equal(readable.status, 200, 'comercial con licitaciones puede obtener la ficha con permiso VIEW');
  assert.equal(observedTargetAccess.length, 1, 'GET VIEW llega sólo a la lectura de ficha');
  assert.equal(observedTargetAccess[0].method, 'GET');

  const writes = [
    ['PUT', '/api/tender-company-profile', { legal_name: 'No debe guardarse' }],
    ['POST', '/api/tender-company-profile-upload-url', { name: 'rup.pdf', mime_type: 'application/pdf', size: 1 }],
    ['POST', '/api/tender-company-profile-process-upload', { storage_path: 'company-profile/rup/blocked.pdf', name: 'blocked.pdf', mime_type: 'application/pdf' }],
    ['POST', '/api/tender-company-profile-upload', { name: 'blocked.txt', mime_type: 'text/plain', content_base64: Buffer.from('blocked').toString('base64') }],
    ['POST', '/api/tender-company-document-upload-url', { documentType: 'certificado', displayName: 'Bloqueado', issuedAt: '2026-01-01', name: 'blocked.pdf', mime_type: 'application/pdf', size: 1 }],
    ['POST', '/api/tender-company-document-process-upload', { documentType: 'certificado', displayName: 'Bloqueado', issuedAt: '2026-01-01', storage_path: 'company-profile/documents/commercial-profile/blocked.pdf', name: 'blocked.pdf', mime_type: 'application/pdf' }],
  ];
  let deniedWrites = 0;
  for (const actor of ['commercial-token', 'director-no-permission-token', 'agent-token']) {
    for (const [method, path, body] of writes) {
      observedTargetAccess.length = 0;
      const response = await requestJson(appPort, path, actor, method, body);
      assert.equal(response.status, 403, `${actor} recibe 403 para ${method} ${path}`);
      assert.match(response.body.error, /No tiene autorización/, `${actor} recibe FORBIDDEN antes de ${method} ${path}`);
      assert.deepEqual(observedTargetAccess, [], `${actor} no llega a DB ni storage para ${method} ${path}`);
      deniedWrites += 1;
    }
  }
  assert.equal(deniedWrites, 18, 'los 3 actores cubren los 6 writes sin acceder al target');
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Tender configuration HTTP denials and no-write regression passed');
