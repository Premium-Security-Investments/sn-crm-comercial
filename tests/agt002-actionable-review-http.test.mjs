// AGT-002 actionable review — HTTP contract for review/comment/outcome/reopen
// routes (design §§7.1, 12.1-12.2, 17-18). GREEN sub-block 3A1: the four
// routes are registered byte-identically on `server/index.js` and
// `api/[...path].js`, auth-before-lookup denies an agent identity and an
// unauthenticated request before any table lookup, a foreign/nonexistent
// item answers the identical 404, and comment/outcome/reopen wire through
// the migration-078 RPCs with server-computed canonical idempotency hashing.
import assert from 'node:assert/strict';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OPPORTUNITY_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const FOREIGN_ITEM_ID = '10101010-1010-4101-8101-101010101010';
const NONEXISTENT_ITEM_ID = '20202020-2020-4202-8202-202020202020';
const HUMAN_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
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
// Tolerant JSON request helper: the app under test may (correctly, pre-
// implementation) answer with Express's default HTML 404, so a raw JSON.parse
// would throw and abort the whole suite; this normalizes that into a typed
// (status, body: null) result instead so assertions fail cleanly per-case.
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
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON (e.g. default 404 page) */ }
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
  'agent-token': {
    user: { id: 'agent-auth', email: 'agente@example.test' },
    profile: { id: AGENT_ID, full_name: 'Agente', microsoft_email: 'agente@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

// Realistic, deterministic PostgREST/RPC emulation for the routes under test
// (the generic `{}`-for-every-RPC fake cannot distinguish valid/foreign/
// nonexistent items nor persist idempotency, so this harness fixture — the
// only part of the fake this block is allowed to touch — replaces the item
// lookup and RPC branches with stateful behavior matching the real
// migration-078 RPCs' contract: same key + same request_hash replays the
// persisted event, same key + a different hash is a closed 409, and only
// `ITEM_ID` resolves to a real row).
const state = { rpcCalls: [], actionableReviewEvents: new Map(), actionableReviewSequence: 0 };
const ACTIONABLE_REVIEW_RPC_EVENT_TYPE = {
  psi_record_tender_actionable_review_comment: 'comment_added',
  psi_record_tender_actionable_review_outcome: 'outcome_recorded',
  psi_reopen_tender_actionable_review: 'reopened',
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
    if (!idFilter) return json(res, 200, []); // GET list: no item ensured yet in this HTTP-contract test.
    const found = idFilter === ITEM_ID
      ? [{ id: ITEM_ID, opportunity_id: OPPORTUNITY_ID, tender_id: RUN_ID, analysis_run_id: RUN_ID, requirement_id: null, created_at: '2026-08-31T00:00:00.000Z' }]
      : []; // FOREIGN_ITEM_ID and NONEXISTENT_ITEM_ID both resolve to no row — indistinguishable 404 upstream.
    return json(res, 200, found);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(payload || '{}');
      state.rpcCalls.push({ name, args });
      const eventType = ACTIONABLE_REVIEW_RPC_EVENT_TYPE[name];
      if (!eventType) return json(res, 200, {});
      const key = `${args.p_actor_id}:${args.p_idempotency_key}`;
      const existing = state.actionableReviewEvents.get(key);
      if (existing) {
        if (existing.requestHash === args.p_request_hash) return json(res, 200, existing.result);
        return json(res, 409, {
          code: '23505',
          message: `idempotency_payload_mismatch: la clave ${args.p_idempotency_key} ya fue usada por ${args.p_actor_id} con un request_hash distinto.`,
        });
      }
      state.actionableReviewSequence += 1;
      const result = {
        id: `actionable-review-event-${state.actionableReviewSequence}`,
        review_item_id: args.p_review_item_id,
        sequence: state.actionableReviewSequence,
        event_type: eventType,
        outcome: args.p_outcome ?? null,
        note: args.p_note ?? null,
        reusable_requested: args.p_reusable_requested ?? null,
        created_at: '2026-08-31T00:00:00.000Z',
      };
      state.actionableReviewEvents.set(key, { requestHash: args.p_request_hash, result });
      return json(res, 200, result);
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
try {
  console.error = () => {};
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    state.rpcCalls.length = 0;
    state.actionableReviewEvents.clear();
    state.actionableReviewSequence = 0;
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      // --- GET list: authenticates before any query, indistinguishable 404,
      // no-store, and the compact summary/capabilities shape (§12.1-12.2). ---
      const unauthenticatedList = await requestJson(port, `/api/tender-actionable-reviews?opportunity_id=${OPPORTUNITY_ID}&analysis_run_id=${RUN_ID}`, null);
      assert.equal(unauthenticatedList.status, 401, `backend ${index} rejects an unauthenticated list request`);

      const okList = await requestJson(port, `/api/tender-actionable-reviews?opportunity_id=${OPPORTUNITY_ID}&analysis_run_id=${RUN_ID}`, 'human-token');
      assert.equal(okList.status, 200, `backend ${index} serves the review list to an authorized human`);
      assert.equal(okList.headers['cache-control'], 'private, no-store', `backend ${index} marks the review list private, no-store`);
      assert.ok(okList.body && Array.isArray(okList.body.items), `backend ${index} returns an items[] array`);
      assert.ok(okList.body && okList.body.summary && typeof okList.body.summary.open_count === 'number', `backend ${index} returns summary.open_count`);
      assert.ok(okList.body && typeof okList.body.summary.confirmed_risk_count === 'number', `backend ${index} returns summary.confirmed_risk_count`);
      assert.equal(okList.body?.items?.some(item => 'storage_path' in item || 'unit_id' in item || 'source_hash' in item), false,
        `backend ${index} never leaks storage paths, technical unit ids or hashes in the list response`);

      // --- comments: agent identities are forbidden outright (§7.2) --------
      const agentComment = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/comments`, 'agent-token', 'POST', {
        comment: 'Comentario de agente.', idempotency_key: '66666666-6666-4666-8666-666666666666',
      });
      assert.equal(agentComment.status, 403, `backend ${index} forbids an agent identity from commenting`);

      // --- unauthenticated writes are rejected before any lookup -----------
      const unauthenticatedComment = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/comments`, null, 'POST', {
        comment: 'x', idempotency_key: '77777777-7777-4777-8777-777777777777',
      });
      assert.equal(unauthenticatedComment.status, 401, `backend ${index} rejects an unauthenticated comment`);

      // --- foreign/nonexistent items are 404-identical (§12.1) -------------
      const foreignItem = await requestJson(port, `/api/tender-actionable-reviews/${FOREIGN_ITEM_ID}/comments`, 'human-token', 'POST', {
        comment: 'Intento sobre item ajeno.', idempotency_key: '88888888-8888-4888-8888-888888888888',
      });
      const nonexistentItem = await requestJson(port, `/api/tender-actionable-reviews/${NONEXISTENT_ITEM_ID}/comments`, 'human-token', 'POST', {
        comment: 'Intento sobre item inexistente.', idempotency_key: '99999999-9999-4999-8999-999999999999',
      });
      assert.equal(foreignItem.status, 404, `backend ${index} answers 404 for a foreign item`);
      assert.equal(nonexistentItem.status, 404, `backend ${index} answers 404 for a nonexistent item`);
      assert.equal(foreignItem.body?.code, 'review_item_not_found', `backend ${index} uses the closed review_item_not_found code`);
      assert.deepEqual(foreignItem.body, nonexistentItem.body, `backend ${index} makes a foreign item indistinguishable from a nonexistent one`);

      // --- a valid comment succeeds; replay with the same key+hash is
      // idempotent, replay with the same key + a different payload is 409 ---
      const firstComment = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/comments`, 'human-token', 'POST', {
        comment: 'Se solicitó soporte al proveedor.', idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      assert.equal(firstComment.status, 201, `backend ${index} accepts a valid comment`);

      const replayedComment = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/comments`, 'human-token', 'POST', {
        comment: 'Se solicitó soporte al proveedor.', idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      assert.equal(replayedComment.status, 201, `backend ${index} replays an identical idempotent comment without erroring`);
      assert.deepEqual(replayedComment.body, firstComment.body, `backend ${index} returns the exact same persisted event on replay`);

      const mismatchedReplay = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/comments`, 'human-token', 'POST', {
        comment: 'Comentario distinto con la misma key.', idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      assert.equal(mismatchedReplay.status, 409, `backend ${index} answers 409 idempotency_payload_mismatch for the same key with a different payload`);
      assert.equal(mismatchedReplay.body?.code, 'idempotency_payload_mismatch');

      // --- outcome: informacion_insuficiente stays open; reopen requires a
      // mandatory note and only applies to a resolved item -------------------
      const outcome = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/outcomes`, 'human-token', 'POST', {
        outcome: 'riesgo_confirmado', note: 'Riesgo confirmado por ausencia de póliza vigente.', reusable_requested: true,
        idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });
      assert.equal(outcome.status, 200, `backend ${index} records a closing outcome`);

      const reopenWithoutNote = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/reopen`, 'human-token', 'POST', {
        idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
      assert.equal(reopenWithoutNote.status, 400, `backend ${index} rejects a reopen with no mandatory note`);
      assert.equal(reopenWithoutNote.body?.code, 'invalid_review_input');

      const reopen = await requestJson(port, `/api/tender-actionable-reviews/${ITEM_ID}/reopen`, 'human-token', 'POST', {
        note: 'La póliza aportada no cubre el periodo requerido.', idempotency_key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      });
      assert.equal(reopen.status, 200, `backend ${index} accepts a reopen with a mandatory note`);

      // --- strict invariant: none of these routes ever trigger reanalysis --
      assert.equal(state.rpcCalls.some(call => /reanaly[sz]e|reanalysis/i.test(call.name)), false,
        `backend ${index} must never call a reanalysis RPC from the actionable review routes`);
    } finally {
      await new Promise(resolve => appServer.close(resolve));
    }
  }
} finally {
  console.error = originalConsoleError;
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

console.log('AGT-002 actionable review HTTP contract (GREEN 3A1) passed');
