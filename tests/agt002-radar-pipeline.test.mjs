import assert from 'node:assert/strict';
import { AGT002_RADAR_PIPELINE_STAGES, createAgt002RadarPipeline } from '../agt002-radar-pipeline.js';

const hostileDatabase = new Proxy({}, { get() { throw new Error('database must not be touched'); } });
const hostile = () => { throw new Error('must not run'); };
const hostileDeps = {
  fetchTenderPage: hostile, evaluateGate: hostile, recordGateEvaluation: hostile,
  enqueueJob: hostile, claimJob: hostile, completeJob: hostile, failJob: hostile,
  projectLearningObservations: hostile, buildLearningSignals: hostile,
  runPreanalysis: hostile, recordPreanalysisRun: hostile, refreshEsuDirect: hostile,
};

// AGT002_RADAR_GATE no longer exists in ANALYSIS_FLAG_NAMES (agt002-analysis-config.js): the AI
// preanalysis pipeline is retired for every environment shape, including ones that used to enable
// it. No collaborator, database, model or queue call is ever reached, and `now` is never called
// either -- the disabled check runs before the clock is read.
for (const environment of [
  {}, { AGT002_RADAR_GATE: 'true' }, { AGT002_RADAR_GATE: 'TRUE' }, { AGT002_RADAR_GATE: '1' },
  { AGT002_RADAR_GATE: 'false' }, { AGT002_RADAR_GATE: 'yes' }, { AGT002_RADAR_GATE: '' },
]) {
  const pipeline = createAgt002RadarPipeline({ database: hostileDatabase, environment, now: hostile, ...hostileDeps });
  assert.deepEqual(await pipeline.runOnce(), { status: 'disabled', stages: [], code: 'AGT002_RADAR_PIPELINE_DISABLED' });
}

assert.deepEqual(AGT002_RADAR_PIPELINE_STAGES, ['esu_refresh', 'fetch', 'gate', 'ledger', 'claim', 'learning', 'agt', 'persist']);
console.log('AGT-002 radar pipeline is unconditionally disabled (AI preanalysis retired) passed');
