import { strict as assert } from 'node:assert';
import {
  AGT002_MAX_DOCUMENTS,
  AGT002_MAX_DOCUMENT_CHARS,
  AGT002_MAX_TOTAL_DOCUMENT_CHARS,
  buildAgt002PreviewInput,
} from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

const longText = 'A'.repeat(4000);
const documents = Array.from({ length: 13 }, (_, index) => ({
  id: `doc-${String(index + 1).padStart(2, '0')}`,
  name: index === 0 ? 'Pliego contacto juan@example.com.pdf' : `Documento ${index + 1}.pdf`,
  document_type: index % 2 ? 'anexo_tecnico' : 'pliego',
  extracted_text: index === 0
    ? `Contacto: juan@example.com, teléfono +57 300 123 4567, cédula 1.234.567.890. Authorization: Bearer super-secret-token. ${longText}`
    : `${longText}${index}`,
  storage_path: `private/${index}/secret.pdf`,
  source_url: `https://example.test/file?token=signed-secret-${index}`,
}));
const original = structuredClone(documents);
const deepAnalysis = {
  version: '1.0',
  matrix: {
    legal: [{ id: 'legal', evidence: [{ document_id: 'doc-01', excerpt: 'juan@example.com exige póliza.' }] }],
    financial: [],
    technical: [],
  },
  coverage: { total: 1, confirmed: 0 },
  blockers: ['Validar cédula 1.234.567.890'],
  questions: [],
  unverified: [],
  strengths: [],
  weaknesses: [],
  unverifiable_documents: [],
  next_action: 'Contactar +57 300 123 4567',
};
const companyProfile = {
  working_capital: 600000000,
  guarantee_capacity_pct: 20,
  rup_expires_at: '2026-12-31',
  microsoft_email: 'directora@example.com',
  private_notes: 'Bearer profile-secret',
  storage_path: 'company/private/rup.pdf',
};

const input = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia', source_url: 'https://secret.test?token=x' },
  documents,
  companyProfile,
  deepAnalysis,
  snapshotId: 'snapshot-1',
});

assert.equal(AGT002_MAX_DOCUMENTS, 12);
assert.equal(AGT002_MAX_DOCUMENT_CHARS, 3000);
assert.equal(AGT002_MAX_TOTAL_DOCUMENT_CHARS, 36000);
assert.equal(input.snapshot_id, 'snapshot-1');
assert.equal(input.documents.length, 12);
assert.deepEqual(input.documents.map(document => document.document_id), documents.slice(0, 12).map(document => document.id));
assert.ok(input.documents.every(document => document.excerpt.length <= AGT002_MAX_DOCUMENT_CHARS));
assert.ok(input.documents.reduce((sum, document) => sum + document.excerpt.length, 0) <= AGT002_MAX_TOTAL_DOCUMENT_CHARS);
assert.ok(input.documents.every(document => document.trust === 'untrusted_document_excerpt'));
assert.ok(input.documents.every(document => document.evidence_id === `document:${document.document_id}`));

