import { strict as assert } from 'node:assert';
import { buildAgt002WorkbenchContinuityReference } from '../agt002-tender-adapter.js';
import { buildAgt002WorkbenchContinuityContext } from '../agt002-workbench-context.js';
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

const reference = buildAgt002WorkbenchContinuityReference(envelope, {
  opportunity_id: snapshot.opportunity_id,
  tender_id: snapshot.tender_id,
  context_version_id: contextVersionId,
  legal_corpus_version_id: legalCorpusVersionId,
  evidence_coverage: { material_omissions: true, omitted_count: 3 },
});

const context = buildAgt002WorkbenchContinuityContext(reference);

// Carries the same case context into the Mesa: opportunity, snapshot, canonical run,
// context version, evidence coverage, corpus version, open questions — all by reference.
assert.equal(context.opportunity_id, snapshot.opportunity_id);
assert.equal(context.tender_id, snapshot.tender_id);
assert.equal(context.snapshot_id, envelope.snapshot_id);
assert.equal(context.canonical_run_id, envelope.run_id);
assert.equal(context.context_version_id, contextVersionId);
assert.equal(context.legal_corpus_version_id, legalCorpusVersionId);
assert.deepEqual(context.evidence_coverage, { material_omissions: true, omitted_count: 3 });
assert.deepEqual(context.open_questions, [{ id: 'q-docs', text: 'Validar evidencia documental.', critical: true }]);

// Dossier links reuse the existing psi_agt002_workbench_message_links shape
// (link_kind, resource_id, label, source_ref) — references only, never raw content.
const snapshotLink = context.dossier_links.find(item => item.link_kind === 'snapshot');
assert.ok(snapshotLink, 'debe referenciar el snapshot documental');
assert.equal(snapshotLink.resource_id, envelope.snapshot_id);
assert.equal(snapshotLink.source_ref, `psi_tender_document_snapshots:${envelope.snapshot_id}`);

const runLink = context.dossier_links.find(item => item.link_kind === 'source' && item.resource_id === envelope.run_id);
assert.ok(runLink, 'debe referenciar la ejecución canónica de análisis como fuente, no como artefacto documental');

const contextVersionLink = context.dossier_links.find(item => item.resource_id === contextVersionId);
assert.ok(contextVersionLink, 'debe referenciar la versión de contexto');
assert.equal(contextVersionLink.link_kind, 'source');

const corpusLink = context.dossier_links.find(item => item.resource_id === legalCorpusVersionId);
assert.ok(corpusLink, 'debe referenciar la versión del corpus jurídico');
assert.equal(corpusLink.link_kind, 'source');

for (const link of context.dossier_links) {
  assert.equal(typeof link.resource_id, 'string');
  assert.equal(typeof link.label, 'string');
  assert.ok(link.label.length > 0);
  assert.equal(typeof link.source_ref, 'string');
  assert.ok(link.source_ref.length > 0);
}

// Optional versions omitted from links when absent (no fabricated references).
const withoutOptional = buildAgt002WorkbenchContinuityContext(buildAgt002WorkbenchContinuityReference(envelope, {
  opportunity_id: snapshot.opportunity_id,
  tender_id: snapshot.tender_id,
  context_version_id: null,
  legal_corpus_version_id: null,
  evidence_coverage: { material_omissions: false, omitted_count: 0 },
}));
assert.equal(withoutOptional.dossier_links.filter(item => item.link_kind === 'source').length, 1);
assert.equal(withoutOptional.dossier_links[1].resource_id, envelope.run_id);
assert.equal(withoutOptional.dossier_links.length, 2);

// Never carries raw document/chunk text.
assert.equal(JSON.stringify(context).includes('"content"'), false);
assert.equal(JSON.stringify(context).includes('Contenido extraído del pliego'), false);

// An invalid reference is rejected before any Mesa context is built.
assert.throws(() => buildAgt002WorkbenchContinuityContext({ ...reference, canonical_run_id: 'not-a-uuid' }), /UUID/);

console.log('AGT-002 workbench continuity context passed');
