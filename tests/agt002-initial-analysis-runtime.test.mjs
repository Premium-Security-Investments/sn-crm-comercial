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

test('member model call is idempotently bound and meters tokens plus deterministic USD cost', async () => {
  let request;
  const result = await runtime({ bridgeClient: { run: async value => {
    request = value;
    return { content: JSON.stringify({ analysis_notes: ['x'], open_items: [] }), usage: { input_tokens: 10, output_tokens: 5 } };
  } } }).callModel({ job, batch: { phase: 'member_batch_analysis', batchIndex: 0, requestHash: 'h' }, modelId: 'model-a', members: [] });
  assert.equal(request.idempotencyKey, 'job-1:member_batch_analysis:0:h');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.00004 });
  assert.equal(result.outputSha256, hashAgt002InitialAnalysisOutput(result.output));
});

test('invalid synthesis fails closed before checkpoint persistence', async () => {
  const configured = runtime({
    bridgeClient: { run: async () => ({ content: '{}', usage: { input_tokens: 1, output_tokens: 1 } }) },
    validateEnvelope: () => ({ ok: false, errors: [{ code: 'schema.required' }] }),
  });
  await assert.rejects(
    () => configured.callModel({ job, batch: { phase: 'synthesis', batchIndex: 1, requestHash: 'h' }, modelId: 'model-a', members: [] }),
    error => error?.code === 'AGT002_ENGINE_MODEL_CALL_FAILED',
  );
});
