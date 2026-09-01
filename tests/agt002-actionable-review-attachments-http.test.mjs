// AGT-002 actionable review — HTTP contract for upload-url/complete/download
// routes (design §§9.4, 12.1-12.2, 13, 17-18). RED reason: none of these
// routes are registered on `server/index.js` / `api/[...path].js` yet, so
// every request falls through to Express's default (non-JSON) 404 handler.
//
// RED reason (segunda ronda, §§13.1-13.2/19.4): `complete` republicaba como
// "detectado" el MIME/tamaño/hash que el navegador había declarado al pedir el
// ticket, sin descargar ni mirar un solo byte. Los bloques marcados «bytes
// reales» de abajo cubren esa conducta ausente: suplantación de MIME, hash o
// tamaño distintos, objeto vacío o ausente, ZIP corriente o con traversal/
// macros disfrazado de DOCX, limpieza del objeto huérfano, ausencia total de
// llamada a la RPC ante un fallo y paso de los valores DETECTADOS al éxito.
import assert from 'node:assert/strict';
import http from 'node:http';
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import { buildDocxBuffer, buildPdfBuffer, buildXlsxBuffer, replaceEqualLengthEntryName } from './fixtures/tender-document-archive-fixtures.mjs';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const ATTACHMENT_ID = '44444444-4444-4444-8444-444444444444';
const HUMAN_ID = '55555555-5555-4555-8555-555555555555';
const FOREIGN_TICKET_ID = '66666666-6666-4666-8666-666666666666';
const ABSENT_TICKET_ID = '66666666-6666-4666-8666-666666666667';
const TEST_SERVICE_KEY = 'test-service-key';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
function requestRaw(port, path, token, method = 'GET', body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...extraHeaders,
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON (e.g. default 404 page or empty 302 body) */ }
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const actors = {
  'human-token': {
    user: { id: 'human-auth', email: 'licitaciones@example.test' },
    profile: { id: HUMAN_ID, full_name: 'Licitaciones', microsoft_email: 'licitaciones@example.test', auth_user_id: 'human-auth', role: 'admin', active: true, identity_type: 'human' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

// --- fixtures binarias deterministas (mismas dependencias de producción) -----
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const PDF_BYTES = buildPdfBuffer(['SOPORTE DE POLIZA']);
const DOCX_BYTES = buildDocxBuffer(['CLAUSULA TECNICA']);
const XLSX_BYTES = buildXlsxBuffer({ sheetName: 'Formato', cellsXml: '<row r="1"><c r="A1" t="inlineStr"><is><t>VALOR</t></is></c></row>' });
const PNG_BYTES = (() => {
  const chunk = (type, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), payload, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
})();
const ORDINARY_ZIP_BYTES = (() => {
  const zip = new AdmZip();
  zip.addFile('lectura.txt', Buffer.from('contenido legitimo', 'utf8'));
  return zip.toBuffer();
})();
const TRAVERSAL_DOCX_BYTES = (() => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>', 'utf8'));
  zip.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="x"/>', 'utf8'));
  zip.addFile('aa/evil.txt', Buffer.from('carga util', 'utf8'));
  return replaceEqualLengthEntryName(zip.toBuffer(), 'aa/evil.txt', '../evil.txt');
})();
const MACRO_DOCX_BYTES = (() => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types/>', 'utf8'));
  zip.addFile('word/document.xml', Buffer.from('<?xml version="1.0"?><w:document xmlns:w="x"/>', 'utf8'));
  zip.addFile('word/vbaProject.bin', Buffer.from('macro', 'utf8'));
  return zip.toBuffer();
})();

// Realistic, deterministic emulation of the migration-078 upload-ticket/
// attachment RPCs and the private storage calls this HTTP block wires through:
// only this fixture (item/ticket/attachment lookup, the two RPCs, and the
// sign-upload/sign-download/download/remove storage endpoints) is added on top
// of the untouched auth/profile/opportunity fake above. `state.objects` es el
// bucket privado: el navegador de este test "sube" escribiendo ahí, y el
// backend sólo puede ver los bytes que realmente estén almacenados.
const state = {
  uploadTickets: new Map(),
  objects: new Map(),
  downloads: [],
  removals: [],
  issueRpcCalls: [],
  completeRpcCalls: [],
  attachmentSequence: 0,
};

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = String(url.searchParams.get('auth_user_id') || '').replace(/^eq\./, '');
    const actor = actorByAuthId.get(authUserId);
    return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    return json(res, 200, actorByProfileId.get(profileId)?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
    return json(res, 200, actorByProfileId.get(profileId)?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: HUMAN_ID });
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_items') {
    const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    const found = idFilter === ITEM_ID
      ? [{ id: ITEM_ID, opportunity_id: OPPORTUNITY_ID, tender_id: ITEM_ID, analysis_run_id: ITEM_ID, requirement_id: null, created_at: '2026-08-31T00:00:00.000Z' }]
      : [];
    return json(res, 200, found);
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_upload_tickets') {
    const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    const ticket = state.uploadTickets.get(idFilter);
    const found = ticket ? [{
      id: ticket.id, review_item_id: ticket.reviewItemId, storage_path: ticket.storagePath,
      name: ticket.name, extension: ticket.extension, version: ticket.version,
      declared_mime_type: ticket.declaredMimeType, declared_size_bytes: ticket.declaredSizeBytes, declared_content_hash: ticket.declaredContentHash,
    }] : [];
    return json(res, 200, found);
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_attachments') {
    const idFilter = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
    if (idFilter) {
      // The download-route test never completes an upload first; any
      // attachment id resolves deterministically under the single review
      // item this fixture knows about (§12.1's opaque-id-first lookup).
      return json(res, 200, [{
        id: idFilter, review_item_id: ITEM_ID,
        storage_path: `actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/synthetic/v1/${'b'.repeat(64)}-archivo.pdf`,
        name: 'archivo.pdf',
      }]);
    }
    return json(res, 200, []); // next-version lookups by logical_attachment_id: always a fresh logical id here.
  }
  if (url.pathname === '/rest/v1/rpc/psi_issue_tender_actionable_review_upload_ticket') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const args = JSON.parse(payload || '{}');
      state.issueRpcCalls.push(args);
      // The fixture only ever receives (and stores) `p_nonce_hash`/
      // `p_payload_hash` — Node-computed, already-hashed values — mirroring
      // the real RPC: it never sees, and therefore never could leak, a
      // plaintext nonce. The plaintext itself lives only in the route's own
      // JSON response below, exactly as `server/index.js`/`api/[...path].js`
      // build it from their own locally-generated nonce, never from this RPC.
      if (!/^[0-9a-f]{64}$/.test(String(args.p_nonce_hash || ''))) {
        return json(res, 400, { code: '22023', message: 'nonce_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' });
      }
      if (!/^[0-9a-f]{64}$/.test(String(args.p_payload_hash || ''))) {
        return json(res, 400, { code: '22023', message: 'payload_hash inválido: debe ser un SHA-256 hexadecimal en minúsculas.' });
      }
      const ticketId = randomUUID();
      // Espejo exacto del path que construye la migración 078. El único caso
      // especial es `namespace-attack`, que simula un ticket cuyo path apunta
      // fuera del espacio de nombres aprobado (§13.3): la ruta debe rechazarlo
      // ANTES de descargar o borrar nada.
      const storagePath = args.p_logical_attachment_id === 'namespace-attack'
        ? `question-responses/${args.p_opportunity_id}/${args.p_review_item_id}/v1/${args.p_declared_content_hash}-${args.p_name}`
        : `actionable-reviews/${args.p_opportunity_id}/${args.p_review_item_id}/${args.p_logical_attachment_id}/v${args.p_version}/${args.p_declared_content_hash}-${args.p_name}`;
      state.uploadTickets.set(ticketId, {
        id: ticketId, reviewItemId: args.p_review_item_id, opportunityId: args.p_opportunity_id, actorId: args.p_actor_id,
        logicalAttachmentId: args.p_logical_attachment_id, version: args.p_version, storagePath,
        name: args.p_name, extension: args.p_extension,
        declaredMimeType: args.p_declared_mime_type, declaredSizeBytes: args.p_declared_size_bytes, declaredContentHash: args.p_declared_content_hash,
        nonceHash: args.p_nonce_hash, payloadHash: args.p_payload_hash, consumedAt: null,
      });
      return json(res, 200, {
        id: ticketId, review_item_id: args.p_review_item_id, opportunity_id: args.p_opportunity_id,
        logical_attachment_id: args.p_logical_attachment_id, version: args.p_version, storage_path: storagePath,
        name: args.p_name, extension: args.p_extension, declared_mime_type: args.p_declared_mime_type,
        declared_size_bytes: args.p_declared_size_bytes, declared_content_hash: args.p_declared_content_hash,
        expires_at: '2026-08-31T00:15:00.000Z', consumed_at: null, created_at: '2026-08-31T00:00:00.000Z',
      });
    });
  }
  if (url.pathname === '/rest/v1/rpc/psi_complete_tender_actionable_review_attachment') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const args = JSON.parse(payload || '{}');
      state.completeRpcCalls.push(args);
      const ticket = state.uploadTickets.get(args.p_ticket_id);
      const reject = () => json(res, 409, {
        code: '55000',
        message: 'attachment_ticket_invalid: el ticket de carga no es válido, expiró, ya fue consumido o no coincide con los datos presentados.',
      });
      if (!ticket || ticket.consumedAt) return reject();
      if (ticket.actorId !== args.p_actor_id) return reject();
      if (ticket.nonceHash !== args.p_nonce_hash) return reject();
      if (ticket.storagePath !== args.p_storage_path) return reject();
      if (ticket.declaredContentHash !== args.p_content_hash) return reject();
      if (ticket.declaredSizeBytes !== args.p_size_bytes) return reject();
      if (ticket.declaredMimeType !== args.p_detected_mime_type) return reject();
      ticket.consumedAt = '2026-08-31T00:01:00.000Z';
      state.attachmentSequence += 1;
      return json(res, 200, {
        attachment_id: `attachment-${state.attachmentSequence}`, review_item_id: ticket.reviewItemId,
        logical_attachment_id: ticket.logicalAttachmentId, version: ticket.version,
        event_id: `actionable-review-event-attachment-${state.attachmentSequence}`, sequence: state.attachmentSequence,
        uploaded_at: '2026-08-31T00:01:00.000Z',
      });
    });
  }
  const signedUpload = url.pathname.match(/^\/storage\/v1\/object\/upload\/sign\/tender-documents\/(.+)$/);
  if (signedUpload) {
    const path = decodeURIComponent(signedUpload[1]);
    return json(res, 200, { url: `/object/upload/sign/tender-documents/${path}?token=upload-token` });
  }
  const signedRead = url.pathname.match(/^\/storage\/v1\/object\/sign\/tender-documents\/(.+)$/);
  if (signedRead) {
    const path = decodeURIComponent(signedRead[1]);
    return json(res, 200, { signedURL: `/object/sign/tender-documents/${path}?token=read-token` });
  }
  const download = url.pathname.match(/^\/storage\/v1\/object\/tender-documents\/(.+)$/);
  if (download && req.method === 'GET') {
    const path = decodeURIComponent(download[1]);
    state.downloads.push(path);
    const object = state.objects.get(path);
    if (!object) return json(res, 404, { message: 'object missing' });
    // El almacenamiento anuncia deliberadamente un Content-Type MENTIROSO: el
    // backend no puede usarlo para nada (§13.2 «no trust Blob.type»).
    res.writeHead(200, { 'content-type': 'application/pdf' });
    return res.end(object);
  }
  if (url.pathname === '/storage/v1/object/tender-documents' && req.method === 'DELETE') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const { prefixes } = JSON.parse(payload || '{}');
      for (const prefix of prefixes || []) {
        state.removals.push(prefix);
        state.objects.delete(prefix);
      }
      return json(res, 200, (prefixes || []).map(name => ({ name })));
    });
  }
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
process.env.VERCEL = '1';

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
try {
  console.error = () => {};
  console.warn = () => {};
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    state.uploadTickets.clear();
    state.objects.clear();
    state.downloads.length = 0;
    state.removals.length = 0;
    state.issueRpcCalls.length = 0;
    state.completeRpcCalls.length = 0;

    // Pide un ticket declarando exactamente los metadatos de `buffer` (lo que
    // haría un navegador honesto) y, salvo que se indique otra cosa, sube esos
    // mismos bytes al bucket privado. `declared` permite mentir a propósito.
    const issueTicket = async ({ name, mimeType, logicalAttachmentId, buffer, uploaded = buffer, declared = {} }) => {
      const ticket = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, 'human-token', 'POST', {
        name,
        mime_type: mimeType,
        size_bytes: declared.sizeBytes ?? buffer.length,
        sha256: declared.sha256 ?? sha256(buffer),
        logical_attachment_id: logicalAttachmentId,
      });
      assert.equal(ticket.status, 200, `backend ${index} emite el ticket para ${name}`);
      if (uploaded !== null) state.objects.set(ticket.body.storage_path, uploaded);
      return ticket.body;
    };
    const complete = (ticket, nonce = ticket.nonce) => requestRaw(
      port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST',
      { ticket_id: ticket.ticket_id, nonce },
    );
    const assertRejectedUpload = async (ticket, message) => {
      const rpcCallsBefore = state.completeRpcCalls.length;
      const response = await complete(ticket);
      assert.equal(response.status, 400, `backend ${index} rechaza ${message}`);
      assert.equal(response.body?.code, 'attachment_content_invalid',
        `backend ${index} usa un único código seguro para ${message}, sin revelar la causa`);
      assert.equal(state.completeRpcCalls.length, rpcCallsBefore,
        `backend ${index} no llama (ni consume) la RPC cuando falla la validación de ${message}`);
      return response;
    };

    try {
      // --- upload-url: auth before lookup, allowlist and size limits -------
      const unauthenticated = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, null, 'POST', {});
      assert.equal(unauthenticated.status, 401, `backend ${index} rejects an unauthenticated upload-url request`);

      const badMime = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, 'human-token', 'POST', {
        name: 'archivo.zip', mime_type: 'application/zip', size_bytes: 10, logical_attachment_id: 'zip-1',
      });
      assert.equal(badMime.status, 415, `backend ${index} rejects a disallowed MIME/extension before signing (§13.1)`);
      assert.equal(badMime.body?.code, 'attachment_type_not_allowed');

      const tooLarge = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, 'human-token', 'POST', {
        name: 'grande.pdf', mime_type: 'application/pdf', size_bytes: 25 * 1024 * 1024 + 1, logical_attachment_id: 'pdf-1',
      });
      assert.equal(tooLarge.status, 413, `backend ${index} rejects a file over 25 MiB before signing`);
      assert.equal(tooLarge.body?.code, 'attachment_too_large');

      const traversal = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, 'human-token', 'POST', {
        name: '../../etc/passwd', mime_type: 'application/pdf', size_bytes: 10, logical_attachment_id: 'pdf-2',
      });
      assert.equal(traversal.status, 400, `backend ${index} rejects a traversal-laden file name`);

      const validTicket = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/upload-url`, 'human-token', 'POST', {
        name: 'Poliza vigente.pdf', mime_type: 'application/pdf', size_bytes: PDF_BYTES.length, sha256: sha256(PDF_BYTES), logical_attachment_id: 'pdf-3',
      });
      assert.equal(validTicket.status, 200, `backend ${index} issues a signed upload URL for a valid file`);
      assert.equal(typeof validTicket.body?.ticket_id, 'string', `backend ${index} returns an opaque ticket_id`);
      assert.equal(typeof validTicket.body?.nonce, 'string', `backend ${index} reveals the ticket nonce exactly once`);
      assert.match(validTicket.body.nonce, /^[0-9a-f]{64}$/, `backend ${index} generates a lowercase-hex nonce of at least 32 bytes`);
      assert.ok(validTicket.body?.storage_path?.startsWith(`actionable-reviews/${OPPORTUNITY_ID}/${ITEM_ID}/`),
        `backend ${index} uses the actionable-reviews/ prefix, never the official document/question-response prefixes (§13.3)`);
      assert.equal(validTicket.body?.storage_path?.includes('/question-responses/'), false,
        `backend ${index} must never reuse the question-responses storage prefix`);

      // --- crypto hardening: the issue RPC never sees the plaintext nonce,
      // only its SHA-256 digest, alongside a Node-computed payload hash -----
      const issueCall = state.issueRpcCalls.at(-1);
      assert.equal(issueCall.p_nonce, undefined, `backend ${index} must never send a plaintext p_nonce to the issue RPC`);
      assert.match(String(issueCall.p_nonce_hash), /^[0-9a-f]{64}$/, `backend ${index} sends a 64-hex p_nonce_hash to the issue RPC`);
      assert.equal(issueCall.p_nonce_hash, sha256(validTicket.body.nonce),
        `backend ${index} sends the SHA-256 digest of the exact nonce it reveals to the caller`);
      assert.match(String(issueCall.p_payload_hash), /^[0-9a-f]{64}$/, `backend ${index} sends a 64-hex p_payload_hash to the issue RPC`);

      // --- complete: private no-store, ticket replay/tampering rejected ----
      const completeUnauthenticated = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, null, 'POST', {
        ticket_id: validTicket.body?.ticket_id, nonce: validTicket.body?.nonce,
      });
      assert.equal(completeUnauthenticated.status, 401, `backend ${index} rejects an unauthenticated complete`);

      // El navegador sube los bytes reales al path firmado (create-only).
      state.objects.set(validTicket.body.storage_path, PDF_BYTES);

      const completeForgedNonce = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST', {
        ticket_id: validTicket.body?.ticket_id, nonce: 'forged-nonce',
      });
      assert.equal(completeForgedNonce.status, 409, `backend ${index} rejects a complete with a forged nonce`);
      assert.equal(completeForgedNonce.body?.code, 'attachment_ticket_invalid');

      const rpcCallsBeforeSuccess = state.completeRpcCalls.length;
      const completeOk = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST', {
        ticket_id: validTicket.body?.ticket_id, nonce: validTicket.body?.nonce,
      });
      assert.equal(completeOk.status, 201, `backend ${index} completes a valid, matching ticket`);
      assert.equal(completeOk.headers['cache-control'], 'private, no-store', `backend ${index} marks complete's response private, no-store`);

      // --- bytes reales: a la RPC viajan los valores DETECTADOS ------------
      const successCall = state.completeRpcCalls[rpcCallsBeforeSuccess];
      assert.equal(successCall.p_detected_mime_type, 'application/pdf',
        `backend ${index} pasa el MIME detectado por magic bytes, no el Content-Type anunciado por el almacenamiento`);
      assert.equal(successCall.p_size_bytes, PDF_BYTES.length, `backend ${index} pasa el tamaño real del objeto descargado`);
      assert.equal(successCall.p_content_hash, sha256(PDF_BYTES), `backend ${index} pasa el SHA-256 recalculado sobre los bytes`);
      assert.equal(successCall.p_storage_path, validTicket.body.storage_path, `backend ${index} pasa el path exacto del ticket`);
      assert.ok(state.downloads.includes(validTicket.body.storage_path),
        `backend ${index} descarga el objeto privado antes de invocar la RPC`);
      assert.equal(successCall.p_nonce, undefined, `backend ${index} must never send a plaintext p_nonce to the complete RPC`);
      assert.equal(successCall.p_nonce_hash, sha256(validTicket.body.nonce),
        `backend ${index} sends the SHA-256 digest of the caller-presented nonce to the complete RPC`);

      const completeReplay = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST', {
        ticket_id: validTicket.body?.ticket_id, nonce: validTicket.body?.nonce,
      });
      assert.equal(completeReplay.status, 409, `backend ${index} rejects a second complete of an already-consumed ticket`);
      assert.equal(completeReplay.body?.code, 'attachment_ticket_invalid');

      // --- bytes reales: ticket ajeno e inexistente son indistinguibles ----
      state.uploadTickets.set(FOREIGN_TICKET_ID, {
        id: FOREIGN_TICKET_ID, reviewItemId: '99999999-9999-4999-8999-999999999999', opportunityId: OPPORTUNITY_ID, actorId: HUMAN_ID,
        logicalAttachmentId: 'ajeno', version: 1, storagePath: `actionable-reviews/${OPPORTUNITY_ID}/99999999-9999-4999-8999-999999999999/ajeno/v1/${sha256(PDF_BYTES)}-ajeno.pdf`,
        name: 'ajeno.pdf', extension: '.pdf', declaredMimeType: 'application/pdf', declaredSizeBytes: PDF_BYTES.length,
        declaredContentHash: sha256(PDF_BYTES), nonceHash: sha256('nonce-ajeno'), consumedAt: null,
      });
      const foreignTicket = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST', {
        ticket_id: FOREIGN_TICKET_ID, nonce: 'nonce-ajeno',
      });
      const absentTicket = await requestRaw(port, `/api/tender-actionable-reviews/${ITEM_ID}/attachments/complete`, 'human-token', 'POST', {
        ticket_id: ABSENT_TICKET_ID, nonce: 'nonce-ajeno',
      });
      assert.equal(foreignTicket.status, 409, `backend ${index} rechaza un ticket de otro pendiente`);
      assert.deepEqual(foreignTicket.body, absentTicket.body,
        `backend ${index} responde exactamente igual para un ticket ajeno y uno inexistente`);
      assert.equal(state.downloads.includes(state.uploadTickets.get(FOREIGN_TICKET_ID).storagePath), false,
        `backend ${index} nunca descarga el objeto de un ticket ajeno`);

      // --- bytes reales: suplantación de MIME ------------------------------
      const spoofed = await issueTicket({
        name: 'suplantado.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'spoof-1', buffer: PNG_BYTES,
      });
      await assertRejectedUpload(spoofed, 'un PNG subido bajo un ticket de PDF (tamaño y hash correctos)');
      assert.ok(state.removals.includes(spoofed.storage_path),
        `backend ${index} borra el objeto huérfano exacto tras la suplantación de MIME`);
      assert.equal(state.objects.has(spoofed.storage_path), false, `backend ${index} deja el bucket sin el objeto rechazado`);

      const zipAsDocx = await issueTicket({
        name: 'ordinario.docx', mimeType: DOCX_MIME, logicalAttachmentId: 'spoof-2', buffer: ORDINARY_ZIP_BYTES,
      });
      await assertRejectedUpload(zipAsDocx, 'un ZIP corriente disfrazado de DOCX');
      assert.ok(state.removals.includes(zipAsDocx.storage_path), `backend ${index} borra el ZIP corriente rechazado`);

      const traversalDocx = await issueTicket({
        name: 'traversal.docx', mimeType: DOCX_MIME, logicalAttachmentId: 'spoof-3', buffer: TRAVERSAL_DOCX_BYTES,
      });
      await assertRejectedUpload(traversalDocx, 'un DOCX con traversal interno');

      const macroDocx = await issueTicket({
        name: 'macros.docx', mimeType: DOCX_MIME, logicalAttachmentId: 'spoof-4', buffer: MACRO_DOCX_BYTES,
      });
      await assertRejectedUpload(macroDocx, 'un DOCX con proyecto VBA');

      // --- bytes reales: hash, tamaño, vacío y objeto ausente --------------
      const wrongHash = await issueTicket({
        name: 'hash.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'bytes-1', buffer: PDF_BYTES,
        uploaded: Buffer.concat([PDF_BYTES, Buffer.from(' ', 'ascii')]), declared: { sizeBytes: PDF_BYTES.length + 1 },
      });
      await assertRejectedUpload(wrongHash, 'unos bytes cuyo SHA-256 no es el declarado');

      const wrongSize = await issueTicket({
        name: 'tamano.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'bytes-2', buffer: PDF_BYTES,
        uploaded: PDF_BYTES.subarray(0, PDF_BYTES.length - 1),
      });
      await assertRejectedUpload(wrongSize, 'un objeto de tamaño distinto del declarado');

      const emptyObject = await issueTicket({
        name: 'vacio.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'bytes-3', buffer: PDF_BYTES,
        uploaded: Buffer.alloc(0),
      });
      await assertRejectedUpload(emptyObject, 'un objeto vacío');

      const neverUploaded = await issueTicket({
        name: 'ausente.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'bytes-4', buffer: PDF_BYTES, uploaded: null,
      });
      await assertRejectedUpload(neverUploaded, 'un ticket cuyo objeto nunca llegó al bucket');

      // --- bytes reales: el ticket NO se consume en un fallo ---------------
      const retried = await issueTicket({
        name: 'reintento.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'bytes-5', buffer: PDF_BYTES,
        uploaded: PNG_BYTES,
      });
      await assertRejectedUpload(retried, 'un primer intento con bytes equivocados');
      state.objects.set(retried.storage_path, PDF_BYTES); // el navegador vuelve a cargar el archivo correcto
      const retriedOk = await complete(retried);
      assert.equal(retriedOk.status, 201, `backend ${index} deja reintentar: un fallo de validación no consume el ticket`);

      // --- bytes reales: path fuera del espacio de nombres aprobado --------
      const outsideNamespace = await issueTicket({
        name: 'fuera.pdf', mimeType: 'application/pdf', logicalAttachmentId: 'namespace-attack', buffer: PDF_BYTES,
      });
      assert.ok(outsideNamespace.storage_path.startsWith('question-responses/'), 'el fixture emite el path fuera del espacio aprobado');
      const removalsBeforeNamespace = state.removals.length;
      const downloadsBeforeNamespace = state.downloads.length;
      await assertRejectedUpload(outsideNamespace, 'un ticket cuyo path no está en el espacio de nombres aprobado');
      assert.equal(state.downloads.length, downloadsBeforeNamespace,
        `backend ${index} no descarga nada fuera del prefijo actionable-reviews/ (§13.3)`);
      assert.equal(state.removals.length, removalsBeforeNamespace,
        `backend ${index} tampoco BORRA una ruta arbitraria: sólo el objeto exacto de un path aprobado`);

      // --- bytes reales: DOCX y XLSX legítimos completan --------------------
      const docxTicket = await issueTicket({ name: 'clausula.docx', mimeType: DOCX_MIME, logicalAttachmentId: 'ooxml-1', buffer: DOCX_BYTES });
      const docxComplete = await complete(docxTicket);
      assert.equal(docxComplete.status, 201, `backend ${index} acepta un DOCX OOXML mínimo válido`);
      assert.equal(state.completeRpcCalls.at(-1).p_detected_mime_type, DOCX_MIME, `backend ${index} detecta el sabor DOCX por sus partes obligatorias`);

      const xlsxTicket = await issueTicket({ name: 'formato.xlsx', mimeType: XLSX_MIME, logicalAttachmentId: 'ooxml-2', buffer: XLSX_BYTES });
      const xlsxComplete = await complete(xlsxTicket);
      assert.equal(xlsxComplete.status, 201, `backend ${index} acepta un XLSX OOXML mínimo válido`);
      assert.equal(state.completeRpcCalls.at(-1).p_detected_mime_type, XLSX_MIME, `backend ${index} detecta el sabor XLSX por sus partes obligatorias`);

      // --- download: 302, no body, private no-store, 120s signed URL -------
      const downloadUnauthenticated = await requestRaw(port, `/api/tender-actionable-review-attachments/${ATTACHMENT_ID}/download?opportunity_id=${OPPORTUNITY_ID}`, null);
      assert.equal(downloadUnauthenticated.status, 401, `backend ${index} rejects an unauthenticated download`);

      const download = await requestRaw(port, `/api/tender-actionable-review-attachments/${ATTACHMENT_ID}/download?opportunity_id=${OPPORTUNITY_ID}`, 'human-token');
      assert.equal(download.status, 302, `backend ${index} answers a download with a 302 redirect, not the file bytes`);
      assert.equal(download.raw, '', `backend ${index} sends no body on the download redirect`);
      assert.ok(download.headers.location, `backend ${index} carries the signed URL in Location`);
      assert.equal(download.headers['cache-control'], 'private, no-store', `backend ${index} marks the download redirect private, no-store`);

      // --- an attachment never appears in the official document set --------
      // (structural invariant re-asserted here at the HTTP boundary; the
      // authoritative check lives in the pglite/backend-parity static suites.)
      assert.equal(download.headers.location && String(download.headers.location).includes('question-responses'), false,
        `backend ${index} download URL must never resolve into the question-responses prefix`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
} finally {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

console.log('AGT-002 actionable review attachments HTTP contract (RED — routes missing) passed');
