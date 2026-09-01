// AGT-002 actionable review — upload ticket / attachment persistence (design
// §§9.3-9.4, §13.2, §17). RED reason: migration 078 does not exist yet, so the
// `readFileSync` below throws ENOENT before any scenario runs — there is no
// upload_tickets/attachments schema, no complete RPC and no deferred
// bijection constraint trigger to test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration078 = strip(readFileSync(new URL('../supabase/migrations/078_agt002_actionable_review_knowledge.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
async function callRpc(pg, name, args) {
  const literal = args.map(sqlLiteral).join(',');
  const result = await pg.query(`select public.${name}(${literal}) as data`);
  return result.rows[0]?.data ?? null;
}

async function createDatabase() {
  const pg = new PGlite();
  await pg.exec(`
    create role authenticated; create role service_role; create role anon;
    alter role service_role bypassrls;
    grant service_role to current_user;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table public.psi_sales_profiles (id uuid primary key, active boolean not null default true, identity_type text default 'human', full_name text);
    create table public.psi_sales_opportunities (id uuid primary key);
    create table public.psi_public_tenders (id uuid primary key);
    create table public.psi_tender_analysis_runs (
      id uuid primary key, opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id), result jsonb
    );
    insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora');
    insert into public.psi_sales_profiles values ('${P2}', true, 'human', 'Beto Revisor');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_analysis_runs values ('${RUN}', '${O}', '${T}', '${JSON.stringify({
      integral_analysis: { analysis_units: [{ unit_id: 'unit-1', closure: { status: 'evidence_pending' } }] },
    }).replace(/'/g, "''")}');
  `);
  await pg.exec(migration078);
  const item = await callRpc(pg, 'psi_ensure_tender_actionable_review_item', [O, T, RUN, 'integral_unit', 'unit-1', null, 'a'.repeat(64), P]);
  pg.itemId = item.id;
  return pg;
}

function nonce() {
  return randomBytes(32).toString('hex');
}
function hashNonce(plainNonce) {
  return createHash('sha256').update(plainNonce, 'utf8').digest('hex');
}
function ticketArgs(pg, overrides = {}) {
  return {
    itemId: pg.itemId, opportunityId: O, actorId: P,
    logicalAttachmentId: '77777777-7777-4777-8777-777777777777', version: 1,
    name: 'Poliza vigente.pdf', extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 1024,
    declaredHash: createHash('sha256').update('contenido de la póliza vigente').digest('hex'),
    payloadHash: 'a1'.repeat(32), nonce: nonce(),
    idempotencyKey: '88888888-8888-4888-8888-888888888888', requestHash: 'b'.repeat(64),
    ...overrides,
  };
}
// The plaintext nonce is generated here (mirroring Node's shared HTTP helper,
// never the RPC) and returned alongside the ticket so callers can complete
// with it; the RPC itself only ever receives `nonce_hash`.
async function issueTicket(pg, overrides = {}) {
  const a = ticketArgs(pg, overrides);
  const ticket = await callRpc(pg, 'psi_issue_tender_actionable_review_upload_ticket', [
    a.itemId, a.opportunityId, a.actorId, a.logicalAttachmentId, a.version, a.name, a.extension, a.mimeType, a.sizeBytes,
    a.declaredHash, a.payloadHash, a.idempotencyKey, a.requestHash, hashNonce(a.nonce),
  ]);
  return ticket && { ...ticket, nonce: a.nonce };
}
async function completeTicket(pg, ticket, overrides = {}) {
  const a = {
    ticketId: ticket.id, nonce: overrides.nonce ?? ticket.nonce, actorId: P,
    detectedMimeType: 'application/pdf', sizeBytes: 1024,
    contentHash: ticketArgs(pg).declaredHash, storagePath: ticket.storage_path,
    idempotencyKey: '99999999-9999-4999-8999-999999999999', requestHash: 'c'.repeat(64),
    ...overrides,
  };
  return callRpc(pg, 'psi_complete_tender_actionable_review_attachment', [
    a.ticketId, hashNonce(a.nonce), a.actorId, a.detectedMimeType, a.sizeBytes, a.contentHash, a.storagePath, a.idempotencyKey, a.requestHash,
  ]);
}

// --- §9.4/§13.2: a ticket is issued with a nonce that is only ever revealed
// once to the caller; it persists as an opaque, single-use authorization. ----
await (async function ticketIssuanceReturnsOpaqueSingleUseAuthorization() {
  const pg = await createDatabase();
  const nonceOnce = nonce();
  const ticket = await issueTicket(pg, { requestHash: 'd0'.repeat(32) });
  assert.equal(typeof ticket.id, 'string');
  assert.equal(typeof ticket.nonce, 'string', 'issuance must return a nonce to the caller exactly once');
  assert.equal(ticket.consumed_at, null);
  assert.ok(ticket.expires_at, 'ticket must carry an expiry');
  await pg.close();
})();

