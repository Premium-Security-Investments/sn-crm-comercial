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
