import { strict as assert } from 'node:assert';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const legacyProfileFields = 'id,full_name,microsoft_email,auth_user_id,role,active,commercial_area,can_edit_customer_segment';
const scenarios = {
  'director-token': {
    user: { id: 'director-user', email: 'director@example.test' },
    profile: { id: 'director-profile', full_name: 'Directora', microsoft_email: 'director@example.test', role: 'director', active: true, commercial_area: 'licitacion_publica', can_edit_customer_segment: false },
    areas: [{ area_code: 'licitaciones', subarea_code: null }, { area_code: 'comercial', subarea_code: 'tecnologia' }],
    permissions: [{ permission_code: 'licitaciones' }]
  },
  'empty-token': {
    user: { id: 'empty-user', email: 'empty@example.test' },
    profile: { id: 'empty-profile', full_name: 'Sin alcance', microsoft_email: 'empty@example.test', role: 'comercial', active: true, commercial_area: null, can_edit_customer_segment: true },
    areas: [],
    permissions: []
  },
  'inactive-token': {
    user: { id: 'inactive-user', email: 'inactive@example.test' },
    profile: { id: 'inactive-profile', full_name: 'Inactiva', microsoft_email: 'inactive@example.test', role: 'director', active: false, commercial_area: null, can_edit_customer_segment: false },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }]
  },
  'missing-token': {
    user: { id: 'missing-user', email: 'missing@example.test' },
    profile: null,
    areas: [],
    permissions: []
  },
  'assignment-error-token': {
    user: { id: 'assignment-error-user', email: 'assignment-error@example.test' },
    profile: { id: 'assignment-error-profile', full_name: 'Error áreas', microsoft_email: 'assignment-error@example.test', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: [],
    permissions: []
  },
  'permission-error-token': {
    user: { id: 'permission-error-user', email: 'permission-error@example.test' },
    profile: { id: 'permission-error-profile', full_name: 'Error permisos', microsoft_email: 'permission-error@example.test', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: [],
    permissions: []
  },
  'null-areas-token': {
    user: { id: 'null-areas-user', email: 'null-areas@example.test' },
    profile: { id: 'null-areas-profile', full_name: 'Áreas nulas', microsoft_email: 'null-areas@example.test', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: null,
    permissions: []
  },
  'malformed-permission-token': {
    user: { id: 'malformed-permission-user', email: 'malformed-permission@example.test' },
    profile: { id: 'malformed-permission-profile', full_name: 'Permiso inválido', microsoft_email: 'malformed-permission@example.test', role: 'director', active: true, commercial_area: null, can_edit_customer_segment: false },
    areas: [],
    permissions: [{ permission_code: ' licitaciones' }]
  },
  'historical-email-token': {
    user: { id: 'historical-user', email: 'directora.licitaciones@seguridadnacional.co' },
    profile: { id: 'historical-profile', full_name: 'Histórica', microsoft_email: 'directora.licitaciones@seguridadnacional.co', role: 'director', active: true, commercial_area: 'licitacion_publica', can_edit_customer_segment: false },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: []
  }
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

async function requestJson(port, path, token) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { authorization: `Bearer ${token}` } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
  });
}

const scenarioByAuthId = new Map(Object.values(scenarios).map(scenario => [scenario.user.id, scenario]));
const scenarioByProfileId = new Map(Object.values(scenarios).filter(scenario => scenario.profile).map(scenario => [scenario.profile.id, scenario]));
const observed = { auth: 0, profiles: [], areas: [], permissions: [] };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const token = bearer(req);
  const scenario = scenarios[token];
  if (url.pathname === '/auth/v1/user') {
    observed.auth += 1;
    return scenario ? json(res, 200, scenario.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    const profileScenario = scenarioByAuthId.get(authUserId);
    observed.profiles.push({ authUserId, search: url.searchParams });
    assert.ok(profileScenario, `unexpected profile lookup for Auth subject ${authUserId}`);
    assert.equal(url.searchParams.get('select'), legacyProfileFields);
    assert.equal(url.searchParams.get('active'), null, 'inactive profiles must be handled explicitly after lookup');
    assert.equal(url.searchParams.get('auth_user_id'), `eq.${profileScenario.user.id}`);
    assert.equal(url.searchParams.get('microsoft_email'), null, 'authorization must never fall back to reusable email');
    return json(res, 200, profileScenario.profile);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    const accessScenario = scenarioByProfileId.get(profileId);
    observed.areas.push({ profileId, search: url.searchParams });
    assert.ok(accessScenario, `unexpected area lookup for ${profileId}`);
    assert.equal(url.searchParams.get('select'), 'area_code,subarea_code');
    assert.equal(url.searchParams.get('profile_id'), `eq.${accessScenario.profile.id}`);
    if (accessScenario === scenarios['assignment-error-token']) {
      return json(res, 500, { message: 'relation psi_profile_area_assignments is unavailable', code: 'AUTH_CONTEXT_UNAVAILABLE' });
    }
    return json(res, 200, accessScenario.areas);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    const accessScenario = scenarioByProfileId.get(profileId);
    observed.permissions.push({ profileId, search: url.searchParams });
    assert.ok(accessScenario, `unexpected permission lookup for ${profileId}`);
    assert.equal(url.searchParams.get('select'), 'permission_code');
    assert.equal(url.searchParams.get('profile_id'), `eq.${accessScenario.profile.id}`);
    if (accessScenario === scenarios['permission-error-token']) return json(res, 500, { message: 'permissions unavailable' });
    return json(res, 200, accessScenario.permissions);
  }
  return json(res, 404, { message: `Unhandled Supabase path ${url.pathname}` });
});

const originalEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

try {
  const { getAuthContext, canViewTenders, default: app } = await import('../server/index.js');
  assert.equal(canViewTenders({ id: 'historical-profile', active: true, role: 'director', microsoft_email: 'directora.licitaciones@seguridadnacional.co', areas: [], permissions: [] }), false, 'el email histórico por sí solo no concede acceso operativo a Licitaciones');
  assert.equal(canViewTenders({ id: 'permitted-profile', active: true, role: 'director', microsoft_email: 'otra@seguridadnacional.co', areas: [], permissions: ['licitaciones'] }), true, 'el permiso explícito derivado por servidor concede acceso');
  const context = await getAuthContext({
    headers: { authorization: 'Bearer director-token' },
    body: { areas: [{ area_code: 'forged' }], permissions: ['forged'] },
    query: { areas: 'forged', permissions: 'forged' }
  });
  assert.deepEqual(context, {
    user: scenarios['director-token'].user,
    profile: {
      ...scenarios['director-token'].profile,
      areas: scenarios['director-token'].areas,
      permissions: ['licitaciones']
    },
    token: 'director-token'
  });
  assert.equal(observed.areas.filter(query => query.profileId === 'director-profile').length, 1);
  assert.equal(observed.permissions.filter(query => query.profileId === 'director-profile').length, 1);

  const empty = await getAuthContext({ headers: { authorization: 'Bearer empty-token' } });
  assert.deepEqual(empty.profile.areas, []);
  assert.deepEqual(empty.profile.permissions, []);

  for (const token of ['inactive-token', 'missing-token']) {
    await assert.rejects(
      () => getAuthContext({ headers: { authorization: `Bearer ${token}` } }),
      error => error?.status === 403
    );
    const profileId = scenarios[token].profile?.id;
    assert.equal(observed.areas.filter(query => query.profileId === profileId).length, 0, `${token} must not load areas`);
    assert.equal(observed.permissions.filter(query => query.profileId === profileId).length, 0, `${token} must not load permissions`);
  }

  const profileCountBeforeInvalid = observed.profiles.length;
  await assert.rejects(() => getAuthContext({ headers: {} }), error => error?.status === 401);
  await assert.rejects(() => getAuthContext({ headers: { authorization: 'Bearer invalid-token' } }), error => error?.status === 401);
  assert.equal(observed.profiles.length, profileCountBeforeInvalid, 'invalid authentication must not query profiles');
  assert.equal(observed.areas.length, 2, 'invalid authentication must not query areas');
  assert.equal(observed.permissions.length, 2, 'invalid authentication must not query permissions');

  const publicAuthContextFailure = 'No se pudo validar el acceso del usuario.';
  const internalDetails = /relation|psi_profile|assign|permission|area|unavailable/i;
  for (const token of ['assignment-error-token', 'permission-error-token', 'null-areas-token', 'malformed-permission-token']) {
    await assert.rejects(
      () => getAuthContext({ headers: { authorization: `Bearer ${token}` } }),
      error => {
        assert.equal(error?.status, 500);
        assert.equal(error?.code, 'AUTH_CONTEXT_UNAVAILABLE');
        assert.equal(error?.message, publicAuthContextFailure);
        assert.ok(error?.cause);
        assert.doesNotMatch(error.message, internalDetails);
        return true;
      }
    );
  }

  const originalConsoleError = console.error;
  let appServer;
  try {
    console.error = () => {};
    appServer = http.createServer(app);
    const appPort = await listen(appServer);
    const response = await requestJson(appPort, '/api/bootstrap', 'assignment-error-token');
    assert.equal(response.status, 500);
    assert.equal(response.body.error, publicAuthContextFailure);
    assert.doesNotMatch(response.body.error, internalDetails);
  } finally {
    if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
    console.error = originalConsoleError;
  }

  const historical = await getAuthContext({ headers: { authorization: 'Bearer historical-email-token' } });
  assert.deepEqual(historical.profile.permissions, [], 'historical email must not receive an inferred permission');

  const source = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(source, /import\s+\{\s*can\s*,\s*requireAction\s*\}\s+from\s+'\.\.\/access-control\.js';/);
  const authContextSource = source.slice(source.indexOf('getAuthContext'), source.indexOf('function sendAuthError'));
  assert.doesNotMatch(authContextSource, /directora\.licitaciones@seguridadnacional\.co/);
  assert.match(authContextSource, /\.eq\('auth_user_id',\s*userData\.user\.id\)/);
  assert.doesNotMatch(authContextSource, /ilike\('microsoft_email'/);
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('getAuthContext server-derived access scope and fail-closed contract passed');
