// Regresión dinámica (HTTP real contra Supabase REST falso, con escritura observable).
//
// Encargo: si construir o persistir el snapshot del Corte 3 (delta) falla DESPUÉS de que las
// licitaciones de esta corrida y el recibo de corrida del Corte 2 ya fueron persistidos,
// `persistTenderRadar` NO debe:
//   - convertir la corrida entera en 'failed' (el recibo real de esta corrida fue 'partial'/
//     'complete', no fatal: el fallo ocurrió sólo en el paso final, no fatal del pipeline),
//   - sobrescribir el recibo ya persistido con un recibo fatal (el catch actual de
//     persistTenderRadar reutiliza `recordAgt002RadarRunReceipt` con el MISMO run_id, por lo que un
//     fallo tardío termina pisando el recibo exitoso ya escrito),
//   - ni reventar la petición completa (hoy GET /api/tenders?refresh=1 relanza `fatalError` y
//     responde con un error, en vez de devolver el Radar con las licitaciones y el recibo que sí se
//     terminaron de persistir).
// El delta (Corte 3) puede quedar temporalmente no disponible esa corrida; eso no es lo que este
// test exige.
//
// persistTenderRadar distingue "fallo fatal antes de persistir nada" de "fallo tardío sólo en el
// snapshot, después de licitaciones+recibo ya persistidos": este último caso no reescribe el recibo
// a 'failed' ni relanza, sino que deja la corrida como 'partial'/'complete' real.
import assert from 'node:assert/strict';
import http from 'node:http';

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { text += chunk; });
    req.on('end', () => {
      try { resolve(text ? JSON.parse(text) : null); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}
function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
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

// Fila SECOP II sintética que sí pasa el pipeline real de adquisición (objeto directo ofertable de
// vigilancia y seguridad privada, valor alto, sin términos descalificantes), para que
// persistTenderRadar tenga al menos una licitación real que persistir en psi_public_tenders antes de
// llegar al paso del snapshot.
const SECOP_II_ROW = {
  entidad: 'Alcaldía de Manizales',
  departamento_entidad: 'Caldas',
  ciudad_entidad: 'Manizales',
  id_del_proceso: 'CO1.REQ.TEST-SNAPSHOT-0001',
  referencia_del_proceso: 'TEST-SNAPSHOT-0001',
  nombre_del_procedimiento: 'Prestación del servicio de vigilancia y seguridad privada',
  descripci_n_del_procedimiento: 'Servicio de vigilancia armada para sede administrativa',
  fase: 'Selección',
  estado_del_procedimiento: 'Presentación de oferta',
  fecha_de_publicacion_del: '2026-09-20T00:00:00.000',
  fecha_de_recepcion_de: '2026-10-20T00:00:00.000',
  precio_base: '600000000',
  codigo_principal_de_categoria: 'V1.81101500',
  urlproceso: { url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.TEST-SNAPSHOT' },
};

const actor = {
  user: { id: 'licitaciones-auth', email: 'licitaciones@example.test' },
  profile: { id: 'licitaciones-profile', full_name: 'Licitaciones', microsoft_email: 'licitaciones@example.test', auth_user_id: 'licitaciones-auth', role: 'director', active: true },
  permissions: ['licitaciones'],
};

// Estado observable de la base falsa: lo que persistTenderRadar realmente escribió, sin importar
// cómo haya respondido la petición HTTP.
let tenderRows = [];
let radarRunRows = [];
let radarRunsPostCount = 0;

function matchesEq(row, key, rawValue) {
  if (rawValue.startsWith('eq.')) return String(row[key]) === rawValue.slice(3);
  if (rawValue.startsWith('in.(') && rawValue.endsWith(')')) {
    return rawValue.slice(4, -1).split(',').includes(String(row[key]));
  }
  return true; // filtros no reconocidos (p.ej. `or=(...)`) se ignoran: sobre-incluir nunca esconde la fila bajo prueba.
}
function filterRows(rows, searchParams) {
  let result = rows;
  for (const [key, value] of searchParams) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    result = result.filter(row => matchesEq(row, key, value));
  }
  const order = searchParams.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    result = [...result].sort((a, b) => dir === 'asc' ? String(a[col]).localeCompare(String(b[col])) : String(b[col]).localeCompare(String(a[col])));
  }
  const limit = searchParams.get('limit');
  if (limit) result = result.slice(0, Number(limit));
  return result;
}

const fakeSupabase = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/auth/v1/user') {
    return bearer(req) === 'licitaciones-token' ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    return json(res, 200, req.headers.accept?.includes('vnd.pgrst.object') ? actor.profile : [actor.profile]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    return json(res, 200, actor.permissions.map(permission_code => ({ permission_code })));
  }

  if (url.pathname === '/rest/v1/psi_public_tenders') {
    if (req.method === 'GET') return json(res, 200, filterRows(tenderRows, url.searchParams));
    if (req.method === 'POST') {
      const body = await readJson(req);
      for (const row of Array.isArray(body) ? body : [body]) {
        const index = tenderRows.findIndex(existing => existing.stable_key === row.stable_key);
        if (index === -1) tenderRows.push({ ...row });
        else tenderRows[index] = { ...tenderRows[index], ...row };
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end('');
    }
  }

  if (url.pathname === '/rest/v1/psi_tender_radar_runs') {
    if (req.method === 'GET') return json(res, 200, filterRows(radarRunRows, url.searchParams));
    if (req.method === 'POST') {
      radarRunsPostCount += 1;
      // La SEGUNDA escritura en esta corrida es siempre la del snapshot del Corte 3
      // (`recordAgt002RadarRunSnapshot`): la primera es el recibo del Corte 2
      // (`recordAgt002RadarRunReceipt`), ya persistido con éxito antes de llegar aquí. Forzamos el
      // fallo sólo en este upsert -- nunca en el select previo ni en el recibo -- para aislar
      // exactamente el escenario del encargo.
      if (radarRunsPostCount === 2) {
        return json(res, 500, { message: 'simulated snapshot upsert failure (forced by test)', code: 'SIMULATED_SNAPSHOT_UPSERT_FAILURE' });
      }
      const body = await readJson(req);
      for (const row of Array.isArray(body) ? body : [body]) {
        const index = radarRunRows.findIndex(existing => existing.id === row.id);
        if (index === -1) radarRunRows.push({ ...row });
        else radarRunRows[index] = { ...radarRunRows[index], ...row };
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end('');
    }
  }

  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

// Intercepta únicamente las fuentes externas del Radar (SECOP vía datos.gov.co, TVEC); todo lo
// demás (incluidas las llamadas reales del cliente Supabase al fake de arriba) sigue yendo al fetch
// real. SECOP II responde con una licitación real y ofertable; SECOP I y TVEC se dejan sin
// candidatos/fallidos para mantener la corrida en un `partial` realista (ESU directo también falla,
// sin red real disponible), sin que eso afecte lo que este test exige.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : String(input);
  if (href.startsWith('https://www.datos.gov.co/resource/p6dx-8zbt.json')) {
    return { ok: true, status: 200, json: async () => [SECOP_II_ROW] };
  }
  if (href.startsWith('https://www.datos.gov.co/resource/f789-7hwg.json')) {
    return { ok: true, status: 200, json: async () => [] };
  }
  if (href.startsWith('https://operaciones.colombiacompra.gov.co/eventos-cotizacion-tvec')) {
    return { ok: false, status: 503, text: async () => '' };
  }
  return realFetch(input, init);
};

let appServer;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
try {
  console.error = () => {};
  console.warn = () => {};
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  const response = await requestJson(appPort, '/api/tenders?refresh=1', 'licitaciones-token');

  // 1. La licitación SECOP II sintética de esta corrida quedó persistida en psi_public_tenders -- el
  //    fallo tardío del snapshot nunca debe revertirla. (No se exige un conteo exacto: si el entorno
  //    sí tiene red real, ESU Contratación directo -- la única fuente que este test no intercepta --
  //    podría aportar candidatos reales adicionales sin afectar lo que este test exige.)
  const ourTender = tenderRows.find(row => row.ref === 'TEST-SNAPSHOT-0001');
  assert.ok(ourTender, 'la licitación SECOP II sintética de esta corrida no debe perderse porque el snapshot del Corte 3 falle después');
  assert.equal(ourTender.entity, 'Alcaldía de Manizales');

  // 2. Exactamente UNA fila de corrida persistida (el recibo del Corte 2, por run_id), y ese recibo
  //    sigue reflejando la corrida real ('partial': SECOP II/SECOP I/ESU vía datos.gov.co con éxito,
  //    TVEC/ESU directo fallidos) -- nunca sobrescrito a 'failed' ni con fatal_error sólo porque el
  //    snapshot haya fallado después.
  assert.equal(radarRunRows.length, 1, 'el fallo tardío del snapshot no debe crear una segunda fila ni perder la única corrida real');
  const persistedRun = radarRunRows[0];
  assert.equal(persistedRun.errors?.status, 'partial', 'el recibo de Corte 2 ya persistido con éxito no debe quedar sobrescrito a failed por un fallo posterior, no fatal, al construir/persistir el snapshot del Corte 3');
  assert.equal(persistedRun.errors?.fatal_error, null, 'un fallo aislado al construir/persistir el snapshot del Corte 3 no es un fallo fatal de la corrida completa');

  // 3. La petición HTTP completa debe devolver el Radar normalmente (200), nunca un error -- el
  //    delta (Corte 3) puede faltar esta corrida, pero licitaciones+recibo ya persistidos deben
  //    volver igual que en cualquier corrida parcial exitosa.
  assert.equal(response.status, 200, 'persistTenderRadar no debe convertir la petición completa en error sólo porque el snapshot del Corte 3 (delta) falle después de persistir licitaciones y el recibo de Corte 2');
  assert.equal(response.body?.run_receipt?.status, 'partial');
} finally {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  globalThis.fetch = realFetch;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('AGT-002 Radar run snapshot failure after receipt+tenders already persisted (real Express app, fake Supabase REST) — OK');
