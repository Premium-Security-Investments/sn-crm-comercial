import { strict as assert } from 'node:assert';
import http from 'node:http';

// Business contract: the NO-GO-status lookup against psi_sales_opportunities is auxiliary to the
// main Radar. If that lookup fails (Supabase/table/query error), /api/tenders must still respond
// 200 and keep converted/trackable tenders visible rather than hiding or deleting them: an
// unavailable lookup fails open (availability wins), it does not take down the whole endpoint. A
// NO-GO tender remaining visible during the outage is an acceptable degraded state as long as it
// is observable via a structured warning, never a reason to fail the whole request.

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
function requestJson(port, path = '/api/tenders') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: { authorization: 'Bearer radar-no-go-fail-open-token' } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const base = {
  source: 'TVEC', section: 'hacer', entity: 'Entidad genérica', title: 'Servicio de vigilancia armada',
  status: 'abierto', deadline_at: '2030-12-31T23:59:59.000Z', last_seen_at: '2026-08-25T12:00:00.000Z',
  internal_status: 'nueva', score: 80,
};
const row = (id, stableKey, extra = {}) => ({ id, stable_key: stableKey, ...base, ...extra });
const converted = (id, stableKey, opportunityId, extra = {}) => row(id, stableKey, {
  internal_status: 'convertida_oportunidad', converted_opportunity_id: opportunityId, ...extra,
});

const activeNew = row('11111111-1111-4111-8111-111111111111', 'active-new');
// Converted tender whose linked opportunity's NO-GO status cannot be read while the lookup is
// down: it must remain visible (fail open), not be hidden or deleted.
const convertedUnknownDecision = converted('22222222-2222-4222-8222-222222222222', 'converted-unknown-decision', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

const activeRows = [activeNew, convertedUnknownDecision];

const observed = { opportunityQueries: 0 };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return json(res, 200, { id: 'radar-no-go-fail-open-user', email: 'radar-no-go-fail-open@example.test' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const profile = { id: 'radar-no-go-fail-open-profile', full_name: 'Radar No-Go Fail Open', microsoft_email: 'radar-no-go-fail-open@example.test', role: 'director', active: true };
    return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'licitaciones' }]);
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') return json(res, 200, { run_at: '2026-08-25T12:00:00.000Z', mode: 'test' });
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    if (url.searchParams.get('select') === 'id') return json(res, 200, [{ id: activeNew.id }]);
    const convertedOnly = decodeURIComponent(url.searchParams.get('internal_status') || '') === 'eq.convertida_oportunidad';
    return json(res, 200, convertedOnly ? activeRows.filter(item => item.internal_status === 'convertida_oportunidad') : activeRows);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    // Simulate the NO-GO-status lookup itself failing (table/query/connection error), not the
    // rest of the Radar read path.
    observed.opportunityQueries += 1;
    return json(res, 500, { message: 'simulated psi_sales_opportunities outage' });
  }
  return json(res, 404, { message: `Unhandled fake Supabase path ${url.pathname}` });
});

const originalWarn = console.warn;
const warnCalls = [];
console.warn = (...args) => { warnCalls.push(args); };

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'radar-no-go-fail-open-service-key';
process.env.VERCEL = '1';

try {
  for (const [index, backend] of ['../server/index.js', '../api/[...path].js'].entries()) {
    const { default: app } = await import(`${backend}?radar-no-go-lookup-fail-open=${index}`);
    const appServer = app.listen(0, '127.0.0.1');
    await new Promise(resolve => appServer.once('listening', resolve));
    try {
      const response = await requestJson(appServer.address().port);
      assert.equal(response.status, 200, `${backend} debe responder 200 aunque falle la consulta de estado NO-GO.`);
      const stableKeys = response.body.tenders.map(item => item.stable_key).sort();
      assert.deepEqual(stableKeys, ['active-new', 'converted-unknown-decision'].sort(), `${backend} debe conservar visibles las convertidas cuando falla la consulta auxiliar de NO-GO.`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
  assert.ok(observed.opportunityQueries > 0, 'La prueba debe ejercitar realmente el fallo de la consulta de estado NO-GO.');
  assert.ok(
    warnCalls.some(args => args[0] === 'tender_radar_no_go_lookup_failed'),
    'El backend debe emitir una advertencia estructurada cuando falla la consulta auxiliar de NO-GO.',
  );
  for (const args of warnCalls) {
    if (args[0] !== 'tender_radar_no_go_lookup_failed') continue;
    const serialized = JSON.stringify(args);
    assert.doesNotMatch(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/, 'La advertencia no debe filtrar identificadores de oportunidad.');
  }
} finally {
  console.warn = originalWarn;
  await new Promise(resolve => fakeSupabase.close(resolve));
}

console.log('NO-GO lookup failure fails open and keeps converted tenders visible');
