import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectAgt002InitialAnalysisState,
  AGT002_INITIAL_ANALYSIS_UI_STATES,
} from '../agt002-initial-analysis-projection.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

test('the reduced INITIAL UI vocabulary is exactly pending/running/ready/failed', () => {
  assert.deepEqual(AGT002_INITIAL_ANALYSIS_UI_STATES, ['pending', 'running', 'ready', 'failed']);
});

test('no job and no run projects pending with an explicit server-owned blocking reason', () => {
  assert.deepEqual(projectAgt002InitialAnalysisState({ job: null, run: null }), {
    state: 'pending',
    jobId: null,
    runId: null,
    errorCode: null,
    reportAvailable: false,
    humanDecisionRequired: false,
    action: {
      allowed: false,
      blockingCode: 'INITIAL_NOT_ADMITTED',
      message: 'El análisis inicial todavía no ha sido admitido.',
    },
  });
});

for (const status of ['QUEUED', 'CLAIMED', 'RUNNING', 'NEEDS_ATTENTION']) {
  test(`${status} projects running and never pretends a report exists`, () => {
    const projection = projectAgt002InitialAnalysisState({
      job: { id: 'job-1', status, analysis_run_id: null, error_code: null },
      run: null,
    });
    assert.equal(projection.state, 'running');
    assert.equal(projection.reportAvailable, false);
    assert.equal(projection.humanDecisionRequired, false);
  });
}

test('COMPLETED is ready only with the exact current canonical INITIAL run', () => {
  const projection = projectAgt002InitialAnalysisState({
    job: { id: 'job-1', status: 'COMPLETED', analysis_run_id: RUN_ID, error_code: null },
    run: { id: RUN_ID, status: 'completed', canonical: true, current: true, analysis_kind: 'INITIAL', analysis_version: 1 },
  });
  assert.equal(projection.state, 'ready');
  assert.equal(projection.reportAvailable, true);
  assert.equal(projection.humanDecisionRequired, true);
  assert.equal(projection.action.allowed, true);
  assert.equal(projection.action.blockingCode, null);
});

test('a completed job without its matching canonical run fails closed', () => {
  const projection = projectAgt002InitialAnalysisState({
    job: { id: 'job-1', status: 'COMPLETED', analysis_run_id: RUN_ID, error_code: null },
    run: null,
  });
  assert.equal(projection.state, 'failed');
  assert.equal(projection.errorCode, 'canonical_run_missing');
  assert.equal(projection.reportAvailable, false);
});

test('FAILED exposes only a closed error code and never raw detail', () => {
  const projection = projectAgt002InitialAnalysisState({
    job: { id: 'job-1', status: 'FAILED', analysis_run_id: null, error_code: 'provider_timeout', raw_error: 'secret' },
    run: null,
  });
  assert.equal(projection.state, 'failed');
  assert.equal(projection.errorCode, 'provider_timeout');
  assert.doesNotMatch(JSON.stringify(projection), /secret|raw_error/);
});

test('unknown or contradictory durable states fail closed', () => {
  for (const job of [
    { id: 'job-1', status: 'MYSTERY', analysis_run_id: null, error_code: null },
    { id: 'job-1', status: 'FAILED', analysis_run_id: RUN_ID, error_code: 'x' },
  ]) {
    const projection = projectAgt002InitialAnalysisState({ job, run: null });
    assert.equal(projection.state, 'failed');
    assert.equal(projection.errorCode, 'state_invalid');
  }
});

// --- Migration 108: a REANALYSIS successor is the canonical analysis from version 2 on ---
test('a completed canonical REANALYSIS run (v>=2) is ready; a REANALYSIS claiming v1 is not', async () => {
  const { projectAgt002InitialAnalysisState } = await import('../agt002-initial-analysis-projection.js');
  const job = { id: 'job-2', status: 'COMPLETED', analysis_run_id: 'run-2', error_code: null };
  const run = { id: 'run-2', status: 'completed', canonical: true, current: true, analysis_kind: 'REANALYSIS', analysis_version: 2 };
  assert.equal(projectAgt002InitialAnalysisState({ job, run }).state, 'ready');
  assert.equal(projectAgt002InitialAnalysisState({ job, run: { ...run, analysis_version: 1 } }).errorCode, 'canonical_run_missing');
});
