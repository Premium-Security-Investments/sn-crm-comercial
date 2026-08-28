import assert from 'node:assert/strict';
import { dispatchTenderProcessingAfterConversion } from '../tender-processing-dispatch.js';

async function run() {
  {
    let calls = 0;
    const result = await dispatchTenderProcessingAfterConversion({
      enabled: false,
      job: { outcome: 'created', status: 'queued', job_id: 'job-1' },
      runOnce: async () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, 'skipped');
  }
  {
    let calls = 0;
    const result = await dispatchTenderProcessingAfterConversion({
      enabled: true,
      job: { outcome: 'existing', status: 'importing_documents', job_id: 'job-1' },
      runOnce: async () => { calls += 1; },
    });
    assert.equal(calls, 0, 'an idempotent existing job must not be dispatched again by conversion');
    assert.equal(result.status, 'skipped');
  }
  {
    let calls = 0;
    const result = await dispatchTenderProcessingAfterConversion({
      enabled: true,
      job: { outcome: 'created', status: 'queued', job_id: 'job-1' },
      runOnce: async () => { calls += 1; return { status: 'discovered' }; },
    });
    assert.equal(calls, 1, 'a newly-created durable job is dispatched exactly once');
    assert.deepEqual(result, { status: 'dispatched', worker_status: 'discovered' });
  }
  {
    let calls = 0;
    const warnings = [];
    const result = await dispatchTenderProcessingAfterConversion({
      enabled: true,
      job: { outcome: 'created', status: 'queued', job_id: 'job-1' },
      runOnce: async () => { calls += 1; throw Object.assign(new Error('temporary'), { code: 'TEMP' }); },
      onError: event => warnings.push(event),
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'failed');
    assert.equal(result.error_code, 'TEMP');
    assert.equal(warnings.length, 1, 'failure is observable but not thrown');
  }
  console.log('tender processing immediate dispatch contract passed');
}

run();
