import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAgt002InitialAnalysisRuntime, hashAgt002InitialAnalysisOutput } from '../agt002-initial-analysis-runtime.js';

const text = 'texto gobernado';
const textHash = createHash('sha256').update(text).digest('hex');
const job = {
  jobId: 'job-1', opportunityId: 'opp-1', tenderId: 'tender-1',
  payload: {
    persistence: { packageVersionId: 'pkg-1' },
    execution: { timeoutMs: 30000, reasoningEffort: 'medium' },
    budget: { maxTotalTokens: 1000, maxCostUsd: 1, inputCostPerMillionUsd: 2, outputCostPerMillionUsd: 4 },
  },
};

function runtime(overrides = {}) {
  return createAgt002InitialAnalysisRuntime({
    bridgeClient: { run: async () => ({ content: JSON.stringify({ analysis_notes: ['x'], open_items: [] }), usage: { input_tokens: 10, output_tokens: 5 } }) },
    loadBindings: async () => [{ document_version_id: 'doc-1', extraction_id: 'ext-1', extraction_text_hash: textHash, content_hash: 'a'.repeat(64), source_classification: 'official', inclusion_reason: 'Pliego' }],
    resolveDocument: async () => ({ text, extraction_text_hash: textHash }),
    ...overrides,
  });
}

test('rehydrates only the exact package-bound member and extraction hash', async () => {
  const members = await runtime().rehydrateMembers({}, ['doc-1'], { job });
  assert.deepEqual(members[0], {
    memberId: 'doc-1', content: text, contentHash: textHash, hashKind: 'utf8_text',
    metadata: {
      documentVersionId: 'doc-1', contentHash: 'a'.repeat(64), extractionTextHash: textHash,
      sourceClassification: 'official', inclusionReason: 'Pliego',
    },
  });
});

const memberOutput = { analysis_notes: [{ document_id: 'doc-1', locator: 'p. 1', note: 'x' }], open_items: [] };
const memberBatch = { phase: 'member_batch_analysis', batchIndex: 0, requestHash: 'h' };
const oneMember = [{ memberId: 'doc-1', content: text, contentHash: textHash }];

test('member model call is idempotently bound and meters tokens plus deterministic USD cost', async () => {
  let request;
  const result = await runtime({ bridgeClient: { run: async value => {
    request = value;
    return { content: JSON.stringify(memberOutput), usage: { input_tokens: 10, output_tokens: 5 } };
  } } }).callModel({ job, batch: memberBatch, modelId: 'model-a', members: oneMember });
  assert.equal(request.idempotencyKey, 'job-1:member_batch_analysis:0:h');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.00004 });
  assert.equal(result.outputSha256, hashAgt002InitialAnalysisOutput(result.output));
});

test('member call restricts every note to a document of that batch, in the schema and after the response', async () => {
  let request;
  const configured = runtime({ bridgeClient: { run: async value => {
    request = value;
    return { content: JSON.stringify({ analysis_notes: [{ document_id: 'other-doc', locator: 'p. 1', note: 'x' }], open_items: [] }), usage: { input_tokens: 1, output_tokens: 1 } };
  } } });
  await assert.rejects(
    () => configured.callModel({ job, batch: memberBatch, modelId: 'model-a', members: oneMember }),
    error => error?.code === 'AGT002_ENGINE_MODEL_CALL_FAILED' && error.diagnostic?.reason === 'member_note_unknown_document',
  );
  assert.deepEqual(request.outputSchema.properties.analysis_notes.items.properties.document_id.enum, ['doc-1']);
});

const PACKAGE_HASH = 'c'.repeat(64);
const synthesisJob = {
  ...job,
  opportunityId: '10000000-0000-4000-8000-000000000001', tenderId: '10000000-0000-4000-8000-000000000002',
  payload: {
    ...job.payload,
    persistence: {
      packageVersionId: 'pkg-1', packageHash: PACKAGE_HASH, analysisRunId: '50000000-0000-4000-8000-000000000001',
      authorizationId: '60000000-0000-4000-8000-000000000001', g1Scope: 'A', policyVersion: 'policy-v1',
    },
  },
};
const synthesisBatch = { phase: 'synthesis', batchIndex: 1, requestHash: 'h' };
const batchMember = [{ memberId: 'batch:0', content: memberOutput, contentHash: 'f'.repeat(64) }];
const stubPackage = () => ({
  version: {
    package_id: '20000000-0000-4000-8000-000000000003', package_hash: PACKAGE_HASH, document_manifest_hash: 'd'.repeat(64),
    semantic_manifest_hash: 'e'.repeat(64), member_count: 1, batch_count: 1, created_at: '2026-08-25T00:00:00Z',
  },
  members: [{ id: '40000000-0000-4000-8000-000000000001', document_version_id: 'doc-1', batch_index: 0, source_classification: 'official', inclusion_reason: 'Pliego', content_hash: 'a'.repeat(64), extraction_text_hash: textHash }],
});

