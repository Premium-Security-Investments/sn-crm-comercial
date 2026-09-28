import assert from 'node:assert/strict';
import { AGT002_RADAR_WORKER_STAGES, createAgt002RadarWorker } from '../agt002-radar-worker.js';

const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };
const hostileDeps = {
  claimJob: hostile, fetchTenderRow: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
  readCanonicalPreanalysis: hostile, completeJob: hostile, failJob: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile,
};

// AGT002_RADAR_GATE no longer exists in ANALYSIS_FLAG_NAMES (agt002-analysis-config.js): the
// queue worker is retired for every environment shape, including gate=true, gate=false and gate
// absent. No claim, database read/write or model call is ever reached, and `now` is never called
// either -- the disabled check runs before the clock is read.
for (const environment of [
  {}, { AGT002_RADAR_GATE: 'true' }, { AGT002_RADAR_GATE: 'false' }, { AGT002_RADAR_GATE: '1' },
]) {
  const worker = createAgt002RadarWorker({ database: hostileDatabase, environment, now: hostile, ...hostileDeps });
  assert.deepEqual(await worker.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_WORKER_DISABLED' });
}

assert.deepEqual(AGT002_RADAR_WORKER_STAGES, ['claim', 'fetch_row', 'gate', 'ledger', 'learning', 'agt', 'persist']);
console.log('AGT-002 radar worker is unconditionally disabled (AI preanalysis retired) passed');
