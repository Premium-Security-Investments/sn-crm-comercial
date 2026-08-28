import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fetchEsuProcesses } from '../esu-direct-crawl.js';
import { createSupabaseEsuDirectRefresher } from '../esu-direct-refresh.js';

function fakeDatabase({ checkpoint = null, existing = [] } = {}) {
  const calls = [];
  const tables = {
    psi_esu_direct_refresh_runs: checkpoint ? [checkpoint] : [],
    psi_public_tenders: existing,
  };
  const database = {
    from(table) {
      const state = { table, filters: [] };
      const response = () => {
        const rows = tables[table] || [];
        const data = rows.filter(row => state.filters.every(filter => {
          if (filter.method === 'in') return filter.values.includes(row[filter.column]);
          if (filter.method === 'eq') return row[filter.column] === filter.value;
          return true;
        }));
        return { data, error: null };
      };
      const query = {
        select(columns) { state.select = columns; calls.push({ table, method: 'select', columns }); return query; },
        in(column, values) { state.filters.push({ method: 'in', column, values }); calls.push({ table, method: 'in', column, values }); return query; },
        eq(column, value) {
          state.filters.push({ method: 'eq', column, value });
          if (state.pendingUpdate !== undefined) calls.push({ table, method: 'update', column, value, patch: state.pendingUpdate });
          else calls.push({ table, method: 'eq', column, value });
          return query;
        },
        order(column, options) { calls.push({ table, method: 'order', column, options }); return query; },
        limit(value) { calls.push({ table, method: 'limit', value }); return query; },
        maybeSingle() { const result = response(); return Promise.resolve({ data: result.data[0] || null, error: result.error }); },
        // A targeted update is the id-scoped shape a reconcile-existing-only adapter must use
        // (`.update(patch).eq('id', existingId)`), distinct from the blanket `.eq()` used to
        // build a select filter: `state.pendingUpdate` set means the eq() that follows terminates
        // the update chain rather than adding another read filter.
        update(patch) { state.pendingUpdate = patch; return query; },
        upsert(rows, options) { calls.push({ table, method: 'upsert', rows, options }); return Promise.resolve({ data: rows, error: null }); },
        insert(row) { calls.push({ table, method: 'insert', row }); return Promise.resolve({ data: row, error: null }); },
        then(resolve, reject) { return Promise.resolve(response()).then(resolve, reject); },
      };
      return query;
    },
  };
  return { database, calls };
}

test('total ESU traversal outage rejects instead of masquerading as success_empty', async () => {
  const offline = async () => { throw new Error('portal offline'); };
  await assert.rejects(
    () => fetchEsuProcesses({ fetchIndexPages: offline, searchProcesses: offline }),
    /unavailable|no disponible|fallaron|offline/i,
  );
});

test('Supabase ESU adapter targets an existing exact stable_key match by id, patching narrow technical fields only, never upserting', async () => {
  const existing = [{
    id: 'db-esu-1',
    stable_key: 'esu-1',
    ref: 'P-1',
    title: 'Servicio de vigilancia',
    source: 'ESU Contratación',
    deadline_at: '2026-09-30T23:59:00.000Z',
    status: 'Convocado',
    internal_status: 'en_revision',
    converted_opportunity_id: '11111111-1111-4111-8111-111111111111',
    tracking_status: 'pendiente_revision',
  }];
  const { database, calls } = fakeDatabase({ existing });
  const refresher = createSupabaseEsuDirectRefresher({
    database,
    now: () => '2026-08-27T18:00:00.000Z',
    fetchDirectProcesses: async () => [{
      stable_key: 'esu-1', source: 'ESU Contratación', section: 'hacer', entity: 'ESU', dept: 'Antioquia', city: 'Medellín',
      ref: 'P-1', process_id: 'P-1', title: 'Servicio de vigilancia', desc: 'Objeto', value: 0,
      status: 'Convocado', category: 'Vigilancia física', published: '2026-08-20T00:00:00.000Z',
      deadline: '2026-10-15T23:59:00.000Z',
      score: 120, reasons: ['ESU convocado'], risks: [], url: 'https://esucontratacion.com/procesos/view/1', raw: { estado: 'Convocado' },
    }],
  });

  const result = await refresher.runOnce();
  assert.equal(result.status, 'success');
  assert.equal(result.rows, 1);

  assert.equal(calls.some(call => call.table === 'psi_public_tenders' && call.method === 'upsert'), false,
    'reconcile-existing-only remediation must never upsert psi_public_tenders');
  assert.equal(calls.some(call => call.table === 'psi_public_tenders' && call.method === 'insert'), false,
    'reconcile-existing-only remediation must never insert a new tender row');

  const updateCalls = calls.filter(call => call.table === 'psi_public_tenders' && call.method === 'update');
  assert.equal(updateCalls.length, 1, 'the exact stable_key match must be targeted by id');
  assert.equal(updateCalls[0].column, 'id');
  assert.equal(updateCalls[0].value, 'db-esu-1');
  assert.deepEqual(Object.keys(updateCalls[0].patch).sort(), ['deadline_at', 'status'], 'the update patch must contain only the narrow technical fields');
  assert.equal(updateCalls[0].patch.deadline_at, '2026-10-15T23:59:00.000Z');
  assert.equal(updateCalls[0].patch.status, 'Convocado');
  for (const forbidden of ['title', 'ref', 'entity', 'stable_key', 'description', 'internal_status', 'converted_opportunity_id', 'tracking_status', 'reviewed_by', 'reviewed_at']) {
    assert.equal(Object.hasOwn(updateCalls[0].patch, forbidden), false, `${forbidden} must remain human-owned and omitted from technical update patch`);
  }
  assert(calls.some(call => call.table === 'psi_esu_direct_refresh_runs' && call.method === 'insert'), 'must record source-local checkpoint');
  assert.equal(calls.some(call => call.table === 'psi_sales_opportunities'), false, 'must not mutate business opportunities');
  assert.equal(calls.some(call => call.table === 'psi_sales_interactions'), false, 'must not mutate business interactions');
});

