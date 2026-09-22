import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import http from 'node:http';

// Regla de producto: el Radar principal (/api/tenders) no muestra NINGÚN proceso vencido, ni
// siquiera uno convertido en oportunidad. La conversión no es un salvoconducto de visibilidad: el
// proceso vencido sigue íntegro en Oportunidades y en su expediente (esta prueba verifica que el
// Radar solo lee, nunca borra ni muta la oportunidad vinculada). Si la fuente oficial vuelve a
// publicar una fecha de cierre vigente, la fila reaparece sola en la siguiente lectura.
// Contrato preservado (PR #203): el preanálisis AGT-002 nunca gobierna visibilidad, así que un
// candidato rastreable NO vencido sigue visible sin importar su veredicto.

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
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: { authorization: 'Bearer radar-hide-expired-token' } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const EXPIRED_AT = '2020-01-01T00:00:00.000Z';
const CURRENT_AT = '2030-12-31T23:59:59.000Z';
const base = {
  source: 'TVEC', section: 'hacer', title: 'Servicio de vigilancia armada y seguridad privada',
  status: 'abierto', last_seen_at: '2026-08-25T12:00:00.000Z', internal_status: 'nueva', score: 80,
};
const row = (id, stableKey, extra = {}) => ({ id, stable_key: stableKey, ...base, ...extra });
const converted = (id, stableKey, opportunityId, extra = {}) => row(id, stableKey, {
  internal_status: 'convertida_oportunidad', converted_opportunity_id: opportunityId, ...extra,
});

// Cali: convertida en oportunidad y ya vencida. Debe desaparecer del Radar pese a la conversión,
// y reaparecer sola cuando la fuente oficial republique una fecha vigente (escenario `refreshed`).
const caliConvertedExpired = () => converted(
  '11111111-1111-4111-8111-111111111111', 'cali-convertida-vencida', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  { entity: 'Alcaldía de Santiago de Cali', ref: 'CALI-LP-001', deadline_at: scenario.caliDeadlineAt },
);
// Procuraduría: convertida en oportunidad y vencida. Mismo trato que Cali.
const procuraduriaConvertedExpired = converted(
  '22222222-2222-4222-8222-222222222222', 'procuraduria-convertida-vencida', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  { entity: 'Procuraduría General de la Nación', ref: 'PGN-LP-010', deadline_at: EXPIRED_AT },
);
// Procuraduría, vencida pero nunca convertida: ya estaba oculta y debe seguir oculta.
const procuraduriaExpiredNueva = row(
  '33333333-3333-4333-8333-333333333333', 'procuraduria-vencida-nueva',
  { entity: 'Procuraduría General de la Nación', ref: 'PGN-LP-011', deadline_at: EXPIRED_AT },
);
// Controles vigentes: no deben verse afectados por la regla de vencimiento.
const procuraduriaCurrentNueva = row(
  '44444444-4444-4444-8444-444444444444', 'procuraduria-vigente-nueva',
  { entity: 'Procuraduría General de la Nación', ref: 'PGN-LP-012', deadline_at: CURRENT_AT },
);
const caliCurrentConverted = converted(
  '55555555-5555-4555-8555-555555555555', 'cali-vigente-convertida', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  { entity: 'Alcaldía de Santiago de Cali', ref: 'CALI-LP-002', deadline_at: CURRENT_AT },
);
// Sin fecha de cierre reportada no hay evidencia de vencimiento: la fila permanece visible.
const caliSinFecha = row(
  '66666666-6666-4666-8666-666666666666', 'cali-sin-fecha',
  { entity: 'Alcaldía de Santiago de Cali', ref: 'CALI-LP-003' },
);

const scenario = { caliDeadlineAt: EXPIRED_AT, writes: [] };
const allRows = () => [caliConvertedExpired(), procuraduriaConvertedExpired, procuraduriaExpiredNueva, procuraduriaCurrentNueva, caliCurrentConverted, caliSinFecha];

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET' && /psi_public_tenders|psi_sales_opportunities/.test(url.pathname)) scenario.writes.push(`${req.method} ${url.pathname}`);
  if (url.pathname === '/auth/v1/user') return json(res, 200, { id: 'radar-hide-expired-user', email: 'radar-hide-expired@example.test' });
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const profile = { id: 'radar-hide-expired-profile', full_name: 'Radar Vencidas', microsoft_email: 'radar-hide-expired@example.test', role: 'director', active: true };
    return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'licitaciones' }]);
  if (url.pathname === '/rest/v1/psi_tender_radar_runs') return json(res, 200, { run_at: '2026-08-25T12:00:00.000Z', mode: 'test' });
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    if (url.searchParams.get('select') === 'id') return json(res, 200, [{ id: procuraduriaCurrentNueva.id }]);
    const convertedOnly = decodeURIComponent(url.searchParams.get('internal_status') || '') === 'eq.convertida_oportunidad';
    const rows = allRows();
    return json(res, 200, convertedOnly ? rows.filter(item => item.internal_status === 'convertida_oportunidad') : rows);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const idFilter = decodeURIComponent(url.searchParams.get('id') || '');
    const requested = idFilter.startsWith('in.(') ? idFilter.slice(4, -1).split(',') : [];
    return json(res, 200, requested.map(id => ({ id, tender_offer_status: 'en_preparacion' })));
  }
  return json(res, 404, { message: `Unhandled fake Supabase path ${url.pathname}` });
});

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'radar-hide-expired-service-key';
process.env.VERCEL = '1';

