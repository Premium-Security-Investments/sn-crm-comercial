// AGT-002 actionable review — HTTP contract for the first-action ensure bridge
// (design §§6.1-6.4, 7.1-7.2, 11, 12.1-12.2, 18). GREEN sub-block 5C1:
// `POST /api/tender-actionable-reviews/ensure` is registered byte-identically
// on `server/index.js` and `api/[...path].js`. It authenticates before any
// table lookup, refuses non-human identities, accepts a strictly closed body
// (the browser may only point at a source that already exists in the run's
// canonical result), re-loads the exact canonical run server-side to derive
// `tender_id` and the §6.4 projection/hash, and answers the identical 404 for
// a foreign opportunity, a run that does not belong to it and a forged
// source_id. No route here reanalyzes, refreshes documents or touches GO/NO-GO.
import assert from 'node:assert/strict';
import http from 'node:http';
import { buildActionableReviewIntegralUnitSource } from '../agt002-actionable-review-canonical.js';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_OPPORTUNITY_ID = '99999999-9999-4999-8999-999999999999';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_RUN_ID = '23232323-2323-4323-8323-232323232323';
const MISSING_RUN_ID = '24242424-2424-4424-8424-242424242424';
const TENDER_ID = '77777777-7777-4777-8777-777777777777';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const HUMAN_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_COMMERCIAL_ID = '66666666-6666-4666-8666-666666666666';
const TEST_SERVICE_KEY = 'test-service-key';

// The exact unit as it lives inside the immutable canonical run result. Every
// hash the server persists must be derived from THIS value, never from
// anything the browser sends.
const UNIT = {
  unit_id: 'unit-dyn-01',
  unit_kind: 'tender_requirement',
  requirement_id: 'req-dyn-poliza',
  category: 'habilitating',
  sequence: 1,
  title: 'Póliza de cumplimiento vigente al cierre',
  assessment_mode: 'assessed',
  conclusion: { status: 'gap_evidenced', summary: 'No hay constancia de póliza vigente.', confidence: 'medium' },
  blocking: { effect: 'blocker', curability: 'curable', reason: 'Subsanable con la póliza vigente.' },
  evidence_state: { presence: 'absent', review: 'not_reviewed', validity: 'unknown', applicability: 'applicable', compliance: 'gap_evidenced_pending_human_review' },
  evidence_refs: [{ ref: 'evidence:chunk:doc-pliego:0142', source_type: 'tender_document', purpose: 'gap_basis' }],
  missing_evidence: [{ missing_id: 'miss-01', evidence_class_id: 'poliza', needed_source_type: 'company_evidence', reason: 'Falta la póliza vigente.', critical: true }],
  commercial_impact: { level: 'high', summary: 'Impide la presentación de la oferta.', dimension: 'elegibilidad' },
  legal_assessment: { status: 'not_verified', basis_refs: [], summary: 'Sin verificación legal disponible.', human_legal_review_required: true },
  actions: [{ action_id: 'act-01', action_type: 'obtain_evidence', summary: 'Solicitar la póliza vigente.', basis_unit_id: 'unit-dyn-01', suggested_role: 'legal', priority: 'critical', external_side_effect: false }],
  milestone: { status: 'verified', type: 'submission_deadline', at: '2026-09-15', source_ref: 'evidence:chunk:doc-pliego:0009', summary: 'Cierre del proceso.' },
  escalation: { required: true, level: 'role_review', reason: 'Requiere revisión jurídica.' },
  closure: { status: 'open', condition: 'Aportar la póliza vigente.', evidence_required: ['poliza'] },
  human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
};
const EXPECTED_SOURCE = buildActionableReviewIntegralUnitSource(UNIT);