assert.deepEqual(input.company_profile, {
  working_capital: 600000000,
  guarantee_capacity_pct: 20,
  rup_expires_at: '2026-12-31',
});
assert.deepEqual(input.opportunity, { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' });
assert.ok(!Object.hasOwn(input, 'storage_path'));

const serialized = JSON.stringify(input);
for (const secret of [
  'juan@example.com', 'directora@example.com', '+57 300 123 4567', '1.234.567.890',
  'super-secret-token', 'profile-secret', 'signed-secret', 'private/0/secret.pdf', 'company/private/rup.pdf',
]) {
  assert.ok(!serialized.includes(secret), `input must redact or exclude ${secret}`);
}
assert.match(serialized, /\[REDACTED_EMAIL\]/);
assert.match(serialized, /\[REDACTED_PHONE\]/);
assert.match(serialized, /\[REDACTED_ID\]/);
assert.match(serialized, /\[REDACTED_SECRET\]/);
assert.deepEqual(documents, original, 'input preparation must not mutate source documents');

const reversed = buildAgt002PreviewInput({
  opportunity: { title: 'Vigilancia', company_name: 'Entidad de prueba', id: 'opp-1' },
  documents: [...documents].reverse(),
  companyProfile: { rup_expires_at: '2026-12-31', guarantee_capacity_pct: 20, working_capital: 600000000 },
  deepAnalysis,
  snapshotId: 'snapshot-1',
});
assert.deepEqual(reversed, input, 'input must be deterministic across document and object key order');

assert.throws(
  () => buildAgt002PreviewInput({ opportunity: {}, documents: [{ name: 'sin-id' }], companyProfile: {}, deepAnalysis: {}, snapshotId: 'snapshot-1' }),
  /identificador estable/i,
);
assert.throws(
  () => buildAgt002PreviewInput({ opportunity: {}, documents: [], companyProfile: {}, deepAnalysis: {}, snapshotId: '' }),
  /snapshot/i,
);

// --- AGT002_CONTEXT_V2: structured opportunity/company context replaces the partial
// opportunity object and misaligned company fields, behind an explicit flag; the v1 path
// above stays byte-for-byte the same for rollback until production verification. ---

const contextV2Sections = {
  ...buildAgt002OpportunityContextV2({
    opportunity: { id: 'opp-1', owner_id: 'owner-1', owner_name: 'Ana', updated_at: '2026-07-29T10:00:00.000Z' },
    tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', source: 'SECOP II', updated_at: '2026-07-29T10:00:00.000Z' },
  }),
  company_dossier: buildAgt002CompanyDossier({
    profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-07-29T10:00:00.000Z' },
    documents: [],
  }),
};

const v2Input = buildAgt002PreviewInput({
  documents,
  deepAnalysis,
  snapshotId: 'snapshot-1',
  contextV2: true,
  contextV2Sections,
});

assert.equal(v2Input.context_version, 2);
assert.deepEqual(v2Input.opportunity, contextV2Sections.opportunity);
assert.deepEqual(v2Input.company_dossier, contextV2Sections.company_dossier);
assert.deepEqual(v2Input.commercial_context, contextV2Sections.commercial_context);
assert.deepEqual(v2Input.human_evidence, []);
assert.ok(Object.hasOwn(v2Input, 'objective_validations'), 'context v2 always carries deterministic objective validations');
assert.equal(Object.hasOwn(v2Input, 'deep_analysis'), false, 'context v2 never carries the legacy deep_analysis/recommendation blob');
assert.equal(Object.hasOwn(v2Input, 'company_profile'), false, 'context v2 replaces the legacy misaligned company_profile fields');
assert.equal(v2Input.documents.length, documents.length > AGT002_MAX_DOCUMENTS ? AGT002_MAX_DOCUMENTS : documents.length);

// Even when canonicalOnly is explicitly false, context v2 still forces objective_validations
// over deep_analysis — the two flags are independent and v2 always wins on this choice.
const v2WithCanonicalOnlyFalse = buildAgt002PreviewInput({
  documents, deepAnalysis, snapshotId: 'snapshot-1', canonicalOnly: false, contextV2: true, contextV2Sections,
});
assert.equal(Object.hasOwn(v2WithCanonicalOnlyFalse, 'deep_analysis'), false);

// Flag off (default false) must reproduce the exact v1 shape even when contextV2Sections is supplied,
// so a caller that always loads context v2 sections cannot accidentally leak it without the flag.
const v1WithSectionsIgnored = buildAgt002PreviewInput({
  opportunity: { id: 'opp-1', company_name: 'Entidad de prueba', title: 'Vigilancia' },
  documents, companyProfile: {}, deepAnalysis, snapshotId: 'snapshot-1', contextV2Sections,
});
assert.equal(Object.hasOwn(v1WithSectionsIgnored, 'context_version'), false);
assert.equal(Object.hasOwn(v1WithSectionsIgnored, 'company_dossier'), false);

// Fail-closed: requesting context v2 without valid sections must throw rather than silently
// degrade to an incomplete or empty structured context.
assert.throws(
  () => buildAgt002PreviewInput({ documents, deepAnalysis, snapshotId: 'snapshot-1', contextV2: true }),
  /context.*v2|contexto/i,
);
assert.throws(
  () => buildAgt002PreviewInput({ documents, deepAnalysis, snapshotId: 'snapshot-1', contextV2: true, contextV2Sections: { opportunity: contextV2Sections.opportunity } }),
  /context.*v2|contexto/i,
);

console.log('AGT-002 preview input minimization and redaction passed');