test('unavailable checkpoint still imposes the 6h retry floor 15 minutes later', async () => {
  const checkpoint = {
    run_at: '2026-08-27T17:45:00.000Z',
    status: 'unavailable',
    count_fetched: 0,
    count_upserted: 0,
    error: 'portal offline',
  };
  const { database } = fakeDatabase({ checkpoint });
  let fetchCalled = false;
  const refresher = createSupabaseEsuDirectRefresher({
    database,
    now: () => '2026-08-27T18:00:00.000Z',
    fetchDirectProcesses: async () => { fetchCalled = true; return []; },
  });

  const result = await refresher.runOnce();
  assert.equal(fetchCalled, false, 'must not re-attempt ESU within the retry floor even after a prior unavailable attempt');
  assert.equal(result.status, 'skipped_fresh');
});

// [Phase 2, 2026-08-28] The ESU direct-refresh now runs inside the daily scan, not the 15-min
// queue worker: the scan owns esu_refresh -> fetch -> gate -> ledger -> enqueue, the worker only
// claims. These two assertions moved from the pipeline runner to the scan runner accordingly; the
// invariant they protect -- "the durable entrypoint injects the real refresher and asks for
// historical rows" -- is unchanged, only which file it lives on.
test('durable AGT-002 scan entrypoint injects the real ESU direct refresher', () => {
  const source = readFileSync(new URL('../ops/agt002-radar-scan/run-agt002-radar-scan.mjs', import.meta.url), 'utf8');
  assert(source.includes('createSupabaseEsuDirectRefresher'));
  assert(source.includes('fetchEsuProcesses'));
  assert(source.includes('refreshEsuDirect'));
  assert(source.includes('.runOnce()'));
});

test('durable AGT-002 queue worker entrypoint never imports or references the ESU direct-refresh adapter', () => {
  const source = readFileSync(new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('createSupabaseEsuDirectRefresher'), false);
  assert.equal(source.includes('fetchEsuProcesses'), false);
  assert.equal(source.includes('refreshEsuDirect'), false);
  assert.doesNotMatch(source, /esu-direct-refresh|esu-direct-crawl/);
});

// --- Reconcile-existing-only remediation --------------------------------------------------
// 53 existing ESU-source psi_public_tenders rows are SECOP-backed: their stable_key/ref/title
// were derived from SECOP data, not from esucontratacion.com's own numbering, so they never
// equal the stable_key the direct crawler computes for the same real-world process. Upserting
// by stable_key (the current adapter behavior, asserted by the test above) treats every direct
// row as brand-new and creates a duplicate tender instead of reconciling the one that already
// exists. The only safe correlation available without fuzzy title matching is the canonical
// `20xx-<sequence>` reference embedded in both the existing ref (behind a human prefix, e.g.
// "SPVA N° 2026-27") and the direct ref (bare, e.g. "2026-27"): match on that key, and only
// when it resolves to exactly one existing row and exactly one direct row.

function directEsuProcess(overrides) {
  return {
    stable_key: 'esu-direct-placeholder', source: 'ESU Contratación', section: 'hacer',
    entity: 'ESU', dept: 'Antioquia', city: 'Medellín', process_id: overrides.ref,
    title: 'Servicio de vigilancia', desc: 'Objeto', value: 0, category: 'Vigilancia física',
    published: '2026-08-20T00:00:00.000Z', score: 100, reasons: [], risks: [],
    raw: { estado: overrides.status || 'Convocado' },
    ...overrides,
  };
}

