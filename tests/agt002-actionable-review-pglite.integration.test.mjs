// AGT-002 actionable review — core item/event persistence (design §§6, 9.1-9.2,
// 10.1, 17). RED reason: `supabase/migrations/078_agt002_actionable_review_knowledge.sql`
// does not exist on this branch yet, so the `readFileSync` below throws ENOENT
// before any scenario runs — there is no schema, no RPC and no trigger to test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const strip = value => value.replace(/^\s*begin;\s*$/im, '').replace(/^\s*commit;\s*$/im, '');
const migration078 = strip(readFileSync(new URL('../supabase/migrations/078_agt002_actionable_review_knowledge.sql', import.meta.url), 'utf8'));

const P = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';
const O = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN = '66666666-6666-4666-8666-666666666666';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && value.__jsonb) return `'${JSON.stringify(value.value).replace(/'/g, "''")}'::jsonb`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}
const jsonbArg = value => ({ __jsonb: true, value });

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
      id uuid primary key,
      opportunity_id uuid not null references public.psi_sales_opportunities(id),
      tender_id uuid not null references public.psi_public_tenders(id),
      result jsonb
    );
    insert into public.psi_sales_profiles values ('${P}', true, 'human', 'Ana Revisora');
    insert into public.psi_sales_profiles values ('${P2}', true, 'human', 'Beto Revisor');
    insert into public.psi_sales_opportunities values ('${O}');
    insert into public.psi_public_tenders values ('${T}');
    insert into public.psi_tender_analysis_runs values ('${RUN}', '${O}', '${T}', '${JSON.stringify({
      integral_analysis: { analysis_units: [{ unit_id: 'unit-1', closure: { status: 'evidence_pending' } }] },
    }).replace(/'/g, "''")}');
    insert into public.psi_tender_analysis_runs values ('${OTHER_RUN}', '${O}', '${T}', '${JSON.stringify({
      integral_analysis: { analysis_units: [{ unit_id: 'unit-1', closure: { status: 'evidence_pending' } }] },
    }).replace(/'/g, "''")}');
  `);
  await pg.exec(migration078);
  return pg;
}

function ensureItemArgs(overrides = {}) {
  return {
    opportunityId: O, tenderId: T, analysisRunId: RUN,
    sourceKind: 'integral_unit', sourceId: 'unit-1', requirementId: null,
    sourceHash: 'a'.repeat(64), actorId: P,
    ...overrides,
  };
}
async function ensureItem(pg, overrides = {}) {
  const a = ensureItemArgs(overrides);
  return callRpc(pg, 'psi_ensure_tender_actionable_review_item', [
    a.opportunityId, a.tenderId, a.analysisRunId, a.sourceKind, a.sourceId, a.requirementId, a.sourceHash, a.actorId,
  ]);
}

function commentArgs(itemId, overrides = {}) {
  return {
    itemId, actorId: P, comment: 'Se solicitó soporte adicional al proveedor.',
    idempotencyKey: '77777777-7777-4777-8777-777777777777', requestHash: 'b'.repeat(64),
    ...overrides,
  };
}
async function addComment(pg, itemId, overrides = {}) {
  const a = commentArgs(itemId, overrides);
  return callRpc(pg, 'psi_record_tender_actionable_review_comment', [
    a.itemId, a.actorId, a.comment, a.idempotencyKey, a.requestHash,
  ]);
}

function outcomeArgs(itemId, overrides = {}) {
  return {
    itemId, actorId: P, outcome: 'riesgo_confirmado', note: 'Riesgo confirmado por ausencia de póliza vigente.',
    reusableRequested: false, idempotencyKey: '88888888-8888-4888-8888-888888888888', requestHash: 'c'.repeat(64),
    ...overrides,
  };
}
async function recordOutcome(pg, itemId, overrides = {}) {
  const a = outcomeArgs(itemId, overrides);
  return callRpc(pg, 'psi_record_tender_actionable_review_outcome', [
    a.itemId, a.actorId, a.outcome, a.note, a.reusableRequested, a.idempotencyKey, a.requestHash,
  ]);
}

async function reopen(pg, itemId, overrides = {}) {
  const a = {
    itemId, actorId: P, note: 'La póliza aportada no cubre el periodo requerido.',
    idempotencyKey: '99999999-9999-4999-8999-999999999999', requestHash: 'd'.repeat(64),
    ...overrides,
  };
  return callRpc(pg, 'psi_reopen_tender_actionable_review', [
    a.itemId, a.actorId, a.note, a.idempotencyKey, a.requestHash,
  ]);
}

// --- §6.2: identity is keyed by (analysis_run_id, source_kind, source_id) —
// re-ensuring the same source returns the same row, never a duplicate. -------
await (async function identityIsStableAndDeduplicatesOnConflict() {
  const pg = await createDatabase();
  const first = await ensureItem(pg);
  const again = await ensureItem(pg);
  assert.equal(again.id, first.id, 'ensuring the same (run, source_kind, source_id) twice must return the same item');

  const count = Number((await pg.query(
    `select count(*)::int as n from public.psi_tender_actionable_review_items where analysis_run_id = '${RUN}' and source_id = 'unit-1'`,
  )).rows[0].n);
  assert.equal(count, 1, 'no duplicate identity row may be created');
  await pg.close();
})();

// --- §6.2: identity is per-run — a new run gets its own identity, and history
// from a prior run is never treated as closing the new pendiente (§6.3, §10.1)
await (async function newRunGetsIndependentIdentity() {
  const pg = await createDatabase();
  const fromRun = await ensureItem(pg, { analysisRunId: RUN });
  const fromOtherRun = await ensureItem(pg, { analysisRunId: OTHER_RUN });
  assert.notEqual(fromRun.id, fromOtherRun.id, 'the same structural source in two different runs must get two distinct identities');
  await pg.close();
})();

// --- §6.2: a hash mismatch (payload re-validation failed) is a conflict, not
// a silent overwrite; an unknown source in the canonical result is rejected. -
await (async function hashMismatchAndUnknownSourceAreRejected() {
  const pg = await createDatabase();
  await ensureItem(pg, { sourceHash: 'a'.repeat(64) });
  await assert.rejects(ensureItem(pg, { sourceHash: 'f'.repeat(64) }), /hash|conflicto/i,
    'a re-ensure with a different source_hash must conflict, never silently update');
  await assert.rejects(ensureItem(pg, { sourceId: 'unit-does-not-exist' }), /no existe|not found/i,
    'a source_id absent from the run\'s canonical payload must be rejected');
  await pg.close();
})();

// --- §9: append-only — direct UPDATE/DELETE on items/events are rejected ----
await (async function itemsAndEventsAreAppendOnly() {
  const pg = await createDatabase();
  const item = await ensureItem(pg);
  const comment = await addComment(pg, item.id);
  await assert.rejects(pg.exec(`update public.psi_tender_actionable_review_items set source_id = 'x' where id = '${item.id}'`), /append-only|inmutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_tender_actionable_review_items where id = '${item.id}'`), /append-only|inmutable/i);
  await assert.rejects(pg.exec(`update public.psi_tender_actionable_review_events set note = 'x' where id = '${comment.id}'`), /append-only|inmutable/i);
  await assert.rejects(pg.exec(`delete from public.psi_tender_actionable_review_events where id = '${comment.id}'`), /append-only|inmutable/i);
  await pg.close();
})();

