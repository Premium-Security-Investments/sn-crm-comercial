import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgt002StableContentHash } from '../tender-analysis-foundation.js';
import { buildAgt002IncrementalDeltaManifest } from '../agt002-incremental-analysis-input.js';
import { dispatchAgt002IncrementalAnalysis, projectAgt002PriorFindings } from '../agt002-incremental-dispatch.js';

const TEXT = 'Adenda oficial modificada';
const manifest = buildAgt002IncrementalDeltaManifest({
  opportunityId: 'o-1', tenderId: 't-1', changeSetId: 'c-1', priorCanonicalRunId: 'r-1',
  priorContextVersionId: null, policyVersion: 'agt002.incremental.r1.v1',
  members: [{
    signal_id: 's-1', trigger_kind: 'official_document', source_table: 'psi_tender_document_versions',
    source_type: 'adenda', source_id: 'd-1', source_version: 'v-2',
    content_hash: computeAgt002StableContentHash(TEXT), observed_at: '2026-10-08T00:00:00.000Z',
    actor_profile_id: null, source_batch_id: 'b-1',
  }],
});

test('dispatches exactly the frozen delta and wakes only after the durable link', async () => {
  const calls = [];
  const database = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: { status: 'dispatched', change_set_id: 'c-1', job_id: 'j-1' }, error: null };
  } };
  const result = await dispatchAgt002IncrementalAnalysis(database, {
    manifest, snapshotId: 'snapshot-2', actorProfileId: 'p-1',
    loadChangedEvidence: async () => [{ signal_id: 's-1', name: 'Adenda', text: TEXT, version: 2 }],
    loadPriorFindings: async () => [{ finding_ref: 'f-1', impact: 'previo' }],
    enqueueIncrementalJob: async ({ incrementalInput }) => {
      assert.equal(incrementalInput.analysisDocuments.length, 1);
      assert.equal(incrementalInput.analysisDocuments[0].extracted_text, TEXT);
      return { status: 'queued', job_id: 'j-1' };
    },
    wakeWorker: async ({ jobId }) => { calls.push(['wake', jobId]); return { status: 'accepted' }; },
  });
  assert.equal(result.status, 'dispatched');
  assert.equal(result.worker_wake, 'accepted');
  assert.deepEqual(calls.map(item => item[0]), ['psi_dispatch_agt002_incremental_change_set', 'wake']);
});

test('does not wake when linking the job fails', async () => {
  const database = { rpc: async () => ({ data: null, error: { code: '55000', message: 'mismatch' } }) };
  let woke = false;
  await assert.rejects(dispatchAgt002IncrementalAnalysis(database, {
    manifest, snapshotId: 'snapshot-2', actorProfileId: 'p-1',
    loadChangedEvidence: async () => [{ signal_id: 's-1', name: 'Adenda', text: TEXT }],
    loadPriorFindings: async () => [],
    enqueueIncrementalJob: async () => ({ status: 'queued', job_id: 'j-1' }),
    wakeWorker: async () => { woke = true; },
  }), /mismatch/);
  assert.equal(woke, false);
});

test('projects stable finding references from an INITIAL result', () => {
  assert.deepEqual(projectAgt002PriorFindings({ findings: [{ finding_id: 'F-1', impact: 'x' }] }), [
    { finding_id: 'F-1', impact: 'x', finding_ref: 'F-1' },
  ]);
});

test('projects governed v3 analysis units as the prior findings for conservative R1 review', () => {
  assert.deepEqual(projectAgt002PriorFindings({
    integral_analysis: { analysis_units: [{ unit_id: 'unit-1', requirement_id: 'req-1', title: 'Póliza' }] },
  }), [{ unit_id: 'unit-1', requirement_id: 'req-1', title: 'Póliza', finding_ref: 'unit-1' }]);
});
