import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgt002StableContentHash } from '../tender-analysis-foundation.js';
import {
  buildAgt002ActionableReviewSignalContent,
  buildAgt002CompanyEvidenceLinkSignalContent,
  ingestAgt002AuthorizedHumanSignals,
  ingestAgt002HumanResponseSignal,
  ingestAgt002OfficialDocumentBatchSignals,
} from '../agt002-incremental-source-ingestion.js';

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

test('generic authorized human evidence uses the same trusted authority gate', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  await ingestAgt002AuthorizedHumanSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', profile,
    sourceTransactionId: 'review:event-1', ensureOpportunityAccess: async () => ({ id: 'opportunity-1' }),
    signalInputs: [{
      triggerKind: 'actionable_review', sourceTable: 'psi_tender_actionable_review_events',
      sourceType: 'commented', sourceId: 'event-1', sourceVersion: 'event-1:1',
      content: '{"note":"Revisar póliza"}', observedAt: '2026-10-08T00:00:00.000Z',
    }],
  });
  assert.equal(args.p_requested_by, profile.id);
  assert.equal(args.p_signals[0].trust_class, 'trusted');
  assert.equal(args.p_signals[0].actor_profile_id, profile.id);
});

test('actionable review evidence excludes workflow labels and keeps only authored text', () => {
  const content = buildAgt002ActionableReviewSignalContent({
    review_item_id: 'review-1', sequence: 2, event_type: 'resolved', outcome: 'approved',
    reusable_requested: true, note: 'La póliza sí cubre el plazo.', created_at: '2026-10-08T00:00:00.000Z',
  });
  const parsed = JSON.parse(content);
  assert.equal(parsed.text, 'La póliza sí cubre el plazo.');
  assert.equal('outcome' in parsed, false);
  assert.equal('event_type' in parsed, false);
  assert.equal('reusable_requested' in parsed, false);
});

test('company evidence link uses a restricted immutable-version projection', () => {
  const content = buildAgt002CompanyEvidenceLinkSignalContent({
    entry_id: 'rup', version: 2, document_class: 'RUP', classification: 'corporativa',
    existence_status: 'reported', human_review_status: 'pending_human_review',
    applicability_status: 'pending_case_validation', vigencia_text: 'Revalidar', expiry: null,
    utilidad_decisional: 'Evaluar capacidad', control_de_uso: 'Uso interno',
    allowed_use: { internal_decision_support: true, external_submission_authority: false, automatic_final_approval: false },
    metadata_only: true, vigente_para_habilitacion: false,
    source_reference: 'private path', notes: 'private note', hash: 'a'.repeat(64),
  });
  assert.equal(content.includes('private path'), false);
  assert.equal(content.includes('private note'), false);
  assert.equal(content.includes('a'.repeat(64)), false);
  assert.equal(JSON.parse(content).applicability_status, 'pending_case_validation');
});

test('generic human evidence without analysis custody is ledgered pending and never requests dispatch', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  const result = await ingestAgt002AuthorizedHumanSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1',
    profile: { ...profile, permissions: ['licitaciones'] },
    sourceTransactionId: 'upload:interaction-1', ensureOpportunityAccess: async () => ({ id: 'opportunity-1' }),
    signalInputs: [{
      triggerKind: 'human_document', sourceTable: 'psi_sales_interactions', sourceType: 'anexo',
      sourceId: 'document-1', sourceVersion: 'interaction-1:document-1', content: 'contenido',
      observedAt: '2026-10-08T00:00:00.000Z',
    }],
  });
  assert.equal(args.p_signals[0].trust_class, 'pending_validation');
  assert.equal(result.dispatch_required, false);
  assert.equal(result.manifest, null);
});

test('one official batch admits only successful changed versions, once', async () => {
  let args;
  const database = pendingDb((_name, observed) => { args = observed; });
  const textHash = computeAgt002StableContentHash('texto');
  await ingestAgt002OfficialDocumentBatchSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', actorProfileId: profile.id, observedAt: '2026-10-08T00:00:00.000Z',
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