const BACKENDS = ['../server/index.js', '../api/[...path].js'];

async function radarStableKeys(backend, suffix) {
  const { default: app } = await import(`${backend}?radar-hide-expired=${suffix}`);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await requestJson(server.address().port);
    assert.equal(response.status, 200, `${backend} debe responder correctamente.`);
    return { keys: response.body.tenders.map(item => item.stable_key).sort(), body: response.body };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

try {
  // 1) Seam puro compartido: una sola función decide "vencido" para la ruta viva y la persistida.
  for (const backend of BACKENDS) {
    const module = await import(`${backend}?radar-hide-expired-seam`);
    const isExpired = module.isExpiredRadarProcess;
    assert.equal(typeof isExpired, 'function', `${backend} debe exportar isExpiredRadarProcess como seam único de vencimiento.`);
    assert.equal(isExpired({ days: -1 }), true, 'Un proceso con días negativos está vencido.');
    assert.equal(isExpired({ days: 0 }), false, 'Cierre hoy todavía es vigente.');
    assert.equal(isExpired({ days: 5 }), false, 'Cierre futuro es vigente.');
    assert.equal(isExpired({ days: null }), false, 'Sin fecha reportada no hay evidencia de vencimiento.');
    assert.equal(isExpired({}), false, 'Una fila sin fecha de cierre no puede declararse vencida.');
    assert.equal(isExpired({ deadline_at: EXPIRED_AT }), true, 'La fila persistida se evalúa por deadline_at.');
    assert.equal(isExpired({ deadline_at: CURRENT_AT }), false, 'Una fila persistida vigente no está vencida.');
    assert.equal(isExpired({ deadline_at: null }), false, 'deadline_at nulo no es vencimiento.');
    assert.equal(isExpired({ internal_status: 'convertida_oportunidad', converted_opportunity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deadline_at: EXPIRED_AT }), true, 'La conversión no exime del vencimiento.');
  }

  // 2) Regresión de producto sobre /api/tenders en ambos entrypoints.
  for (const [index, backend] of BACKENDS.entries()) {
    scenario.caliDeadlineAt = EXPIRED_AT;
    const expired = await radarStableKeys(backend, `${index}-expired`);
    assert.equal(expired.keys.includes('cali-convertida-vencida'), false, `${backend} debe ocultar la convertida vencida de Cali.`);
    assert.equal(expired.keys.includes('procuraduria-convertida-vencida'), false, `${backend} debe ocultar la convertida vencida de Procuraduría.`);
    assert.equal(expired.keys.includes('procuraduria-vencida-nueva'), false, `${backend} debe ocultar una vencida no convertida.`);
    assert.deepEqual(expired.keys, ['cali-sin-fecha', 'cali-vigente-convertida', 'procuraduria-vigente-nueva'].sort(), `${backend} solo debe mostrar procesos no vencidos.`);
    assert.equal(expired.body.totals.all, 3, `${backend} debe contar únicamente los procesos visibles.`);
    assert.equal(expired.body.totals.convertidas, 1, `${backend} no debe contar convertidas vencidas que ya no muestra.`);

    // 3) La fuente oficial republica una fecha vigente para Cali: la fila reaparece sola.
    scenario.caliDeadlineAt = CURRENT_AT;
    const refreshed = await radarStableKeys(backend, `${index}-refreshed`);
    assert.equal(refreshed.keys.includes('cali-convertida-vencida'), true, `${backend} debe volver a mostrar Cali cuando la fuente publica una fecha vigente.`);
    assert.deepEqual(refreshed.keys, ['cali-convertida-vencida', 'cali-sin-fecha', 'cali-vigente-convertida', 'procuraduria-vigente-nueva'].sort(), `${backend} debe reincorporar solo la fila refrescada.`);
  }

  // 4) Ocultar es solo lectura: nunca se borra ni se muta la oportunidad ni la licitación.
  assert.deepEqual(scenario.writes, [], 'El Radar no debe escribir en psi_public_tenders ni en psi_sales_opportunities al ocultar vencidas.');

  // 5) El seam debe ser compartido: ambas rutas (viva y persistida) lo usan, sin reimplementar `days < 0`.
  for (const relative of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /export function isExpiredRadarProcess/, `${relative} debe declarar el seam único de vencimiento.`);
    assert.match(source, /const trackableRows = mergedRows\.filter\(row => !isExpiredRadarProcess\(row\)/, `${relative}: la ruta persistida debe usar el seam.`);
    assert.match(source, /persistenceTenders\.filter\(t => !isExpiredRadarProcess\(t\)/, `${relative}: la ruta viva debe usar el mismo seam.`);
    assert.doesNotMatch(source, /t\.days === null \|\| t\.days >= 0/, `${relative}: no debe quedar lógica de vencimiento duplicada.`);
  }
} finally {
  await new Promise(resolve => fakeSupabase.close(resolve));
}

console.log('Radar hides every expired process, conversion included, and restores it when the official source republishes a current deadline');