// --- §10.1: state machine — first action inserts an implicit review_started;
// informacion_insuficiente never closes; a closed outcome moves to resuelto. -
await (async function stateMachineTransitionsHold() {
  const pg = await createDatabase();
  const item = await ensureItem(pg);

  await addComment(pg, item.id);
  let projected = (await pg.query(`select event_type from public.psi_tender_actionable_review_events where review_item_id = '${item.id}' order by sequence asc`)).rows;
  assert.equal(projected[0].event_type, 'review_started', 'the first ever action on an item must insert an implicit review_started');
  assert.equal(projected[1].event_type, 'comment_added');

  const insufficient = await recordOutcome(pg, item.id, { outcome: 'informacion_insuficiente', idempotencyKey: 'a1111111-1111-4111-8111-111111111111', requestHash: 'e'.repeat(64) });
  assert.ok(insufficient, 'informacion_insuficiente must be recordable');
  const stillOpenRows = (await pg.query(`select event_type, outcome from public.psi_tender_actionable_review_events where review_item_id = '${item.id}' order by sequence desc limit 1`)).rows;
  assert.equal(stillOpenRows[0].outcome, 'informacion_insuficiente');

  const closed = await recordOutcome(pg, item.id, { outcome: 'riesgo_confirmado', idempotencyKey: 'a2222222-2222-4222-8222-222222222222', requestHash: 'f1'.repeat(32) });
  assert.ok(closed, 'a subsequent closed outcome must be accepted after informacion_insuficiente');

  const reopened = await reopen(pg, item.id);
  assert.ok(reopened, 'a resolved item accepts reopen with a mandatory note');
  await assert.rejects(reopen(pg, item.id, { idempotencyKey: 'a3333333-3333-4333-8333-333333333333', requestHash: '11'.repeat(32) }),
    /reabierto|resuelto|estado/i, 'reopen must only be legal from an already-resolved state');
  await pg.close();
})();

