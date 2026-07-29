import { strict as assert } from 'node:assert';
import { buildAgt002CompanyDossier, AGT002_COMPANY_PROFILE_SELECT, AGT002_COMPANY_DOCUMENT_SELECT } from '../agt002-company-dossier.js';
import { AGT002_CONTEXT_V2_FIELDS } from '../agt002-context-v2.js';

const profile = {
  legal_name: 'Seguridad Nacional Ltda.',
  nit: 'NIT 900123456-7',
  rup_status: 'Vigente y en firme',
  rup_updated_at: '2026-06-01',
  rup_unspsc_codes: '92121504\n92121701',
  authorized_services: 'Vigilancia fija y móvil',
  supervigilancia_license: 'Resolución 1234 de 2026',
  financial_capacity: 'Índice de liquidez 2.1',
  organizational_capacity: 'Rentabilidad patrimonio 0.18',
  experience_summary: 'Contratos de vigilancia privada',
  certifications: 'ISO 9001; ISO 45001',
  recurring_documents: 'RUP; licencia; pólizas',
  disqualifications_notes: 'Validar sanciones vigentes antes de presentar.',
  source_document_name: 'RUP_SN_2026.pdf',
  updated_at: '2026-07-29T16:00:00.000Z',
  invented_legacy_field: 'must-not-leak',
};
const documents = [
  {
    id: '11111111-1111-4111-8111-111111111111', document_type: 'rup', display_name: 'RUP 2026',
    issued_at: '2026-06-01', expires_at: '2027-04-30', version: 2, content_hash: 'a'.repeat(64),
    current: true, updated_at: '2026-07-29T16:30:00.000Z', ignored_storage_path: 'secret/path',
  },
  {
    id: '22222222-2222-4222-8222-222222222222', document_type: 'licencia_supervigilancia', display_name: 'Licencia vigente',
    issued_at: '2026-01-01', expires_at: '2028-01-01', version: 1, content_hash: 'b'.repeat(64),
    current: true, updated_at: '2026-07-29T16:31:00.000Z',
  },
  {
    id: 'old', document_type: 'rup', display_name: 'RUP anterior', issued_at: '2025-01-01', expires_at: '2026-01-01',
    version: 1, content_hash: 'c'.repeat(64), current: false, updated_at: '2025-01-01T00:00:00.000Z',
  },
];

const dossier = buildAgt002CompanyDossier({ profile, documents });
assert.deepEqual(Object.keys(dossier), AGT002_CONTEXT_V2_FIELDS.company_dossier);
assert.equal(dossier.legal_name.value, 'Seguridad Nacional Ltda.');
assert.equal(dossier.rup_status.value, 'Vigente y en firme');
assert.deepEqual(dossier.unspsc_codes.value, ['92121504', '92121701']);
assert.equal(dossier.services.value, 'Vigilancia fija y móvil');
assert.equal(dossier.licenses.value, 'Resolución 1234 de 2026');
assert.equal(dossier.experience.value, 'Contratos de vigilancia privada');
assert.equal(dossier.restrictions.value, 'Validar sanciones vigentes antes de presentar.');
assert.equal(dossier.recurring_documents.value.length, 2, 'only current registered evidence is included');
assert.match(dossier.recurring_documents.value[0], /evidence_id=company_document:/);
assert.equal(dossier.rup_status.source.expires_at, '2027-04-30T00:00:00.000Z');
assert.equal(dossier.licenses.source.expires_at, '2028-01-01T00:00:00.000Z');
assert.doesNotMatch(JSON.stringify(dossier), /invented_legacy_field|ignored_storage_path|secret\/path|RUP anterior/);
assert.notEqual(AGT002_COMPANY_PROFILE_SELECT, '*');
assert.notEqual(AGT002_COMPANY_DOCUMENT_SELECT, '*');

const gaps = buildAgt002CompanyDossier({ profile: { updated_at: profile.updated_at }, documents: [] });
for (const item of Object.values(gaps)) {
  assert.equal(item.status, 'not_verified');
  assert.equal(item.value, null);
}

console.log('AGT-002 company dossier normalization passed');
