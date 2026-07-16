import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';
import http from 'node:http';

const radarSource = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const bundled = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { filterRadarTenders } = await import(utilsUrl);

const converted = {
  id: 'tender-converted',
  source: 'SECOP II',
  entity: 'Entidad pública',
  title: 'Proceso convertido',
  internal_status: 'convertida_oportunidad',
  converted_opportunity_id: '11111111-1111-4111-8111-111111111111',
  section: 'hacer',
  score: 80,
  value: 500_000_000,
};
const linkedWithoutNormalizedStatus = {
  ...converted,
  id: 'tender-linked-only',
  internal_status: 'nueva',
};
const baseFilters = {
  query: '', source: 'todas', region: 'todas', deadline: 'todas', value: 'todas', score: 'todas', section: 'todas', internalStatus: 'todas',
};

assert.deepEqual(filterRadarTenders([converted], baseFilters).map(row => row.id), ['tender-converted'], 'Una licitación convertida debe permanecer visible en Radar con el filtro Todas.');
assert.deepEqual(filterRadarTenders([converted], { ...baseFilters, internalStatus: 'convertida_oportunidad' }).map(row => row.id), ['tender-converted'], 'El filtro Convertida debe mostrar la licitación vinculada.');
assert.deepEqual(filterRadarTenders([converted], { ...baseFilters, internalStatus: 'nueva' }), [], 'Un filtro de otro estado no debe incluir la convertida.');
assert.deepEqual(filterRadarTenders([linkedWithoutNormalizedStatus], { ...baseFilters, internalStatus: 'convertida_oportunidad' }).map(row => row.id), ['tender-linked-only'], 'El vínculo a oportunidad debe prevalecer aunque el estado persistido todavía no esté normalizado.');
assert.deepEqual(filterRadarTenders([linkedWithoutNormalizedStatus], { ...baseFilters, internalStatus: 'nueva' }), [], 'Una licitación vinculada nunca debe reaparecer como nueva por estado persistido desfasado.');

assert.match(radarSource, /Convertida en oportunidad/, 'La tarjeta debe identificar claramente el estado convertido.');
assert.match(radarSource, /Abrir oportunidad/, 'La tarjeta convertida debe abrir la oportunidad comercial vinculada.');
assert.match(radarSource, /Abrir expediente/, 'La tarjeta convertida debe abrir su expediente documental.');
assert.doesNotMatch(radarSource, /no se muestran en Radar|se gestionan fuera del Radar/, 'El copy no debe afirmar que las convertidas desaparecen del Radar.');
assert.match(serverSource, /internal_status\.eq\.convertida_oportunidad/, 'La consulta persistida debe recuperar convertidas aunque estén fuera de la ventana activa.');
assert.match(serverSource, /isConvertedTenderRecord\(row\) \|\| isTenderTrackable\(row\)/, 'El backend debe conservar convertidas aunque el proceso público ya tenga estado terminal.');
assert.match(serverSource, /isConvertedTenderRecord\(t\) \|\| !\['SECOP I','SECOP II'\]\.includes\(t\.source\) \|\| hasTenderServiceSignal\(t\)/, 'Una convertida vinculada no debe desaparecer por filtros de señal posteriores.');

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function requestJson(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: { authorization: 'Bearer radar-review-token' } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const activeRows = Array.from({ length: 250 }, (_, index) => ({
  stable_key: `active-${index}`,
  source: 'TVEC',
  section: 'hacer',
  entity: `Entidad ${index}`,
  title: `Proceso activo ${index}`,
  status: 'abierto',
  deadline_at: '2027-12-31T23:59:59.000Z',
  last_seen_at: '2026-07-15T12:00:00.000Z',
  internal_status: 'nueva',
  score: 80,
}));
const oldConvertedRow = {
  stable_key: 'old-converted-outside-active-window',
  source: 'SECOP II',
  section: 'hacer',
  entity: 'Entidad convertida',
  title: 'Proceso histórico convertido',
  status: 'terminado',
  deadline_at: '2025-01-01T00:00:00.000Z',
  last_seen_at: '2025-01-01T00:00:00.000Z',
  internal_status: 'convertida_oportunidad',
  converted_opportunity_id: '22222222-2222-4222-8222-222222222222',
  score: 70,
};
const observedTenderOrFilters = [];
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return json(res, 200, { id: 'radar-review-user', email: 'radar-review@example.test' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const profile = { id: 'radar-review-profile', full_name: 'Radar Review', microsoft_email: 'radar-review@example.test', role: 'director', active: true };
    return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') return json(res, 200, { run_at: '2026-07-15T12:00:00.000Z', mode: 'cron_export' });
  if (url.pathname === '/rest/v1/psi_profile_area_assignments' || url.pathname === '/rest/v1/psi_profile_permissions') {
    return json(res, 200, []);
  }
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    if (url.searchParams.get('select') === 'id') return json(res, 200, [{ id: 'available' }]);
    const orFilter = decodeURIComponent(url.searchParams.get('or') || '');
    observedTenderOrFilters.push(orFilter);
    const convertedOnly = orFilter.includes('internal_status.eq.convertida_oportunidad') && !orFilter.includes('last_seen_at.gte');
    return json(res, 200, convertedOnly ? [oldConvertedRow] : activeRows);
  }
  return json(res, 404, { message: `Unhandled fake Supabase path ${url.pathname}` });
});

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'radar-review-service-key';
process.env.VERCEL = '1';

try {
  for (const [index, backend] of ['../server/index.js', '../api/[...path].js'].entries()) {
    const { default: app } = await import(`${backend}?converted-volume-regression=${index}`);
    const appServer = app.listen(0, '127.0.0.1');
    await new Promise(resolve => appServer.once('listening', resolve));
    try {
      const response = await requestJson(appServer.address().port, '/api/tenders');
      assert.equal(response.status, 200, `${backend} debe responder correctamente.`);
      assert.ok(response.body.tenders.some(row => row.stable_key === oldConvertedRow.stable_key), `${backend} debe conservar una convertida antigua aunque existan 250 activas más recientes.`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
  const convertedOnlyQueries = observedTenderOrFilters.filter(filter => filter.includes('internal_status.eq.convertida_oportunidad') && !filter.includes('last_seen_at.gte'));
  assert.equal(convertedOnlyQueries.length, 2, 'Los dos entrypoints deben consultar las convertidas separadas de la ventana activa.');
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
}

console.log('converted tenders remain visible in Radar');