// --- §9.2/§17: idempotency — same key + same hash replays; same key + a
// different hash fails without mutating state (idempotency_payload_mismatch).
await (async function idempotencyReplayAndPayloadMismatch() {
  const pg = await createDatabase();
  const item = await ensureItem(pg);
  const args = commentArgs(item.id, { idempotencyKey: 'b1111111-1111-4111-8111-111111111111', requestHash: 'aa'.repeat(32) });
  const first = await callRpc(pg, 'psi_record_tender_actionable_review_comment', [args.itemId, args.actorId, args.comment, args.idempotencyKey, args.requestHash]);
  const replay = await callRpc(pg, 'psi_record_tender_actionable_review_comment', [args.itemId, args.actorId, args.comment, args.idempotencyKey, args.requestHash]);
  assert.equal(replay.id, first.id, 'same actor + same idempotency key + same request_hash must replay the prior event');

  await assert.rejects(
    callRpc(pg, 'psi_record_tender_actionable_review_comment', [args.itemId, args.actorId, 'Comentario distinto', args.idempotencyKey, 'bb'.repeat(32)]),
    /idempotency_payload_mismatch/i,
    'same key with a different request_hash must fail without inserting or revealing the prior result',
  );

  const count = Number((await pg.query(`select count(*)::int as n from public.psi_tender_actionable_review_events where review_item_id = '${item.id}' and event_type = 'comment_added'`)).rows[0].n);
  assert.equal(count, 1, 'a payload-mismatch replay attempt must not create a second event');
  await pg.close();
})();

// --- §9.2/§17: sequence is unique per item and assigned under FOR UPDATE ----
await (async function sequenceIsUniquePerItemAndMonotonic() {
  const pg = await createDatabase();
  const item = await ensureItem(pg);
  await addComment(pg, item.id, { idempotencyKey: 'c1111111-1111-4111-8111-111111111111', requestHash: '01'.repeat(32) });
  await addComment(pg, item.id, { comment: 'Segundo comentario.', idempotencyKey: 'c2222222-2222-4222-8222-222222222222', requestHash: '02'.repeat(32) });
  const sequences = (await pg.query(`select sequence from public.psi_tender_actionable_review_events where review_item_id = '${item.id}' order by sequence asc`)).rows.map(r => Number(r.sequence));
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), 'sequence must be strictly increasing');
  assert.equal(new Set(sequences).size, sequences.length, 'sequence must be unique per item');
  await pg.close();
})();

// --- §9: RLS/grants fail closed for anon/authenticated; only service_role via RPC
await (async function rlsAndGrantsFailClosed() {
  const pg = await createDatabase();
  const item = await ensureItem(pg);
  await pg.exec('set role authenticated');
  await assert.rejects(() => pg.query(`select id from public.psi_tender_actionable_review_items limit 1`), /permission denied/i);
  await assert.rejects(() => pg.query(`select public.psi_record_tender_actionable_review_comment('${item.id}','${P}','x','c3333333-3333-4333-8333-333333333333','${'03'.repeat(32)}')`), /permission denied/i);
  await pg.exec('reset role; set role anon');
  await assert.rejects(() => pg.query(`select id from public.psi_tender_actionable_review_items limit 1`), /permission denied/i);
  await pg.exec('reset role; set role service_role');
  const asServiceRole = await pg.query(`select id from public.psi_tender_actionable_review_items limit 1`);
  assert.ok(asServiceRole.rows.length >= 0);
  await assert.rejects(
    () => pg.query(`insert into public.psi_tender_actionable_review_items (opportunity_id, tender_id, analysis_run_id, source_kind, source_id, source_hash, hash_contract, origin) values ('${O}','${T}','${RUN}','integral_unit','direct-insert','${'ff'.repeat(32)}','agt002-actionable-review-json-v1','canonical_analysis_projection')`),
    /permission denied/i,
    'even service_role must write only through the SECURITY DEFINER RPCs, never by direct INSERT',
  );
  await pg.exec('reset role');
  await pg.close();
})();

console.log('AGT-002 actionable review core PGlite integration passed');