test('invalid synthesis fails closed before checkpoint persistence and names the reason without model content', async () => {
  const configured = runtime({
    loadPackage: async () => stubPackage(),
    bridgeClient: { run: async () => ({ content: JSON.stringify({ claims: [], process_analysis: {}, requirements: [], findings: [], contradictions: [], coverage: [], recommendation: {}, open_items: [], process_deadlines: [] }), usage: { input_tokens: 1, output_tokens: 1 } }) },
    validateEnvelope: () => ({ ok: false, errors: [{ path: 'claims.0.x', code: 'schema.required', secret: 'must not leak' }] }),
  });
  await assert.rejects(
    () => configured.callModel({ job: synthesisJob, batch: synthesisBatch, modelId: 'model-a', members: batchMember }),
    error => error?.code === 'AGT002_ENGINE_MODEL_CALL_FAILED'
      && error.diagnostic.reason === 'synthesis_validation_failed'
      && JSON.stringify(error.diagnostic.validation) === JSON.stringify([{ path: 'claims.0.x', code: 'schema.required' }]),
  );
});

test('synthesis asks the model for analysis only: server identities never travel in the schema or get trusted from the response', async () => {
  let request;
  const configured = runtime({
    loadPackage: async () => stubPackage(),
    bridgeClient: { run: async value => {
      request = value;
      return { content: JSON.stringify({ meta: { analysis_run_id: 'model-invented' }, claims: [], process_analysis: {}, requirements: [], findings: [], contradictions: [], coverage: [], recommendation: {}, open_items: [], process_deadlines: [] }), usage: { input_tokens: 1, output_tokens: 1 } };
    } },
    validateEnvelope: () => ({ ok: true, errors: [] }),
    now: () => new Date('2026-10-05T12:00:00Z'),
  });
  const result = await configured.callModel({ job: synthesisJob, batch: synthesisBatch, modelId: 'model-a', members: batchMember });
  assert.equal('meta' in request.outputSchema.properties, false);
  assert.equal('evidence_package' in request.outputSchema.properties, false);
  assert.deepEqual(request.input.evidence_catalog, [{ document_id: 'doc-1', source_classification: 'official', inclusion_reason: 'Pliego' }]);
  assert.equal(result.output.meta.analysis_run_id, synthesisJob.payload.persistence.analysisRunId);
  assert.equal(result.output.meta.package_hash, PACKAGE_HASH);
});

test('synthesis fails closed when the frozen package does not match the job', async () => {
  const configured = runtime({
    loadPackage: async () => ({ ...stubPackage(), version: { ...stubPackage().version, package_hash: 'd'.repeat(64) } }),
  });
  await assert.rejects(
    () => configured.callModel({ job: synthesisJob, batch: synthesisBatch, modelId: 'model-a', members: batchMember }),
    error => error.diagnostic?.reason === 'package_hash_mismatch',
  );
});

test('with scope A_PLUS_B the synthesis receives the frozen company profile and the aggregate carries its identity', async () => {
  let request;
  const companyJob = { ...synthesisJob, payload: { ...synthesisJob.payload, persistence: { ...synthesisJob.payload.persistence, g1Scope: 'A_PLUS_B', workflowInstanceId: 'wf-1' } } };
  const configured = runtime({
    loadPackage: async () => stubPackage(),
    loadCompanyProfile: async (_db, workflowInstanceId) => {
      assert.equal(workflowInstanceId, 'wf-1');
      return { profileSnapshotId: '70000000-0000-4000-8000-000000000001', profileSnapshotHash: 'e'.repeat(64), snapshot: { profile: { legal_name: 'SN' } } };
    },
    bridgeClient: { run: async value => {
      request = value;
      return { content: JSON.stringify({ claims: [], process_analysis: {}, requirements: [], findings: [], contradictions: [], coverage: [], recommendation: {}, open_items: [], process_deadlines: [], company_fit: { overall_label: 'APTO', requirement_ids: [], limitation_claim_ids: [] } }), usage: { input_tokens: 1, output_tokens: 1 } };
    } },
    validateEnvelope: () => ({ ok: true, errors: [] }),
  });
  const result = await configured.callModel({ job: companyJob, batch: synthesisBatch, modelId: 'model-a', members: batchMember });
  assert.deepEqual(request.input.company_profile, { profile: { legal_name: 'SN' } });
  assert.ok('company_fit' in request.outputSchema.properties);
  assert.match(request.policy, /perfil congelado de la empresa/);
  assert.equal(result.output.company_fit.status, 'EVALUATED');
  assert.equal(result.output.company_fit.profile_snapshot_hash, 'e'.repeat(64));
});

