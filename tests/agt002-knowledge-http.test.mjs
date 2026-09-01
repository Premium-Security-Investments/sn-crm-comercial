// AGT-002 knowledge — HTTP contract for knowledge item/version routes (design
// §§7.1, 12.1-12.2, 15-16, 17-18). Exercises the real routes registered on
// `server/index.js` / `api/[...path].js` against a fake Supabase REST/RPC
// harness (mirrors `agt002-actionable-review-http.test.mjs`'s stateful
// pattern) plus a fake SharePoint adapter injected via the modules' own
// `__setTenderKnowledgeSharePointAdapterForTests` test seam, so publish can
// reach a real `publicado` 200 without touching Microsoft Graph.
import assert from 'node:assert/strict';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const KNOWLEDGE_ITEM_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_KNOWLEDGE_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const NONEXISTENT_KNOWLEDGE_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const KNOWLEDGE_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const HUMAN_ID = '66666666-6666-4666-8666-666666666666';
const REVIEWER_ID = '77777777-7777-4777-8777-777777777777';
// Internal-only fixture ids: the client never supplies these (§12.1 — the
// server derives them from the opaque knowledge item/version id), so they
// only need to be stable within this fake, never asserted on directly.
const SOURCE_REVIEW_ITEM_ID = '12121212-1212-4212-8212-121212121212';
const SOURCE_RESOLUTION_EVENT_ID = '13131313-1313-4313-8313-131313131313';
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
function requestRaw(port, path, token, method = 'GET', body) {
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
        try { parsed = JSON.parse(text); } catch { /* non-JSON default 404 page */ }
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const actors = {
  'proposer-token': {
    user: { id: 'proposer-auth', email: 'comercial@example.test' },
    profile: { id: HUMAN_ID, full_name: 'Comercial', microsoft_email: 'comercial@example.test', auth_user_id: 'proposer-auth', role: 'comercial', active: true, identity_type: 'human' },
    areas: [], permissions: [{ permission_code: 'licitaciones' }],
  },
  'reviewer-token': {
    user: { id: 'reviewer-auth', email: 'gerencia@example.test' },
    profile: { id: REVIEWER_ID, full_name: 'Gerencia', microsoft_email: 'gerencia@example.test', auth_user_id: 'reviewer-auth', role: 'gerencia', active: true, identity_type: 'human' },
    areas: [], permissions: [{ permission_code: 'licitaciones' }],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

// Realistic, deterministic PostgREST/RPC emulation for the routes under test
// (the generic `{}`-for-every-RPC fake used before this repair could not
// distinguish valid/foreign/nonexistent knowledge items nor persist the
// draft -> submitted -> approved -> published event sequence, so it 500'd on
// every table it didn't already know about). Mirrors the stateful harness in
// `agt002-actionable-review-http.test.mjs`: only `KNOWLEDGE_ITEM_ID` resolves
// to a real row (foreign/nonexistent both resolve to no row upstream, same as
// that suite's item lookup, so the 404 is identical by construction, not by
// special-casing), and the four `psi_tender_knowledge_*` RPCs mutate this
// fixture's in-memory event/version/publication state exactly like the real
// migration-078 RPCs would.
const state = {
  knowledgeVersions: new Map(),
  knowledgeEvents: [],
  knowledgePublications: [],
};
function resetTenderKnowledgeState() {
  state.knowledgeVersions.clear();
  state.knowledgeEvents.length = 0;
  state.knowledgePublications.length = 0;
}
function eqParam(url, name) {
  if (!url.searchParams.has(name)) return null;
  return String(url.searchParams.get(name)).replace(/^eq\./, '');
}
function inParam(url, name) {
  const raw = url.searchParams.get(name);
  if (!raw || !raw.startsWith('in.')) return null;
  return raw.slice(3).replace(/^\(/, '').replace(/\)$/, '').split(',').filter(Boolean);
}
function nextKnowledgeEventSequence(knowledgeVersionId) {
  const existing = state.knowledgeEvents.filter(event => event.knowledge_version_id === knowledgeVersionId);
  return existing.length ? Math.max(...existing.map(event => event.sequence)) + 1 : 1;
}
function orderRows(rows, url, field) {
  const order = String(url.searchParams.get('order') || '');
  if (!order.startsWith(`${field}.`)) return rows;
  const ascending = order.endsWith('.asc');
  return [...rows].sort((a, b) => (ascending ? a[field] - b[field] : b[field] - a[field]));
}
const TENDER_KNOWLEDGE_RPC_EVENT_TYPE = {
  psi_submit_tender_knowledge_version: 'submitted',
  psi_approve_tender_knowledge_version: 'approved',
  psi_reject_tender_knowledge_version: 'rejected',
};

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = eqParam(url, 'auth_user_id');
    if (authUserId !== null) {
      const actor = actorByAuthId.get(authUserId);
      return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
    }
    // Publish resolves the responsible profile's display name by profile id
    // (never auth_user_id) — a distinct real query shape on the same table.
    const profileId = eqParam(url, 'id');
    const actor = profileId !== null ? actorByProfileId.get(profileId) : null;
    return json(res, 200, actor ? [{ full_name: actor.profile.full_name }] : []);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    const profileId = eqParam(url, 'profile_id');
    return json(res, 200, actorByProfileId.get(profileId)?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    const profileId = eqParam(url, 'profile_id');
    return json(res, 200, actorByProfileId.get(profileId)?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    return json(res, 200, { id: OPPORTUNITY_ID, owner_id: HUMAN_ID });
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_items') {
    const idFilter = eqParam(url, 'id');
    const found = idFilter === SOURCE_REVIEW_ITEM_ID
      ? [{ id: SOURCE_REVIEW_ITEM_ID, opportunity_id: OPPORTUNITY_ID, tender_id: OPPORTUNITY_ID, analysis_run_id: OPPORTUNITY_ID, requirement_id: null, created_at: '2026-08-31T00:00:00.000Z' }]
      : [];
    return json(res, 200, found);
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_events') {
    const reviewItemId = eqParam(url, 'review_item_id');
    const idFilter = eqParam(url, 'id');
    let rows = [];
    if (reviewItemId === SOURCE_REVIEW_ITEM_ID || idFilter === SOURCE_RESOLUTION_EVENT_ID) {
      // One vigente closed outcome for the source review item (§10.1): a
      // single non-reopened `outcome_recorded` row is enough to make the
      // "current" resolution both derivable and vigente.
      rows = [{ id: SOURCE_RESOLUTION_EVENT_ID, review_item_id: SOURCE_REVIEW_ITEM_ID, sequence: 1, event_type: 'outcome_recorded', outcome: 'riesgo_confirmado', note: 'Riesgo confirmado por ausencia de póliza vigente.' }];
    }
    return json(res, 200, orderRows(rows, url, 'sequence'));
  }
  if (url.pathname === '/rest/v1/psi_tender_knowledge_items') {
    const idFilter = eqParam(url, 'id');
    // FOREIGN_KNOWLEDGE_ITEM_ID and NONEXISTENT_KNOWLEDGE_ITEM_ID both
    // resolve to no row here, so the route's 404 is byte-identical for both.
    const found = idFilter === KNOWLEDGE_ITEM_ID
      ? [{ id: KNOWLEDGE_ITEM_ID, source_review_item_id: SOURCE_REVIEW_ITEM_ID, source_resolution_event_id: SOURCE_RESOLUTION_EVENT_ID, scope_type: 'general', scope_value: null, created_at: '2026-08-31T00:00:00.000Z' }]
      : [];
    return json(res, 200, found);
  }
  if (url.pathname === '/rest/v1/psi_tender_knowledge_versions') {
    const idFilter = eqParam(url, 'id');
    const itemFilter = eqParam(url, 'knowledge_item_id');
    let rows = [];
    if (idFilter !== null) {
      const row = state.knowledgeVersions.get(idFilter);
      rows = row ? [row] : [];
    } else if (itemFilter !== null) {
      rows = [...state.knowledgeVersions.values()].filter(version => version.knowledge_item_id === itemFilter);
    }
    return json(res, 200, orderRows(rows, url, 'version'));
  }
  if (url.pathname === '/rest/v1/psi_tender_knowledge_events') {
    const versionIds = inParam(url, 'knowledge_version_id') || (eqParam(url, 'knowledge_version_id') !== null ? [eqParam(url, 'knowledge_version_id')] : []);
    const rows = state.knowledgeEvents.filter(event => versionIds.includes(event.knowledge_version_id));
    return json(res, 200, orderRows(rows, url, 'sequence'));
  }
  if (url.pathname === '/rest/v1/psi_tender_knowledge_publications') {
    const itemFilter = eqParam(url, 'knowledge_item_id');
    const rows = state.knowledgePublications.filter(publication => publication.knowledge_item_id === itemFilter);
    return json(res, 200, rows);
  }
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    let payload = '';
    req.on('data', chunk => { payload += chunk; });
    return req.on('end', () => {
      const name = url.pathname.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(payload || '{}');
      if (name === 'psi_add_tender_knowledge_version') {
        const row = {
          id: KNOWLEDGE_VERSION_ID, knowledge_item_id: args.p_knowledge_item_id, version: 1,
          reusable_summary: args.p_reusable_summary, valid_from: args.p_valid_from, valid_until: args.p_valid_until,
          review_on: args.p_review_on, tags: args.p_tags, confidentiality: args.p_confidentiality,
          agent_reuse_allowed: args.p_agent_reuse_allowed, responsible_profile_id: args.p_responsible_profile_id,
          sanitization_attestation: args.p_sanitization_attestation, created_at: '2026-09-01T00:00:00.000Z',
          content_hash: 'a'.repeat(64),
        };
        state.knowledgeVersions.set(KNOWLEDGE_VERSION_ID, row);
        state.knowledgeEvents.push({ knowledge_version_id: KNOWLEDGE_VERSION_ID, event_type: 'draft_created', sequence: nextKnowledgeEventSequence(KNOWLEDGE_VERSION_ID) });
        return json(res, 200, { ...row });
      }
      const eventType = TENDER_KNOWLEDGE_RPC_EVENT_TYPE[name];
      if (eventType) {
        const event = {
          knowledge_version_id: args.p_knowledge_version_id, event_type: eventType,
          sequence: nextKnowledgeEventSequence(args.p_knowledge_version_id), note: args.p_note ?? null,
        };
        state.knowledgeEvents.push(event);
        return json(res, 200, { knowledge_version_id: args.p_knowledge_version_id, event_type: eventType });
      }
      if (name === 'psi_record_tender_knowledge_publication') {
        const publication = {
          id: `publication-${state.knowledgePublications.length + 1}`, knowledge_item_id: KNOWLEDGE_ITEM_ID,
          knowledge_version_id: args.p_knowledge_version_id, library_root: args.p_library_root, relative_path: args.p_relative_path,
          site_id: args.p_site_id, drive_id: args.p_drive_id, drive_item_id: args.p_drive_item_id, web_url: args.p_web_url,
          e_tag: args.p_e_tag, sharepoint_version: args.p_sharepoint_version, content_hash: args.p_content_hash,
          published_by: args.p_published_by, created_at: '2026-09-01T00:00:00.000Z',
        };
        state.knowledgePublications.push(publication);
        state.knowledgeEvents.push({ knowledge_version_id: args.p_knowledge_version_id, event_type: 'published', sequence: nextKnowledgeEventSequence(args.p_knowledge_version_id) });
        return json(res, 200, { ...publication });
      }
      return json(res, 500, { message: `unexpected Supabase RPC access: ${name}` });
    });
  }
  return json(res, 500, { message: `unexpected Supabase access: ${req.method} ${url.pathname}` });
});

// Deterministic fake SharePoint adapter matching the real Graph adapter's
// contract (`agt002-knowledge-sharepoint-graph-adapter.js`): `siteId`/
// `driveId` properties plus `get`/`createOrUpdate` async methods.
// `publishTenderKnowledgeVersion` (`agt002-knowledge-sharepoint.js`, real
// production code, not mocked here) does its own eTag-conflict reconciliation
// against whatever `get`/`createOrUpdate` return, so the fake only needs to
// persist by relative path and hand back a safe `*.sharepoint.com` URL.
function createFakeTenderKnowledgeSharePointAdapter() {
  const items = new Map();
  return Object.freeze({
    siteId: 'fake-site-id',
    driveId: 'fake-drive-id',
    async get({ relativePath }) {
      return items.get(relativePath) || null;
    },
    async createOrUpdate({ relativePath, content, expectedETag }) {
      const existing = items.get(relativePath);
      if (existing && expectedETag && existing.eTag !== expectedETag) {
        const conflict = new Error('etag_conflict');
        conflict.code = 'etag_conflict';
        throw conflict;
      }
      const version = (existing?.version || 0) + 1;
      const record = {
        relativePath, content, eTag: `etag-${version}`, version, sharepointVersion: String(version),
        driveItemId: existing?.driveItemId || `drive-item-${items.size + 1}`,
        webUrl: `https://contoso.sharepoint.com/sites/comercial/${relativePath}`,
      };
      items.set(relativePath, record);
      return record;
    },
  });
}

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
    // Each backend replays the identical draft/submit/approve/publish
    // sequence against the SAME fixed ids (KNOWLEDGE_VERSION_ID etc.), so the
    // event/version/publication state built up by backend 0 must never leak
    // into backend 1 — reset the fake's lifecycle here, in the test harness,
    // never in production.
    resetTenderKnowledgeState();
    module.__setTenderKnowledgeSharePointAdapterForTests(createFakeTenderKnowledgeSharePointAdapter());
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      // --- GET knowledge item: auth before lookup; resolves the full
      // item -> resolution -> review_item -> opportunity chain internally,
      // never trusting an opportunity_id supplied by the client (§12.1). ----
      const unauthenticated = await requestRaw(port, `/api/tender-knowledge-items/${KNOWLEDGE_ITEM_ID}`, null);
      assert.equal(unauthenticated.status, 401, `backend ${index} rejects an unauthenticated knowledge read`);

      const foreign = await requestRaw(port, `/api/tender-knowledge-items/${FOREIGN_KNOWLEDGE_ITEM_ID}`, 'proposer-token');
      const nonexistent = await requestRaw(port, `/api/tender-knowledge-items/${NONEXISTENT_KNOWLEDGE_ITEM_ID}`, 'proposer-token');
      assert.equal(foreign.status, 404, `backend ${index} answers 404 for a foreign knowledge item`);
      assert.equal(nonexistent.status, 404, `backend ${index} answers 404 for a nonexistent knowledge item`);
      assert.deepEqual(foreign.body, nonexistent.body, `backend ${index} makes a foreign knowledge item indistinguishable from a nonexistent one`);

      const ok = await requestRaw(port, `/api/tender-knowledge-items/${KNOWLEDGE_ITEM_ID}`, 'proposer-token');
      assert.equal(ok.status, 200, `backend ${index} serves a knowledge item to an authorized human`);
      assert.equal(ok.headers['cache-control'], 'private, no-store', `backend ${index} marks knowledge reads private, no-store`);

      // --- versions: propose requires knowledge.propose, not review/publish
      const proposerCreatesVersion = await requestRaw(port, `/api/tender-knowledge-items/${KNOWLEDGE_ITEM_ID}/versions`, 'proposer-token', 'POST', {
        reusable_summary: 'Resumen reutilizable saneado.',
        valid_from: '2026-09-01', review_on: '2027-09-01', tags: ['polizas'],
        confidentiality: 'interno', agent_reuse_allowed: false, responsible_profile_id: REVIEWER_ID,
        sanitization_attestation: 'Se removieron referencias específicas de entidad y monto.',
        idempotency_key: '88888888-8888-4888-8888-888888888888',
      });
      assert.equal(proposerCreatesVersion.status, 201, `backend ${index} lets a proposer create a knowledge version`);

      // --- submit: proposer-owned action ------------------------------------
      const submit = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/submit`, 'proposer-token', 'POST', {
        idempotency_key: '99999999-9999-4999-8999-999999999999',
      });
      assert.equal(submit.status, 200, `backend ${index} lets the proposer submit their own version`);

      // --- approve/reject/publish require knowledge.review /
      // knowledge.publish; a mere proposer must be forbidden from all three -
      const proposerApprove = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/approve`, 'proposer-token', 'POST', {
        idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      assert.equal(proposerApprove.status, 403, `backend ${index} forbids a mere proposer from approving their own version`);

      const proposerPublish = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/publish`, 'proposer-token', 'POST', {
        idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });
      assert.equal(proposerPublish.status, 403, `backend ${index} forbids a mere proposer from publishing`);

      const reviewerApprove = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/approve`, 'reviewer-token', 'POST', {
        idempotency_key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      });
      assert.equal(reviewerApprove.status, 200, `backend ${index} lets an authorized reviewer approve`);

      const rejectRequiresNote = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/reject`, 'reviewer-token', 'POST', {
        idempotency_key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      });
      assert.equal(rejectRequiresNote.status, 400, `backend ${index} requires a mandatory note to reject`);

      const reviewerPublish = await requestRaw(port, `/api/tender-knowledge-versions/${KNOWLEDGE_VERSION_ID}/publish`, 'reviewer-token', 'POST', {
        idempotency_key: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      });
      assert.equal(reviewerPublish.status, 200, `backend ${index} lets an authorized reviewer publish`);
      assert.equal(reviewerPublish.body?.status, 'publicado', `backend ${index} projects the published state`);

      // --- SharePoint unavailable is a closed, fail-closed 503, and never
      // fabricates a publication (§16.4, §18) --------------------------------
      // Covered end-to-end against a fake adapter in the sharepoint-specific
      // integration suite; this file only proves the route wiring exists and
      // answers the closed codes documented for the HTTP surface.
    } finally {
      await new Promise(resolve => appServer.close(resolve));
      module.__setTenderKnowledgeSharePointAdapterForTests(undefined);
    }
  }
} finally {
  console.error = originalConsoleError;
  await new Promise(resolve => fakeSupabase.close(resolve));
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

console.log('AGT-002 knowledge HTTP contract passed');
