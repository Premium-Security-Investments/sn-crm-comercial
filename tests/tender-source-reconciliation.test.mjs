// RED step (strict TDD): `../tender-source-reconciliation.js` does not exist yet. These
// assertions are the executable spec for it. The module reconciles a durable SECOP II
// `psi_public_tenders` row (see supabase/migrations/005_public_tenders_radar.sql) against the
// live datos.gov.co Socrata record for the same `id_del_proceso` (see the `tenderSources['SECOP
// II']` config in server/index.js: dateField `fecha_de_recepcion_de`, status candidates
// `estado_resumen` / `fase` / `estado_del_procedimiento`).
//
// Hard invariant throughout: reconciliation is a technical refresh only. It may ever patch
// `deadline_at`, `status`, `raw` and `last_seen_at` -- never identity (`id`, `process_id`,
// `source`, `stable_key`), never human/business fields (`title`, `entity`, `section`,
// `reviewed_by`, `reviewed_at`), and never conversion fields (`internal_status`,
// `converted_opportunity_id`). A converted tender (`internal_status: 'convertida_oportunidad'`)
// still gets its deadline/status kept fresh -- conversion does not freeze the technical facts.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  reconcileTenderSource,
  createTenderSourceReconciliation,
  socrataWhereForProcessIds,
  selectAuthoritativeSocrataRecord,
} from '../tender-source-reconciliation.js';

function existingRow(overrides = {}) {
  return {
    id: 'row-1',
    source: 'SECOP II',
    process_id: 'CO1.REQ.123',
    stable_key: 'secop-ii-co1-req-123',
    title: 'Servicio de vigilancia física',
    entity: 'Alcaldía de Manizales',
    section: 'hacer',
    deadline_at: '2026-11-01T00:00:00.000Z',
    status: 'Presentación de oferta',
    internal_status: 'convertida_oportunidad',
    converted_opportunity_id: '11111111-1111-4111-8111-111111111111',
    reviewed_by: 'reviewer-1',
    reviewed_at: '2026-09-01T00:00:00.000Z',
    last_seen_at: '2026-09-20T00:00:00.000Z',
    raw: { id_del_proceso: 'CO1.REQ.123' },
    ...overrides,
  };
}

// Mirrors the real `$select` fields read off datos.gov.co/resource/p6dx-8zbt.json in
// server/index.js's `tenderSources['SECOP II']`.
function sourceRow(overrides = {}) {
  return {
    id_del_proceso: 'CO1.REQ.123',
    entidad: 'Alcaldía de Manizales',
    fecha_de_recepcion_de: '2026-11-01T00:00:00.000',
    estado_resumen: '',
    fase: 'Presentación de oferta',
    estado_del_procedimiento: 'Publicado',
    ...overrides,
  };
}

// --- 1. Converted tender, later source deadline --------------------------------------------

