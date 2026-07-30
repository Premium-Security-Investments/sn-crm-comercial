import { strict as assert } from 'node:assert';
import {
  validateAgt002WorkbenchContinuityReference,
  buildAgt002WorkbenchContinuityReference,
} from '../agt002-tender-adapter.js';
import { buildSyntheticAgt002TenderAnalysis } from './fixtures/agt002-synthetic-responder.mjs';

const snapshot = {
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
  tender_id: '33333333-3333-4333-8333-333333333333',
  document_hash: 'a'.repeat(64),
  profile_hash: 'b'.repeat(64),
  documents: [{
    document_id: 'doc-001',
    name: 'Pliego de condiciones',
    document_type: 'pliego',
    content: 'Contenido extraído del pliego.',
    content_sha256: 'c'.repeat(64),
    current: true,
  }],
  company_profile: {
    profile_version: 'rup-2026-07',
    fields: [{ key: 'annual_revenue', label: 'Ingresos anuales', value: '500000000', source: 'RUP' }],
  },
};

const envelope = buildSyntheticAgt002TenderAnalysis(snapshot);
const contextVersionId = '44444444-4444-4444-8444-444444444444';
const legalCorpusVersionId = '55555555-5555-4555-8555-555555555555';

function baseRefs(overrides = {}) {
  return {
    opportunity_id: snapshot.opportunity_id,
    tender_id: snapshot.tender_id,
    context_version_id: contextVersionId,
    legal_corpus_version_id: legalCorpusVersionId,
    evidence_coverage: { material_omissions: false, omitted_count: 0 },
    ...overrides,
  };
}

const reference = buildAgt002WorkbenchContinuityReference(envelope, baseRefs());

// GO transition must retain: opportunity, snapshot, canonical analysis run,
// context version, evidence coverage, corpus version, open questions.
assert.equal(reference.opportunity_id, snapshot.opportunity_id);
assert.equal(reference.tender_id, snapshot.tender_id);
assert.equal(reference.snapshot_id, envelope.snapshot_id);
assert.equal(reference.canonical_run_id, envelope.run_id);
assert.equal(reference.context_version_id, contextVersionId);
assert.equal(reference.legal_corpus_version_id, legalCorpusVersionId);
assert.deepEqual(reference.evidence_coverage, { material_omissions: false, omitted_count: 0 });
assert.deepEqual(reference.open_questions, envelope.questions);
assert.equal(validateAgt002WorkbenchContinuityReference(reference), reference);

// Pre-GO context versions and legal corpus are optional (not every opportunity has them yet).
const withoutOptionalVersions = buildAgt002WorkbenchContinuityReference(envelope, baseRefs({
  context_version_id: null, legal_corpus_version_id: null,
}));
assert.equal(withoutOptionalVersions.context_version_id, null);
assert.equal(withoutOptionalVersions.legal_corpus_version_id, null);

// Closed allowlist: no unexpected keys, no raw document/chunk text smuggled in.
assert.throws(() => validateAgt002WorkbenchContinuityReference({ ...reference, extra_field: true }), /cerrada/i);
assert.throws(() => validateAgt002WorkbenchContinuityReference({ ...reference, canonical_run_id: 'not-a-uuid' }), /UUID/);
assert.throws(() => validateAgt002WorkbenchContinuityReference({ ...reference, snapshot_id: 'not-a-uuid' }), /UUID/);
assert.throws(
  () => validateAgt002WorkbenchContinuityReference({ ...reference, evidence_coverage: { ...reference.evidence_coverage, omitted_chunks_text: 'raw chunk text' } }),
  /cobertura/i,
);
assert.throws(
  () => validateAgt002WorkbenchContinuityReference({
    ...reference,
    open_questions: [{ id: 'q1', text: 'x', critical: false, evidence_refs: [], raw_document_text: 'nope' }],
  }),
  /hallazgos cerrados/i,
);

// Never copies raw document content: the reference never carries a `content` field anywhere.
assert.equal(JSON.stringify(reference).includes('"content"'), false);

console.log('AGT-002 workbench continuity reference contract passed');