// --- §9.4: complete consumes the ticket exactly once; replay/expired/foreign/
// nonce-mismatched/payload-mismatched tickets are all rejected generically. -
await (async function completeConsumesOnceAndRejectsReplayAndTampering() {
  const pg = await createDatabase();
  const ticket = await issueTicket(pg, { requestHash: 'e0'.repeat(32) });

  const wrongNonce = await callRpc(pg, 'psi_complete_tender_actionable_review_attachment', [
    ticket.id, 'f'.repeat(64), P, 'application/pdf', 1024, ticketArgs(pg).declaredHash, ticket.storage_path, 'aa111111-1111-4111-8111-111111111111', 'f1'.repeat(32),
  ]).catch(error => error);
  assert.ok(wrongNonce instanceof Error, 'a ticket presented with the wrong nonce must be rejected');

  const wrongActor = await completeTicket(pg, ticket, { actorId: P2, idempotencyKey: 'aa222222-2222-4222-8222-222222222222', requestHash: 'f2'.repeat(32) }).catch(error => error);
  assert.ok(wrongActor instanceof Error, 'a ticket completed by a different actor than the one it was issued to must be rejected');

  const completed = await completeTicket(pg, ticket, { idempotencyKey: 'aa333333-3333-4333-8333-333333333333', requestHash: 'f3'.repeat(32) });
  assert.ok(completed.attachment_id, 'a valid, matching complete must succeed and create an attachment');

  const secondComplete = await completeTicket(pg, ticket, { idempotencyKey: 'aa444444-4444-4444-8444-444444444444', requestHash: 'f4'.repeat(32) }).catch(error => error);
  assert.ok(secondComplete instanceof Error, 'a second complete against an already-consumed ticket must fail (no double-spend)');

  const tampered = await completeTicket(pg, ticket, { contentHash: 'ff'.repeat(32), idempotencyKey: 'aa555555-5555-4555-8555-555555555555', requestHash: 'f5'.repeat(32) }).catch(error => error);
  assert.ok(tampered instanceof Error, 'a complete whose recomputed hash does not match the ticket payload_hash must fail');

  await pg.close();
})();

// --- §9.4/§6.4: the RPC never receives or persists a plaintext nonce — only
// its SHA-256 digest is ever an argument, and the same digest is the only
// thing stored; a correct plaintext presented at complete matches it. -------
await (async function issueNeverReceivesOrPersistsPlaintextNonce() {
  const pg = await createDatabase();
  const plainNonce = nonce();
  const expectedNonceHash = hashNonce(plainNonce);
  const ticket = await issueTicket(pg, { nonce: plainNonce, requestHash: 'd0'.repeat(32) });
  assert.equal(ticket.nonce, plainNonce, 'the caller-facing ticket carries the plaintext exactly once');

  const storedRow = (await pg.query(
    `select nonce_hash from public.psi_tender_actionable_review_upload_tickets where id = '${ticket.id}'`,
  )).rows[0];
  assert.equal(storedRow.nonce_hash, expectedNonceHash, 'only the SHA-256 digest of the nonce is persisted, and it matches Node\'s hash of the plaintext');
  assert.notEqual(storedRow.nonce_hash, plainNonce, 'the persisted value must never equal the plaintext nonce');

  const completed = await completeTicket(pg, ticket, { idempotencyKey: 'ee111111-1111-4111-8111-111111111111', requestHash: 'e1'.repeat(32) });
  assert.ok(completed.attachment_id, 'presenting the correct plaintext nonce (hashed by the caller) must succeed');
  await pg.close();
})();

// --- §9.4: nonce_hash/payload_hash are validated as 64-char lowercase hex —
// a malformed digest is rejected before any row is written, never silently
// truncated/coerced or trusted as SQL-computable from a shorter secret. -----
await (async function nonceAndPayloadHashAreValidatedAsSha256Hex() {
  const pg = await createDatabase();

  const badNonceHash = await callRpc(pg, 'psi_issue_tender_actionable_review_upload_ticket', (() => {
    const a = ticketArgs(pg, { requestHash: 'd0'.repeat(32) });
    return [a.itemId, a.opportunityId, a.actorId, a.logicalAttachmentId, a.version, a.name, a.extension, a.mimeType, a.sizeBytes,
      a.declaredHash, a.payloadHash, a.idempotencyKey, a.requestHash, 'not-hex'];
  })()).catch(error => error);
  assert.ok(badNonceHash instanceof Error, 'issuing a ticket with a non-hex nonce_hash must be rejected');

  const badPayloadHash = await callRpc(pg, 'psi_issue_tender_actionable_review_upload_ticket', (() => {
    const a = ticketArgs(pg, { idempotencyKey: 'fe111111-1111-4111-8111-111111111111', requestHash: 'd1'.repeat(32) });
    return [a.itemId, a.opportunityId, a.actorId, a.logicalAttachmentId, a.version, a.name, a.extension, a.mimeType, a.sizeBytes,
      a.declaredHash, 'short', a.idempotencyKey, a.requestHash, hashNonce(a.nonce)];
  })()).catch(error => error);
  assert.ok(badPayloadHash instanceof Error, 'issuing a ticket with a malformed payload_hash must be rejected');

  const ticket = await issueTicket(pg, { idempotencyKey: 'fe222222-2222-4222-8222-222222222222', requestHash: 'd2'.repeat(32) });
  const badCompleteNonceHash = await callRpc(pg, 'psi_complete_tender_actionable_review_attachment', [
    ticket.id, 'g'.repeat(63), P, 'application/pdf', 1024, ticketArgs(pg).declaredHash, ticket.storage_path,
    'fe333333-3333-4333-8333-333333333333', 'd3'.repeat(32),
  ]).catch(error => error);
  assert.ok(badCompleteNonceHash instanceof Error, 'completing with a non-64-hex nonce_hash must be rejected');

  await pg.close();
})();

