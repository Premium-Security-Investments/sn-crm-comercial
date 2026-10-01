// Contrato HTTP de sólo lectura para el delta de corrida del Radar (Corte 3, mitad backend).
// Levanta el Express real (server/index.js) contra un Supabase REST falso: ejercita autenticación,
// autorización y el wiring real de la ruta /api/tenders/radar-runs/delta sin tocar red ni una base
// de datos real.
//
// RED deliberado: la ruta /api/tenders/radar-runs/delta todavía no existe en server/index.js, así
// que toda petición a ella hoy responde 404 (o lo que Express haga por defecto para una ruta no
// montada), nunca 200 con `{ delta }`. Esta suite fija el contrato completo: lectura exclusiva de
// las dos corridas persistidas más recientes, misma autorización que GET /api/tenders, estado vacío
// sin baseline, y fail-closed ante un snapshot corrupto almacenado (nunca filtra su contenido crudo
// en la respuesta).
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildAgt002RadarRunSnapshot, computeAgt002RadarRunDelta } from '../agt002-radar-run-delta.js';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function requestJson(port, path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let body = null;
        try { body = JSON.parse(text); } catch { body = null; }
        resolve({ status: response.statusCode, text, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const candidate = (overrides = {}) => ({
  stable_key: 'k-1', source: 'SECOP II', title: 'Vigilancia armada', entity: 'Alcaldía de Manizales',
  deadline: '2026-10-15', fit_band: 'alto', fit_reasons: ['coincide objeto'], known_phases: ['radar'],
  ...overrides,
});
const src = (source, status, candidates = []) => ({ source, status, candidates: status === 'success' ? candidates : undefined });
const snap = (runId, finishedAt, sources) => buildAgt002RadarRunSnapshot({ run_id: runId, finished_at: finishedAt, sources });

const PREVIOUS_SNAPSHOT = snap('run-1', '2026-09-29T08:00:00.000Z', [src('SECOP II', 'success', [candidate({ stable_key: 'k-a', deadline: '2026-10-15' })])]);
const LATEST_SNAPSHOT = snap('run-2', '2026-09-30T08:00:00.000Z', [src('SECOP II', 'success', [
  candidate({ stable_key: 'k-a', deadline: '2026-10-25' }),
  candidate({ stable_key: 'k-b', title: 'Obra pública' }),
])]);
const EXPECTED_DELTA = computeAgt002RadarRunDelta(PREVIOUS_SNAPSHOT, LATEST_SNAPSHOT);

function radarRunRow(id, runAt, snapshot) {
  return {
    id, run_at: runAt,
    errors: {
      schema_version: 'agt002-radar-run-receipt-v1', run_id: id, started_at: runAt, finished_at: runAt, status: 'complete',
      sources_attempted: ['SECOP II'], sources_succeeded: ['SECOP II'], sources_failed: [],
      sources: [{ name: 'SECOP II', attempted: true, succeeded: true, pages_read: 1, records_read: 1, candidates_found: 1, error: null }],
      totals: { pages_read: 1, records_read: 1, candidates_found: 1 }, fatal_error: null, absence_notice: null,
      radar_run_snapshot_schema_version: 'agt002-radar-run-delta-v1',
      radar_run_snapshot: snapshot,
    },
  };
}

const actors = {
  'licitaciones-token': {
    user: { id: 'licitaciones-auth', email: 'licitaciones@example.test' },
    profile: { id: 'licitaciones-profile', full_name: 'Licitaciones', microsoft_email: 'licitaciones@example.test', auth_user_id: 'licitaciones-auth', role: 'director', active: true },
    permissions: ['licitaciones'],
  },
  'no-permission-token': {
    user: { id: 'no-permission-auth', email: 'sin-permiso@example.test' },
    profile: { id: 'no-permission-profile', full_name: 'Sin permiso', microsoft_email: 'sin-permiso@example.test', auth_user_id: 'no-permission-auth', role: 'comercial', active: true },
    permissions: [],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const observedRadarRunsRequests = [];
let rows = [radarRunRow(LATEST_SNAPSHOT.run_id, '2026-09-30T08:00:00.000Z', LATEST_SNAPSHOT), radarRunRow(PREVIOUS_SNAPSHOT.run_id, '2026-09-29T08:00:00.000Z', PREVIOUS_SNAPSHOT)];

function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    const actor = actorByAuthId.get(authUserId);
    if (actor) return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? actor.profile : [actor.profile]);
    return json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    const actor = Object.values(actors).find(candidateActor => candidateActor.profile.id === profileId);
    return json(res, 200, (actor?.permissions || []).map(permission_code => ({ permission_code })));
  }
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') {
    observedRadarRunsRequests.push({ method: req.method, query: url.search });
    const ordered = [...rows].sort((a, b) => b.run_at.localeCompare(a.run_at));
    return json(res, 200, ordered);
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

  // 1. Delta entre las dos corridas persistidas más recientes: nunca escribe, compara exactamente
  //    `previous`/`latest` tal como quedaron persistidos.
  observedRadarRunsRequests.length = 0;
  const delta = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'licitaciones-token');
  assert.equal(delta.status, 200, 'la ruta /api/tenders/radar-runs/delta debe existir y responder 200');
  assert.deepEqual(delta.body.delta, EXPECTED_DELTA);
  assert.ok(observedRadarRunsRequests.every(request => request.method === 'GET'), 'el delta sólo debe leer, nunca escribir');

  // 2. Autorización: misma que GET /api/tenders. Un actor sin permiso recibe 403 y nunca toca la tabla.
  observedRadarRunsRequests.length = 0;
  const denied = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'no-permission-token');
  assert.equal(denied.status, 403);
  assert.deepEqual(observedRadarRunsRequests, [], 'sin autorización, la ruta no debe tocar psi_tender_radar_runs');

  // 3. Sin ninguna corrida persistida todavía: `{ delta: null }`, nunca un error.
  rows = [];
  observedRadarRunsRequests.length = 0;
  const empty = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'licitaciones-token');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.delta, null);

  // 4. Una sola corrida persistida (sin baseline todavía): `baseline_available:false`, nunca inventa
  //    "nuevo" para ningún candidato de esa única corrida.
  rows = [radarRunRow(LATEST_SNAPSHOT.run_id, '2026-09-30T08:00:00.000Z', LATEST_SNAPSHOT)];
  observedRadarRunsRequests.length = 0;
  const onlyOne = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'licitaciones-token');
  assert.equal(onlyOne.status, 200);
  assert.equal(onlyOne.body.delta.baseline_available, false);
  assert.equal(onlyOne.body.delta.previous_run, null);
  assert.deepEqual(onlyOne.body.delta.changes, []);

  // 5. Fila ajena sin snapshot (p.ej. mode:'company_profile') con run_at más reciente no debe
  //    esconder la última corrida real ni colarse como baseline.
  rows = [
    radarRunRow(LATEST_SNAPSHOT.run_id, '2026-09-30T08:00:00.000Z', LATEST_SNAPSHOT),
    radarRunRow(PREVIOUS_SNAPSHOT.run_id, '2026-09-29T08:00:00.000Z', PREVIOUS_SNAPSHOT),
    { id: 'company-profile-update', run_at: '2026-10-01T00:00:00.000Z', mode: 'company_profile', errors: null },
  ];
  observedRadarRunsRequests.length = 0;
  const withForeignRow = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'licitaciones-token');
  assert.equal(withForeignRow.status, 200);
  assert.deepEqual(withForeignRow.body.delta, EXPECTED_DELTA, 'una fila ajena más reciente sin snapshot no debe alterar el delta real');

  // 6. Seguridad/no fuga: un snapshot corrupto persistido (campo fuera del allowlist, con un
  //    secreto colado) debe fallar cerrado -- nunca 200 con el contenido crudo filtrado en la
  //    respuesta HTTP, y el secreto nunca debe aparecer en el cuerpo de la respuesta.
  const pollutedSnapshot = { ...LATEST_SNAPSHOT, candidates: [{ ...LATEST_SNAPSHOT.candidates[0], raw: { api_key: 'sk-live-leak-canary' } }] };
  rows = [
    radarRunRow(LATEST_SNAPSHOT.run_id, '2026-09-30T08:00:00.000Z', pollutedSnapshot),
    radarRunRow(PREVIOUS_SNAPSHOT.run_id, '2026-09-29T08:00:00.000Z', PREVIOUS_SNAPSHOT),
  ];
  observedRadarRunsRequests.length = 0;
  const polluted = await requestJson(appPort, '/api/tenders/radar-runs/delta', 'licitaciones-token');
  assert.notEqual(polluted.status, 200, 'un snapshot persistido corrupto nunca debe responder 200 con contenido fuera del contrato');
  assert.equal(polluted.text.includes('sk-live-leak-canary'), false, 'el secreto colado nunca debe aparecer en la respuesta HTTP');
  assert.equal(polluted.text.includes('api_key'), false, 'ningún campo fuera del allowlist debe filtrarse en la respuesta HTTP');
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('AGT-002 Radar run delta HTTP contract (real Express app, fake Supabase REST) — expected to fail until /api/tenders/radar-runs/delta exists');
