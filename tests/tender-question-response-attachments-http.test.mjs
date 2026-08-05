import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPPORTUNITY_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const HUMAN_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';
const HUMAN_ID_2 = '55555555-5555-4555-8555-555555555555';
const NO_IDENTITY_ID = '66666666-6666-4666-8666-666666666666';
const NULL_IDENTITY_ID = '77777777-7777-4777-8777-777777777777';
const TEST_SERVICE_KEY = 'test-service-key';

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
function requestJson(port, path, token, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function craftTicket({ opportunityId, responseId, profileId, expiresAt }) {
  const signature = createHmac('sha256', TEST_SERVICE_KEY).update(`${opportunityId}:${responseId}:${profileId}:${expiresAt}`).digest('hex');
  return `${expiresAt}.${signature}`;
}
function downloadName(signedUrl) {
  return new URL(signedUrl, 'http://placeholder.test').searchParams.get('download');
}

const actors = {
  'human-token': {
    user: { id: 'human-auth', email: 'licitaciones@example.test' },
    profile: { id: HUMAN_ID, full_name: 'Licitaciones', microsoft_email: 'licitaciones@example.test', auth_user_id: 'human-auth', role: 'admin', active: true, identity_type: 'human' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'human-token-2': {
    user: { id: 'human-auth-2', email: 'licitaciones2@example.test' },
    profile: { id: HUMAN_ID_2, full_name: 'Licitaciones Dos', microsoft_email: 'licitaciones2@example.test', auth_user_id: 'human-auth-2', role: 'admin', active: true, identity_type: 'human' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'agent-token': {
    user: { id: 'agent-auth', email: 'agente@example.test' },
    profile: { id: AGENT_ID, full_name: 'Agente', microsoft_email: 'agente@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'no-identity-token': {
    user: { id: 'no-identity-auth', email: 'sistema@example.test' },
    profile: { id: NO_IDENTITY_ID, full_name: 'Sistema', microsoft_email: 'sistema@example.test', auth_user_id: 'no-identity-auth', role: 'admin', active: true },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'null-identity-token': {
    user: { id: 'null-identity-auth', email: 'legacy@example.test' },
    profile: { id: NULL_IDENTITY_ID, full_name: 'Legacy', microsoft_email: 'legacy@example.test', auth_user_id: 'null-identity-auth', role: 'admin', active: true, identity_type: null },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

const state = {
  rpcCalls: [],
  rpcFails: false,
  rpcFailureCode: null,
  signedUploads: [],
  signedReads: [],
  removals: [],
  bucketPublic: false,
  bucketLimit: 0,
  bucketUpdates: [],
  questionResponses: [],
  attachments: [],
  objects: new Map(),
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
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: HUMAN_ID, customer_segment: 'cliente_nuevo' });
  }
  if (url.pathname === '/rest/v1/v_psi_sales_opportunity_enriched') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: HUMAN_ID, service_type_code: 'licitacion_publica' });
  }
  if (url.pathname === '/rest/v1/psi_tender_question_responses') {
    const opportunityId = String(url.searchParams.get('opportunity_id') || '').replace(/^eq\./, '');
    const analysisRunId = String(url.searchParams.get('analysis_run_id') || '').replace(/^eq\./, '');
    let rows = state.questionResponses.filter(row => row.opportunity_id === opportunityId);
    if (analysisRunId) rows = rows.filter(row => row.analysis_run_id === analysisRunId);
    return json(res, 200, rows.map(row => ({ ...row, psi_sales_profiles: { full_name: actorByProfileId.get(row.responded_by)?.profile.full_name || null } })));
  }
  if (url.pathname === '/rest/v1/psi_tender_question_response_attachments') {
    const opportunityId = String(url.searchParams.get('opportunity_id') || '').replace(/^eq\./, '');
    const responseIdFilter = String(url.searchParams.get('response_id') || '');
    const ids = responseIdFilter.startsWith('in.(') ? responseIdFilter.slice(4, -1).split(',') : [];
    const rows = state.attachments.filter(row => row.opportunity_id === opportunityId && ids.includes(row.response_id));
    return json(res, 200, rows.map(row => ({ ...row, psi_sales_profiles: { full_name: actorByProfileId.get(row.uploaded_by)?.profile.full_name || null } })));
  }
  if (url.pathname === '/rest/v1/rpc/psi_record_tender_question_response_with_attachments') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const args = JSON.parse(payload);
      state.rpcCalls.push(args);
      if (state.rpcFails) return json(res, state.rpcFailureCode === '23505' ? 409 : 500, { message: state.rpcFailureCode === '23505' ? 'duplicate key value violates unique constraint' : 'rpc unavailable', code: state.rpcFailureCode || undefined });
      const respondedAt = new Date().toISOString();
      state.questionResponses.push({
        id: args.p_response_id, opportunity_id: args.p_opportunity_id, analysis_run_id: args.p_analysis_run_id,
        question_id: args.p_question_id, question_text: args.p_question_text, status: args.p_status,
        response: args.p_response, evidence_notes: args.p_evidence_notes, responded_by: args.p_responded_by, responded_at: respondedAt,
      });
      for (const attachment of args.p_attachments || []) {
        state.attachments.push({
          id: `attachment-${state.attachments.length + 1}`, response_id: args.p_response_id, opportunity_id: args.p_opportunity_id,
          name: attachment.name, mime_type: attachment.mime_type, size_bytes: attachment.size_bytes,
          storage_path: attachment.storage_path, uploaded_by: args.p_responded_by, uploaded_at: respondedAt,
        });
      }
      return json(res, 200, { id: args.p_response_id, response: args.p_response, attachments: args.p_attachments || [] });
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
    const object = state.objects.get(path);
    if (!object) return json(res, 404, { message: 'object missing' });
    res.writeHead(200, { 'content-type': object.contentType || 'application/octet-stream' });
    return res.end(object.buffer);
  }
  if (url.pathname === '/storage/v1/object/tender-documents' && req.method === 'DELETE') {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const { prefixes } = JSON.parse(payload || '{}');
      state.removals.push(...(prefixes || []));
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
let appServer;
try {
  console.error = () => {};
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    state.rpcCalls.length = 0; state.rpcFails = false; state.signedUploads.length = 0; state.signedReads.length = 0;
    state.removals.length = 0; state.questionResponses.length = 0; state.attachments.length = 0; state.objects.clear();
    appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      const unauthenticated = await requestJson(port, '/api/tender-question-response-attachment-upload-url', null, 'POST', {});
      assert.equal(unauthenticated.status, 401, `backend ${index} rejects unauthenticated upload-url requests`);

      const agentBlocked = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'agent-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'x.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(agentBlocked.status, 403, `backend ${index} blocks agent identities from issuing upload URLs`);

      const agentBlockedPost = await requestJson(port, '/api/tender-question-responses', 'agent-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, question_id: 'q-1', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
      });
      assert.equal(agentBlockedPost.status, 403, `backend ${index} blocks agent identities from recording responses`);

      const noIdentityUpload = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'no-identity-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'x.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(noIdentityUpload.status, 200, `backend ${index} accepts a legacy human profile without identity_type`);

      const noIdentityPost = await requestJson(port, '/api/tender-question-responses', 'no-identity-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, question_id: 'q-1', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
      });
      assert.equal(noIdentityPost.status, 201, `backend ${index} accepts the final response from a legacy human profile without identity_type`);

      const nullIdentityUpload = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'null-identity-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'x.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(nullIdentityUpload.status, 200, `backend ${index} accepts a legacy human profile with identity_type null`);

      const nullIdentityPost = await requestJson(port, '/api/tender-question-responses', 'null-identity-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, question_id: 'q-1', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
      });
      assert.equal(nullIdentityPost.status, 201, `backend ${index} accepts the final response from a legacy human profile with identity_type null`);

      const badMime = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'x.zip', mime_type: 'application/zip', size: 10,
      });
      assert.equal(badMime.status, 400, `backend ${index} rejects disallowed MIME types before signing`);

      const badSize = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'x.pdf', mime_type: 'application/pdf', size: 25 * 1024 * 1024 + 1,
      });
      assert.equal(badSize.status, 400, `backend ${index} rejects oversized files before signing`);

      const badIndex = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 8, name: 'x.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(badIndex.status, 400, `backend ${index} caps attachments per response at 8`);

      const ticket1 = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'RUP vigente.pdf', mime_type: 'application/pdf', size: 1024,
      });
      assert.equal(ticket1.status, 200, `backend ${index} issues a signed upload URL for a valid attachment`);
      assert.equal(typeof ticket1.body.response_id, 'string');
      assert.match(ticket1.body.response_id, /^[0-9a-f-]{36}$/i, `backend ${index} generates a server-side response_id`);
      assert.equal(typeof ticket1.body.response_ticket, 'string', `backend ${index} mints a response_ticket for the first upload-url request`);
      assert.ok(ticket1.body.response_ticket.length > 10, `backend ${index} response_ticket is not trivially short`);
      assert.equal(ticket1.body.storage_path, `tender-documents/${OPPORTUNITY_ID}/question-responses/${ticket1.body.response_id}/${ticket1.body.path.split('/').pop()}`, `backend ${index} shapes storage_path per migration 059`);
      assert.equal(ticket1.body.path, `${OPPORTUNITY_ID}/question-responses/${ticket1.body.response_id}/${ticket1.body.path.split('/').pop()}`, `backend ${index} uses a bucket-relative physical path (no duplicated bucket segment)`);
      assert.equal(state.signedUploads.at(-1), ticket1.body.path, `backend ${index} signs the bucket-relative path, not the DB-shaped storage_path`);

      const responseId = ticket1.body.response_id;

      const ticket2 = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, response_id: responseId, response_ticket: ticket1.body.response_ticket, attachment_index: 1, name: 'Foto.png', mime_type: 'image/png', size: 2048,
      });
      assert.equal(ticket2.status, 200);
      assert.equal(ticket2.body.response_id, responseId, `backend ${index} reuses the same response_id across attachments in one submission`);
      assert.equal(typeof ticket2.body.response_ticket, 'string', `backend ${index} mints a fresh response_ticket on every valid ticket request`);

      // --- Ticket forgery / tampering must be rejected ---

      const missingTicket = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, response_id: responseId, attachment_index: 2, name: 'Sin-ticket.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(missingTicket.status, 403, `backend ${index} rejects a follow-up upload-url request with no response_ticket`);

      const forgedTicket = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, response_id: responseId, response_ticket: 'not-a-real-ticket', attachment_index: 2, name: 'Forjado.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(forgedTicket.status, 403, `backend ${index} rejects a forged response_ticket`);

      const expiredTicket = craftTicket({ opportunityId: OPPORTUNITY_ID, responseId, profileId: HUMAN_ID, expiresAt: Date.now() - 1000 });
      const expiredResult = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, response_id: responseId, response_ticket: expiredTicket, attachment_index: 2, name: 'Expirado.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(expiredResult.status, 403, `backend ${index} rejects an expired (but validly-signed) response_ticket`);

      const mismatchedUser = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token-2', 'POST', {
        opportunity_id: OPPORTUNITY_ID, response_id: responseId, response_ticket: ticket1.body.response_ticket, attachment_index: 2, name: 'Ajeno.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(mismatchedUser.status, 403, `backend ${index} rejects a genuine ticket presented by a different authenticated profile`);

      const mismatchedOpportunity = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OTHER_OPPORTUNITY_ID, response_id: responseId, response_ticket: ticket1.body.response_ticket, attachment_index: 2, name: 'Otra.pdf', mime_type: 'application/pdf', size: 10,
      });
      assert.equal(mismatchedOpportunity.status, 403, `backend ${index} rejects a genuine ticket presented against a different opportunity_id`);

      // --- Authoritative stored-object verification before RPC ---

      const rupBuffer = Buffer.from('contenido real del RUP vigente');
      const rupHash = createHash('sha256').update(rupBuffer).digest('hex');
      state.objects.set(ticket1.body.path, { buffer: rupBuffer, contentType: 'application/pdf' });

      const fotoBuffer = Buffer.from('contenido real de la foto');
      const fotoHash = createHash('sha256').update(fotoBuffer).digest('hex');
      state.objects.set(ticket2.body.path, { buffer: fotoBuffer, contentType: 'image/png' });

      const rpcCallsBeforeFinal = state.rpcCalls.length;
      const finalWithAttachments = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: responseId, response_ticket: ticket2.body.response_ticket, question_id: 'q-1', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí, vigente.',
        attachments: [
          { name: 'RUP vigente.pdf', mime_type: 'application/pdf', size_bytes: rupBuffer.length, content_hash: rupHash.toUpperCase(), storage_path: ticket1.body.storage_path },
          { name: 'Foto.png', mime_type: 'image/png', size_bytes: fotoBuffer.length, content_hash: fotoHash, storage_path: ticket2.body.storage_path },
        ],
      });
      assert.equal(finalWithAttachments.status, 201, `backend ${index} records a response with attachments via RPC 059 once stored content is verified`);
      assert.equal(state.rpcCalls.length, rpcCallsBeforeFinal + 1);
      const finalRpcArgs = state.rpcCalls.at(-1);
      assert.equal(finalRpcArgs.p_response_id, responseId, `backend ${index} passes the ticket-bound response_id into the RPC`);
      assert.equal(finalRpcArgs.p_evidence_notes, null, `backend ${index} always sends p_evidence_notes: null`);
      assert.equal(finalRpcArgs.p_attachments.length, 2);
      assert.equal(finalRpcArgs.p_attachments[0].content_hash, rupHash, `backend ${index} normalizes content_hash to lowercase using the server-computed authoritative hash`);
      assert.equal(finalWithAttachments.body.question_response.id, responseId);
      assert.equal(finalWithAttachments.body.question_response.attachments.length, 2, `backend ${index} groups attachments onto the recorded response`);
      assert.ok(finalWithAttachments.body.question_response.attachments.every(item => typeof item.signed_url === 'string'), `backend ${index} issues short signed download URLs`);
      assert.ok(finalWithAttachments.body.question_response.attachments.every(item => !('storage_path' in item)), `backend ${index} never exposes storage_path to the UI`);
      assert.ok(finalWithAttachments.body.question_response.attachments.every(item => !('response_ticket' in item) && !('ticket' in item)), `backend ${index} never exposes the response_ticket in the API response`);
      for (const item of finalWithAttachments.body.question_response.attachments) {
        assert.equal(downloadName(item.signed_url), item.name, `backend ${index} signed download URL forces attachment disposition with the recorded filename for ${item.name}`);
      }

      const getResponses = await requestJson(port, `/api/tender-question-responses?opportunity_id=${OPPORTUNITY_ID}&analysis_run_id=${RUN_ID}`, 'human-token');
      assert.equal(getResponses.status, 200);
      const grouped = getResponses.body.question_responses.find(item => item.id === responseId);
      assert.ok(grouped, `backend ${index} GET groups attachments by response_id`);
      assert.equal(grouped.attachments.length, 2);
      assert.ok(grouped.attachments.every(item => !('storage_path' in item)), `backend ${index} GET never exposes storage_path`);
      for (const item of grouped.attachments) {
        assert.equal(downloadName(item.signed_url), item.name, `backend ${index} GET signed download URL forces attachment disposition with the recorded filename for ${item.name}`);
      }

      // --- Final POST with attachments must require and verify the ticket ---

      const finalMissingTicket = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: responseId, question_id: 'q-1b', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
        attachments: [{ name: 'RUP vigente.pdf', mime_type: 'application/pdf', size_bytes: rupBuffer.length, content_hash: rupHash, storage_path: ticket1.body.storage_path }],
      });
      assert.equal(finalMissingTicket.status, 403, `backend ${index} rejects a final POST with attachments and no response_ticket`);

      const finalForgedTicket = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: responseId, response_ticket: 'garbage', question_id: 'q-1c', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
        attachments: [{ name: 'RUP vigente.pdf', mime_type: 'application/pdf', size_bytes: rupBuffer.length, content_hash: rupHash, storage_path: ticket1.body.storage_path }],
      });
      assert.equal(finalForgedTicket.status, 403, `backend ${index} rejects a final POST with a forged response_ticket`);

      const finalNoResponseId = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, question_id: 'q-1d', question_text: '¿Existe RUP?', status: 'resolved', response: 'Sí.',
        attachments: [{ name: 'RUP vigente.pdf', mime_type: 'application/pdf', size_bytes: rupBuffer.length, content_hash: rupHash, storage_path: ticket1.body.storage_path }],
      });
      assert.equal(finalNoResponseId.status, 400, `backend ${index} rejects a final POST with attachments but no response_id at all`);

      // --- Final POST without attachments always ignores any client response_id/ticket ---

      const noAttachmentRpcCallsBefore = state.rpcCalls.length;
      const finalNoAttachments = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: responseId, response_ticket: ticket2.body.response_ticket, question_id: 'q-2', question_text: '¿RUT vigente?', status: 'resolved', response: 'Sí.',
      });
      assert.equal(finalNoAttachments.status, 201, `backend ${index} accepts a response with zero attachments`);
      assert.equal(state.rpcCalls.length, noAttachmentRpcCallsBefore + 1);
      const noAttachmentArgs = state.rpcCalls.at(-1);
      assert.deepEqual(noAttachmentArgs.p_attachments, [], `backend ${index} still calls RPC 059 with an empty attachments array`);
      assert.notEqual(noAttachmentArgs.p_response_id, responseId, `backend ${index} ignores a valid client-supplied response_id/ticket and generates a fresh response_id when there are no attachments`);
      assert.match(noAttachmentArgs.p_response_id, /^[0-9a-f-]{36}$/i);

      // --- Authoritative verification failures: reject, cleanup, never call RPC ---

      const mismatchCases = [
        {
          label: 'hash',
          claim: (real) => ({ content_hash: 'f'.repeat(64) }),
        },
        {
          label: 'size',
          claim: (real) => ({ size_bytes: real.length + 1 }),
        },
        {
          label: 'mime',
          claim: () => ({ mime_type: 'image/jpeg' }),
        },
      ];
      for (const mismatchCase of mismatchCases) {
        const ticketX = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
          opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: `${mismatchCase.label}.pdf`, mime_type: 'application/pdf', size: 10,
        });
        assert.equal(ticketX.status, 200);
        const bufferX = Buffer.from(`contenido-${mismatchCase.label}`);
        const hashX = createHash('sha256').update(bufferX).digest('hex');
        state.objects.set(ticketX.body.path, { buffer: bufferX, contentType: 'application/pdf' });
        const claim = {
          name: `${mismatchCase.label}.pdf`, mime_type: 'application/pdf', size_bytes: bufferX.length, content_hash: hashX, storage_path: ticketX.body.storage_path,
          ...mismatchCase.claim(bufferX),
        };
        const rpcBefore = state.rpcCalls.length;
        state.removals.length = 0;
        const mismatchResult = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
          opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: ticketX.body.response_id, response_ticket: ticketX.body.response_ticket,
          question_id: `q-mismatch-${mismatchCase.label}`, question_text: '¿Adjunto?', status: 'resolved', response: 'Sí.',
          attachments: [claim],
        });
        assert.ok(mismatchResult.status >= 400 && mismatchResult.status < 500, `backend ${index} rejects a ${mismatchCase.label} mismatch between the claim and the stored object (status ${mismatchResult.status})`);
        assert.equal(state.rpcCalls.length, rpcBefore, `backend ${index} never calls RPC 059 when the ${mismatchCase.label} verification fails`);
        assert.equal(state.removals.length, 1, `backend ${index} best-effort cleans up the uploaded object when ${mismatchCase.label} verification fails`);
        assert.equal(state.removals[0], ticketX.body.path, `backend ${index} removes the bucket-relative path (not the DB-shaped storage_path) after a ${mismatchCase.label} verification failure`);
      }

      // --- RPC failure still cleans up (distinct from a verification failure) ---

      const ticketForFailure = await requestJson(port, '/api/tender-question-response-attachment-upload-url', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, attachment_index: 0, name: 'Falla.txt', mime_type: 'text/plain', size: 5,
      });
      assert.equal(ticketForFailure.status, 200);
      const fallaBuffer = Buffer.from('conte');
      const fallaHash = createHash('sha256').update(fallaBuffer).digest('hex');
      state.objects.set(ticketForFailure.body.path, { buffer: fallaBuffer, contentType: 'text/plain' });
      state.removals.length = 0;
      state.rpcFails = true;
      const rpcFailure = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: ticketForFailure.body.response_id, response_ticket: ticketForFailure.body.response_ticket, question_id: 'q-3', question_text: '¿Certificado?', status: 'resolved', response: 'Sí.',
        attachments: [{ name: 'Falla.txt', mime_type: 'text/plain', size_bytes: fallaBuffer.length, content_hash: fallaHash, storage_path: ticketForFailure.body.storage_path }],
      });
      assert.equal(rpcFailure.status, 500, `backend ${index} surfaces the original RPC failure once verification passed`);
      assert.equal(state.removals.length, 1, `backend ${index} best-effort cleans up newly uploaded objects on RPC failure`);
      assert.equal(state.removals[0], ticketForFailure.body.path, `backend ${index} removes the bucket-relative path, not the DB-shaped storage_path`);
      state.rpcFails = false;

      // --- A replay/unique conflict must not delete objects from the committed response ---
      state.removals.length = 0;
      state.rpcFails = true;
      state.rpcFailureCode = '23505';
      const replayFailure = await requestJson(port, '/api/tender-question-responses', 'human-token', 'POST', {
        opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, response_id: ticketForFailure.body.response_id, response_ticket: ticketForFailure.body.response_ticket, question_id: 'q-3', question_text: '¿Certificado?', status: 'resolved', response: 'Sí.',
        attachments: [{ name: 'Falla.txt', mime_type: 'text/plain', size_bytes: fallaBuffer.length, content_hash: fallaHash, storage_path: ticketForFailure.body.storage_path }],
      });
      assert.equal(replayFailure.status, 409, `backend ${index} surfaces a replay/unique conflict`);
      assert.equal(state.removals.length, 0, `backend ${index} must preserve already-committed objects on a replay/unique conflict`);
      state.rpcFails = false;
      state.rpcFailureCode = null;
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
} finally {
  console.error = originalConsoleError;
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log('tender question response attachments HTTP contract passed for Node and Vercel');