test('Supabase ESU adapter reconciles only existing rows via canonical ref, never upserts or inserts', async () => {
  const existing = [
    {
      // Human prefix ("SPVA"), a "N°" glyph and extra spacing around the canonical
      // 20xx-number key must all be normalized away to still match the bare direct ref "2026-27".
      id: 'db-27', ref: 'SPVA N° 2026-27', stable_key: 'secop-db-27', title: 'Vigilancia armada sede occidente (SECOP)',
      source: 'ESU Contratación', deadline_at: null, status: 'Publicado', internal_status: 'en_revision', tracking_status: 'pendiente_revision',
    },
    {
      // Two direct processes below share this row's canonical ref: an ambiguous 1:many group
      // must be skipped entirely rather than guessing which direct row is authoritative.
      id: 'db-1', ref: 'SPO 2026-1', stable_key: 'secop-db-1', title: 'Vigilancia sede oriente (SECOP)',
      source: 'ESU Contratación', deadline_at: null, status: 'Publicado', internal_status: 'nueva', tracking_status: 'pendiente_revision',
    },
    {
      // No canonical 20xx-number key in this ref at all: even though it is textually identical
      // to a direct ref below, that must never be accepted as a match (no fuzzy/string fallback).
      id: 'db-77', ref: 'VARIOS SIN NUMERO', stable_key: 'secop-db-77', title: 'Otro proceso (SECOP)',
      source: 'ESU Contratación', deadline_at: null, status: 'Publicado', internal_status: 'nueva', tracking_status: 'pendiente_revision',
    },
  ];
  const { database, calls } = fakeDatabase({ existing });

  const directMatch = directEsuProcess({
    stable_key: 'esu-direct-2026-27', ref: '2026-27', title: 'Servicio de vigilancia física distinto título',
    status: 'Convocado', deadline: '2026-09-30T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/2701',
  });
  const directAmbiguousA = directEsuProcess({
    stable_key: 'esu-direct-2026-1-a', ref: '2026-1', title: 'Servicio de vigilancia sede oriente A',
    status: 'Convocado', deadline: '2026-10-15T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/101',
  });
  const directAmbiguousB = directEsuProcess({
    stable_key: 'esu-direct-2026-1-b', ref: '2026-1', title: 'Servicio de vigilancia sede oriente B',
    status: 'Convocado', deadline: '2026-10-20T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/102',
  });
  const directUnmatched = directEsuProcess({
    stable_key: 'esu-direct-2026-99', ref: '2026-99', title: 'Servicio de vigilancia proceso nuevo sin registro previo',
    status: 'Convocado', deadline: '2026-11-01T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/9901',
  });
  const directNoCanonicalRef = directEsuProcess({
    stable_key: 'esu-direct-no-ref', ref: 'VARIOS SIN NUMERO', title: 'Otro proceso',
    status: 'Convocado', deadline: '2026-11-05T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/7701',
  });

  const refresher = createSupabaseEsuDirectRefresher({
    database,
    now: () => '2026-08-27T18:00:00.000Z',
    fetchDirectProcesses: async () => [directMatch, directAmbiguousA, directAmbiguousB, directUnmatched, directNoCanonicalRef],
  });

  const result = await refresher.runOnce();
  assert.equal(result.status, 'success');

  assert.equal(calls.some(call => call.table === 'psi_public_tenders' && call.method === 'upsert'), false,
    'reconcile-existing-only remediation must never upsert psi_public_tenders');
  assert.equal(calls.some(call => call.table === 'psi_public_tenders' && call.method === 'insert'), false,
    'reconcile-existing-only remediation must never insert a new tender row');

  const updateCalls = calls.filter(call => call.table === 'psi_public_tenders' && call.method === 'update');
  assert.equal(updateCalls.length, 1, 'exactly one existing row is a safe, unambiguous canonical-ref match');
  assert.equal(updateCalls[0].column, 'id');
  assert.equal(updateCalls[0].value, 'db-27', 'the single safe update must target the existing row by its own id');
  assert.equal(updateCalls[0].patch.deadline_at, directMatch.deadline);
  assert.equal(updateCalls[0].patch.status, directMatch.status);
  for (const forbidden of ['title', 'ref', 'entity', 'stable_key', 'description', 'internal_status', 'tracking_status', 'converted_opportunity_id', 'reviewed_by', 'reviewed_at']) {
    assert.equal(Object.hasOwn(updateCalls[0].patch, forbidden), false,
      `${forbidden} is a human/business or identity field and must not be part of the conservative technical-only update patch`);
  }

  assert.equal(result.count_upserted, 1, 'count_upserted must reflect the one safe matched update, not the five processes fetched');

  const checkpointInsert = calls.find(call => call.table === 'psi_esu_direct_refresh_runs' && call.method === 'insert');
  assert.ok(checkpointInsert, 'must still record the source-local checkpoint');
  assert.equal(checkpointInsert.row.count_upserted, 1);
  assert.equal(checkpointInsert.row.count_fetched, 5);
});

