import { strict as assert } from 'node:assert';
import { callCreateTenderProcessingJob } from '../tender-tracking-rpc.js';
import { dispatchTenderProcessingAfterConversion } from '../tender-processing-dispatch.js';

const tenderId = '11111111-1111-4111-8111-111111111111';
const opportunityId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';

function fakeDatabase({ rpcResult, row }) {
  return {
    rpc() { return Promise.resolve({ data: rpcResult, error: null }); },
    from(table) {
      assert.equal(table, 'psi_tender_processing_jobs');
      return {
        select(columns) {
          assert.equal(columns, 'status,current_step');
          return { eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
        },
      };
    },
  };
}

await (async function newlyCreatedJobIsDispatchedExactlyOnceAndRetainsPipelineStatus() {
  const database = fakeDatabase({
    rpcResult: { status: 'created', job_id: 'job-new' },
    row: { status: 'queued', current_step: 'documents' },
  });

  const job = await callCreateTenderProcessingJob(database, { tenderId, opportunityId, pipelineVersion: 'v1', requestedBy: actorId });

  let calls = 0;
  const dispatch = await dispatchTenderProcessingAfterConversion({
    enabled: true,
    job,
    runOnce: async () => { calls += 1; return { status: 'discovered' }; },
  });

  assert.equal(calls, 1, 'a job freshly created by the RPC must trigger immediate dispatch exactly once');
  assert.equal(dispatch.status, 'dispatched');
  assert.equal(job.status, 'queued', 'the durable pipeline status must be preserved, not overwritten by the creation outcome');
  assert.equal(job.current_step, 'documents');
})();

await (async function existingIdempotentJobIsNeverRedispatched() {
  const database = fakeDatabase({
    rpcResult: { status: 'existing', job_id: 'job-existing' },
    row: { status: 'analyzing', current_step: 'analysis' },
  });

  const job = await callCreateTenderProcessingJob(database, { tenderId, opportunityId, pipelineVersion: 'v1', requestedBy: actorId });

  let calls = 0;
  const dispatch = await dispatchTenderProcessingAfterConversion({
    enabled: true,
    job,
    runOnce: async () => { calls += 1; },
  });

  assert.equal(calls, 0, 'a repeated conversion recovering an idempotent existing job must not redispatch it');
  assert.equal(dispatch.status, 'skipped');
  assert.equal(job.status, 'analyzing', 'the durable pipeline status of the recovered job must be reported as-is');
  assert.equal(job.current_step, 'analysis');
})();

console.log('tender processing immediate dispatch integration contract passed');
