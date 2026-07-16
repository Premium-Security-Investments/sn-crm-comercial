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

async function requestJson(port, path, token, method = 'GET', body) {
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
    }, res => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(responseBody) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const profiles = {
  'director-auth': { id: 'director-profile', full_name: 'Directora', microsoft_email: 'director@example.test', auth_user_id: 'director-auth', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
  'board-auth': { id: 'board-profile', full_name: 'Junta', microsoft_email: 'board@example.test', auth_user_id: 'board-auth', role: 'junta', active: true, commercial_area: null, can_edit_customer_segment: false },
};
const tokens = { 'director-token': 'director-auth', 'board-token': 'board-auth' };
let siioReads = 0;
const siioPaths = [];
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
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'modulo_siio_gerencial' }]);
  if (url.pathname.startsWith('/rest/v1/siio_')) {
    siioReads += 1;
    siioPaths.push(url.pathname);
    if (url.pathname === '/rest/v1/siio_monthly_board_reports') {
      return json(res, 200, [
        { id: 'published-report', publication_status: 'published', title: 'Publicado' },
        { id: 'draft-report', status: 'draft', title: 'Borrador' },
      ]);
    }
    return json(res, 500, { message: `unexpected SIIO database access: ${url.pathname}` });
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
  const { default: app, requireSiioEndpointAccess } = await import('../server/index.js');
  const profile = (role, permissions = ['modulo_siio_gerencial'], overrides = {}) => ({ id: `${role}-profile`, role, active: true, areas: [], permissions, ...overrides });

  assert.equal(requireSiioEndpointAccess(profile('admin'), 'GET /api/siio/records'), true, 'admin puede leer SIIO');
  assert.equal(requireSiioEndpointAccess(profile('gerencia'), 'POST /api/siio/records'), true, 'gerencia puede gestionar SIIO');
  for (const denied of [
    profile('director', ['modulo_siio_gerencial'], { areas: [{ area_code: 'gerencia', subarea_code: null }] }),
    profile('junta'),
    profile('comercial'),
    profile('gerencia', [], { active: false }),
    profile('gerencia', []),
  ]) {
    assert.throws(() => requireSiioEndpointAccess(denied, 'GET /api/siio/records'), error => error?.status === 403, `${denied.role} falla cerrado fuera de una política SIIO permitida`);
  }
  assert.equal(requireSiioEndpointAccess(profile('junta'), 'GET /api/siio/board-reports'), true, 'junta puede solicitar la colección ejecutiva publicada');
  assert.equal(requireSiioEndpointAccess(profile('junta'), 'GET /api/siio/bootstrap'), true, 'junta puede solicitar bootstrap ejecutivo reducido');
  for (const route of [
    'GET /api/siio/fronts', 'GET /api/siio/records', 'POST /api/siio/records', 'PATCH /api/siio/records/:id',
    'GET /api/siio/sources', 'POST /api/siio/sources', 'GET /api/siio/decisions', 'POST /api/siio/decisions', 'PATCH /api/siio/decisions/:id',
  ]) {
    assert.throws(() => requireSiioEndpointAccess(profile('junta'), route), error => error?.status === 403, `junta no puede ${route}`);
  }

  appServer = http.createServer(app);
  const appPort = await listen(appServer);
  let response = await requestJson(appPort, '/api/siio/records', 'director-token');
  assert.equal(response.status, 403, 'director falla cerrado antes de Task 11');
  assert.equal(siioReads, 0, 'director no consulta SIIO antes de ser denegado');

  response = await requestJson(appPort, '/api/siio/board-reports', 'board-token');
  assert.equal(response.status, 200, 'junta puede leer reportes de junta');
  assert.deepEqual(response.body.map(row => row.id), ['published-report'], 'junta sólo recibe reportes publicados');

  siioReads = 0;
  siioPaths.length = 0;
  response = await requestJson(appPort, '/api/siio/bootstrap', 'board-token');
  assert.equal(response.status, 200, 'junta puede cargar bootstrap ejecutivo reducido');
  assert.deepEqual(response.body.boardReports.map(row => row.id), ['published-report'], 'bootstrap junta filtra reportes publicados');
  for (const key of ['fronts', 'records', 'sources', 'decisions', 'boardSections', 'financialMetrics', 'commercialSignals', 'payrollAggregates', 'strategicOpportunities']) assert.deepEqual(response.body[key], [], `bootstrap junta no expone ${key}`);
  assert.deepEqual(siioPaths, ['/rest/v1/siio_monthly_board_reports'], 'bootstrap junta consulta únicamente board reports');

  siioReads = 0;
  response = await requestJson(appPort, '/api/siio/records', 'board-token');
  assert.equal(response.status, 403, 'junta no puede leer colecciones SIIO no ejecutivas');
  response = await requestJson(appPort, '/api/siio/records', 'board-token', 'POST', { id: 'ignored', title: 'ignored' });
  assert.equal(response.status, 403, 'junta no puede mutar SIIO');
  assert.equal(siioReads, 0, 'junta denegada no consulta tablas SIIO');
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('SIIO endpoint action policy regression passed');
