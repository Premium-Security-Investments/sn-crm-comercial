// AGT-002 actionable review — GET /api/tender-actionable-reviews read model
// (design §§10.1, 12.2, approved spec block 5C2). RED reason: the route today
// only selects id/requirement_id/created_at and projects a hardcoded
// pendiente/zero-count/no-timeline/no-capabilities shape, so every assertion
// below about state projection, counts, timeline, attachments, actor names,
// capabilities and secret-field absence fails against the current code.
//
// This fixture is a realistic, deterministic PostgREST emulation (same style
// as agt002-actionable-review-http.test.mjs): items/events/attachments/
// resolution_supports/profiles are served from small in-memory maps keyed the
// same way the real Supabase REST endpoints are, including `in.(...)` filters
// for the batch loads the route must use to avoid N+1.
import assert from 'node:assert/strict';
import http from 'node:http';

const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const EMPTY_RUN_ID = '22222222-2222-4222-8222-222222222223';
const OWNER_ID = '33333333-3333-4333-8333-333333333333'; // comercial owner: contribute yes, resolve no
const ADMIN_ID = '44444444-4444-4444-8444-444444444444'; // admin: contribute + resolve
const OTHER_ACTOR_ID = '55555555-5555-4555-8555-555555555555'; // never authenticates, only appears as an event actor
const AGENT_ID = '66666666-6666-4666-8666-666666666666';
const NO_ACCESS_ID = '77777777-7777-4777-8777-777777777777';
const TEST_SERVICE_KEY = 'test-service-key';

const ITEM_PENDING = 'a0000000-0000-4000-8000-000000000001';
const ITEM_COMMENT_ATTACH = 'a0000000-0000-4000-8000-000000000002';
const ITEM_RESOLVED_RISK = 'a0000000-0000-4000-8000-000000000003';
const ITEM_REOPENED = 'a0000000-0000-4000-8000-000000000004';
const ITEM_RESOLVED_LATER_COMMENT = 'a0000000-0000-4000-8000-000000000005';

const ATTACH_1 = 'b0000000-0000-4000-8000-000000000001';
const ATTACH_2 = 'b0000000-0000-4000-8000-000000000002';
const ATTACH_3 = 'b0000000-0000-4000-8000-000000000003';

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
function requestJson(port, path, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* non-JSON */ }
        resolve({ status: response.statusCode, headers: response.headers, body: parsed, raw: text });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
function postgrestIn(url, field) {
  const value = url.searchParams.getAll(field).find(item => item.startsWith('in.('));
  if (!value?.startsWith('in.(') || !value.endsWith(')')) return null;
  return value.slice(4, -1).split(',').filter(Boolean);
}
function eqValue(url, field) {
  return String(url.searchParams.get(field) || '').replace(/^eq\./, '');
}

