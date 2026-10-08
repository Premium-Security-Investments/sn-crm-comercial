import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverOneAgt002IncrementalChangeSet } from '../agt002-incremental-recovery.js';

function databaseWithTerminalJob(job) {
  const rpcCalls = [];
  return {
    rpcCalls,
    from(table) {
      const query = {
        select() { return query; }, in() { return query; }, eq() { return query; },
        order() { return query; }, limit() { return query; },
        async maybeSingle() {
          if (table === 'psi_agt002_incremental_change_sets') {
            return { data: {
              id: 'set-1', opportunity_id: 'opp-1', tender_id: 'tender-1',
              prior_canonical_run_id: 'run-0', prior_context_version_id: null,
              requested_by: 'profile-1', state: 'DISPATCHED', policy_version: 'agt002.incremental.r1.v1',
              manifest: {}, linked_job_id: 'job-1',
            }, error: null };
          }
          if (table === 'psi_agt002_reanalysis_jobs') return { data: job, error: null };
          throw new Error(`unexpected table ${table}`);
        },
      };
      return query;
    },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return { data: { status: job.status === 'completed' ? 'completed' : 'failed' }, error: null };
    },
  };
}

test('recovery closes a terminal completed job/set crash gap without claiming or rerunning it', async () => {
  const database = databaseWithTerminalJob({
    id: 'job-1', status: 'completed', analysis_run_id: 'run-1', error_code: null,
  });
  const result = await recoverOneAgt002IncrementalChangeSet(database);
  assert.deepEqual(result, {
    status: 'reconciled', change_set_id: 'set-1', job_id: 'job-1', outcome: 'completed',
  });
  assert.deepEqual(database.rpcCalls, [[
    'psi_close_agt002_incremental_change_set',
    {
      p_job_id: 'job-1', p_outcome: 'completed', p_analysis_run_id: 'run-1',
      p_safe_error: null, p_worker_id: 'agt002-incremental-recovery',
    },
  ]]);
});
