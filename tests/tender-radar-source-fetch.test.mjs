import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { fetchTenderRadarSourceRows } from '../tender-radar-source-fetch.js';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..');
const lastSeen = '2026-10-05T13:07:00+00:00';

function buildRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${String(index).padStart(4, '0')}`,
    last_seen_at: lastSeen,
    deadline_at: '2026-10-23T00:00:00+00:00',
    ref: index === 369 ? 'FGN-NC-IPSE-0054-2026' : `REF-${index}`,
    entity: index === 369 ? 'FISCALÍA GENERAL DE LA NACIÓN NIVEL CENTRAL.' : `Entity ${index}`,
  }));
}

function createMockDatabase(rows) {
  const calls = [];
  const database = {
    from(table) {
      const state = {
        table,
        orders: [],
        orFilter: null,
        range: null,
        limit: null,
      };
      const chain = {
        select(columns) {
          state.select = columns;
          return chain;
        },
        order(column, options) {
          state.orders.push({ column, options });
          return chain;
        },
        or(filter) {
          state.orFilter = filter;
          return chain;
        },
        range(from, to) {
          state.range = { from, to };
          calls.push({ ...state, orders: [...state.orders], method: 'range' });
          const page = rows.slice(from, to + 1);
          return Promise.resolve({ data: page, error: null });
        },
        limit(count) {
          state.limit = count;
          calls.push({ ...state, orders: [...state.orders], method: 'limit' });
          return Promise.resolve({ data: rows.slice(0, count), error: null });
        },
      };
      return chain;
    },
  };
  return { database, calls };
}

function readPersistedBody(source) {
  const start = source.indexOf('async function readPersistedTenderRadar');
  assert.ok(start !== -1, 'readPersistedTenderRadar must exist');
  const next = source.indexOf('\nasync function ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}

test('fetchTenderRadarSourceRows pages the full pool past 250 and keeps Fiscalía', async () => {
  const rows = buildRows(370);
  const { database, calls } = createMockDatabase(rows);
  const result = await fetchTenderRadarSourceRows(database, {
    cutoffIso: lastSeen,
    activeDeadlineIso: '2026-10-05T00:00:00.000Z',
  });

  assert.equal(result.length, 370);
  assert.equal(result[369].ref, 'FGN-NC-IPSE-0054-2026');
  assert.equal(calls.some((call) => call.method === 'limit' || call.limit === 250), false);
  assert.equal(calls.some((call) => call.method === 'range'), true);
  assert.equal(calls[0].orders[0].column, 'last_seen_at');
  assert.equal(calls[0].orders[0].options.ascending, false);
  assert.equal(calls[0].orders[1].column, 'id');
  assert.equal(calls[0].orders[1].options.ascending, true);
  assert.match(calls[0].orFilter, /last_seen_at\.gte\./);
  assert.match(calls[0].orFilter, /deadline_at\.gte\./);
  assert.equal(calls[0].range.from, 0);
  assert.equal(calls[0].range.to, 999);
});

test('fetchTenderRadarSourceRows omits or-filter when there is no cutoff', async () => {
  const { database, calls } = createMockDatabase(buildRows(3));
  const result = await fetchTenderRadarSourceRows(database, {});
  assert.equal(result.length, 3);
  assert.equal(calls[0].orFilter, null);
});

test('readPersistedTenderRadar no longer cuts the pool at 250', async () => {
  const server = await readFile(resolve(projectRoot, 'server/index.js'), 'utf8');
  const api = await readFile(resolve(projectRoot, 'api/[...path].js'), 'utf8');
  for (const [label, source] of [['server', server], ['api', api]]) {
    const body = readPersistedBody(source);
    assert.equal(body.includes('.limit(250)'), false, `${label} readPersistedTenderRadar must not use .limit(250)`);
    assert.equal(body.includes('fetchTenderRadarSourceRows'), true, `${label} must call fetchTenderRadarSourceRows`);
    assert.match(source, /from ['"]\.\.\/tender-radar-source-fetch\.js['"]/);
  }
});
