import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgt002StableContentHash } from '../tender-analysis-foundation.js';
import { ingestAgt002HumanResponseSignal, ingestAgt002OfficialDocumentBatchSignals } from '../agt002-incremental-source-ingestion.js';

const profile = { id: 'profile-1', identity_type: 'human', active: true, role: 'admin', permissions: ['licitaciones', 'licitaciones_custodia'], areas: [] };

function pendingDb(observe) {
  return { rpc: async (name, args) => {
    observe(name, args);
    return { data: { status: 'pending_validation', signal_ids: ['signal-1'] }, error: null };
  } };
}

test('an authorized human answer enters as trusted with attachment hashes but no signed URL', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  await ingestAgt002HumanResponseSignal(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', profile,
    response: { id: 'answer-1', question_id: 'q1', question_text: 'Pregunta', status: 'resolved', response: 'Respuesta', responded_at: '2026-10-08T00:00:00.000Z' },
    attachmentEvidence: [{ name: 'soporte.pdf', mime_type: 'application/pdf', size_bytes: 10, content_hash: 'a'.repeat(64), signed_url: 'secret-url' }],
    ensureOpportunityAccess: async () => ({ id: 'opportunity-1' }),
  });
  assert.equal(args.p_signals[0].trust_class, 'trusted');
  assert.match(args.p_signals[0].content_hash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(args).includes('secret-url'), false);
});

test('a human without analysis custody is preserved pending validation and creates no job', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  const result = await ingestAgt002HumanResponseSignal(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', profile: { ...profile, permissions: ['licitaciones'] },
    response: { id: 'answer-2', question_id: 'q2', status: 'open', response: 'Dato', responded_at: '2026-10-08T00:00:00.000Z' },
    ensureOpportunityAccess: async () => ({ id: 'opportunity-1' }),
  });
  assert.equal(args.p_signals[0].trust_class, 'pending_validation');
  assert.equal(result.dispatch_required, false);
});

test('one official batch admits only successful changed versions, once', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  const textHash = computeAgt002StableContentHash('texto');
  await ingestAgt002OfficialDocumentBatchSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', observedAt: '2026-10-08T00:00:00.000Z',
    refreshResults: [
      { status: 'new', source_batch_id: 'batch-1', source_document_id: 'doc-1', document_type: 'pliego', analysis_content_hash: textHash, version: { id: 'v1' } },
      { status: 'unchanged', source_batch_id: 'batch-1', source_document_id: 'doc-2' },
      { status: 'failed', source_batch_id: 'batch-1', source_document_id: 'doc-3' },
    ],
  });
  assert.equal(args.p_source_batch_id, 'batch-1');
  assert.equal(args.p_signals.length, 1);
  assert.equal(args.p_signals[0].source_id, 'doc-1');
  assert.equal(args.p_signals[0].content_hash, textHash);
});