const RUNS = {
  [RUN_ID]: { id: RUN_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, result: { integral_analysis: { analysis_units: [UNIT] } } },
  // Same shape, but owned by another opportunity: the mismatch must be a 404.
  [FOREIGN_RUN_ID]: { id: FOREIGN_RUN_ID, opportunity_id: FOREIGN_OPPORTUNITY_ID, tender_id: TENDER_ID, result: { integral_analysis: { analysis_units: [UNIT] } } },
};

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
// Tolerant JSON request helper: before the route exists the app answers with
// Express's default HTML 404, so a raw JSON.parse would abort the suite; this
// normalizes that into (status, body: null) so each assertion fails cleanly.
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
    areas: [{ area_code: 'comercial', subarea_code: 'licitaciones' }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'agent-token': {
    user: { id: 'agent-auth', email: 'agente@example.test' },
    profile: { id: AGENT_ID, full_name: 'Agente', microsoft_email: 'agente@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    areas: [{ area_code: 'comercial', subarea_code: 'licitaciones' }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  // §7.2: `comercial` only reaches contribute through ownership of the
  // opportunity, and never reaches resolve. This one owns nothing here.
  'other-commercial-token': {
    user: { id: 'other-commercial-auth', email: 'otra@example.test' },
    profile: { id: OTHER_COMMERCIAL_ID, full_name: 'Otra Comercial', microsoft_email: 'otra@example.test', auth_user_id: 'other-commercial-auth', role: 'comercial', active: true, identity_type: 'human' },
    areas: [{ area_code: 'comercial', subarea_code: 'licitaciones' }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

// Stateful PostgREST/RPC emulation matching the real migration-078 ensure RPC:
// unique on (analysis_run_id, source_kind, source_id), a re-ensure with a
// different source_hash is a closed 23514 conflict, and the row is never
// created from anything the client sent.
const state = { rpcCalls: [], items: new Map(), tableReads: [] };

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const eq = name => String(url.searchParams.get(name) || '').replace(/^eq\./, '');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const actor = actorByAuthId.get(eq('auth_user_id'));
    return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    return json(res, 200, actorByProfileId.get(eq('profile_id'))?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    return json(res, 200, actorByProfileId.get(eq('profile_id'))?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    state.tableReads.push('psi_sales_opportunities');
    return json(res, 200, eq('id') === OPPORTUNITY_ID ? [{ id: OPPORTUNITY_ID, owner_id: HUMAN_ID }] : []);
  }
  if (url.pathname === '/rest/v1/psi_tender_analysis_runs') {
    state.tableReads.push('psi_tender_analysis_runs');
    const run = RUNS[eq('id')];
    return json(res, 200, run ? [run] : []);
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_items') {
    const item = state.items.get(`${eq('analysis_run_id')}:${eq('source_kind')}:${eq('source_id')}`);
    return json(res, 200, item ? [{ id: item.id }] : []);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(payload || '{}');
      state.rpcCalls.push({ name, args });
      if (name !== 'psi_ensure_tender_actionable_review_item') return json(res, 200, {});
      const key = `${args.p_analysis_run_id}:${args.p_source_kind}:${args.p_source_id}`;
      const existing = state.items.get(key);
      if (existing) {
        if (existing.source_hash !== args.p_source_hash) {
          return json(res, 409, { code: '23514', message: `Conflicto de hash: el pendiente ${existing.id} ya existe con un source_hash distinto.` });
        }
        return json(res, 200, existing);
      }
      const item = {
        id: ITEM_ID,
        opportunity_id: args.p_opportunity_id,
        tender_id: args.p_tender_id,
        analysis_run_id: args.p_analysis_run_id,
        source_kind: args.p_source_kind,
        source_id: args.p_source_id,
        requirement_id: args.p_requirement_id,
        source_hash: args.p_source_hash,
        created_at: '2026-08-31T00:00:00.000Z',
      };
      state.items.set(key, item);
      return json(res, 200, item);
    });
  }
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

const savedEnv = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].map(key => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
process.env.VERCEL = '1';

const ENSURE_PATH = '/api/tender-actionable-reviews/ensure';
function ensureBody(overrides = {}) {
  return { opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, source_kind: 'integral_unit', source_id: UNIT.unit_id, ...overrides };
}

const originalConsoleError = console.error;
try {
  console.error = () => {};
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    state.rpcCalls.length = 0;
    state.tableReads.length = 0;
    state.items.clear();
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      // --- auth-before-lookup: no session, no table read at all -------------
      const unauthenticated = await requestJson(port, ENSURE_PATH, null, 'POST', ensureBody());
      assert.equal(unauthenticated.status, 401, `backend ${index} rejects an unauthenticated ensure`);
      assert.deepEqual(state.tableReads, [], `backend ${index} must not read any resource table before authenticating`);

      // --- §7.2: an agent identity never receives one of the five actions ---
      const agentEnsure = await requestJson(port, ENSURE_PATH, 'agent-token', 'POST', ensureBody());
      assert.equal(agentEnsure.status, 403, `backend ${index} forbids an agent identity from ensuring an item`);
      assert.equal(agentEnsure.body?.code, 'review_action_forbidden');
      assert.deepEqual(state.tableReads, [], `backend ${index} rejects the agent identity before any resource lookup`);

      // --- closed body: the browser may never supply the hash, the canonical
      // payload or the tender; these are rejected, not silently ignored ------
      for (const [label, forged] of [
        ['source_hash', { source_hash: EXPECTED_SOURCE.sourceHash }],
        ['tender_id', { tender_id: TENDER_ID }],
        ['a canonical projection', { source: EXPECTED_SOURCE.projection }],
        ['origin', { origin: 'canonical_analysis_projection' }],
        ['actor_id', { actor_id: HUMAN_ID }],
      ]) {
        const response = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody(forged));
        assert.equal(response.status, 400, `backend ${index} rejects a body carrying ${label}`);
        assert.equal(response.body?.code, 'invalid_review_input');
      }
      assert.equal(state.rpcCalls.length, 0, `backend ${index} never reaches the RPC with a client-supplied hash/payload`);

      // --- §6.1/§6.2: decision_review findings are explicitly refused -------
      const decisionFinding = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ source_kind: 'decision_review_finding', source_id: 'finding-1' }));
      assert.equal(decisionFinding.status, 400, `backend ${index} refuses decision_review_finding while it is derived and non-persisted`);
      assert.equal(decisionFinding.body?.code, 'invalid_review_input');

      const unknownKind = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ source_kind: 'texto_libre' }));
      assert.equal(unknownKind.status, 400, `backend ${index} refuses an unsupported source_kind`);

      // --- malformed identifiers never reach the database -------------------
      const badUuid = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ analysis_run_id: 'no-es-uuid' }));
      assert.equal(badUuid.status, 400, `backend ${index} requires UUID identifiers`);
      const badIdempotency = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ idempotency_key: 'no-es-uuid' }));
      assert.equal(badIdempotency.status, 400, `backend ${index} requires a UUID idempotency key when one is sent`);
      assert.equal(state.rpcCalls.length, 0, `backend ${index} never calls the RPC for an invalid request`);

      // --- valid ensure: 201, private no-store, minimal public state --------
      const created = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
      assert.equal(created.status, 201, `backend ${index} creates the stable identity on the first action`);
      assert.equal(created.headers['cache-control'], 'private, no-store', `backend ${index} marks the ensure response private, no-store`);
      assert.equal(created.body?.id, ITEM_ID, `backend ${index} returns the public item UUID`);
      assert.equal(created.body?.status, 'pendiente', `backend ${index} returns the minimal projected state`);
      assert.equal(created.body?.requirement_id, UNIT.requirement_id);
      for (const forbidden of ['source_hash', 'tender_id', 'source_id', 'unit_id', 'storage_path', 'opportunity_id']) {
        assert.equal(Object.hasOwn(created.body || {}, forbidden), false, `backend ${index} never leaks ${forbidden} in the ensure response`);
      }

      // --- the RPC receives only server-derived values -----------------------
      const ensureCalls = state.rpcCalls.filter(call => call.name === 'psi_ensure_tender_actionable_review_item');
      assert.equal(ensureCalls.length, 1, `backend ${index} calls the ensure RPC exactly once`);
      assert.equal(ensureCalls[0].args.p_tender_id, TENDER_ID, `backend ${index} passes the tender_id it loaded from the run, never one from the body`);
      assert.equal(ensureCalls[0].args.p_analysis_run_id, RUN_ID);
      assert.equal(ensureCalls[0].args.p_opportunity_id, OPPORTUNITY_ID);
      assert.equal(ensureCalls[0].args.p_source_kind, 'integral_unit');
      assert.equal(ensureCalls[0].args.p_source_id, UNIT.unit_id);
      assert.equal(ensureCalls[0].args.p_requirement_id, UNIT.requirement_id);
      assert.equal(ensureCalls[0].args.p_actor_id, HUMAN_ID, `backend ${index} passes the authenticated actor, never a body-supplied one`);
      assert.equal(ensureCalls[0].args.p_source_hash, EXPECTED_SOURCE.sourceHash,
        `backend ${index} hashes the exact §6.4 projection of the unit found in the canonical run`);
      assert.equal(Object.hasOwn(ensureCalls[0].args, 'p_idempotency_key'), false,
        `backend ${index} sends no idempotency argument the real RPC signature does not declare`);
      assert.equal(Object.hasOwn(ensureCalls[0].args, 'p_request_hash'), false,
        `backend ${index} sends no request_hash argument the real RPC signature does not declare`);

      // --- replay: same identity is idempotent and answers 200 --------------
      const replayed = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
      assert.equal(replayed.status, 200, `backend ${index} replays an already materialized identity without creating it again`);
      assert.deepEqual(replayed.body, created.body, `backend ${index} returns the exact same persisted identity on replay`);
      assert.equal(state.items.size, 1, `backend ${index} never materializes a second row for the same source`);

      // --- a replay with a different idempotency key is still the same row --
      const replayedOtherKey = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
      assert.equal(replayedOtherKey.status, 200, `backend ${index} keys the identity on the source, not on the client key`);
      assert.deepEqual(replayedOtherKey.body, created.body);

      // --- a forged source_id is the identical 404 of a nonexistent resource
      const forgedSource = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ source_id: 'unit-inventada-99' }));
      const foreignOpportunity = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ opportunity_id: FOREIGN_OPPORTUNITY_ID }));
      assert.equal(forgedSource.status, 404, `backend ${index} answers 404 for a source that is not in the canonical result`);
      assert.equal(forgedSource.body?.code, 'review_item_not_found');
      assert.deepEqual(forgedSource.body, foreignOpportunity.body,
        `backend ${index} makes a forged source indistinguishable from an invisible opportunity`);

      // --- run/opportunity mismatch and a nonexistent run are the same 404 --
      const runMismatch = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ analysis_run_id: FOREIGN_RUN_ID }));
      const missingRun = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody({ analysis_run_id: MISSING_RUN_ID }));
      assert.equal(runMismatch.status, 404, `backend ${index} refuses a run that does not belong to the opportunity`);
      assert.deepEqual(runMismatch.body, missingRun.body, `backend ${index} makes a foreign run indistinguishable from a nonexistent one`);
      assert.equal(state.items.size, 1, `backend ${index} materializes nothing for a mismatched run`);

      // --- §7.2: a `comercial` who owns nothing here gets the same safe 404 -
      const unauthorizedRole = await requestJson(port, ENSURE_PATH, 'other-commercial-token', 'POST', ensureBody());
      assert.equal(unauthorizedRole.status, 404, `backend ${index} hides the resource from a comercial who does not own the opportunity`);
      assert.deepEqual(unauthorizedRole.body, foreignOpportunity.body, `backend ${index} uses the same closed 404 body for an unauthorized role`);

      // --- §11/§18: a stored identity with another source_hash is a closed
      // 409, never a silent overwrite -----------------------------------------
      state.items.get(`${RUN_ID}:integral_unit:${UNIT.unit_id}`).source_hash = 'f'.repeat(64);
      const hashConflict = await requestJson(port, ENSURE_PATH, 'human-token', 'POST', ensureBody());
      assert.equal(hashConflict.status, 409, `backend ${index} answers 409 when the stored identity has a different source_hash`);
      assert.equal(hashConflict.body?.code, 'review_version_conflict');

      // --- strict invariant: ensure never analyzes, reanalyzes or decides ---
      assert.deepEqual(
        [...new Set(state.rpcCalls.map(call => call.name))],
        ['psi_ensure_tender_actionable_review_item'],
        `backend ${index} calls no RPC other than the ensure bridge`,
      );
      assert.equal(state.rpcCalls.some(call => /reanaly[sz]|go_no_go|document_refresh|snapshot|analysis_run_record/i.test(call.name)), false,
        `backend ${index} must never trigger AGT reanalysis, snapshots or GO/NO-GO from the ensure route`);
      assert.equal(state.tableReads.some(table => /document|snapshot|go_no_go/i.test(table)), false,
        `backend ${index} must never read or write documents, snapshots or decisions from the ensure route`);
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

console.log('AGT-002 actionable review ensure HTTP contract (GREEN 5C1) passed');
