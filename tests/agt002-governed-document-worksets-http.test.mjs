// AGT-002 governed document worksets — HTTP contract for the Phase 3 freeze/enqueue route
// (.hermes/plans/2026-09-17-agt002-governed-document-worksets.md). Real Express app, real
// server/index.js and api/[...path].js (byte-parity), fake Supabase REST+RPC backend — same
// convention as tests/agt002-actionable-review-http.test.mjs. Covers auth-before-lookup,
// fail-closed permission/role/body/scope checks, the snapshot/context-version precondition, and
// the success path's sanitized response + server-resolved (never client-trusted) RPC payload.
import assert from 'node:assert/strict';
import http from 'node:http';

function uuid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
function hex64(label) {
  const base = Buffer.from(String(label)).toString('hex');
  return base.repeat(Math.ceil(64 / base.length)).slice(0, 64);
}

const OPPORTUNITY_ID = uuid('http-opportunity-1');
const TENDER_ID = uuid('http-tender-1');
const NO_SNAPSHOT_OPPORTUNITY_ID = uuid('http-nosnapshot-opp');
const NO_SNAPSHOT_TENDER_ID = uuid('http-tender-no-snapshot');
const DOC_A = uuid('http-doc-a');
const DOC_B = uuid('http-doc-b');
const DOC_HUGE = uuid('http-doc-huge');
const DOC_OVER_DURABLE = uuid('http-doc-over-durable');
const DOC_BAD_EVIDENCE = uuid('http-doc-bad-evidence');
const SNAPSHOT_ID = uuid('http-snapshot-1');
const CONTEXT_VERSION_ID = uuid('http-context-1');
const CUSTODY_ID = uuid('http-custody-profile');
const NO_CUSTODY_ID = uuid('http-no-custody-profile');
const AGENT_ID = uuid('http-agent-profile');
const TEST_SERVICE_KEY = 'test-service-key';

