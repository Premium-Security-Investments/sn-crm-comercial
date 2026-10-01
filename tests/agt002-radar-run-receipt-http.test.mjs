// Contrato HTTP de sólo lectura para el recibo de corrida del Radar (Corte 2, mitad backend).
// Levanta el Express real (server/index.js) contra un Supabase REST falso: ejercita autenticación,
// autorización y el wiring real de las rutas /api/tenders/radar-runs/{latest,history} sin tocar
// red ni una base de datos real.
import assert from 'node:assert/strict';
import http from 'node:http';

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
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const ABSENCE_NOTICE = 'Corrida parcial o fallida: la ausencia de candidatos de una fuente que no terminó no puede interpretarse como cierre, remoción o descarte. Sólo significa que esa fuente no fue leída (o no terminó de leerse) en esta corrida.';

function receiptRow(id, { runAt, status, sourcesAttempted = [], sourcesSucceeded = [], sourcesFailed = [], fatalError = null }) {
  return {
    id, run_at: runAt,
    errors: {
      schema_version: 'agt002-radar-run-receipt-v1',
      run_id: id, started_at: runAt, finished_at: runAt,
      status,
      sources_attempted: sourcesAttempted,
      sources_succeeded: sourcesSucceeded,
      sources_failed: sourcesFailed,
      sources: sourcesAttempted.map(name => ({
        name, attempted: true, succeeded: sourcesSucceeded.includes(name),
        pages_read: 1, records_read: sourcesSucceeded.includes(name) ? 10 : 0, candidates_found: sourcesSucceeded.includes(name) ? 2 : 0,
        error: sourcesSucceeded.includes(name) ? null : 'TVEC respondió 503',
      })),
      totals: { pages_read: sourcesAttempted.length, records_read: sourcesSucceeded.length * 10, candidates_found: sourcesSucceeded.length * 2 },
      fatal_error: fatalError,
      absence_notice: status === 'complete' ? null : ABSENCE_NOTICE,
    },
  };
}