test('a converted SECOP II tender with a later source fecha_de_recepcion_de gets a UTC-midnight deadline patch and no conversion/internal/business fields', () => {
  const existing = existingRow({ deadline_at: '2026-11-01T00:00:00.000Z' });
  // Deliberately not midnight: the source timestamp must be truncated to UTC midnight of its
  // calendar date, not carried through with its time-of-day component.
  const source = sourceRow({ fecha_de_recepcion_de: '2026-11-20T15:45:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(patch.deadline_at, '2026-11-20T00:00:00+00:00', 'the patched deadline must be the UTC midnight of the source calendar date, persisted as +00:00, not .000Z');
  assert.equal(patch.last_seen_at, '2026-09-25T12:00:00.000Z');
  assert.equal(Object.hasOwn(patch, 'status'), false, 'an unchanged status must not be part of the patch');

  const FORBIDDEN_FIELDS = [
    'id', 'process_id', 'source', 'stable_key',
    'title', 'entity', 'section', 'reviewed_by', 'reviewed_at',
    'internal_status', 'converted_opportunity_id',
  ];
  for (const field of FORBIDDEN_FIELDS) {
    assert.equal(Object.hasOwn(patch, field), false, `${field} must never appear in a source reconciliation patch`);
  }
  assert.deepEqual(Object.keys(patch).sort(), ['deadline_at', 'last_seen_at', 'raw']);
});

// --- 2. Earlier source date: deterministic, deduplicated conflict, no deadline patch --------

test('an earlier source date creates a deterministic, deduplicated raw conflict and does not patch the deadline', () => {
  const existing = existingRow({ deadline_at: '2026-11-01T00:00:00.000Z' });
  const source = sourceRow({ fecha_de_recepcion_de: '2026-10-01T00:00:00.000' });

  const first = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });
  assert.equal(Object.hasOwn(first.patch, 'deadline_at'), false, 'an earlier source date must never move the deadline backwards');
  assert.equal(first.patch.raw.deadline_conflicts.length, 1);
  assert.deepEqual(first.patch.raw.deadline_conflicts[0], {
    source_deadline: '2026-10-01T00:00:00+00:00',
    current_deadline: '2026-11-01T00:00:00.000Z',
    detected_at: '2026-09-25T12:00:00.000Z',
  });

  // Determinism: identical inputs produce an identical conflict record.
  const second = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });
  assert.deepEqual(second.patch.raw.deadline_conflicts, first.patch.raw.deadline_conflicts);

  // Re-reconciling a row that already carries this exact conflict (the previous patch was
  // applied, or the same chunk is re-fetched on a later run) must not grow the list.
  const alreadyPatched = { ...existing, raw: first.patch.raw };
  const third = reconcileTenderSource(alreadyPatched, source, { now: '2026-09-30T08:00:00.000Z' });
  assert.equal(third.patch.raw.deadline_conflicts.length, 1, 'a repeated identical conflict must be deduplicated, not appended again');
});

// --- 2b. Earlier source date must never clobber a valid, already-persisted raw.deadline -----

