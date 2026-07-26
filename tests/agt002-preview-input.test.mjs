import { strict as assert } from 'node:assert';
import {
  AGT002_MAX_DOCUMENTS,
  AGT002_MAX_DOCUMENT_CHARS,
  AGT002_MAX_TOTAL_DOCUMENT_CHARS,
  buildAgt002PreviewInput,
} from '../agt002-preview-input.js';

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

console.log('AGT-002 preview input minimization and redaction passed');