// Regression guard: uuid() derives an ID from only the first 16 bytes of its label, so two
// labels sharing a 16-byte prefix (e.g. 'http-opportunity-1' and 'http-opportunity-no-snapshot')
// silently collide into the same fixture ID. Fail fast if that ever happens again.
{
  const scenarioIds = {
    OPPORTUNITY_ID, TENDER_ID, NO_SNAPSHOT_OPPORTUNITY_ID, NO_SNAPSHOT_TENDER_ID,
    DOC_A, DOC_B, DOC_HUGE, DOC_OVER_DURABLE, DOC_BAD_EVIDENCE, SNAPSHOT_ID, CONTEXT_VERSION_ID, CUSTODY_ID, NO_CUSTODY_ID, AGENT_ID,
  };
  const entries = Object.entries(scenarioIds);
  const seen = new Map();
  for (const [name, id] of entries) {
    const clashingName = seen.get(id);
    assert.ok(!clashingName, `fixture ID collision: ${name} and ${clashingName} both resolved to ${id}`);
    seen.set(id, name);
  }
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(value === undefined ? '' : JSON.stringify(value));
}
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
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
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const actors = {
  'custody-token': {
    user: { id: 'custody-auth', email: 'custodia@example.test' },
    profile: { id: CUSTODY_ID, full_name: 'Custodia', microsoft_email: 'custodia@example.test', auth_user_id: 'custody-auth', role: 'admin', active: true, identity_type: 'human' },
    areas: [], permissions: [{ permission_code: 'licitaciones' }, { permission_code: 'licitaciones_custodia' }],
  },
  'no-custody-token': {
    user: { id: 'no-custody-auth', email: 'sincustodia@example.test' },
    profile: { id: NO_CUSTODY_ID, full_name: 'Sin Custodia', microsoft_email: 'sincustodia@example.test', auth_user_id: 'no-custody-auth', role: 'admin', active: true, identity_type: 'human' },
    areas: [], permissions: [{ permission_code: 'licitaciones' }],
  },
  'agent-token': {
    user: { id: 'agent-auth', email: 'agente@example.test' },
    profile: { id: AGENT_ID, full_name: 'Agente', microsoft_email: 'agente@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    areas: [], permissions: [{ permission_code: 'licitaciones' }, { permission_code: 'licitaciones_custodia' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map((actor) => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map((actor) => [actor.profile.id, actor]));

function candidateEvidence(opportunityId, tenderId, docId, index, overrides = {}) {
  return {
    document_version_id: docId, opportunity_id: opportunityId, tender_id: tenderId, current: true, extraction_status: 'ok',
    content_hash: hex64(`content-${docId}-${index}`), extraction_id: uuid(`extraction-${docId}-${index}`), extraction_text_hash: hex64(`text-${docId}-${index}`),
    extracted_text_char_count: 500,
    ...overrides,
  };
}

const state = { rpcCalls: [], freezeEnqueueCalls: 0 };

function queryEq(url, name) {
  return String(url.searchParams.get(name) || '').replace(/^eq\./, '');
}

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = queryEq(url, 'auth_user_id');
    const actor = actorByAuthId.get(authUserId);
    return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = queryEq(url, 'profile_id');
    return json(res, 200, actorByProfileId.get(profileId)?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = queryEq(url, 'profile_id');
    return json(res, 200, actorByProfileId.get(profileId)?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    // ensureOpportunityAccess: privileged (admin) actors pass regardless of owner_id.
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: CUSTODY_ID, customer_segment: 'cliente_nuevo' });
  }
  if (url.pathname === '/rest/v1/v_psi_sales_opportunity_enriched') {
    const id = queryEq(url, 'id');
    return json(res, 200, { id, owner_id: CUSTODY_ID, service_type_code: 'licitacion_publica', stage_code: 'prospecto' });
  }
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    const opportunityId = queryEq(url, 'converted_opportunity_id');
    if (opportunityId === NO_SNAPSHOT_OPPORTUNITY_ID) return json(res, 200, { id: NO_SNAPSHOT_TENDER_ID });
    return json(res, 200, { id: TENDER_ID });
  }
  if (url.pathname === '/rest/v1/psi_tender_document_snapshots') {
    const opportunityId = queryEq(url, 'opportunity_id');
    if (opportunityId === NO_SNAPSHOT_OPPORTUNITY_ID) return json(res, 200, null);
    return json(res, 200, { id: SNAPSHOT_ID });
  }
  if (url.pathname === '/rest/v1/psi_agt002_context_versions') {
    return json(res, 200, { id: CONTEXT_VERSION_ID });
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let payload = '';
    req.on('data', (chunk) => { payload += chunk; });
    return req.on('end', () => {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(payload || '{}');
      state.rpcCalls.push({ name, args });
      if (name === 'psi_resolve_agt002_governed_document_candidate') {
        if (args.p_document_version_id === DOC_A) return json(res, 200, candidateEvidence(args.p_opportunity_id, args.p_tender_id, DOC_A, 0));
        if (args.p_document_version_id === DOC_B) return json(res, 200, candidateEvidence(args.p_opportunity_id, args.p_tender_id, DOC_B, 1));
        // A single document whose server-resolved size alone exceeds the route's operational
        // batch-capacity ceiling: ceil(2,000,000 / 20,000) = 100 predicted batches > 64.
        if (args.p_document_version_id === DOC_HUGE) return json(res, 200, candidateEvidence(args.p_opportunity_id, args.p_tender_id, DOC_HUGE, 2, { extracted_text_char_count: 2_000_000 }));
        // A single document whose server-resolved size exceeds even the durable policy's own
        // 184-batch ceiling: ceil(3,680,001 / 20,000) = 185 predicted batches > 184.
        if (args.p_document_version_id === DOC_OVER_DURABLE) return json(res, 200, candidateEvidence(args.p_opportunity_id, args.p_tender_id, DOC_OVER_DURABLE, 4, { extracted_text_char_count: 3_680_001 }));
        if (args.p_document_version_id === DOC_BAD_EVIDENCE) return json(res, 200, candidateEvidence(args.p_opportunity_id, args.p_tender_id, DOC_BAD_EVIDENCE, 3, { extracted_text_char_count: null }));
        return json(res, 404, { code: 'P0002', message: 'La versión documental no existe.' });
      }
      if (name === 'psi_freeze_agt002_governed_document_workset') {
        state.freezeEnqueueCalls += 1;
        return json(res, 200, {
          status: 'created',
          workset_id: uuid('http-workset-result'),
          run_id: uuid('http-run-result'),
          reanalysis_job_id: uuid('http-job-result'),
          member_count: args.p_members.length,
          selection_hash: args.p_frozen_engine_input.document_workset_identity.selection_hash,
        });
      }
      return json(res, 200, {});
    });
  }
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

function twoDocumentsBody(overrides = {}) {
  return {
    opportunity_id: OPPORTUNITY_ID,
    documents: [
      { document_version_id: DOC_A, source_classification: 'official', inclusion_reason: 'Pliego de condiciones vigente.' },
      { document_version_id: DOC_B, source_classification: 'corporate', inclusion_reason: 'Certificado de experiencia propio.' },
    ],
    ...overrides,
  };
}

// Only the server-owned AGT runtime/flag environment the governed freeze route's own canonical
// frozen-engine-input source factory needs (agt002-preview-runtime.js's getAgt002PreviewRuntimeConfig
// plus the module-level AGT002_CANONICAL_ONLY flag buildAgt002FrozenEngineInput requires) — never
// anything the client/browser could ever influence.
const savedEnv = Object.fromEntries([
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL',
  'TENDER_ANALYSIS_ENGINE', 'AGT002_PREVIEW_MODEL', 'AGT002_HETZNER_BRIDGE_URL', 'AGT002_HETZNER_BRIDGE_HMAC_SECRET',
  'AGT002_CANONICAL_ONLY',
].map((key) => [key, process.env[key]]));
const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_KEY;
process.env.VERCEL = '1';
process.env.TENDER_ANALYSIS_ENGINE = 'agt002_codex_preview';
process.env.AGT002_PREVIEW_MODEL = 'sonnet';
process.env.AGT002_HETZNER_BRIDGE_URL = 'https://agt002.5-78-140-24.sslip.io/v1/agt002-preview/run';
process.env.AGT002_HETZNER_BRIDGE_HMAC_SECRET = 'a'.repeat(32);
process.env.AGT002_CANONICAL_ONLY = 'true';

const originalConsoleError = console.error;
try {
  console.error = () => {};
  const modules = [await import('../server/index.js'), await import('../api/[...path].js')];
  for (const [index, module] of modules.entries()) {
    state.rpcCalls.length = 0;
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      const ROUTE = '/api/tender-agt002-governed-document-worksets';

      const unauthenticated = await requestJson(port, ROUTE, null, 'POST', twoDocumentsBody());
      assert.equal(unauthenticated.status, 401, `backend ${index}: unauthenticated request must be rejected before any lookup`);

      const noCustody = await requestJson(port, ROUTE, 'no-custody-token', 'POST', twoDocumentsBody());
      assert.equal(noCustody.status, 403, `backend ${index}: a Licitaciones user WITHOUT custody must be forbidden`);

      const agent = await requestJson(port, ROUTE, 'agent-token', 'POST', twoDocumentsBody());
      assert.equal(agent.status, 403, `backend ${index}: an agent identity must never freeze a governed workset on its own`);

      const unexpectedKey = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({ snapshot_id: SNAPSHOT_ID }));
      assert.equal(unexpectedKey.status, 400, `backend ${index}: an unexpected top-level key (client-declared snapshot_id) must be rejected`);

      const clientSuppliedTenderId = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({ tender_id: TENDER_ID }));
      assert.equal(clientSuppliedTenderId.status, 400, `backend ${index}: tender_id must be rejected as an unexpected client key — it is always server-resolved`);

      const emptyDocuments = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({ documents: [] }));
      assert.equal(emptyDocuments.status, 400, `backend ${index}: an empty documents array must be rejected`);

      const noSnapshot = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({
        opportunity_id: NO_SNAPSHOT_OPPORTUNITY_ID,
      }));
      assert.equal(noSnapshot.status, 409, `backend ${index}: freezing without a registered document snapshot must fail closed`);

      state.rpcCalls.length = 0;
      const ok = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody());
      assert.equal(ok.status, 202, `backend ${index}: a valid freeze/enqueue request succeeds`);
      assert.deepEqual(Object.keys(ok.body || {}).sort(), ['capacity_preflight', 'member_count', 'reanalysis_job_id', 'run_id', 'selection_hash', 'status', 'workset_id'], `backend ${index}: response is the sanitized seven-field summary only`);
      assert.equal(ok.body.status, 'created');
      assert.equal(ok.body.member_count, 2);
      assert.equal(ok.body.capacity_preflight.verdict, 'APTO', `backend ${index}: a successful freeze response must carry the APTO capacity preflight evidence`);
      assert.equal(ok.body.capacity_preflight.source_char_count, 1_000, `backend ${index}: source_char_count must be the sum of the server-resolved candidates' char counts`);
      assert.equal(ok.body.capacity_preflight.max_batch_count, 64, `backend ${index}: the classic ceiling must be reported for context`);
      assert.equal(ok.body.capacity_preflight.durable_max_batch_count, 184, `backend ${index}: the durable ceiling must be reported for context`);
      assert.equal(ok.body.capacity_preflight.effective_max_batch_count, 184, `backend ${index}: the default execution mode for this route is durable checkpointed, so the effective ceiling is the durable one`);

      const freezeCall = state.rpcCalls.find((c) => c.name === 'psi_freeze_agt002_governed_document_workset');
      assert.ok(freezeCall, `backend ${index}: must call the freeze RPC`);
      const memberA = freezeCall.args.p_members.find((m) => m.document_version_id === DOC_A);
      assert.equal(memberA.content_hash, hex64(`content-${DOC_A}-0`), `backend ${index}: p_members content_hash must be the server-resolved candidate hash, never client-supplied`);
      assert.equal(freezeCall.args.p_actor_profile_id, CUSTODY_ID);

      // The frozen engine input the real freeze route sends is composed through the canonical
      // builder (server-owned model/config/identity, never client-influenced), not the legacy
      // identity-only shape: it carries the canonical top-level fields plus the governed
      // identity/members.
      const frozenEngineInput = freezeCall.args.p_frozen_engine_input;
      assert.equal(frozenEngineInput.schema_version, 2, `backend ${index}: frozen engine input must carry the canonical schema_version`);
      assert.equal(frozenEngineInput.engine_identity.model, 'sonnet', `backend ${index}: engine_identity.model must come from server-owned AGT002_PREVIEW_MODEL, never the client`);
      assert.equal(typeof frozenEngineInput.engine_identity.idempotency_key, 'string');
      assert.ok(frozenEngineInput.engine_identity.idempotency_key.length > 0);
      assert.equal(frozenEngineInput.analysis_flags.AGT002_CANONICAL_ONLY, true, `backend ${index}: analysis_flags must reflect the server-owned AGT002_CANONICAL_ONLY flag`);
      assert.equal(frozenEngineInput.analysis_context.opportunity.id, OPPORTUNITY_ID);
      assert.equal(frozenEngineInput.analysis_context.canonicalOnly, true);
      assert.deepEqual(
        frozenEngineInput.analysis_context.documents.map((d) => d.document_version_id).sort(),
        [DOC_A, DOC_B].sort(),
        `backend ${index}: analysis_context.documents must be derived only from the frozen workset members, never an all-current-documents listing`,
      );
      assert.equal(frozenEngineInput.document_workset_identity.opportunity_id, OPPORTUNITY_ID);
      assert.equal(frozenEngineInput.document_workset_identity.selection_hash, ok.body.selection_hash);
      assert.deepEqual(
        frozenEngineInput.governed_workset_members.map((m) => m.document_version_id).sort(),
        [DOC_A, DOC_B].sort(),
      );

      // DOC_HUGE's server-resolved evidence (extracted_text_char_count: 2_000_000, see the fake
      // Supabase RPC above) predicts ceil(2_000_000 / 20_000) = 100 batches, which exceeds the
      // classic single-turn cap of 64. That honest count is never rounded down or hidden: the
      // route must retain predicted_batch_count 100 and max_batch_count 64 byte-for-byte, and the
      // package is accepted only because it is routed through durable checkpointing
      // (execution_mode 'durable_batched_v1', checkpointing true) — durable_checkpointing_required
      // makes that overage-covered-by-checkpointing reasoning explicit in the response.
      state.rpcCalls.length = 0;
      state.freezeEnqueueCalls = 0;
      const huge = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({
        documents: [{ document_version_id: DOC_HUGE, source_classification: 'official', inclusion_reason: 'Documento voluminoso.' }],
      }));
      assert.equal(huge.status, 202, `backend ${index}: an oversized governed package must be accepted once durable checkpointing covers the overage`);
      assert.equal(huge.body.status, 'created');
      assert.equal(huge.body.capacity_preflight.verdict, 'APTO', `backend ${index}: durable checkpointing must flip the overage verdict to APTO`);
      assert.equal(huge.body.capacity_preflight.predicted_batch_count, 100, `backend ${index}: the honest predicted batch count must be retained even once accepted`);
      assert.equal(huge.body.capacity_preflight.max_batch_count, 64, `backend ${index}: the classic max batch count must be retained even once accepted`);
      assert.equal(huge.body.capacity_preflight.durable_max_batch_count, 184, `backend ${index}: the durable ceiling that governed this verdict must be reported`);
      assert.equal(huge.body.capacity_preflight.effective_max_batch_count, 184, `backend ${index}: the effective ceiling actually applied must be the durable ceiling, not the classic one`);
      assert.equal(huge.body.capacity_preflight.source_char_count, 2_000_000);
      assert.equal(huge.body.capacity_preflight.execution_mode, 'durable_batched_v1');
      assert.equal(huge.body.capacity_preflight.checkpointing, true);
      assert.equal(huge.body.capacity_preflight.durable_checkpointing_required, true);
      const hugeFreezeCall = state.rpcCalls.find((c) => c.name === 'psi_freeze_agt002_governed_document_workset');
      assert.ok(hugeFreezeCall, `backend ${index}: an oversized package accepted via durable checkpointing must still reach the freeze RPC`);
      assert.equal(state.freezeEnqueueCalls, 1, `backend ${index}: an oversized package accepted via durable checkpointing must enqueue exactly once via the freeze RPC`);

      // Even durable checkpointed execution is bounded: a single document whose server-resolved
      // size predicts 185 batches — one over the durable policy's own 184-batch ceiling for this
      // route — must still be rejected, never silently accepted as an unlimited escape hatch.
      state.rpcCalls.length = 0;
      state.freezeEnqueueCalls = 0;
      const overDurable = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({
        documents: [{ document_version_id: DOC_OVER_DURABLE, source_classification: 'official', inclusion_reason: 'Documento que excede el techo durable.' }],
      }));
      assert.equal(overDurable.status, 422, `backend ${index}: a package exceeding even the durable ceiling must be rejected`);
      assert.equal(overDurable.body.code, 'agt002_governed_workset_capacity_rejected');
      assert.equal(overDurable.body.report.criterion, 'NO_APTO');
      assert.equal(overDurable.body.report.predicted_batch_count, 185);
      assert.equal(overDurable.body.report.max_batch_count, 64);
      assert.equal(state.rpcCalls.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false, `backend ${index}: a package exceeding the durable ceiling must never reach the freeze/enqueue RPC`);
      assert.equal(state.freezeEnqueueCalls, 0, `backend ${index}: a package exceeding the durable ceiling must never actually enqueue`);

      state.rpcCalls.length = 0;
      state.freezeEnqueueCalls = 0;
      const invalidEvidence = await requestJson(port, ROUTE, 'custody-token', 'POST', twoDocumentsBody({
        documents: [{ document_version_id: DOC_BAD_EVIDENCE, source_classification: 'official', inclusion_reason: 'Evidencia de tamaño inválida.' }],
      }));
      assert.equal(invalidEvidence.status, 503, `backend ${index}: missing/malformed server-resolved size evidence must fail closed with a safe 503`);
      assert.equal(invalidEvidence.body.code, 'agt002_governed_workset_capacity_unavailable');
      assert.deepEqual(invalidEvidence.body.report, { code: 'agt002_governed_workset_capacity_unavailable' });
      assert.equal(state.rpcCalls.some((c) => c.name === 'psi_freeze_agt002_governed_document_workset'), false, `backend ${index}: invalid size evidence must never reach the freeze/enqueue RPC`);
      assert.equal(state.freezeEnqueueCalls, 0, `backend ${index}: invalid size evidence must never actually enqueue via the freeze RPC`);
    } finally {
      appServer.close();
    }
  }
} finally {
  console.error = originalConsoleError;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fakeSupabase.close();
}

console.log('AGT-002 governed document worksets HTTP contract passed');