test('an earlier source date does not overwrite a valid persisted raw.deadline with the earlier source date', () => {
  const existing = existingRow({
    deadline_at: '2026-10-06T00:00:00+00:00',
    raw: { id_del_proceso: 'CO1.REQ.123', deadline: '2026-10-06' },
  });
  const source = sourceRow({ fecha_de_recepcion_de: '2026-10-05T00:00:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(Object.hasOwn(patch, 'deadline_at'), false, 'an earlier source date must never move the deadline backwards');
  assert.equal(patch.raw.deadline, '2026-10-06', 'a persisted/confirmed raw.deadline must survive an earlier, conflicting source date');
  assert.equal(patch.raw.fecha_de_recepcion_de, '2026-10-05T00:00:00.000', 'the raw source evidence field itself may still reflect what the source actually sent');
  assert.equal(patch.raw.deadline_conflicts.length, 1, 'the earlier date must still be recorded as a conflict');
});

// --- 2c. Earlier source date with a missing/invalid raw.deadline derives it from deadline_at -

test('an earlier source date derives raw.deadline from the persisted deadline_at when the existing raw.deadline is missing', () => {
  const existing = existingRow({
    deadline_at: '2026-10-06T00:00:00+00:00',
    raw: { id_del_proceso: 'CO1.REQ.123' },
  });
  const source = sourceRow({ fecha_de_recepcion_de: '2026-10-05T00:00:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(Object.hasOwn(patch, 'deadline_at'), false);
  assert.equal(patch.raw.deadline, '2026-10-06', 'a missing raw.deadline must be safely derived from the persisted deadline_at, not set to the earlier source date');
  assert.equal(patch.raw.deadline_conflicts.length, 1);
});

// --- 3. Equal date omits the deadline patch -------------------------------------------------

test('an equal source date omits the deadline patch and records no conflict', () => {
  // The current deadline is already persisted in the correct +00:00 form, while the source
  // resolves to the same calendar date. A lexicographic string compare of '+00:00' against the
  // emitted '.000Z' suffix would misread this as the source being "earlier" even though it is
  // the identical instant -- this must be recognized as equal, not a conflict.
  const existing = existingRow({ deadline_at: '2026-11-01T00:00:00+00:00' });
  const source = sourceRow({ fecha_de_recepcion_de: '2026-11-01T00:00:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(Object.hasOwn(patch, 'deadline_at'), false, 'an unchanged deadline must not be patched, even when the stored and computed forms use different UTC suffix spellings for the same instant');
  assert.equal((patch.raw.deadline_conflicts || []).length, 0, 'an equal date is agreement, not a conflict');
});

// --- 4. Missing current deadline gets set ---------------------------------------------------

test('a missing current deadline is set from the source regardless of comparison', () => {
  const existing = existingRow({ deadline_at: null });
  const source = sourceRow({ fecha_de_recepcion_de: '2026-10-01T00:00:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(patch.deadline_at, '2026-10-01T00:00:00+00:00');
  assert.equal((patch.raw.deadline_conflicts || []).length, 0, 'filling a missing deadline is not a conflict');
});

// --- 5. Status precedence, independent of the deadline patch --------------------------------

test('status precedence is estado_resumen > fase > estado_del_procedimiento and changes independently of the deadline patch', () => {
  const sameDeadline = '2026-11-01T00:00:00.000';
  const existing = existingRow({ deadline_at: '2026-11-01T00:00:00.000Z', status: 'Presentación de oferta' });
  const now = { now: '2026-09-25T12:00:00.000Z' };

  const resumenWins = reconcileTenderSource(existing, sourceRow({
    fecha_de_recepcion_de: sameDeadline,
    estado_resumen: 'En evaluación', fase: 'Presentación de oferta', estado_del_procedimiento: 'Publicado',
  }), now);
  assert.equal(resumenWins.patch.status, 'En evaluación', 'estado_resumen must win over fase and estado_del_procedimiento');
  assert.equal(Object.hasOwn(resumenWins.patch, 'deadline_at'), false, 'an unchanged deadline must stay out of the patch even when status changes');

  const faseWins = reconcileTenderSource(existing, sourceRow({
    fecha_de_recepcion_de: sameDeadline,
    estado_resumen: '', fase: 'Evaluación de ofertas', estado_del_procedimiento: 'Publicado',
  }), now);
  assert.equal(faseWins.patch.status, 'Evaluación de ofertas', 'fase must win over estado_del_procedimiento when estado_resumen is blank');

  const procedimientoWins = reconcileTenderSource(existing, sourceRow({
    fecha_de_recepcion_de: sameDeadline,
    estado_resumen: '', fase: '', estado_del_procedimiento: 'Adjudicado',
  }), now);
  assert.equal(procedimientoWins.patch.status, 'Adjudicado', 'estado_del_procedimiento is the last resort when the higher-precedence fields are blank');

  const unchanged = reconcileTenderSource(existing, sourceRow({
    fecha_de_recepcion_de: sameDeadline,
    estado_resumen: '', fase: 'Presentación de oferta', estado_del_procedimiento: 'Publicado',
  }), now);
  assert.equal(Object.hasOwn(unchanged.patch, 'status'), false, 'an unchanged resolved status must be omitted from the patch');
});

// --- 6. Raw merge preserves fields / deadline_history, no duplicate audit event -------------

test('raw merge preserves unrelated existing fields and deadline_history without duplicating a matching deadline audit event', () => {
  const existing = existingRow({
    deadline_at: '2026-11-01T00:00:00.000Z',
    raw: {
      id_del_proceso: 'CO1.REQ.123',
      custom_note: 'manually annotated by ops',
      deadline_history: [
        { deadline_at: '2026-11-20T00:00:00+00:00', source: 'SECOP II', recorded_at: '2026-08-01T00:00:00.000Z' },
      ],
    },
  });
  // The source has flapped back to a deadline already present in deadline_history.
  const source = sourceRow({ fecha_de_recepcion_de: '2026-11-20T00:00:00.000' });

  const { patch } = reconcileTenderSource(existing, source, { now: '2026-09-25T12:00:00.000Z' });

  assert.equal(patch.deadline_at, '2026-11-20T00:00:00+00:00');
  assert.equal(patch.raw.custom_note, 'manually annotated by ops', 'unrelated existing raw fields must survive the merge');
  assert.equal(patch.raw.id_del_proceso, 'CO1.REQ.123');
  assert.equal(patch.raw.deadline_history.length, 1, 'a deadline that flapped back to an already-recorded value must not duplicate its audit event');
  assert.deepEqual(patch.raw.deadline_history[0], {
    deadline_at: '2026-11-20T00:00:00+00:00', source: 'SECOP II', recorded_at: '2026-08-01T00:00:00.000Z',
  });
});

// --- 7. SoQL IN clause escaping --------------------------------------------------------------

test('socrataWhereForProcessIds builds an escaped SoQL IN clause over id_del_proceso', () => {
  const where = socrataWhereForProcessIds(['CO1.REQ.123', "CO1.REQ.O'BRIEN", 'CO1.REQ.456']);
  assert.equal(where, "id_del_proceso in ('CO1.REQ.123','CO1.REQ.O''BRIEN','CO1.REQ.456')");
});

test('socrataWhereForProcessIds supports a custom field name', () => {
  const where = socrataWhereForProcessIds(['CO1.REQ.123'], { field: 'process_id' });
  assert.equal(where, "process_id in ('CO1.REQ.123')");
});

test('socrataWhereForProcessIds refuses to build an unbounded clause from an empty id list', () => {
  assert.throws(() => socrataWhereForProcessIds([]), /process_id|empty|vac[ií]o/i);
});

// --- 8 & 9. Realistic injected database / fetch runner fake ---------------------------------
//
// Fake `psi_public_tenders` table supporting the keyset-pagination read shape
// (`select().eq('source','SECOP II').not('process_id','is',null).order('id').gt('id', cursor)
// .limit(pageSize)`) and the id-targeted technical update shape (`update(patch).eq('id', id)`),
// the same chain shape used by the existing ESU adapter fake in
// tests/esu-direct-refresh-adapter.test.mjs.
// `concurrentDeadlineById` simulates a row whose `deadline_at` was already changed by another
// writer between the durable read and this PATCH -- the compare-and-swap predicate must then be
// evaluated against that *actual* current value, not the stale value the reconciliation run read
// earlier, exactly like a real `UPDATE ... WHERE id = $1 AND deadline_at = $2`.
function fakeDatabase({ rows, failingIds = new Set(), mismatchedIds = new Set(), concurrentDeadlineById = {} }) {
  const calls = [];
  const database = {
    from(table) {
      calls.push({ op: 'from', table });
      const state = {};
      const query = {
        // `select()` is overloaded: before an update it's the read projection (chainable, as
        // real postgrest-js is); after `update(patch).eq('id', id)[.eq('deadline_at', v)|.is(...)]`
        // it's the mandatory PATCH readback (`.select('id')`), which is where the real client
        // actually resolves -- `eq()`/`is()` after an update stay chainable, exactly like the real
        // postgrest-js builder.
        select(columns) {
          if (state.pendingUpdate !== undefined) {
            calls.push({ op: 'select', table, columns, afterUpdate: true });
            const idValue = state.idTarget;
            const error = failingIds.has(idValue) ? new Error(`simulated PATCH failure for ${idValue}`) : null;
            if (error) return Promise.resolve({ data: null, error });
            if (state.deadlineCas) {
              const row = rows.find(r => r.id === idValue);
              const baselineDeadline = row ? (row.deadline_at ?? null) : null;
              const actualCurrentDeadline = Object.prototype.hasOwnProperty.call(concurrentDeadlineById, idValue)
                ? concurrentDeadlineById[idValue]
                : baselineDeadline;
              if (state.deadlineCas.value !== actualCurrentDeadline) {
                // CAS predicate matches zero rows -- same observable shape as a verified update
                // that affected nobody.
                return Promise.resolve({ data: [], error: null });
              }
            }
            // `mismatchedIds` simulates a readback that is correct by cardinality (exactly one
            // row) but wrong by identity -- it must not be mistaken for a verified update.
            const readbackValue = mismatchedIds.has(idValue) ? `not-${idValue}` : idValue;
            return Promise.resolve({ data: [{ id: readbackValue }], error: null });
          }
          calls.push({ op: 'select', table, columns });
          return query;
        },
        not(column, type, value) { calls.push({ op: 'not', table, column, type, value }); return query; },
        order(column, options) { calls.push({ op: 'order', table, column, options }); return query; },
        gt(column, value) { state.cursor = value; calls.push({ op: 'gt', table, column, value }); return query; },
        limit(value) { state.limit = value; calls.push({ op: 'limit', table, value }); return query; },
        update(patch) { state.pendingUpdate = patch; return query; },
        eq(column, value) {
          if (state.pendingUpdate !== undefined) {
            if (column === 'id') {
              state.idTarget = value;
              calls.push({ op: 'update', table, column, value, patch: state.pendingUpdate });
            } else {
              if (column === 'deadline_at') state.deadlineCas = { type: 'eq', value };
              calls.push({ op: 'eq', table, column, value, afterUpdate: true });
            }
            return query;
          }
          calls.push({ op: 'eq', table, column, value });
          return query;
        },
        is(column, value) {
          if (state.pendingUpdate !== undefined) {
            if (column === 'deadline_at') state.deadlineCas = { type: 'is', value };
            calls.push({ op: 'is', table, column, value, afterUpdate: true });
            return query;
          }
          calls.push({ op: 'is', table, column, value });
          return query;
        },
        then(resolve, reject) {
          const limit = state.limit ?? rows.length;
          const page = rows.filter(row => state.cursor == null || row.id > state.cursor).slice(0, limit);
          return Promise.resolve({ data: page, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return { database, calls };
}

function fakeFetchSource(sourceById) {
  const calls = [];
  return {
    calls,
    async run(where) {
      calls.push(where);
      const ids = [...where.matchAll(/'([^']*(?:''[^']*)*)'/g)].map(m => m[1].replace(/''/g, "'"));
      return ids.map(id => sourceById[id]).filter(Boolean);
    },
  };
}

function durableRow(id, processId, overrides = {}) {
  return {
    id, process_id: processId, source: 'SECOP II',
    deadline_at: '2026-11-01T00:00:00.000Z', status: 'Presentación de oferta',
    internal_status: 'nueva', raw: {},
    ...overrides,
  };
}

test('a realistic fake database/fetch runner proves pagination, chunked source lookups, converted-row inclusion, and a narrow PATCH', async () => {
  const rows = [
    durableRow('id-1', 'P-1'),
    durableRow('id-2', 'P-2', { internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-2' }),
    durableRow('id-3', 'P-3'),
    durableRow('id-4', 'P-4', { deadline_at: null }),
    durableRow('id-5', 'P-5'),
  ];
  const { database, calls } = fakeDatabase({ rows });

  const sourceById = {
    'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }), // later -> patched
    'P-2': sourceRow({ id_del_proceso: 'P-2', fecha_de_recepcion_de: '2026-11-25T00:00:00.000' }), // converted, later -> still patched
    'P-3': sourceRow({ id_del_proceso: 'P-3', fecha_de_recepcion_de: '2026-11-01T00:00:00.000' }), // equal -> no deadline change
    'P-4': sourceRow({ id_del_proceso: 'P-4', fecha_de_recepcion_de: '2026-12-01T00:00:00.000' }), // missing -> set
    'P-5': sourceRow({ id_del_proceso: 'P-5', fecha_de_recepcion_de: '2026-10-01T00:00:00.000' }), // earlier -> conflict only
  };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 2, chunkSize: 2,
  });

  const result = await reconciliation.runOnce();

  // Pagination: 5 durable rows at pageSize 2 cannot be read in a single page.
  const gtCalls = calls.filter(call => call.op === 'gt');
  assert.ok(gtCalls.length >= 2, 'keyset pagination over 5 rows at pageSize 2 must request more than one page');
  assert.ok(calls.some(call => call.op === 'eq' && call.column === 'source' && call.value === 'SECOP II'), 'durable read must be scoped to source SECOP II');
  assert.ok(calls.some(call => call.op === 'not' && call.column === 'process_id'), 'durable read must require a non-null process_id');

  // Chunking: chunkSize 2 over 5 ids must take 3 SoQL lookups, none larger than the chunk size.
  assert.equal(fetch.calls.length, 3, 'process_id lookups must be chunked at the configured chunk size');
  let idsRequested = 0;
  for (const where of fetch.calls) {
    assert.match(where, /^id_del_proceso in \(/);
    const idCount = (where.match(/'/g) || []).length / 2;
    assert.ok(idCount <= 2, `each SoQL chunk must respect the configured chunk size, saw ${idCount}`);
    idsRequested += idCount;
  }
  assert.equal(idsRequested, 5, 'every durable process_id must be looked up exactly once across the chunks');

  const updateCalls = calls.filter(call => call.op === 'update');
  const patchById = Object.fromEntries(updateCalls.map(call => [call.value, call.patch]));

  assert.ok(patchById['id-2'], 'a converted tender must still receive technical reconciliation');
  assert.equal(patchById['id-2'].deadline_at, '2026-11-25T00:00:00+00:00');

  for (const [id, patch] of Object.entries(patchById)) {
    for (const key of Object.keys(patch)) {
      assert.ok(['deadline_at', 'status', 'raw', 'last_seen_at'].includes(key), `${id} patch must only ever touch deadline_at/status/raw/last_seen_at, saw ${key}`);
    }
  }

  assert.equal(result.scanned, 5);
  assert.equal(result.matched, 5);
});

test('an individual PATCH failure is counted but reconciliation continues with later rows', async () => {
  const rows = [
    durableRow('a-1', 'P-1'),
    durableRow('a-2', 'P-2'),
    durableRow('a-3', 'P-3'),
  ];
  const { database, calls } = fakeDatabase({ rows, failingIds: new Set(['a-2']) });

  const sourceById = {
    'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }),
    'P-2': sourceRow({ id_del_proceso: 'P-2', fecha_de_recepcion_de: '2026-11-21T00:00:00.000' }),
    'P-3': sourceRow({ id_del_proceso: 'P-3', fecha_de_recepcion_de: '2026-11-22T00:00:00.000' }),
  };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });

  const result = await reconciliation.runOnce();

  assert.equal(result.failed, 1, 'exactly the one simulated PATCH failure must be counted');
  assert.equal(result.patched, 2, 'the two non-failing rows must still be reconciled');
  assert.ok(Array.isArray(result.errors) && result.errors.length === 1, 'the failure must be surfaced, not swallowed silently');

  const patchedIds = calls.filter(call => call.op === 'update').map(call => call.value);
  assert.ok(patchedIds.includes('a-1'));
  assert.ok(patchedIds.includes('a-3'), 'the row after the failing one must still be attempted and must succeed');
});

test('runOnce rejects when the injected fetch runner returns a non-array source response', async () => {
  const rows = [durableRow('inv-1', 'P-1')];
  const { database } = fakeDatabase({ rows });

  const reconciliation = createTenderSourceReconciliation({
    database,
    fetchSource: async () => ({ unexpected: 'shape' }),
    now: () => '2026-09-25T12:00:00.000Z',
    pageSize: 10,
    chunkSize: 10,
  });

  await assert.rejects(
    () => reconciliation.runOnce(),
    'an invalid (non-array) Socrata acquisition must be a core failure, not silently counted as missing'
  );
});

test('a PATCH readback that matches by cardinality but not by id must not count as a verified update', async () => {
  const rows = [durableRow('tgt-1', 'P-1')];
  const { database } = fakeDatabase({ rows, mismatchedIds: new Set(['tgt-1']) });

  const sourceById = {
    'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }),
  };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });

  const result = await reconciliation.runOnce();

  assert.equal(result.patched, 0, 'an id-mismatched readback (exactly one row, wrong id) must not be counted as a verified update');
  assert.equal(result.failed, 1, 'exact targeted readback verification must reject a cardinality-only match and count it as a failure');
});

// --- 10. Deterministic Socrata record selection (selectAuthoritativeSocrataRecord) -----------

test('selectAuthoritativeSocrataRecord keeps the row with the unique latest fecha_de_ultima_publicaci', () => {
  const older = sourceRow({ fecha_de_ultima_publicaci: '2026-09-01T00:00:00.000', estado_resumen: 'Publicado' });
  const newer = sourceRow({ fecha_de_ultima_publicaci: '2026-09-20T00:00:00.000', estado_resumen: 'En evaluación' });

  assert.equal(selectAuthoritativeSocrataRecord([older, newer]), newer);
  assert.equal(selectAuthoritativeSocrataRecord([newer, older]), newer, 'order of the input rows must not matter');
});

test('selectAuthoritativeSocrataRecord throws a deterministic conflict when a publication-date tie disagrees on resolved status', () => {
  const sharedPublication = '2026-09-20T00:00:00.000';
  const a = sourceRow({ fecha_de_ultima_publicaci: sharedPublication, estado_resumen: 'Publicado' });
  const b = sourceRow({ fecha_de_ultima_publicaci: sharedPublication, estado_resumen: 'Adjudicado' });

  assert.throws(() => selectAuthoritativeSocrataRecord([a, b]), /conflict|conflicto/i);
});

test('selectAuthoritativeSocrataRecord throws a deterministic conflict when a publication-date tie disagrees on fecha_de_recepcion_de', () => {
  const sharedPublication = '2026-09-20T00:00:00.000';
  const a = sourceRow({ fecha_de_ultima_publicaci: sharedPublication, fecha_de_recepcion_de: '2026-11-01T00:00:00.000' });
  const b = sourceRow({ fecha_de_ultima_publicaci: sharedPublication, fecha_de_recepcion_de: '2026-11-02T00:00:00.000' });

  assert.throws(() => selectAuthoritativeSocrataRecord([a, b]), /conflict|conflicto/i);
});

test('selectAuthoritativeSocrataRecord resolves a publication-date tie deterministically when the tied rows actually agree', () => {
  const sharedPublication = '2026-09-20T00:00:00.000';
  const a = sourceRow({ fecha_de_ultima_publicaci: sharedPublication });
  const b = sourceRow({ fecha_de_ultima_publicaci: sharedPublication });

  const winner = selectAuthoritativeSocrataRecord([a, b]);
  assert.ok(winner === a || winner === b, 'an agreeing tie must resolve to one of the tied rows, not throw');
});

test("createTenderSourceReconciliation's default Socrata fetch requests fecha_de_ultima_publicaci, orders by it DESC, and sizes \$limit to chunkSize * 20", async () => {
  const rows = [durableRow('d-1', 'P-1')];
  const { database } = fakeDatabase({ rows });
  const seenUrls = [];
  const fetchImpl = async url => {
    seenUrls.push(url);
    return [sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' })];
  };

  const reconciliation = createTenderSourceReconciliation({
    database, fetchImpl, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 7,
  });
  await reconciliation.runOnce();

  assert.equal(seenUrls.length, 1);
  const url = new URL(seenUrls[0]);
  assert.match(url.searchParams.get('$select'), /fecha_de_ultima_publicaci/, '$select must include fecha_de_ultima_publicaci');
  assert.equal(url.searchParams.get('$order'), 'fecha_de_ultima_publicaci DESC');
  assert.equal(url.searchParams.get('$limit'), String(7 * 20), 'the limit must be sized at chunkSize * 20 so one duplicate-heavy id cannot starve the rest of the chunk');
});

test('a requested process_id truncated out of the chunk response is missing, not matched to an arbitrary leftover row, and runOnce fails closed', async () => {
  const rows = [
    durableRow('m-1', 'P-1'),
    durableRow('m-2', 'P-2'),
  ];
  const { database, calls } = fakeDatabase({ rows });

  // Simulate a Socrata response truncated by a duplicate-heavy id: P-1 fills the response, P-2
  // never comes back even though it was requested in the same `in (...)` clause.
  const fetch = {
    calls: [],
    async run(where) {
      fetch.calls.push(where);
      return [sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' })];
    },
  };

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });
  const result = await reconciliation.runOnce();

  assert.equal(result.matched, 1);
  assert.equal(result.missing, 1, 'the truncated process_id must be counted as missing, never silently matched');
  assert.notEqual(result.status, 'success', 'an unmatched durable process_id must fail runOnce closed');

  const updatedIds = calls.filter(call => call.op === 'update').map(call => call.value);
  assert.deepEqual(updatedIds, ['m-1'], 'm-2 must never be patched with m-1 (P-1) data');
});

// --- 11. Unexpected missing IDs fail closed ---------------------------------------------------

test('an unmatched durable process_id makes runOnce status not success, with missing=1', async () => {
  const rows = [durableRow('u-1', 'P-1')];
  const { database } = fakeDatabase({ rows });
  const fetch = fakeFetchSource({});

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });
  const result = await reconciliation.runOnce();

  assert.equal(result.missing, 1);
  assert.notEqual(result.status, 'success', 'runOnce must not report success while a durable process_id went unmatched');
});

// --- 12. Deadline writes are compare-and-swap, not unconditional .eq('id') --------------------

test('a later-source deadline write includes a compare-and-swap on the observed current deadline_at', async () => {
  const rows = [durableRow('cas-1', 'P-1', { deadline_at: '2026-11-01T00:00:00.000Z' })];
  const { database, calls } = fakeDatabase({ rows });
  const sourceById = { 'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }) };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });
  const result = await reconciliation.runOnce();

  assert.equal(result.patched, 1);
  const casCalls = calls.filter(call => call.afterUpdate && call.column === 'deadline_at');
  assert.equal(casCalls.length, 1, 'a deadline_at patch must be constrained by a compare-and-swap on the observed current deadline_at');
  assert.equal(casCalls[0].value, '2026-11-01T00:00:00.000Z', 'the CAS must target the exact value read from the durable row');
});

test('a durable row with no current deadline uses a null-safe compare-and-swap, not eq(deadline_at, null)', async () => {
  const rows = [durableRow('cas-2', 'P-1', { deadline_at: null })];
  const { database, calls } = fakeDatabase({ rows });
  const sourceById = { 'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }) };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });
  const result = await reconciliation.runOnce();

  assert.equal(result.patched, 1);
  const casCalls = calls.filter(call => call.afterUpdate && call.column === 'deadline_at');
  assert.equal(casCalls.length, 1);
  assert.equal(casCalls[0].op, 'is', 'a null observed deadline must use a null-safe is(), since eq(column, null) never matches in SQL');
  assert.equal(casCalls[0].value, null);
});

test('a concurrent deadline change defeats the CAS: the row is counted as failed, not overwritten', async () => {
  const rows = [durableRow('cas-3', 'P-1', { deadline_at: '2026-11-01T00:00:00.000Z' })];
  const { database, calls } = fakeDatabase({ rows, concurrentDeadlineById: { 'cas-3': '2026-12-15T00:00:00.000Z' } });
  const sourceById = { 'P-1': sourceRow({ id_del_proceso: 'P-1', fecha_de_recepcion_de: '2026-11-20T00:00:00.000' }) };
  const fetch = fakeFetchSource(sourceById);

  const reconciliation = createTenderSourceReconciliation({
    database, fetchSource: fetch.run, now: () => '2026-09-25T12:00:00.000Z', pageSize: 10, chunkSize: 10,
  });
  const result = await reconciliation.runOnce();

  assert.equal(result.patched, 0, 'a CAS defeated by a concurrent write must not count as patched');
  assert.equal(result.failed, 1, 'a CAS failure must be counted as failed, not silently skipped');
  const casCalls = calls.filter(call => call.afterUpdate && call.column === 'deadline_at');
  assert.equal(casCalls[0].value, '2026-11-01T00:00:00.000Z', 'the CAS still targets the value observed at read time, not the concurrent one');
});
