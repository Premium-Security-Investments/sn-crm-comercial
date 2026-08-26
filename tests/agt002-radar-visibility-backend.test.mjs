import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { computeAgt002RadarSourceRowHash, AGT002_RADAR_GATE_CONTEXT_VERSION, AGT002_RADAR_GATE_POLICY_VERSION } from '../agt002-radar-gate.js';

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
    const req = http.request({ hostname: '127.0.0.1', port, path, headers: { authorization: 'Bearer radar-visibility-token' } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const base = {
  source: 'TVEC', section: 'hacer', entity: 'Entidad', title: 'Servicio de vigilancia armada',
  status: 'abierto', deadline_at: '2030-12-31T23:59:59.000Z', last_seen_at: '2026-08-25T12:00:00.000Z',
  internal_status: 'nueva', score: 80, raw: { modalidad: 'licitacion publica' },
};
const row = (id, stableKey, extra = {}) => ({ id, stable_key: stableKey, ...base, ...extra });
const visible = row('11111111-1111-4111-8111-111111111111', 'visible');
const converted = row('22222222-2222-4222-8222-222222222222', 'converted', {
  internal_status: 'convertida_oportunidad', converted_opportunity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'cancelado', deadline_at: '2025-01-01T00:00:00.000Z',
});
const hidden = row('33333333-3333-4333-8333-333333333333', 'hidden');
const inconclusive = row('44444444-4444-4444-8444-444444444444', 'inconclusive');
const staleHash = row('55555555-5555-4555-8555-555555555555', 'stale-hash');
const stalePolicy = row('66666666-6666-4666-8666-666666666666', 'stale-policy');
const staleContext = row('77777777-7777-4777-8777-777777777777', 'stale-context');
const missing = row('88888888-8888-4888-8888-888888888888', 'missing');
// BLOCKER A2: canonico positivo y fresco, pero la fecha de cierre ya paso. El gate determinista se
// reevalua en lectura, asi que esta fila no puede seguir visible por inercia del canonico.
const expired = row('99999999-9999-4999-8999-999999999999', 'expired', { deadline_at: '2020-01-01T00:00:00.000Z' });
const activeRows = [visible, converted, hidden, inconclusive, staleHash, stalePolicy, staleContext, missing, expired];
const canonicalRows = [
  { tender_id: visible.id, canonical: true, visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(visible), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
  { tender_id: hidden.id, canonical: true, visibility_verdict: 'no_mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(hidden), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
  { tender_id: inconclusive.id, canonical: true, visibility_verdict: 'no_concluyente', source_row_hash: computeAgt002RadarSourceRowHash(inconclusive), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
  { tender_id: staleHash.id, canonical: true, visibility_verdict: 'mostrar_en_radar', source_row_hash: 'f'.repeat(64), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
  { tender_id: stalePolicy.id, canonical: true, visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(stalePolicy), policy_version: 'old-policy', context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
  { tender_id: staleContext.id, canonical: true, visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(staleContext), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: 'old-context' },
  { tender_id: expired.id, canonical: true, visibility_verdict: 'mostrar_en_radar', source_row_hash: computeAgt002RadarSourceRowHash(expired), policy_version: AGT002_RADAR_GATE_POLICY_VERSION, context_version: AGT002_RADAR_GATE_CONTEXT_VERSION },
];
// El hash de la fila fuente no depende del reloj de ingesta: el unico eje que oculta a `expired` es
// el veredicto vigente del gate, no una supuesta falta de frescura.
assert.equal(computeAgt002RadarSourceRowHash(expired), computeAgt002RadarSourceRowHash({ ...expired, last_seen_at: '2026-08-26T23:00:00.000Z' }));
assert.equal(computeAgt002RadarSourceRowHash(visible), computeAgt002RadarSourceRowHash({ ...visible, last_seen_at: '2026-08-26T23:00:00.000Z' }));
let scenario = { ledgerError: false, ledgerQueries: 0 };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return json(res, 200, { id: 'radar-user', email: 'radar@example.test' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const profile = { id: 'radar-profile', full_name: 'Radar', microsoft_email: 'radar@example.test', role: 'director', active: true };
    return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'licitaciones' }]);
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') return json(res, 200, { run_at: '2026-08-25T12:00:00.000Z', mode: 'test' });
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    if (url.searchParams.get('select') === 'id') return json(res, 200, [{ id: visible.id }]);
    const convertedOnly = decodeURIComponent(url.searchParams.get('internal_status') || '') === 'eq.convertida_oportunidad';
    return json(res, 200, convertedOnly ? [converted] : activeRows);
  }
  if (url.pathname === '/rest/v1/psi_agt002_radar_preanalysis_runs') {
    scenario.ledgerQueries += 1;
    if (scenario.ledgerError) return json(res, 503, { message: 'ledger unavailable' });
    return json(res, 200, canonicalRows);
  }
  return json(res, 404, { message: `Unhandled fake Supabase path ${url.pathname}` });
});

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'radar-service-key';
process.env.VERCEL = '1';
const originalFlags = { gate: process.env.AGT002_RADAR_GATE, visibility: process.env.AGT002_RADAR_VISIBILITY };

async function runBackend(backend, suffix, env) {
  if (env.gate === undefined) delete process.env.AGT002_RADAR_GATE; else process.env.AGT002_RADAR_GATE = env.gate;
  if (env.visibility === undefined) delete process.env.AGT002_RADAR_VISIBILITY; else process.env.AGT002_RADAR_VISIBILITY = env.visibility;
  const { default: app } = await import(`${backend}?radar-visibility=${suffix}`);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { return await requestJson(server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

try {
  for (const [backendIndex, backend] of ['../server/index.js', '../api/[...path].js'].entries()) {
    scenario = { ledgerError: false, ledgerQueries: 0 };
    const off = await runBackend(backend, `${backendIndex}-off`, {});
    assert.equal(off.status, 200);
    assert.deepEqual(off.body.tenders.map(item => item.stable_key).sort(), activeRows.map(item => item.stable_key).sort());
    assert.equal(scenario.ledgerQueries, 0, `${backend} no debe consultar el ledger con flags OFF`);

    const gateOnly = await runBackend(backend, `${backendIndex}-gate-only`, { gate: 'true' });
    assert.equal(gateOnly.status, 200);
    assert.deepEqual(gateOnly.body, off.body, `${backend} debe conservar payload byte-equivalente sin visibility`);
    assert.equal(scenario.ledgerQueries, 0);

    const on = await runBackend(backend, `${backendIndex}-on`, { gate: 'true', visibility: 'true' });
    assert.equal(on.status, 200);
    // `visible` sigue vigente (cierre 2030); `expired` tiene canonico positivo y fresco pero ya
    // cruzo su cierre; `converted` esta cancelada y vencida y aun asi se muestra siempre.
    assert.deepEqual(on.body.tenders.map(item => item.stable_key).sort(), ['converted', 'visible']);
    assert.equal(on.body.tenders.some(item => item.stable_key === 'expired'), false, `${backend} debe ocultar un positivo canonico ya vencido`);
    assert.equal(on.body.tenders.some(item => item.stable_key === 'converted'), true, `${backend} debe mostrar siempre las convertidas`);
    assert.deepEqual(Object.keys(on.body.tenders.find(item => item.stable_key === 'visible')).sort(), Object.keys(off.body.tenders.find(item => item.stable_key === 'visible')).sort());
    assert.equal(scenario.ledgerQueries, 1);

    scenario.ledgerError = true;
    const unavailable = await runBackend(backend, `${backendIndex}-unavailable`, { gate: 'true', visibility: 'true' });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.code, 'AGT002_RADAR_VISIBILITY_LEDGER_UNAVAILABLE');
  }

  const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const persistStart = serverSource.indexOf('async function persistTenderRadar');
  const persistEnd = serverSource.indexOf('async function buildTenderRadar', persistStart);
  assert.doesNotMatch(serverSource.slice(persistStart, persistEnd), /radar_preanalysis|evaluateAgt002RadarGate/);
} finally {
  if (originalFlags.gate === undefined) delete process.env.AGT002_RADAR_GATE; else process.env.AGT002_RADAR_GATE = originalFlags.gate;
  if (originalFlags.visibility === undefined) delete process.env.AGT002_RADAR_VISIBILITY; else process.env.AGT002_RADAR_VISIBILITY = originalFlags.visibility;
  await new Promise(resolve => fakeSupabase.close(resolve));
}

console.log('AGT-002 Radar backend visibility is byte-shape stable and fails closed at 503');
