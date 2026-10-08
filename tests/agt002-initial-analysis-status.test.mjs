import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgt002InitialAnalysisStatus } from '../agt002-initial-analysis-status.js';

function query(result, selects) {
  const chain = {};
  for (const method of ['eq', 'order', 'limit']) chain[method] = () => chain;
  chain.select = columns => { selects?.push(columns); return chain; };
  chain.maybeSingle = async () => result;
  return chain;
}

// The real columns of psi_tender_analysis_runs: there is no `current` column.
const REAL_RUN = { id: 'run-1', status: 'completed', canonical: true, analysis_kind: 'INITIAL', analysis_version: 1 };
const COMPLETED_JOB = { id: 'job-1', status: 'COMPLETED', analysis_run_id: 'run-1', error_code: null };

function databaseWith(run) {
  const selects = [];
  return {
    selects,
    from(table) {
      if (table === 'psi_agt002_initial_analysis_jobs') return query({ data: COMPLETED_JOB, error: null }, selects);
      return query({ data: run, error: null }, selects);
    },
  };
}

test('status loader reads the latest durable job and exact run, returning only the safe projection', async () => {
  const seen = [];
  const database = {
    from(table) {
      seen.push(table);
      if (table === 'psi_agt002_initial_analysis_jobs') return query({
        data: { id: 'job-1', status: 'COMPLETED', analysis_run_id: 'run-1', error_code: null }, error: null,
      });
      return query({ data: { id: 'run-1', status: 'completed', canonical: true, analysis_kind: 'INITIAL', analysis_version: 1 }, error: null });
    },
  };
  const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
  assert.equal(result.state, 'ready');
  assert.deepEqual(seen, ['psi_agt002_initial_analysis_jobs', 'psi_tender_analysis_runs']);
  assert.doesNotMatch(JSON.stringify(result), /result|payload|raw/);
});

test('status loader never reads a run for a pending opportunity', async () => {
  let reads = 0;
  const database = { from() { reads += 1; return query({ data: null, error: null }); } };
  const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
  assert.equal(result.state, 'pending');
  assert.equal(reads, 1);
});

test('status loader never selects a column that does not exist and derives "current" from the canonical invariant', async () => {
  const database = databaseWith(REAL_RUN);
  const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
  assert.equal(result.state, 'ready');
  assert.equal(result.reportAvailable, true);
  for (const columns of database.selects) assert.doesNotMatch(columns, /\bcurrent\b/, 'psi_tender_analysis_runs has no current column');
});

test('a demoted (non-canonical) run is not reported as the current initial analysis', async () => {
  const result = await readAgt002InitialAnalysisStatus(databaseWith({ ...REAL_RUN, canonical: false }), 'opp-1');
  assert.equal(result.state, 'failed');
  assert.equal(result.errorCode, 'canonical_run_missing');
  assert.equal(result.reportAvailable, false);
});

test('a demoted INITIAL report remains readable when the current canonical run proves successor lineage', async () => {
  let runReads = 0;
  const initial = { ...REAL_RUN, canonical: false, supersedes_run_id: null };
  const current = { id: 'run-r1', status: 'completed', canonical: true, supersedes_run_id: 'run-1' };
  const database = {
    from(table) {
      if (table === 'psi_agt002_initial_analysis_jobs') return query({ data: COMPLETED_JOB, error: null });
      runReads += 1;
      return query({ data: runReads === 1 ? initial : current, error: null });
    },
  };
  const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
  assert.equal(result.state, 'ready');
  assert.equal(result.runId, 'run-1');
  assert.equal(result.reportAvailable, true);
});

// --- Migration 108: a running or failed REANALYSIS never hides the analysis it would succeed ---
function databaseWithJobs({ latest, completed, run }) {
  const jobQueries = [];
  return {
    jobQueries,
    from(table) {
      if (table === 'psi_agt002_initial_analysis_jobs') {
        const filters = [];
        const chain = {};
        chain.select = () => chain;
        chain.order = () => chain;
        chain.limit = () => chain;
        chain.eq = (column, value) => { filters.push([column, value]); return chain; };
        chain.maybeSingle = async () => {
          jobQueries.push(filters);
          const onlyCompleted = filters.some(([column, value]) => column === 'status' && value === 'COMPLETED');
          return { data: onlyCompleted ? completed : latest, error: null };
        };
        return chain;
      }
      return query({ data: run, error: null });
    },
  };
}

test('a REANALYSIS in progress or failed keeps the current canonical analysis visible', async () => {
  for (const latest of [
    { id: 'job-2', status: 'RUNNING', analysis_run_id: null, error_code: null, analysis_kind: 'REANALYSIS' },
    { id: 'job-2', status: 'FAILED', analysis_run_id: null, error_code: 'model_call_failed', analysis_kind: 'REANALYSIS' },
  ]) {
    const database = databaseWithJobs({ latest, completed: { ...COMPLETED_JOB, analysis_kind: 'INITIAL' }, run: REAL_RUN });
    const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
    assert.equal(result.state, 'ready', latest.status);
    assert.equal(result.runId, 'run-1');
    assert.equal(database.jobQueries.length, 2);
  }
});

test('an INITIAL in progress is still reported as running (no fallback outside REANALYSIS)', async () => {
  const latest = { id: 'job-1', status: 'RUNNING', analysis_run_id: null, error_code: null, analysis_kind: 'INITIAL' };
  const database = databaseWithJobs({ latest, completed: null, run: null });
  const result = await readAgt002InitialAnalysisStatus(database, 'opp-1');
  assert.equal(result.state, 'running');
  assert.equal(database.jobQueries.length, 1);
});