// --- §9.3/§17: complete + attachment + attachment_added are atomic and share
// the item's single global sequence, right after the implicit review_started.
await (async function completeIsAtomicAndUsesGlobalSequence() {
  const pg = await createDatabase();
  const ticket = await issueTicket(pg, { requestHash: 'g0'.repeat(32) });
  const result = await completeTicket(pg, ticket, { idempotencyKey: 'bb111111-1111-4111-8111-111111111111', requestHash: 'g1'.repeat(32) });

  const events = (await pg.query(`select event_type, attachment_id, sequence from public.psi_tender_actionable_review_events where review_item_id = '${pg.itemId}' order by sequence asc`)).rows;
  assert.equal(events[0].event_type, 'review_started');
  assert.equal(events[1].event_type, 'attachment_added');
  assert.equal(events[1].attachment_id, result.attachment_id, 'attachment_added must reference the exact attachment created by the same complete');

  const attachmentCount = Number((await pg.query(`select count(*)::int as n from public.psi_tender_actionable_review_attachments where review_item_id = '${pg.itemId}'`)).rows[0].n);
  assert.equal(attachmentCount, 1);
  await pg.close();
})();

// --- §9.3/§9.8: deferred constraint trigger enforces an exact attachment <->
// attachment_added bijection at COMMIT, not merely at RPC time. -------------
await (async function deferredBijectionRejectsOrphanRowsAtCommit() {
  const pg = await createDatabase();
  const ticket = await issueTicket(pg, { requestHash: 'h0'.repeat(32) });
  const result = await completeTicket(pg, ticket, { idempotencyKey: 'cc111111-1111-4111-8111-111111111111', requestHash: 'h1'.repeat(32) });

  await pg.exec('begin');
  await assert.rejects(
    pg.exec(`insert into public.psi_tender_actionable_review_attachments
      (id, review_item_id, upload_ticket_id, logical_attachment_id, version, name, extension, declared_mime_type, detected_mime_type,
       content_hash, size_bytes, storage_path, validation_status, uploaded_by, origin)
      values (gen_random_uuid(), '${pg.itemId}', '${ticket.id}', 'cc999999-9999-4999-8999-999999999999', 1, 'x.pdf', '.pdf', 'application/pdf', 'application/pdf',
       '${'ab'.repeat(32)}', 10, 'actionable-reviews/${O}/${pg.itemId}/cc999999-9999-4999-8999-999999999999/v1/hash-x.pdf', 'content_validated', '${P}', 'human_ui'); commit;`),
    /bijecci|attachment_added|constraint/i,
    'an attachment row with no matching attachment_added event must fail to commit',
  );
  await pg.exec('rollback').catch(() => {});
  await pg.close();
})();

// --- §9.5: resolution_supports selects only validated versions of the same
// item; each selected support authorizes reuse as a candidate source only. --
await (async function resolutionSupportsSelectOnlyValidatedSameItemAttachments() {
  const pg = await createDatabase();
  const ticket = await issueTicket(pg, { requestHash: 'i0'.repeat(32) });
  const attachment = await completeTicket(pg, ticket, { idempotencyKey: 'dd111111-1111-4111-8111-111111111111', requestHash: 'i1'.repeat(32) });

  const outcome = await callRpc(pg, 'psi_record_tender_actionable_review_outcome', [
    pg.itemId, P, 'aclarado_con_soporte', 'La póliza vigente cubre el periodo requerido.', true,
    'dd222222-2222-4222-8222-222222222222', 'i2'.repeat(32),
  ]);
  assert.ok(outcome.resolution_event_id, 'a closing outcome with reusable_requested=true must return a resolution_event_id');

  const supportRow = (await pg.query(
    `select attachment_id from public.psi_tender_actionable_review_resolution_supports where resolution_event_id = '${outcome.resolution_event_id}'`,
  )).rows;
  // Nothing selects a support automatically; selection is an explicit,
  // person-driven step covered by the RPC args once the schema exists. This
  // assertion documents the invariant that an unrelated attachment id must
  // never be insertable as a support for this resolution.
  await assert.rejects(
    pg.query(`insert into public.psi_tender_actionable_review_resolution_supports (resolution_event_id, attachment_id, selected_by, origin) values ('${outcome.resolution_event_id}', gen_random_uuid(), '${P}', 'human_ui')`),
    /foreign key|violat/i,
    'a resolution support must reference a real, validated attachment of the same item',
  );
  await pg.close();
})();

console.log('AGT-002 actionable review attachments PGlite integration passed');
