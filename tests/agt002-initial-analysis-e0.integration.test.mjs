import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { buildInitialScopeAV2 as buildBaselineScopeA, analysisFromBaseline, packageForDocuments } from './fixtures/agt002-pre-go-analysis-v2.mjs';
import { validatePreGoAnalysisV2 } from '../agt002-pre-go-analysis-v2.js';
import { createAgt002InitialAnalysisRuntime } from '../agt002-initial-analysis-runtime.js';
import { createAgt002InitialAnalysisExecutor } from '../agt002-initial-analysis-executor.js';
import { createAgt002InitialAnalysisWorker } from '../agt002-initial-analysis-worker.js';
import { assertAgt002RehydratedMembersMatchHashes, runAgt002AnalysisBatch } from '../agt002-analysis-engine.js';
import { completeAgt002InitialAnalysisJob } from '../agt002-initial-analysis-persistence.js';

const hash = value => createHash('sha256').update(value).digest('hex');

async function runSyntheticInitial(buildEnvelope) {
  const envelope = buildEnvelope();
  const documents = Array.from({ length: 13 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    text: `documento gobernado ${index + 1}`,
  }));
  const bindings = new Map(documents.map(document => [document.id, {
    document_version_id: document.id,
    extraction_id: `10000000-0000-4000-8000-${document.id.slice(-12)}`,
    extraction_text_hash: hash(document.text), content_hash: hash(`file:${document.text}`),
    source_classification: 'official', inclusion_reason: 'Fixture E0',
  }]));
  const modelCalls = [];
  const analysis = analysisFromBaseline(envelope, documents.map(document => document.id));
  const packageStub = packageForDocuments(documents.map(document => ({
    id: document.id, extractionHash: hash(document.text), contentHash: hash(`file:${document.text}`),
  })), { packageHash: envelope.meta.package_hash, createdAt: envelope.meta.cutoff_at, batchIndexOf: index => (index < 12 ? 0 : 1) });
  const runtime = createAgt002InitialAnalysisRuntime({
    loadPackage: async () => packageStub,
    now: () => new Date('2026-10-05T12:00:00.000Z'),
    bridgeClient: { run: async request => {
      modelCalls.push(request);
      const output = request.input.phase === 'synthesis'
        ? analysis
        : { analysis_notes: request.input.members.map(member => ({ document_id: member.id, locator: 'p. 1', note: `nota de ${member.id.slice(-2)}` })), open_items: [] };
      return { content: JSON.stringify(output), usage: { input_tokens: 100, output_tokens: 50 } };
    } },
    loadBindings: async (_db, _packageVersionId, memberIds) => memberIds.map(id => bindings.get(id)),
    resolveDocument: async (_db, { documentVersionId }) => ({
      text: documents.find(document => document.id === documentVersionId).text,
      extraction_text_hash: bindings.get(documentVersionId).extraction_text_hash,
    }),
  });
  const persistence = {
    workflowInstanceId: '20000000-0000-4000-8000-000000000001',
    authorizationId: envelope.meta.g1_authorization_id,
    packageVersionId: '20000000-0000-4000-8000-000000000002',
    packageHash: envelope.meta.package_hash,
    g1Scope: envelope.meta.g1_scope,
    policyVersion: 'agt002-initial-e0.v1',
    analysisRunId: envelope.meta.analysis_run_id,
  };
  const job = {
    jobId: '30000000-0000-4000-8000-000000000001',
    leaseId: '30000000-0000-4000-8000-000000000002', fenceVersion: 1,
    opportunityId: envelope.meta.opportunity_id, tenderId: envelope.meta.tender_id,
    payload: {
      persistence,
      execution: { timeoutMs: 30000, reasoningEffort: 'medium' },
      budget: { maxTotalTokens: 1000, maxCostUsd: 1, inputCostPerMillionUsd: 2, outputCostPerMillionUsd: 4 },
      batches: [
        { batchIndex: 0, phase: 'member_batch_analysis', modelId: 'synthetic-model', memberIds: documents.slice(0, 12).map(d => d.id), expectedMemberIds: documents.slice(0, 12).map(d => d.id), requestHash: hash('batch-0') },
        { batchIndex: 1, phase: 'member_batch_analysis', modelId: 'synthetic-model', memberIds: documents.slice(12).map(d => d.id), expectedMemberIds: documents.slice(12).map(d => d.id), requestHash: hash('batch-1') },
        { batchIndex: 2, phase: 'synthesis', modelId: 'synthetic-model', memberIds: [], expectedMemberIds: ['batch:0', 'batch:1'], sourceBatchIndexes: [0, 1], requestHash: hash('synthesis') },
      ],
    },
  };
  const checkpoints = new Map();
  const executor = createAgt002InitialAnalysisExecutor({
    rehydrateMembers: runtime.rehydrateMembers,
    assertMembersMatchHashes: assertAgt002RehydratedMembersMatchHashes,
    runBatch: args => runAgt002AnalysisBatch({
      ...args,
      budget: args.job.payload.budget,
      callModel: inner => runtime.callModel({ ...inner, job: args.job, batch: args.batch, database: null }),
    }),
    resumeCheckpoint: async (_db, args) => checkpoints.get(args.expectedBatchIndex) ?? null,
    renewLease: async () => ({ status: 'renewed' }),
    storeCheckpoint: async (_db, value) => {
      checkpoints.set(value.batchIndex, {
        jobId: value.jobId, batchIndex: value.batchIndex, phase: value.phase,
        requestHash: value.requestHash, output: value.output,
        outputSha256: value.outputSha256, usage: value.usage,
      });
      return { status: 'created' };
    },
  });
  const persistenceCalls = [];
  const database = { rpc: async (name, args) => {
    persistenceCalls.push({ name, args });
    return { data: { status: 'completed', job_id: job.jobId, analysis_run_id: envelope.meta.analysis_run_id, aggregate_version: 1, lineage_id: 'lineage-1' }, error: null };
  } };
  const worker = createAgt002InitialAnalysisWorker({
    database, leaseSeconds: 600,
    claimJob: async () => job,
    executeJob: (db, claimed) => executor(db, claimed),
    completeJob: completeAgt002InitialAnalysisJob,
    failJob: async () => { throw new Error('E0 must not fail'); },
  });
  const result = await worker.runOnce();
  return { result, modelCalls, checkpoints, persistenceCalls, envelope: checkpoints.get(2)?.output };
}