const actors = {
  'owner-token': {
    user: { id: 'owner-auth', email: 'owner@example.test' },
    profile: { id: OWNER_ID, full_name: 'Comercial Dueño', microsoft_email: 'owner@example.test', auth_user_id: 'owner-auth', role: 'comercial', active: true, identity_type: 'human' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'admin-token': {
    user: { id: 'admin-auth', email: 'admin@example.test' },
    profile: { id: ADMIN_ID, full_name: 'Admin Persona', microsoft_email: 'admin@example.test', auth_user_id: 'admin-auth', role: 'admin', active: true, identity_type: 'human' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'agent-token': {
    user: { id: 'agent-auth', email: 'agente@example.test' },
    profile: { id: AGENT_ID, full_name: 'Agente', microsoft_email: 'agente@example.test', auth_user_id: 'agent-auth', role: 'admin', active: true, identity_type: 'agent' },
    areas: [{ area_code: 'licitaciones', subarea_code: null }],
    permissions: [{ permission_code: 'licitaciones' }],
  },
  'no-access-token': {
    user: { id: 'no-access-auth', email: 'sinacceso@example.test' },
    profile: { id: NO_ACCESS_ID, full_name: 'Sin Acceso', microsoft_email: 'sinacceso@example.test', auth_user_id: 'no-access-auth', role: 'colaborador', active: true, identity_type: 'human' },
    areas: [],
    permissions: [],
  },
};
const actorByAuthId = new Map(Object.values(actors).map(actor => [actor.user.id, actor]));
const actorByProfileId = new Map(Object.values(actors).map(actor => [actor.profile.id, actor]));

const PROFILE_NAMES = new Map([
  [OWNER_ID, 'Comercial Dueño'],
  [ADMIN_ID, 'Admin Persona'],
  [OTHER_ACTOR_ID, 'Otra Persona'],
]);

const OPPORTUNITIES = new Map([[OPPORTUNITY_ID, { id: OPPORTUNITY_ID, owner_id: OWNER_ID }]]);

const ITEMS = [
  { id: ITEM_PENDING, opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, requirement_id: 'REQ-000', created_at: '2026-08-01T00:00:00.000Z' },
  { id: ITEM_COMMENT_ATTACH, opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, requirement_id: 'REQ-001', created_at: '2026-08-01T00:00:00.000Z' },
  { id: ITEM_RESOLVED_RISK, opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, requirement_id: 'REQ-002', created_at: '2026-08-01T00:00:00.000Z' },
  { id: ITEM_REOPENED, opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, requirement_id: 'REQ-003', created_at: '2026-08-01T00:00:00.000Z' },
  { id: ITEM_RESOLVED_LATER_COMMENT, opportunity_id: OPPORTUNITY_ID, analysis_run_id: RUN_ID, requirement_id: 'REQ-004', created_at: '2026-08-01T00:00:00.000Z' },
];

// Timeline events stored intentionally out of sequence order for
// ITEM_COMMENT_ATTACH to prove the route sorts ascending itself rather than
// trusting row order from the database.
const EVENTS_BY_ITEM = new Map([
  [ITEM_COMMENT_ATTACH, [
    { id: 'e-ca-3', review_item_id: ITEM_COMMENT_ATTACH, sequence: 3, event_type: 'attachment_added', outcome: null, note: null, reusable_requested: null, attachment_id: ATTACH_1, actor_id: OTHER_ACTOR_ID, created_at: '2026-08-01T00:10:00.000Z' },
    { id: 'e-ca-1', review_item_id: ITEM_COMMENT_ATTACH, sequence: 1, event_type: 'review_started', outcome: null, note: null, reusable_requested: null, attachment_id: null, actor_id: OWNER_ID, created_at: '2026-08-01T00:00:00.000Z' },
    { id: 'e-ca-2', review_item_id: ITEM_COMMENT_ATTACH, sequence: 2, event_type: 'comment_added', outcome: null, note: 'Se solicitó soporte al proveedor.', reusable_requested: null, attachment_id: null, actor_id: OTHER_ACTOR_ID, created_at: '2026-08-01T00:05:00.000Z' },
  ]],
  [ITEM_RESOLVED_RISK, [
    { id: 'e-rr-1', review_item_id: ITEM_RESOLVED_RISK, sequence: 1, event_type: 'review_started', outcome: null, note: null, reusable_requested: null, attachment_id: null, actor_id: OWNER_ID, created_at: '2026-08-02T00:00:00.000Z' },
    { id: 'e-rr-2', review_item_id: ITEM_RESOLVED_RISK, sequence: 2, event_type: 'attachment_added', outcome: null, note: null, reusable_requested: null, attachment_id: ATTACH_2, actor_id: OWNER_ID, created_at: '2026-08-02T00:05:00.000Z' },
    { id: 'e-rr-3', review_item_id: ITEM_RESOLVED_RISK, sequence: 3, event_type: 'attachment_added', outcome: null, note: null, reusable_requested: null, attachment_id: ATTACH_3, actor_id: OWNER_ID, created_at: '2026-08-02T00:10:00.000Z' },
    { id: 'e-rr-4', review_item_id: ITEM_RESOLVED_RISK, sequence: 4, event_type: 'outcome_recorded', outcome: 'riesgo_confirmado', note: 'Riesgo confirmado por ausencia de póliza vigente.', reusable_requested: true, attachment_id: null, actor_id: ADMIN_ID, created_at: '2026-08-02T00:15:00.000Z' },
  ]],
  [ITEM_REOPENED, [
    { id: 'e-ro-1', review_item_id: ITEM_REOPENED, sequence: 1, event_type: 'review_started', outcome: null, note: null, reusable_requested: null, attachment_id: null, actor_id: OWNER_ID, created_at: '2026-08-03T00:00:00.000Z' },
    { id: 'e-ro-2', review_item_id: ITEM_REOPENED, sequence: 2, event_type: 'outcome_recorded', outcome: 'riesgo_confirmado', note: 'Riesgo inicial.', reusable_requested: false, attachment_id: null, actor_id: ADMIN_ID, created_at: '2026-08-03T00:05:00.000Z' },
    { id: 'e-ro-3', review_item_id: ITEM_REOPENED, sequence: 3, event_type: 'reopened', outcome: null, note: 'La póliza aportada no cubre el periodo requerido.', reusable_requested: null, attachment_id: null, actor_id: ADMIN_ID, created_at: '2026-08-03T00:10:00.000Z' },
  ]],
  [ITEM_RESOLVED_LATER_COMMENT, [
    { id: 'e-rl-1', review_item_id: ITEM_RESOLVED_LATER_COMMENT, sequence: 1, event_type: 'review_started', outcome: null, note: null, reusable_requested: null, attachment_id: null, actor_id: OWNER_ID, created_at: '2026-08-04T00:00:00.000Z' },
    { id: 'e-rl-2', review_item_id: ITEM_RESOLVED_LATER_COMMENT, sequence: 2, event_type: 'outcome_recorded', outcome: 'no_aplica', note: 'No aplica dado el alcance.', reusable_requested: false, attachment_id: null, actor_id: ADMIN_ID, created_at: '2026-08-04T00:05:00.000Z' },
    { id: 'e-rl-3', review_item_id: ITEM_RESOLVED_LATER_COMMENT, sequence: 3, event_type: 'comment_added', outcome: null, note: 'Comentario posterior al cierre.', reusable_requested: null, attachment_id: null, actor_id: OTHER_ACTOR_ID, created_at: '2026-08-04T00:10:00.000Z' },
  ]],
]);

function attachmentRow(id, reviewItemId, overrides) {
  return {
    id, review_item_id: reviewItemId, logical_attachment_id: `logical-${id}`, version: 1,
    name: 'soporte.pdf', declared_mime_type: 'application/pdf', size_bytes: 2048, uploaded_at: '2026-08-01T00:09:00.000Z',
    // Secret/technical fields the real table also carries — the projection
    // must strip these even though this fake (unlike real Postgres) does not
    // enforce the `select=` column list itself.
    detected_mime_type: 'application/pdf', storage_path: `actionable-reviews/${OPPORTUNITY_ID}/${reviewItemId}/secret.pdf`,
    content_hash: 'a'.repeat(64), uploaded_by: OTHER_ACTOR_ID, origin: 'human_ui', upload_ticket_id: `ticket-${id}`,
    supersedes_attachment_id: null, validation_status: 'content_validated',
    ...overrides,
  };
}
const ATTACHMENTS_BY_ITEM = new Map([
  [ITEM_COMMENT_ATTACH, [attachmentRow(ATTACH_1, ITEM_COMMENT_ATTACH, { uploaded_at: '2026-08-01T00:09:00.000Z' })]],
  [ITEM_RESOLVED_RISK, [
    attachmentRow(ATTACH_2, ITEM_RESOLVED_RISK, { uploaded_at: '2026-08-02T00:04:00.000Z' }),
    attachmentRow(ATTACH_3, ITEM_RESOLVED_RISK, { uploaded_at: '2026-08-02T00:09:00.000Z' }),
  ]],
]);

const SUPPORTS_BY_RESOLUTION = new Map([
  ['e-rr-4', [{ resolution_event_id: 'e-rr-4', attachment_id: ATTACH_2 }, { resolution_event_id: 'e-rr-4', attachment_id: ATTACH_3 }]],
  // Stale supports of a resolution that was later reopened: must never be
  // counted once the item's vigente resolution is gone.
  ['e-ro-2', [{ resolution_event_id: 'e-ro-2', attachment_id: ATTACH_2 }]],
]);

const ATTACHMENT_SAFE_KEYS = ['declared_mime_type', 'id', 'logical_attachment_id', 'name', 'size_bytes', 'uploaded_at', 'version'];
const TIMELINE_EVENT_KEYS = ['actor_id', 'actor_name', 'attachment_id', 'comment', 'created_at', 'event_type', 'id', 'note', 'outcome', 'reusable_requested', 'sequence'];
const ITEM_KEYS = ['attachment_count', 'attachments', 'capabilities', 'comment_count', 'current_supports_count', 'id', 'outcome', 'requirement_id', 'sequence', 'state', 'timeline', 'timeline_truncated'];
const CAPABILITY_KEYS = ['can_contribute', 'can_resolve'];
const FORBIDDEN_SUBSTRINGS = [
  'storage_path', 'source_hash', 'source_id', 'detected_mime_type', 'content_hash', 'uploaded_by',
  'upload_ticket_id', 'supersedes_attachment_id', 'nonce', 'ticket_id', 'request_hash', 'e_tag', 'unit_id', 'validation_status',
];

const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const actor = actors[bearer(req)];
    return actor ? json(res, 200, actor.user) : json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const authUserId = url.searchParams.get('auth_user_id');
    if (authUserId) {
      const actor = actorByAuthId.get(authUserId.replace(/^eq\./, ''));
      return actor ? json(res, 200, actor.profile) : json(res, 406, { code: 'PGRST116', message: 'not found' });
    }
    const idIn = postgrestIn(url, 'id');
    if (idIn) {
      const rows = idIn.map(id => ({ id, full_name: PROFILE_NAMES.get(id) })).filter(row => row.full_name);
      return json(res, 200, rows);
    }
    return json(res, 200, []);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments') {
    return json(res, 200, actorByProfileId.get(eqValue(url, 'profile_id'))?.areas || []);
  }
  if (url.pathname === '/rest/v1/psi_profile_permissions') {
    return json(res, 200, actorByProfileId.get(eqValue(url, 'profile_id'))?.permissions || []);
  }
  if (url.pathname === '/rest/v1/psi_sales_opportunities') {
    const opportunity = OPPORTUNITIES.get(eqValue(url, 'id'));
    return opportunity ? json(res, 200, opportunity) : json(res, 406, { code: 'PGRST116', message: 'not found' });
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_items') {
    const opportunityId = eqValue(url, 'opportunity_id');
    const analysisRunId = eqValue(url, 'analysis_run_id');
    const rows = ITEMS.filter(item => item.opportunity_id === opportunityId && item.analysis_run_id === analysisRunId)
      .map(({ id, requirement_id, created_at }) => ({ id, requirement_id, created_at }));
    return json(res, 200, rows);
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_events') {
    const ids = postgrestIn(url, 'review_item_id') || [];
    return json(res, 200, ids.flatMap(id => EVENTS_BY_ITEM.get(id) || []));
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_attachments') {
    const ids = postgrestIn(url, 'review_item_id') || [];
    return json(res, 200, ids.flatMap(id => ATTACHMENTS_BY_ITEM.get(id) || []));
  }
  if (url.pathname === '/rest/v1/psi_tender_actionable_review_resolution_supports') {
    const ids = postgrestIn(url, 'resolution_event_id') || [];
    return json(res, 200, ids.flatMap(id => SUPPORTS_BY_RESOLUTION.get(id) || []));
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
    const appServer = http.createServer(module.default);
    const port = await listen(appServer);
    try {
      const listUrl = (runId, token) => requestJson(port, `/api/tender-actionable-reviews?opportunity_id=${OPPORTUNITY_ID}&analysis_run_id=${runId}`, token);

      // --- auth/visibility stay intact -------------------------------------
      const unauthenticated = await listUrl(RUN_ID, null);
      assert.equal(unauthenticated.status, 401, `backend ${index} rejects an unauthenticated list request`);

      const noAccess = await listUrl(RUN_ID, 'no-access-token');
      assert.equal(noAccess.status, 404, `backend ${index} answers 404 for a human without any qualifying permission`);
      assert.equal(noAccess.body?.code, 'review_item_not_found');

      const agent = await listUrl(RUN_ID, 'agent-token');
      assert.equal(agent.status, 404, `backend ${index} never grants an agent identity list visibility (§7.2 preserved)`);

      // --- empty run: shape stays correct with zero items -------------------
      const empty = await listUrl(EMPTY_RUN_ID, 'owner-token');
      assert.equal(empty.status, 200, `backend ${index} serves an empty run`);
      assert.equal(empty.headers['cache-control'], 'private, no-store');
      assert.deepEqual(empty.body?.items, [], `backend ${index} returns items:[] for a run with no persisted review items`);
      assert.deepEqual(empty.body?.summary, { open_count: 0, confirmed_risk_count: 0 }, `backend ${index} zeroes the summary for an empty run`);
      assert.equal(empty.body?.history_available, false);

      // --- full run: the complete safe read model ---------------------------
      const owner = await listUrl(RUN_ID, 'owner-token');
      assert.equal(owner.status, 200, `backend ${index} serves the full run to the owning comercial`);
      assert.equal(owner.headers['cache-control'], 'private, no-store');
      assert.equal(owner.body.items.length, 5, `backend ${index} returns every persisted review item for the run`);

      const byId = id => owner.body.items.find(item => item.id === id);

      // capabilities: comercial owner may contribute but not resolve (§7.1)
      for (const item of owner.body.items) {
        assert.deepEqual(item.capabilities, { can_contribute: true, can_resolve: false }, `backend ${index} computes owner capabilities per item ${item.id}`);
      }

      // pendiente: no events at all
      const pending = byId(ITEM_PENDING);
      assert.equal(pending.state, 'pendiente', `backend ${index} projects pendiente with zero events`);
      assert.equal(pending.outcome, null);
      assert.equal(pending.sequence, 0);
      assert.equal(pending.comment_count, 0);
      assert.equal(pending.attachment_count, 0);
      assert.equal(pending.current_supports_count, 0);
      assert.deepEqual(pending.timeline, []);
      assert.deepEqual(pending.attachments, []);
      assert.equal(pending.timeline_truncated, false);
      assert.equal(pending.requirement_id, 'REQ-000');

      // en_revision: comment + attachment, deterministic ascending timeline
      // regardless of the shuffled row order the fake DB served them in
      const commentAttach = byId(ITEM_COMMENT_ATTACH);
      assert.equal(commentAttach.state, 'en_revision', `backend ${index} projects en_revision once any activity exists without a lifecycle outcome`);
      assert.equal(commentAttach.outcome, null);
      assert.equal(commentAttach.sequence, 3);
      assert.equal(commentAttach.comment_count, 1);
      assert.equal(commentAttach.attachment_count, 1);
      assert.equal(commentAttach.current_supports_count, 0);
      assert.deepEqual(commentAttach.timeline.map(event => event.sequence), [1, 2, 3], `backend ${index} sorts the timeline ascending by sequence regardless of DB row order`);
      assert.equal(commentAttach.timeline[0].event_type, 'review_started');
      assert.equal(commentAttach.timeline[0].actor_name, 'Comercial Dueño', `backend ${index} resolves actor_name via the batched profile lookup`);
      assert.equal(commentAttach.timeline[1].event_type, 'comment_added');
      assert.equal(commentAttach.timeline[1].comment, 'Se solicitó soporte al proveedor.', `backend ${index} maps the comment_added note into the comment field`);
      assert.equal(commentAttach.timeline[1].note, null, `backend ${index} never duplicates a comment into the note field`);
      assert.equal(commentAttach.timeline[1].actor_name, 'Otra Persona');
      assert.equal(commentAttach.timeline[2].event_type, 'attachment_added');
      assert.equal(commentAttach.timeline[2].attachment_id, ATTACH_1);
      assert.equal(commentAttach.attachments.length, 1);
      assert.equal(commentAttach.attachments[0].id, ATTACH_1);
      assert.equal(commentAttach.attachments[0].name, 'soporte.pdf');
      assert.deepEqual(Object.keys(commentAttach.attachments[0]).sort(), ATTACHMENT_SAFE_KEYS, `backend ${index} projects only the safe attachment fields`);
      assert.deepEqual(Object.keys(commentAttach).sort(), ITEM_KEYS, `backend ${index} projects only the documented item fields`);
      assert.deepEqual(Object.keys(commentAttach.timeline[0]).sort(), TIMELINE_EVENT_KEYS, `backend ${index} projects only the documented timeline event fields`);
      assert.deepEqual(Object.keys(commentAttach.capabilities).sort(), CAPABILITY_KEYS);

      // resuelto/riesgo_confirmado: current_supports_count from the vigente resolution
      const resolvedRisk = byId(ITEM_RESOLVED_RISK);
      assert.equal(resolvedRisk.state, 'resuelto');
      assert.equal(resolvedRisk.outcome, 'riesgo_confirmado');
      assert.equal(resolvedRisk.sequence, 4);
      assert.equal(resolvedRisk.attachment_count, 2);
      assert.equal(resolvedRisk.comment_count, 0);
      assert.equal(resolvedRisk.current_supports_count, 2, `backend ${index} counts the approved supports of the exact vigente resolution`);

      // reabierto: outcome clears and stale supports of the reopened
      // resolution never count again
      const reopened = byId(ITEM_REOPENED);
      assert.equal(reopened.state, 'reabierto', `backend ${index} projects reabierto after a reopened event`);
      assert.equal(reopened.outcome, null, `backend ${index} clears outcome once reopened`);
      assert.equal(reopened.current_supports_count, 0, `backend ${index} never counts supports of a resolution that is no longer vigente`);

      // resuelto stays resuelto even after a later comment_added — a comment
      // must never silently reopen the projected lifecycle state
      const resolvedLaterComment = byId(ITEM_RESOLVED_LATER_COMMENT);
      assert.equal(resolvedLaterComment.state, 'resuelto', `backend ${index} keeps a resolved item resuelto after a later comment`);
      assert.equal(resolvedLaterComment.outcome, 'no_aplica');
      assert.equal(resolvedLaterComment.comment_count, 1);
      assert.equal(resolvedLaterComment.sequence, 3);

      // summary: open = pendiente + en_revision + reabierto; confirmed risk
      // excludes the reopened item even though its prior outcome was
      // riesgo_confirmado
      assert.deepEqual(owner.body.summary, { open_count: 3, confirmed_risk_count: 1 }, `backend ${index} derives summary counts from projected state/outcome`);

      // --- secret fields never leak, anywhere in the payload ----------------
      const rawBody = JSON.stringify(owner.body);
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        assert.equal(rawBody.includes(forbidden), false, `backend ${index} never leaks "${forbidden}" anywhere in the list response`);
      }

      // --- capability differences: admin gets both write capabilities -------
      const admin = await listUrl(RUN_ID, 'admin-token');
      assert.equal(admin.status, 200);
      for (const item of admin.body.items) {
        assert.deepEqual(item.capabilities, { can_contribute: true, can_resolve: true }, `backend ${index} grants admin full capabilities per item ${item.id}`);
      }

      // --- deterministic ordering: identical repeated request ---------------
      const ownerReplay = await listUrl(RUN_ID, 'owner-token');
      assert.deepEqual(ownerReplay.body, owner.body, `backend ${index} returns a byte-identical projection on repeated reads of unchanged data`);
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

console.log('AGT-002 actionable review GET list read model (GREEN 5C2) passed');
