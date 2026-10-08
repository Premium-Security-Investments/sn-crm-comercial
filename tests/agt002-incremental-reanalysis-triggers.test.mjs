import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgt002IncrementalSignal, recordAgt002IncrementalSignals } from '../agt002-incremental-reanalysis-triggers.js';

test('builds a content-bound trusted signal without retaining content', () => {
  const signal = buildAgt002IncrementalSignal({
    triggerKind: 'human_interaction', trustClass: 'trusted', sourceTable: 'psi_tender_question_responses',
    sourceType: 'answer', sourceId: 'answer-1', sourceVersion: 'v1', content: 'respuesta',
    observedAt: '2026-10-08T00:00:00.000Z', actorProfileId: 'profile-1',
  });
  assert.match(signal.content_hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(signal, 'content'), false);
});

test('uncertain evidence remains pending and does not build a manifest', async () => {
  const database = { rpc: async () => ({ data: { status: 'pending_validation', signal_ids: ['signal-1'] }, error: null }) };
  const result = await recordAgt002IncrementalSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', sourceTransactionId: 'tx-1',
    signals: [{ trust_class: 'pending_validation' }],
  });
  assert.deepEqual(result, { status: 'pending_validation', signal_ids: ['signal-1'] });
});

test('sealed server result must reproduce the exact manifest hash', async () => {
  const database = { rpc: async () => ({ data: {
    status: 'sealed', change_set_id: 'set-1', prior_canonical_run_id: 'run-1', prior_context_version_id: 'context-1',
    policy_version: 'r1.v1', manifest_hash: '0'.repeat(64), affected_finding_refs: [], comparison_excerpts: [],
    members: [{ signal_id: 'signal-1', trigger_kind: 'human_interaction', source_table: 'answers', source_type: 'answer', source_id: 'answer-1', source_version: 'v1', content_hash: 'a'.repeat(64), observed_at: '2026-10-08T00:00:00.000Z', actor_profile_id: 'profile-1', source_batch_id: null }],
  }, error: null }) };
  await assert.rejects(() => recordAgt002IncrementalSignals(database, {
    opportunityId: 'opportunity-1', tenderId: 'tender-1', sourceTransactionId: 'tx-1',
    signals: [{ trust_class: 'trusted' }],
  }), /hash server-side/);
});
