import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ESU_DIRECT_REFRESH_INTERVAL_MS,
  createEsuDirectRefresher,
  mergeAuthoritativeEsuTender,
} from '../esu-direct-refresh.js';
import { createAgt002RadarPipeline } from '../agt002-radar-pipeline.js';

const NOW = '2026-08-27T12:00:00.000Z';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const hostile = () => { throw new Error('unexpected call'); };

function createHarness({ lastCheckpoint = null, fetched = [], fetchError = null } = {}) {
  const calls = [];
  const checkpoints = [];
  const upserts = [];
  const businessMutations = [];
  const refresher = createEsuDirectRefresher({
    now: () => NOW,
    readLastCheckpoint: async () => { calls.push('checkpoint.read'); return lastCheckpoint; },
    fetchDirectProcesses: async () => {
      calls.push('esu.direct_fetch');
      if (fetchError) throw fetchError;
      return fetched;
    },
    upsertTenders: async rows => { calls.push('esu.upsert'); upserts.push(...rows); },
    recordCheckpoint: async checkpoint => { calls.push('checkpoint.write'); checkpoints.push(checkpoint); },
  });
  return { refresher, calls, checkpoints, upserts, businessMutations };
}

test('default direct ESU refresh cadence is six hours', () => {
  assert.equal(ESU_DIRECT_REFRESH_INTERVAL_MS, SIX_HOURS);
});

for (const [label, ageMs, shouldFetch] of [
  ['5h59m59s', SIX_HOURS - 1000, false],
  ['exactly 6h', SIX_HOURS, true],
  ['6h00m01s', SIX_HOURS + 1000, true],
]) {
  test(`direct ESU refresh cadence boundary ${label}`, async () => {
    const runAt = new Date(Date.parse(NOW) - ageMs).toISOString();
    const harness = createHarness({ lastCheckpoint: { run_at: runAt, status: 'success' } });
    const result = await harness.refresher.runOnce();
    assert.equal(harness.calls.includes('esu.direct_fetch'), shouldFetch);
    if (!shouldFetch) {
      assert.equal(result.status, 'skipped_fresh');
      assert.deepEqual(harness.calls, ['checkpoint.read']);
      assert.equal(harness.checkpoints.length, 0);
    }
    assert.deepEqual(harness.businessMutations, []);
  });
}

test('successful direct ESU refresh upserts authoritative deadline and status', async () => {
  const direct = {
    stable_key: 'esu:2026-130',
    source: 'ESU Contratación',
    ref: '2026-130',
    title: 'Servicio de vigilancia física',
    status: 'Convocado',
    deadline_at: '2026-09-01T15:00:00.000Z',
  };
  const harness = createHarness({ fetched: [direct] });
  const result = await harness.refresher.runOnce();
  assert.equal(result.status, 'success');
  assert.equal(result.rows, 1);
  assert.equal(harness.upserts.length, 1);
  assert.equal(harness.upserts[0].deadline_at, direct.deadline_at);
  assert.equal(harness.upserts[0].status, direct.status);
  assert.equal(harness.checkpoints[0].status, 'success');
  assert.deepEqual(harness.calls, ['checkpoint.read', 'esu.direct_fetch', 'esu.upsert', 'checkpoint.write']);
  assert.deepEqual(harness.businessMutations, []);
});

test('successful direct ESU refresh with no rows is explicit success_empty and rate-limited', async () => {
  const harness = createHarness({ fetched: [] });
  const result = await harness.refresher.runOnce();
  assert.equal(result.status, 'success_empty');
  assert.equal(result.rows, 0);
  assert.equal(harness.upserts.length, 0);
  assert.equal(harness.checkpoints[0].status, 'success_empty');
  assert.equal(harness.checkpoints[0].run_at, NOW);
  assert.deepEqual(harness.businessMutations, []);
});

