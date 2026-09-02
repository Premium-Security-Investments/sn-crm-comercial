import { strict as assert } from 'node:assert';
import http from 'node:http';

// Business contract: the main Radar (/api/tenders) must hide a converted tender whose linked
// opportunity's current decision is NO-GO, while keeping GO/pending decisions and merely-expired
// tenders visible. NO-GO is archival, not deletion: this test only asserts on the read payload of
// the Radar endpoint, never on writes to psi_public_tenders or psi_sales_opportunities.

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
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: { authorization: 'Bearer radar-no-go-token' } }, response => {
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

// Active, never converted: unaffected by any decision.
const activeNew = row('11111111-1111-4111-8111-111111111111', 'active-new');
// Converted with a current GO decision: must remain visible.
const convertedGo = converted('22222222-2222-4222-8222-222222222222', 'converted-go', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
// Converted, decision still pending: must remain visible.
const convertedPending = converted('33333333-3333-4333-8333-333333333333', 'converted-pending', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
// Converted with a current NO-GO decision: must be excluded from the main Radar.
const convertedNoGo = converted('44444444-4444-4444-8444-444444444444', 'converted-no-go', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
// Converted, GO decision, but the deadline is in the past: expiry alone must NOT hide it.
const convertedExpiredGo = converted('55555555-5555-4555-8555-555555555555', 'converted-expired-go', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', { deadline_at: '2020-01-01T00:00:00.000Z' });
// Converted with a NO-GO later reversed to GO: the current (non-superseded) decision governs, so it must remain visible.
const convertedReversedToGo = converted('66666666-6666-4666-8666-666666666666', 'converted-reversed-go', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
// Converted and awarded (closed, but not NO-GO): "closed" must not be conflated with NO-GO.
const convertedAwarded = converted('77777777-7777-4777-8777-777777777777', 'converted-awarded', 'ffffffff-ffff-4fff-8fff-ffffffffffff');

const activeRows = [activeNew, convertedGo, convertedPending, convertedNoGo, convertedExpiredGo, convertedReversedToGo, convertedAwarded];
const opportunityStatusById = {
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa': 'en_preparacion',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb': 'pendiente_decision',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc': 'cerrada_no_go',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd': 'en_preparacion',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee': 'en_preparacion',
  'ffffffff-ffff-4fff-8fff-ffffffffffff': 'adjudicada',
};

const observed = { opportunityQueries: 0 };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return json(res, 200, { id: 'radar-no-go-user', email: 'radar-no-go@example.test' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const profile = { id: 'radar-no-go-profile', full_name: 'Radar No-Go', microsoft_email: 'radar-no-go@example.test', role: 'director', active: true };
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
    observed.opportunityQueries += 1;
    const idFilter = decodeURIComponent(url.searchParams.get('id') || '');
    const requested = idFilter.startsWith('in.(') ? idFilter.slice(4, -1).split(',') : [];
    return json(res, 200, requested.map(id => ({ id, tender_offer_status: opportunityStatusById[id] || 'pendiente_decision' })));
  }
  return json(res, 404, { message: `Unhandled fake Supabase path ${url.pathname}` });
});

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'radar-no-go-service-key';
process.env.VERCEL = '1';

try {
  for (const [index, backend] of ['../server/index.js', '../api/[...path].js'].entries()) {
    const { default: app } = await import(`${backend}?radar-no-go-visibility=${index}`);
    const appServer = app.listen(0, '127.0.0.1');
    await new Promise(resolve => appServer.once('listening', resolve));
    try {
      const response = await requestJson(appServer.address().port);
      assert.equal(response.status, 200, `${backend} debe responder correctamente.`);
      const stableKeys = response.body.tenders.map(item => item.stable_key).sort();
      assert.equal(stableKeys.includes('converted-no-go'), false, `${backend} debe ocultar una convertida con decisión NO-GO vigente.`);
      assert.deepEqual(stableKeys, ['active-new', 'converted-awarded', 'converted-expired-go', 'converted-go', 'converted-pending', 'converted-reversed-go'].sort(), `${backend} debe conservar activas, pendientes, GO, vencidas no-NO-GO y adjudicadas.`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
  assert.ok(observed.opportunityQueries > 0, 'El backend debe consultar el estado de la oportunidad vinculada para aplicar la exclusión NO-GO.');
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
}

console.log('Main Radar hides NO-GO opportunities and keeps GO/pending/expired-non-NO-GO visible');
