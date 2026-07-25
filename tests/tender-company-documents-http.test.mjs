import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';

const MAX_BYTES = 50 * 1024 * 1024;

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function requestJson(port, path, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: {
        authorization: 'Bearer configure-token',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const actor = {
  user: { id: 'auth-1', email: 'config@example.test' },
  profile: { id: 'profile-1', full_name: 'Configurador', microsoft_email: 'config@example.test', auth_user_id: 'auth-1', role: 'director', active: true },
};
const state = {
  bucketUpdates: [], signedUploads: [], signedReads: [], downloads: [], rpcCalls: [],
  bucketPublic: false, bucketLimit: 0,
  rpcFails: false,
  documents: [{
    id: 'document-1', document_type: 'certificado', display_name: 'Certificado de existencia', issued_at: '2026-01-01', expires_at: '2026-12-31',
    version: 1, current: true, content_hash: 'a'.repeat(64), storage_path: 'company-profile/documents/profile-1/certificado.pdf', mime_type: 'application/pdf', size_bytes: 16,
    created_at: '2026-01-01T00:00:00.000Z', psi_sales_profiles: { full_name: 'Configurador' },
  }],
  buffers: new Map(),
};

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') return json(res, 200, actor.user);
  if (url.pathname === '/rest/v1/psi_sales_profiles') return json(res, 200, actor.profile);
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') return json(res, 200, []);
  if (url.pathname === '/rest/v1/psi_profile_permissions') return json(res, 200, [{ permission_code: 'licitaciones' }]);
  if (url.pathname === '/rest/v1/psi_company_procurement_profile') return json(res, 200, { singleton_key: 'seguridad_nacional', legal_name: 'Seguridad Nacional', updated_by: null });
  if (url.pathname === '/rest/v1/psi_company_procurement_documents') return json(res, 200, state.documents);
  if (url.pathname === '/rest/v1/rpc/psi_record_company_procurement_document') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      state.rpcCalls.push(JSON.parse(payload));
      if (state.rpcFails) return json(res, 500, { message: 'rpc unavailable' });
      return json(res, 200, { id: 'document-recorded' });
    });
  }
  if (url.pathname === '/storage/v1/bucket/tender-documents') {
    if (req.method === 'GET') return json(res, 200, { id: 'tender-documents', public: state.bucketPublic, file_size_limit: state.bucketLimit });
    if (req.method === 'PUT') {
      let payload = '';
      req.on('data', chunk => { payload += chunk; });
      return req.on('end', () => {
        const update = JSON.parse(payload);
        state.bucketUpdates.push(update);
        state.bucketPublic = update.public;
        state.bucketLimit = update.file_size_limit;
        json(res, 200, { id: 'tender-documents' });
      });
    }
  }
  const signedUpload = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/tender-documents\/(.+)$/);
  if (signedUpload) {
    const path = decodeURIComponent(signedUpload[1]);
    state.signedUploads.push(path);
    return json(res, 200, { url: `/object/upload/sign/tender-documents/${path}?token=upload-token` });
  }
  const signedRead = url.pathname.match(/^\/storage\/v1\/object\/sign\/tender-documents\/(.+)$/);
  if (signedRead) {
    const path = decodeURIComponent(signedRead[1]);
    state.signedReads.push(path);
    return json(res, 200, { signedURL: `/object/sign/tender-documents/${path}?token=read-token` });
  }
  const download = url.pathname.match(/^\/storage\/v1\/object\/tender-documents\/(.+)$/);
  if (download && req.method === 'GET') {
    const path = decodeURIComponent(download[1]);
    state.downloads.push(path);
    const buffer = state.buffers.get(path);
    if (!buffer) return json(res, 404, { message: 'object missing' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(buffer);
  }
  return json(res, 500, { message: `unexpected request: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const originalConsoleError = console.error;
const capturedErrors = [];
console.error = (...args) => { capturedErrors.push(args); };
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

let appServer;
try {
  const { default: app } = await import('../server/index.js');
  appServer = http.createServer(app);
  const appPort = await listen(appServer);

  const listed = await requestJson(appPort, '/api/tender-company-documents');
  assert.equal(listed.status, 200);
  assert.deepEqual(Object.keys(listed.body[0]).sort(), [
    'content_hash', 'created_at', 'current', 'display_name', 'document_type', 'expires_at', 'id', 'issued_at', 'mime_type', 'psi_sales_profiles',
    'size_bytes', 'state', 'storage_path', 'uploaded_by_name', 'url', 'version',
  ].sort(), 'el inventario expone display_name como nombre contractual y una URL firmada');
  assert.equal(listed.body[0].url, `http://127.0.0.1:${fakePort}/storage/v1/object/sign/tender-documents/company-profile/documents/profile-1/certificado.pdf?token=read-token`);

  const invalidCalendar = await requestJson(appPort, '/api/tender-company-document-upload-url', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-02-31', name: 'certificado.pdf', size: 1,
  });
  assert.equal(invalidCalendar.status, 400, 'fechas de calendario imposibles se rechazan antes de Storage');

  const invalidOrder = await requestJson(appPort, '/api/tender-company-document-upload-url', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-02-01', expiresAt: '2026-01-31', name: 'certificado.pdf', size: 1,
  });
  assert.equal(invalidOrder.status, 400, 'vencimiento anterior se rechaza antes de Storage');

  for (const size of [0, -1, Number.POSITIVE_INFINITY]) {
    const response = await requestJson(appPort, '/api/tender-company-document-upload-url', 'POST', {
      documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', name: 'certificado.pdf', size,
    });
    assert.equal(response.status, 400, `ticket rechaza size inválido: ${size}`);
  }

  const ticket = await requestJson(appPort, '/api/tender-company-document-upload-url', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', name: 'certificado.pdf', size: 20,
  });
  assert.equal(ticket.status, 200);
  assert.match(ticket.body.path, /^company-profile\/documents\/profile-1\//, 'ticket queda anclado al actor');
  assert.equal(state.bucketUpdates.length, 1, 'bucket ilimitado se corrige');
  assert.equal(state.bucketUpdates[0].file_size_limit, MAX_BYTES, 'bucket queda limitado a 50MB');
  assert.equal(state.bucketUpdates[0].public, false, 'bucket se conserva privado');

  state.bucketPublic = true;
  const publicBucketTicket = await requestJson(appPort, '/api/tender-company-document-upload-url', 'POST', {
    documentType: 'certificado', displayName: 'Certificado público', issuedAt: '2026-01-01', name: 'publico.pdf', size: 20,
  });
  assert.equal(publicBucketTicket.status, 200);
  assert.equal(state.bucketUpdates.length, 2, 'bucket público se corrige aunque ya tenga el límite correcto');
  assert.equal(state.bucketUpdates[1].public, false, 'corrección vuelve privado el bucket');
  assert.equal(state.bucketUpdates[1].file_size_limit, MAX_BYTES, 'corrección conserva el límite de 50MB');

  const otherActor = await requestJson(appPort, '/api/tender-company-document-process-upload', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', storage_path: 'company-profile/documents/profile-2/foreign.pdf', name: 'foreign.pdf', mime_type: 'application/pdf',
  });
  assert.equal(otherActor.status, 400, 'path de otro actor se rechaza como entrada inválida');

  const contents = Buffer.from('documento empresarial verificable');
  state.buffers.set(ticket.body.path, contents);
  const processed = await requestJson(appPort, '/api/tender-company-document-process-upload', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', storage_path: ticket.body.path, name: 'certificado.pdf', mime_type: 'application/pdf',
  });
  assert.equal(processed.status, 201);
  assert.deepEqual(Object.keys(processed.body).sort(), ['documents', 'profile']);
  assert.equal(state.rpcCalls.at(-1).p_content_hash, createHash('sha256').update(contents).digest('hex'), 'RPC recibe SHA-256 de los bytes descargados');
  assert.equal(state.rpcCalls.at(-1).p_size_bytes, contents.length, 'RPC recibe tamaño físico descargado');

  const oversizedPath = 'company-profile/documents/profile-1/oversized.pdf';
  state.buffers.set(oversizedPath, Buffer.alloc(MAX_BYTES + 1, 1));
  const rpcCountBeforeOversize = state.rpcCalls.length;
  const oversized = await requestJson(appPort, '/api/tender-company-document-process-upload', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', storage_path: oversizedPath, name: 'oversized.pdf', mime_type: 'application/pdf',
  });
  assert.equal(oversized.status, 400, 'tamaño físico mayor de 50MB responde 400 antes de RPC');
  assert.equal(state.rpcCalls.length, rpcCountBeforeOversize, 'sobrelímite físico no registra documento');

  const rupPath = 'company-profile/rup/oversized.txt';
  state.buffers.set(rupPath, Buffer.alloc(MAX_BYTES + 1, 1));
  const rpcCountBeforeRup = state.rpcCalls.length;
  const oversizedRup = await requestJson(appPort, '/api/tender-company-profile-process-upload', 'POST', {
    storage_path: rupPath, name: 'oversized.txt', mime_type: 'text/plain',
  });
  assert.equal(oversizedRup.status, 400, 'RUP firmado rechaza bytes reales antes de extracción');
  assert.equal(state.rpcCalls.length, rpcCountBeforeRup, 'RUP sobredimensionado no llega al RPC');

  state.rpcFails = true;
  const rpcFailure = await requestJson(appPort, '/api/tender-company-document-process-upload', 'POST', {
    documentType: 'certificado', displayName: 'Certificado', issuedAt: '2026-01-01', storage_path: ticket.body.path, name: 'certificado.pdf', mime_type: 'application/pdf',
  });
  assert.equal(rpcFailure.status, 500, 'fallo de RPC se conserva como error de servidor');
  assert.equal(capturedErrors.length, 9, 'cada escenario negativo produce un error controlado y no hay errores inesperados');
} finally {
  console.error = originalConsoleError;
  if (appServer?.listening) await new Promise(resolve => appServer.close(resolve));
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('Tender company documents authorized HTTP workflow passed');