test('direct ESU unavailable is explicit, source-local and preserves safe continuation', async () => {
  const harness = createHarness({ fetchError: new Error('portal unavailable') });
  const result = await harness.refresher.runOnce();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'ESU Contratación directo');
  assert.equal(harness.upserts.length, 0);
  assert.equal(harness.checkpoints[0].status, 'unavailable');
  assert.deepEqual(harness.businessMutations, []);
});

test('null fallback fields cannot erase authoritative direct ESU deadline or status', () => {
  const existing = {
    stable_key: 'esu:2026-130',
    deadline_at: '2026-09-01T15:00:00.000Z',
    status: 'Convocado',
    raw: { source_origin: 'ESU Contratación directo' },
  };
  for (const fallback of [
    { stable_key: existing.stable_key, deadline_at: null, status: null },
    { stable_key: existing.stable_key, deadline_at: '', status: '' },
    { stable_key: existing.stable_key },
  ]) {
    const merged = mergeAuthoritativeEsuTender(existing, fallback);
    assert.equal(merged.deadline_at, existing.deadline_at);
    assert.equal(merged.status, existing.status);
  }
});

test('upsertTenders returning a fractional, negative, or otherwise non-integer count falls back to processes.length', async () => {
  const processes = [{ stable_key: 'a' }, { stable_key: 'b' }, { stable_key: 'c' }];
  const invalidCounts = [1.5, -1, -0.5, -100, NaN, Infinity, -Infinity];
  for (const bogusCount of invalidCounts) {
    const checkpoints = [];
    const refresher = createEsuDirectRefresher({
      now: () => NOW,
      readLastCheckpoint: async () => null,
      fetchDirectProcesses: async () => processes,
      upsertTenders: async () => bogusCount,
      recordCheckpoint: async checkpoint => { checkpoints.push(checkpoint); },
    });
    const result = await refresher.runOnce();
    assert.equal(result.count_upserted, processes.length,
      `upsertTenders returning ${bogusCount} must fall back to processes.length, not be treated as an actual persisted count`);
    assert.equal(result.rows, processes.length);
    assert.equal(checkpoints[0].count_upserted, processes.length);
  }

  const validCounts = [0, 1, 2, processes.length];
  for (const realCount of validCounts) {
    const checkpoints = [];
    const refresher = createEsuDirectRefresher({
      now: () => NOW,
      readLastCheckpoint: async () => null,
      fetchDirectProcesses: async () => processes,
      upsertTenders: async () => realCount,
      recordCheckpoint: async checkpoint => { checkpoints.push(checkpoint); },
    });
    const result = await refresher.runOnce();
    assert.equal(result.count_upserted, realCount,
      `upsertTenders returning the nonnegative integer ${realCount} must be trusted as the actual persisted count`);
    assert.equal(checkpoints[0].count_upserted, realCount);
  }
});

test('pipeline refreshes ESU before candidate fetch and continues source-locally on unavailable', async () => {
  const calls = [];
  const pipeline = createAgt002RadarPipeline({
    database: {},
    environment: { AGT002_RADAR_GATE: 'true' },
    now: () => NOW,
    refreshEsuDirect: async () => { calls.push('esu.refresh'); return { status: 'unavailable', source: 'ESU Contratación directo' }; },
    fetchTenderPage: async () => { calls.push('agt.fetch'); return []; },
    evaluateGate: hostile,
    recordGateEvaluation: hostile,
    enqueueJob: hostile,
    claimJob: async () => null,
    completeJob: hostile,
    failJob: hostile,
    projectLearningObservations: hostile,
    buildLearningSignals: hostile,
    runPreanalysis: hostile,
    recordPreanalysisRun: hostile,
  });
  const result = await pipeline.runOnce();
  assert.equal(result.status, 'empty');
  assert.equal(result.esu_refresh.status, 'unavailable');
  assert.deepEqual(calls, ['esu.refresh', 'agt.fetch']);
  assert.equal(result.stages[0], 'esu_refresh');
  assert.equal(result.stages[1], 'fetch');
});
