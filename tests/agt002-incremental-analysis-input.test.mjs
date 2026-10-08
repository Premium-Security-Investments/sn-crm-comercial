import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgt002StableContentHash } from '../tender-analysis-foundation.js';
import {
  AGT002_INCREMENTAL_DELTA_MANIFEST_VERSION,
  buildAgt002IncrementalAnalysisInput,
  buildAgt002IncrementalDeltaManifest,
  validateAgt002IncrementalDeltaManifest,
} from '../agt002-incremental-analysis-input.js';

const changedText = 'Documento oficial modificado';
const base = {
  opportunityId: 'opportunity-1', tenderId: 'tender-1', changeSetId: 'set-1',
  priorCanonicalRunId: 'run-1', priorContextVersionId: 'context-1', policyVersion: 'r1.v1',
  members: [{
    signal_id: 'signal-1', trigger_kind: 'official_document', source_table: 'psi_tender_document_versions',
    source_type: 'pliego', source_id: 'document-1', source_version: 'version-2',
    content_hash: computeAgt002StableContentHash(changedText), observed_at: '2026-10-08T00:00:00.000Z', actor_profile_id: null,
    source_batch_id: 'batch-1',
  }],
};

test('freezes a deterministic delta-only manifest', () => {
  const left = buildAgt002IncrementalDeltaManifest(base);
  const right = buildAgt002IncrementalDeltaManifest({ ...base, members: [...base.members].reverse() });
  assert.equal(left.schema_version, AGT002_INCREMENTAL_DELTA_MANIFEST_VERSION);
  assert.equal(left.manifest_hash, right.manifest_hash);
  assert.deepEqual(validateAgt002IncrementalDeltaManifest(left), left);
});

test('requires one official source_batch_id and rejects hash drift', () => {
  assert.throws(() => buildAgt002IncrementalDeltaManifest({ ...base, members: [{ ...base.members[0], source_batch_id: null }] }), /source_batch_id/);
  const manifest = buildAgt002IncrementalDeltaManifest(base);
  assert.throws(() => validateAgt002IncrementalDeltaManifest({ ...manifest, manifest_hash: '0'.repeat(64) }), /identidad/);
});

test('builds input only from changed evidence and mechanically carries unaffected findings', () => {
  const manifest = buildAgt002IncrementalDeltaManifest({ ...base, affectedFindingRefs: ['finding-2'] });
  const input = buildAgt002IncrementalAnalysisInput({
    manifest,
    changedEvidence: [{ signal_id: 'signal-1', name: 'Adenda', text: changedText }],
    priorFindings: [{ finding_ref: 'finding-1', value: 'unchanged' }, { finding_ref: 'finding-2', value: 're-evaluate' }],
    snapshotId: 'snapshot-2',
  });
  assert.equal(input.analysisDocuments.length, 1);
  assert.equal(input.analysisDocuments[0].extracted_text, changedText);
  assert.equal(input.analysisDocuments[0].snapshot_id, 'snapshot-2');
  assert.deepEqual(Object.keys(input.analysisDocuments[0]).sort(), [
    'content_hash', 'current', 'document_id', 'document_type', 'document_version_id',
    'extracted_text', 'name', 'opportunity_id', 'snapshot_id', 'version',
  ].sort());
  assert.deepEqual(input.deepAnalysis.unaffected_finding_refs, ['finding-1']);
  assert.deepEqual(input.deepAnalysis.affected_findings, [{ finding_ref: 'finding-2', value: 're-evaluate' }]);
  assert.equal(JSON.stringify(input).includes('all_current_documents'), false);
});

test('rejects content that does not match the frozen changed member', () => {
  const manifest = buildAgt002IncrementalDeltaManifest(base);
  assert.throws(() => buildAgt002IncrementalAnalysisInput({
    manifest,
    changedEvidence: [{ signal_id: 'signal-1', name: 'Adenda', text: 'other' }],
    priorFindings: [],
    snapshotId: 'snapshot-2',
  }), /no coincide/);
});

test('accepts an INITIAL predecessor without a legacy context id', () => {
  const manifest = buildAgt002IncrementalDeltaManifest({ ...base, priorContextVersionId: null });
  assert.equal(manifest.prior_context_version_id, null);
  assert.deepEqual(validateAgt002IncrementalDeltaManifest(manifest), manifest);
});