test('an A_PLUS_B synthesis without a verifiable company profile fails closed before calling the model', async () => {
  let called = false;
  const companyJob = { ...synthesisJob, payload: { ...synthesisJob.payload, persistence: { ...synthesisJob.payload.persistence, g1Scope: 'A_PLUS_B', workflowInstanceId: 'wf-1' } } };
  const configured = runtime({
    loadPackage: async () => stubPackage(),
    loadCompanyProfile: async () => { const error = new Error('x'); error.diagnostic = { reason: 'snapshot_content_mismatch' }; throw error; },
    bridgeClient: { run: async () => { called = true; return {}; } },
  });
  await assert.rejects(() => configured.callModel({ job: companyJob, batch: synthesisBatch, modelId: 'model-a', members: batchMember }),
    error => error.diagnostic?.reason === 'snapshot_content_mismatch');
  assert.equal(called, false);
});

import { planAgt002InitialMemberCalls } from '../agt002-initial-analysis-runtime.js';

test('member documents are planned into calls by size: big documents split into ordered parts, nothing truncated', () => {
  const big = Array.from({ length: 30 }, (_, i) => `línea ${i} ${'x'.repeat(90)}`).join('\n');
  const members = [
    { memberId: 'doc-a', content: 'a'.repeat(400) },
    { memberId: 'doc-b', content: big },
    { memberId: 'doc-c', content: 'c'.repeat(300) },
  ];
  const calls = planAgt002InitialMemberCalls(members, 1000);
  assert.ok(calls.every(call => call.reduce((sum, piece) => sum + piece.content.length, 0) <= 1000));
  const parts = calls.flat().filter(piece => piece.member.memberId === 'doc-b');
  assert.ok(parts.length > 1);
  assert.equal(parts.map(piece => piece.content).join(''), big, 'the parts reassemble the whole document');
  assert.deepEqual(parts.map(piece => piece.part), parts.map((_, i) => `${i + 1}/${parts.length}`));
  assert.equal(planAgt002InitialMemberCalls([{ memberId: 'small', content: 'hola' }], 1000).length, 1);
});

test('a member batch that needs several calls merges their notes, renews the lease between calls and meters every call', async () => {
  const requests = [];
  let heartbeats = 0;
  const configured = runtime({
    memberCallMaxChars: 10,
    bridgeClient: { run: async value => {
      requests.push(value);
      const id = value.input.members[0].id;
      return { content: JSON.stringify({ analysis_notes: [{ document_id: id, locator: `parte ${value.input.members[0].metadata.part ?? '-'}`, note: 'n' }], open_items: ['p'] }), usage: { input_tokens: 10, output_tokens: 5 } };
    } },
  });
  const result = await configured.callModel({
    job, batch: memberBatch, modelId: 'model-a',
    members: [{ memberId: 'doc-1', content: 'abcdefghij', contentHash: textHash }, { memberId: 'doc-2', content: 'klmnopqrst', contentHash: textHash }],
    heartbeat: async () => { heartbeats += 1; },
  });
  assert.equal(requests.length, 2);
  assert.equal(heartbeats, 1);
  assert.deepEqual(requests.map(request => request.idempotencyKey), ['job-1:member_batch_analysis:0:h:1/2', 'job-1:member_batch_analysis:0:h:2/2']);
  assert.equal(result.output.analysis_notes.length, 2);
  assert.deepEqual(result.output.open_items, ['p', 'p']);
  assert.deepEqual(result.usage, { inputTokens: 20, outputTokens: 10, totalTokens: 30, costUsd: 0.00008 });
});