// Más reciente a más antigua: PARTIAL_ROW (latest) > FAILED_ROW > COMPLETE_ROW.
const COMPLETE_ROW = receiptRow('cccccccc-cccc-4ccc-8ccc-cccccccccccc', {
  runAt: '2026-09-28T00:00:00.000Z', status: 'complete', sourcesAttempted: ['SECOP II'], sourcesSucceeded: ['SECOP II'],
});
const FAILED_ROW = receiptRow('ffffffff-ffff-4fff-8fff-ffffffffffff', {
  runAt: '2026-09-29T00:00:00.000Z', status: 'failed', sourcesAttempted: ['SECOP II', 'TVEC'], sourcesFailed: ['SECOP II', 'TVEC'],
});
const PARTIAL_ROW = receiptRow('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
  runAt: '2026-09-30T13:00:05.000Z', status: 'partial', sourcesAttempted: ['SECOP II', 'TVEC'], sourcesSucceeded: ['SECOP II'], sourcesFailed: ['TVEC'],
});

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
let rows = [PARTIAL_ROW, FAILED_ROW, COMPLETE_ROW];

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
    const actor = Object.values(actors).find(candidate => candidate.profile.id === profileId);
    return json(res, 200, (actor?.permissions || []).map(permission_code => ({ permission_code })));
  }
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') {
    observedRadarRunsRequests.push({ method: req.method, limit: url.searchParams.get('limit'), schemaFilter: url.searchParams.get('errors->>schema_version') });
    // Replica el filtro real de PostgREST sobre la columna jsonb: se aplica ANTES del límite, para
    // que filas ajenas sin recibo (p.ej. mode:'company_profile') nunca entren en la ventana.
    const schemaFilter = url.searchParams.get('errors->>schema_version');
    const filtered = schemaFilter ? rows.filter(row => row.errors?.schema_version === schemaFilter.replace(/^eq\./, '')) : [...rows];
    const ordered = filtered.sort((a, b) => b.run_at.localeCompare(a.run_at));
    const limit = Number.parseInt(url.searchParams.get('limit'), 10) || ordered.length || 1;
    return json(res, 200, ordered.slice(0, limit));
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

  // 1. Última corrida: devuelve el recibo real más reciente ('partial' en este fixture), nunca
  //    retrocede a una fila más vieja y nunca escribe.
  observedRadarRunsRequests.length = 0;
  const latest = await requestJson(appPort, '/api/tenders/radar-runs/latest', 'licitaciones-token');
  assert.equal(latest.status, 200);
  assert.equal(latest.body.run_receipt.run_id, PARTIAL_ROW.id);
  assert.equal(latest.body.run_receipt.status, 'partial');
  assert.equal(latest.body.run_receipt.schema_version, 'agt002-radar-run-receipt-v1');
  assert.equal(latest.body.run_receipt.absence_notice, ABSENCE_NOTICE);
  assert.ok(observedRadarRunsRequests.every(request => request.method === 'GET'), 'la última corrida sólo debe leer, nunca escribir');
  assert.equal(observedRadarRunsRequests[0].schemaFilter, 'eq.agt002-radar-run-receipt-v1', 'la lectura debe filtrar por schema_version en la base, no sólo en memoria');

  // 2. Historial: respeta el límite pedido, nunca excede el tope de 10, y refleja complete/partial/
  //    failed sin normalizarlos a un único estado.
  observedRadarRunsRequests.length = 0;
  const history = await requestJson(appPort, '/api/tenders/radar-runs/history?limit=3', 'licitaciones-token');
  assert.equal(history.status, 200);
  assert.equal(history.body.run_receipts.length, 3);
  assert.deepEqual(history.body.run_receipts.map(r => r.status), ['partial', 'failed', 'complete']);
  assert.equal(observedRadarRunsRequests[0].limit, '3');
  assert.ok(observedRadarRunsRequests.every(request => request.method === 'GET'), 'el historial sólo debe leer, nunca escribir');

  observedRadarRunsRequests.length = 0;
  const historyOverLimit = await requestJson(appPort, '/api/tenders/radar-runs/history?limit=9999', 'licitaciones-token');
  assert.equal(historyOverLimit.status, 200);
  assert.equal(observedRadarRunsRequests[0].limit, '10', 'el límite real contra la base nunca pasa de 10 sin importar lo pedido');

  // 3. Autorización: un actor sin permiso de licitaciones recibe 403 y nunca llega a la tabla.
  for (const path of ['/api/tenders/radar-runs/latest', '/api/tenders/radar-runs/history']) {
    observedRadarRunsRequests.length = 0;
    const denied = await requestJson(appPort, path, 'no-permission-token');
    assert.equal(denied.status, 403, `${path} debe exigir autorización de licitaciones`);
    assert.deepEqual(observedRadarRunsRequests, [], `${path} no debe tocar psi_tender_radar_runs sin autorización`);
  }

  // 4. `psi_tender_radar_runs` es compartida con otros escritores ajenos al recibo (p.ej.
  //    mode:'company_profile' en getTenderCompanyProfile, server/index.js) que insertan filas SIN
  //    recibo. Una de esas filas con run_at más reciente que la última corrida real no debe esconder
  //    el recibo real ni recortar el historial por debajo de las corridas reales disponibles.
  rows = [PARTIAL_ROW, FAILED_ROW, COMPLETE_ROW, {
    id: 'company-profile-update', run_at: '2026-10-01T00:00:00.000Z', mode: 'company_profile', errors: null,
  }];
  observedRadarRunsRequests.length = 0;
  const latestWithForeignRow = await requestJson(appPort, '/api/tenders/radar-runs/latest', 'licitaciones-token');
  assert.equal(latestWithForeignRow.status, 200);
  assert.equal(latestWithForeignRow.body.run_receipt?.run_id, PARTIAL_ROW.id, 'una fila ajena (company_profile) más reciente sin recibo no debe esconder el recibo real ni devolver null');

  observedRadarRunsRequests.length = 0;
  const historyWithForeignRow = await requestJson(appPort, '/api/tenders/radar-runs/history', 'licitaciones-token');
  assert.equal(historyWithForeignRow.status, 200);
  assert.equal(historyWithForeignRow.body.run_receipts.length, 3, 'la fila ajena sin recibo no debe contarse ni recortar el historial real');

  // 5. Todavía sin recibos nuevos: `null`/`[]`, nunca un error ni un valor inventado.
  rows = [];
  observedRadarRunsRequests.length = 0;
  const emptyLatest = await requestJson(appPort, '/api/tenders/radar-runs/latest', 'licitaciones-token');
  assert.equal(emptyLatest.status, 200);
  assert.equal(emptyLatest.body.run_receipt, null);
  const emptyHistory = await requestJson(appPort, '/api/tenders/radar-runs/history', 'licitaciones-token');
  assert.equal(emptyHistory.status, 200);
  assert.deepEqual(emptyHistory.body.run_receipts, []);
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('AGT-002 Radar run receipt HTTP contract (real Express app, fake Supabase REST) passed');