test('E0 A: 13 governed documents complete one INITIAL run through two batches plus synthesis', async () => {
  const result = await runSyntheticInitial(buildBaselineScopeA);
  assert.equal(result.result.status, 'completed');
  assert.equal(result.modelCalls.length, 3);
  assert.deepEqual(result.modelCalls.map(call => call.input.members.length), [12, 1, 2]);
  assert.equal(result.checkpoints.size, 3);
  assert.equal(result.persistenceCalls.length, 1);
  assert.equal(result.persistenceCalls[0].name, 'psi_complete_agt002_initial_analysis_job');
  // The persisted aggregate is exactly the stored synthesis output, stamped by the server and valid as v2.
  assert.deepEqual(result.persistenceCalls[0].args.p_envelope, result.envelope);
  assert.equal(validatePreGoAnalysisV2(result.envelope).ok, true);
  assert.equal(result.envelope.meta.schema_version, 'pre_go_analysis.v2');
  assert.equal(result.envelope.evidence_package.member_refs.length, 13);
});

test('E0 A_PLUS_B: the first INITIAL aggregate is scope A only and fails closed for anything else', async () => {
  await assert.rejects(() => runSyntheticInitial(() => {
    const baseline = buildBaselineScopeA();
    baseline.meta.g1_scope = 'A_PLUS_B';
    return baseline;
  }), /E0 must not fail/);
});
