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
        eq(column, value) { state.filters.push({ method: 'eq', column, value }); calls.push({ table, method: 'eq', column, value }); return query; },
        order(column, options) { calls.push({ table, method: 'order', column, options }); return query; },
        limit(value) { calls.push({ table, method: 'limit', value }); return query; },
        maybeSingle() { const result = response(); return Promise.resolve({ data: result.data[0] || null, error: result.error }); },
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

test('Supabase ESU adapter upserts technical fields without mutating human workflow fields', async () => {
  const existing = [{
    stable_key: 'esu-1',
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
      status: null, category: 'Vigilancia física', published: '2026-08-20T00:00:00.000Z', deadline: null,
      score: 120, reasons: ['ESU convocado'], risks: [], url: 'https://esucontratacion.com/procesos/view/1', raw: { estado: 'Convocado' },
    }],
  });

  const result = await refresher.runOnce();
  assert.equal(result.status, 'success');
  assert.equal(result.rows, 1);

  const upsert = calls.find(call => call.table === 'psi_public_tenders' && call.method === 'upsert');
  assert(upsert, 'must upsert psi_public_tenders');
  assert.equal(upsert.options.onConflict, 'stable_key');
  assert.equal(upsert.rows.length, 1);
  assert.equal(upsert.rows[0].deadline_at, existing[0].deadline_at, 'blank direct deadline cannot erase authoritative persisted value');
  assert.equal(upsert.rows[0].status, existing[0].status, 'blank direct status cannot erase authoritative persisted value');
  assert.equal(upsert.rows[0].description, 'Objeto');
  for (const forbidden of ['internal_status', 'converted_opportunity_id', 'tracking_status', 'reviewed_by', 'reviewed_at']) {
    assert.equal(Object.hasOwn(upsert.rows[0], forbidden), false, `${forbidden} must remain human-owned and omitted from technical upsert`);
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

test('durable AGT-002 entrypoint injects the real ESU direct refresher', () => {
  const source = readFileSync(new URL('../ops/agt002-radar-pipeline/run-agt002-radar-pipeline.mjs', import.meta.url), 'utf8');
  assert(source.includes('createSupabaseEsuDirectRefresher'));
  assert(source.includes('fetchEsuProcesses'));
  assert(source.includes('refreshEsuDirect'));
  assert(source.includes('.runOnce()'));
});