test('Supabase ESU adapter scopes the existing-row read to the exact ESU source and never matches a row from another source sharing a canonical ref', async () => {
  const existing = [{
    // Same canonical "2026-50" key as the direct process below, and it would resolve to a
    // singleton on both sides -- but this row is SECOP-sourced, not an ESU Contratación row, so
    // it must never be fetched as a reconcile candidate in the first place.
    id: 'secop-50', ref: 'SPO N° 2026-50', stable_key: 'secop-db-50', title: 'Vigilancia sede sur (SECOP)',
    source: 'SECOP II', deadline_at: '2026-08-01T00:00:00.000Z', status: 'Publicado',
    internal_status: 'en_revision', tracking_status: 'pendiente_revision',
  }];
  const { database, calls } = fakeDatabase({ existing });

  const directMatch = directEsuProcess({
    stable_key: 'esu-direct-2026-50', ref: '2026-50', title: 'Servicio de vigilancia sede sur',
    status: 'Convocado', deadline: '2026-09-30T23:59:00.000Z', url: 'https://esucontratacion.com/procesos/view/5001',
  });

  const refresher = createSupabaseEsuDirectRefresher({
    database,
    now: () => '2026-08-27T18:00:00.000Z',
    fetchDirectProcesses: async () => [directMatch],
  });

  const result = await refresher.runOnce();
  assert.equal(result.status, 'success');

  assert.equal(
    calls.some(call => call.table === 'psi_public_tenders' && call.method === 'eq' && call.column === 'source' && call.value === 'ESU Contratación'),
    true,
    'the existing-row read must be scoped by an exact .eq(\'source\', \'ESU Contratación\') filter',
  );
  assert.equal(
    calls.some(call => call.table === 'psi_public_tenders' && call.method === 'update'),
    false,
    'an existing row from another source (SECOP II) sharing the canonical ref must never become a match candidate',
  );
  assert.equal(result.count_upserted, 0, 'no in-scope ESU row exists to reconcile, so nothing may be counted as matched/updated');
  assert.equal(result.rows, 0);
});

test('Supabase ESU adapter preserves existing deadline/status in the id-targeted update patch when the direct crawl comes back blank', async () => {
  const existing = [{
    id: 'db-88', ref: 'SPVA N° 2026-88', stable_key: 'secop-db-88', title: 'Vigilancia sede norte (SECOP)',
    source: 'ESU Contratación', deadline_at: '2026-10-01T23:59:00.000Z', status: 'Convocado',
    internal_status: 'en_revision', tracking_status: 'pendiente_revision',
  }];
  const { database, calls } = fakeDatabase({ existing });

  const directBlank = directEsuProcess({
    stable_key: 'esu-direct-2026-88', ref: '2026-88', title: 'Servicio de vigilancia sede norte',
    status: '', deadline: null, url: 'https://esucontratacion.com/procesos/view/8801',
  });

  const refresher = createSupabaseEsuDirectRefresher({
    database,
    now: () => '2026-08-27T18:00:00.000Z',
    fetchDirectProcesses: async () => [directBlank],
  });

  const result = await refresher.runOnce();
  assert.equal(result.status, 'success');

  const updateCalls = calls.filter(call => call.table === 'psi_public_tenders' && call.method === 'update');
  assert.equal(updateCalls.length, 1, 'the canonical-ref singleton match must still be safely updated');
  assert.equal(updateCalls[0].column, 'id');
  assert.equal(updateCalls[0].value, 'db-88');
  assert.equal(updateCalls[0].patch.deadline_at, existing[0].deadline_at,
    'a blank direct deadline must not erase the existing authoritative deadline in the id-targeted patch');
  assert.equal(updateCalls[0].patch.status, existing[0].status,
    'a blank direct status must not erase the existing authoritative status in the id-targeted patch');
});

test('durable AGT-002 scan entrypoint requests historical ESU rows, not just default candidate-discovery mode', () => {
  const source = readFileSync(new URL('../ops/agt002-radar-scan/run-agt002-radar-scan.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /fetchEsuProcesses\(\s*\{\s*includeHistorical\s*:\s*true/,
    'reconcile-existing-only matching needs terminal/past direct rows too, so the durable entrypoint must call fetchEsuProcesses({ includeHistorical: true, ... }) rather than default candidate-discovery mode',
  );
});
