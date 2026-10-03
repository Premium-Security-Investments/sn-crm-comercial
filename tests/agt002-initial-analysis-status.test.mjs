import test from 'node:test';
import assert from 'node:assert/strict';
import { readAgt002InitialAnalysisStatus } from '../agt002-initial-analysis-status.js';

function query(result) {
  const chain = {};
  for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain;
  chain.maybeSingle = async () => result;
  return chain;
}

test('status loader reads the latest durable job and exact run, returning only the safe projection', async () => {
  const seen = [];
  const database = {
    from(table) {
      seen.push(table);
      if (table === 'psi_agt002_initial_analysis_jobs') return query({
        data: { id: 'job-1', status: 'COMPLETED', analysis_run_id: 'run-1', error_code: null }, error: null,
      });
      return query({ data: { id: 'run-1', status: 'completed', canonical: true, current: true, analysis_kind: 'INITIAL', analysis_version: 1 }, error: null });
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
