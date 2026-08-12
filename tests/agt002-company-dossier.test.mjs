import { strict as assert } from 'node:assert';
import {
  buildAgt002CompanyDossier,
  loadAgt002CompanyDossier,
  AGT002_COMPANY_PROFILE_SELECT,
  AGT002_COMPANY_DOCUMENT_SELECT,
  AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT,
} from '../agt002-company-dossier.js';
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

// --- Baseline (pre-061): no registryEntries at all — behavior must be byte-identical
// to before this hotfix. This is the regression guard for "si no hay entrada canónica,
// conserva comportamiento anterior".
{
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
  assert.notEqual(AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT, '*');
  // P2-2: minimum-exposure defense — the legacy select must never carry sensitive columns
  // (decision_humana, notes, classification, sensibilidad, control_de_uso) even though
  // they exist on the same table.
  for (const sensitiveColumn of ['notes', 'decision_humana', 'classification', 'sensibilidad', 'control_de_uso', 'zona_almacenamiento']) {
    assert.doesNotMatch(AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT, new RegExp(`(^|,)${sensitiveColumn}(,|$)`), `${sensitiveColumn} must never be selected from psi_agt002_company_evidence_registry`);
  }

  const gaps = buildAgt002CompanyDossier({ profile: { updated_at: profile.updated_at }, documents: [] });
  for (const item of Object.values(gaps)) {
    assert.equal(item.status, 'not_verified');
    assert.equal(item.value, null);
  }
}

function licenseRegistryEntry(overrides = {}) {
  return {
    entry_id: 'supervigilancia_operating_license',
    document_class: 'Licencia de funcionamiento SuperVigilancia',
    estado_integracion: 'INTEGRADO_PROVISIONAL_PENDIENTE_REVISION_HUMANA',
    source_reference: 'LICENCIA DE FUNCIONAMIENTO SEGURIDAD NACIONAL (3 copias idénticas)',
    hash: '45d9857f2a128853d53b6e7040dcff9551668b5e4e936dcc4e2c7249dce88255',
    human_gate: 'juridico_y_comercial',
    metadata_only: false,
    vigencia_text: 'Resolución 20214100005697; vigencia observada hasta 2029-05-10',
    expiry: '2029-05-10',
    existence_status: 'reported',
    applicability_status: 'pending_case_validation',
    current: true,
    integration_active: true,
    updated_at: '2026-08-01T22:09:41.000Z',
    created_at: '2026-08-01T22:09:41.000Z',
    ...overrides,
  };
}

function communicationsLicenseRegistryEntry(overrides = {}) {
  return licenseRegistryEntry({
    entry_id: 'communications_license',
    document_class: 'Licencia o permisos de comunicaciones',
    source_reference: 'LICENCIA DE COMUNICACIONES (2 copias idénticas)',
    vigencia_text: 'No determinable del corpus sanitizado; documento de 63 páginas',
    expiry: null,
    metadata_only: true,
    ...overrides,
  });
}

// --- Precedence over stale scalar text: no stored license document, but a canonical
// registry entry exists — it must win over the obsolete profile.supervigilancia_license
// annotation (this is the productive bug: an empty psi_company_procurement_documents plus
// a stale profile.supervigilancia_license used to fabricate a false question).
{
  const entry = licenseRegistryEntry();
  const dossier = buildAgt002CompanyDossier({ profile, documents: [], registryEntries: [entry] });

  assert.equal(dossier.licenses.status, 'reported', 'canonical registry evidence must never be reported as verified/cumplido merely for existing');
  assert.notEqual(dossier.licenses.value, profile.supervigilancia_license, 'the obsolete scalar text must not win when canonical evidence exists');
  assert.match(dossier.licenses.value, /document_class=Licencia de funcionamiento SuperVigilancia/);
  // A resolution number (6-20 digits immediately following "Resolución"/"Resolución No.")
  // is now explicitly exempted from agt002-context-v2.js's shared phone redaction, so it
  // must survive verbatim here instead of being partially masked as [REDACTED_PHONE].
  assert.match(dossier.licenses.value, /vigencia=Resolución 20214100005697; vigencia observada hasta 2029-05-10/);
  assert.doesNotMatch(dossier.licenses.value, /REDACTED_PHONE/);
  assert.match(dossier.licenses.value, /source_reference=LICENCIA DE FUNCIONAMIENTO SEGURIDAD NACIONAL \(3 copias idénticas\)/);
  assert.match(dossier.licenses.value, /estado_integracion=INTEGRADO_PROVISIONAL_PENDIENTE_REVISION_HUMANA/);
  // value stays purely factual text; applicability lives as a structured sibling field,
  // not folded into the string.
  assert.doesNotMatch(dossier.licenses.value, /applicability_status/);
  assert.equal(dossier.licenses.applicability_status, 'pending_case_validation', 'applicability_status must be a structured sibling of status/value/source');
  assert.equal(dossier.licenses.source.type, 'database');
  assert.equal(dossier.licenses.source.reference, 'psi_agt002_company_evidence_registry:supervigilancia_operating_license');
  assert.equal(dossier.licenses.source.expires_at, '2029-05-10T00:00:00.000Z', 'expiry must be conserved from the registry row');
}

// --- The real seed contains both communications_license and the operating license.
// Alphabetical ordering must never let the generic communications permit occupy the
// canonical SuperVigilancia slot.
{
  const dossier = buildAgt002CompanyDossier({
    profile,
    documents: [],
    registryEntries: [communicationsLicenseRegistryEntry(), licenseRegistryEntry()],
  });
  assert.equal(dossier.licenses.source.reference, 'psi_agt002_company_evidence_registry:supervigilancia_operating_license');
  assert.match(dossier.licenses.value, /Resolución 20214100005697/);
  assert.doesNotMatch(dossier.licenses.value, /Licencia o permisos de comunicaciones|No determinable/);
}

// --- Ausencia real: no registry entry and no stale scalar either — the field must
// stay not_verified, never fabricated.
{
  const dossier = buildAgt002CompanyDossier({
    profile: { ...profile, supervigilancia_license: undefined },
    documents: [],
    registryEntries: [],
  });
  assert.equal(dossier.licenses.status, 'not_verified');
  assert.equal(dossier.licenses.value, null);
}

// --- Mix of real stored file + canonical metadata: the canonical registry entry for
// supervigilancia_operating_license ALWAYS wins for `licenses`, even when a stored
// license document also exists (the stored file stays listed separately, in full, in
// recurring_documents — it is not hidden, just no longer the source of `licenses`).
{
  const entry = licenseRegistryEntry();
  const dossier = buildAgt002CompanyDossier({ profile, documents, registryEntries: [entry] });

  assert.notEqual(dossier.licenses.value, profile.supervigilancia_license, 'canonical registry evidence must win even when a stored license document exists');
  assert.match(dossier.licenses.value, /document_class=Licencia de funcionamiento SuperVigilancia/);
  assert.equal(dossier.licenses.status, 'reported');
  assert.equal(dossier.licenses.applicability_status, 'pending_case_validation');
  assert.equal(dossier.licenses.source.reference, 'psi_agt002_company_evidence_registry:supervigilancia_operating_license');
  assert.equal(dossier.licenses.source.expires_at, '2029-05-10T00:00:00.000Z', 'expiry comes from the registry, not the stored document, once the registry wins');

  const stored = dossier.recurring_documents.value.filter(line => line.includes('kind=stored_file'));
  const metadata = dossier.recurring_documents.value.filter(line => line.includes('kind=canonical_metadata'));
  assert.equal(stored.length, 2, 'both current stored documents must still be listed in full, separately from licenses precedence');
  assert.equal(metadata.length, 1, 'the canonical registry entry must be present too, separately tagged');
  assert.match(metadata[0], /evidence_id=company_evidence_registry:supervigilancia_operating_license/);
  assert.match(metadata[0], /applicability_status=pending_case_validation/);
  assert.equal(dossier.recurring_documents.status, 'verified', 'status stays verified because a real stored file is present');
}

// --- Metadata-only recurring_documents (no stored files at all): existence of registry
// entries alone must never push status to verified/cumplido/applicable.
{
  const entry = licenseRegistryEntry();
  const other = licenseRegistryEntry({ entry_id: 'rup', document_class: 'Registro Único de Proponentes (RUP)', expiry: null, vigencia_text: 'Expedido 2026-06-17', applicability_status: 'pending_case_validation' });
  const dossier = buildAgt002CompanyDossier({ profile, documents: [], registryEntries: [entry, other] });

  assert.equal(dossier.recurring_documents.status, 'reported', 'metadata-only entries alone must never be reported as verified');
  assert.equal(dossier.recurring_documents.value.length, 2);
  for (const line of dossier.recurring_documents.value) {
    assert.match(line, /kind=canonical_metadata/);
    assert.doesNotMatch(line, /\bverified\b|\bcumplido\b|applicability_status=applicable\b/);
  }
  assert.equal(dossier.recurring_documents.source.expires_at, '2029-05-10T00:00:00.000Z', 'nearest registry expiry is still surfaced when no stored document has one');
}

// --- A registry entry that is superseded (current=false) or deactivated
// (integration_active=false) must be ignored, defense-in-depth, even if a caller
// forgets to pre-filter (mirrors currentDocuments()'s own re-filtering of documents).
{
  const superseded = licenseRegistryEntry({ current: false });
  const deactivated = licenseRegistryEntry({ integration_active: false });
  const dossier = buildAgt002CompanyDossier({
    profile: { ...profile, supervigilancia_license: undefined },
    documents: [],
    registryEntries: [superseded, deactivated],
  });
  assert.equal(dossier.licenses.status, 'not_verified');
  // evidence() treats an empty array the same as "missing": status not_verified and
  // value null, not an empty array — recurring_documents must follow that same contract.
  assert.equal(dossier.recurring_documents.status, 'not_verified');
  assert.equal(dossier.recurring_documents.value, null);
}

console.log('AGT-002 company dossier normalization passed');

// ---------------------------------------------------------------------------
// loadAgt002CompanyDossier: fail-soft only on table-absent, fail-closed otherwise.
// ---------------------------------------------------------------------------

function makeQuery(rows, error, { single = false } = {}) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    maybeSingle() {
      return Promise.resolve({ data: error ? null : (rows[0] || null), error });
    },
    then(resolve, reject) {
      return Promise.resolve({ data: error ? null : rows, error }).then(resolve, reject);
    },
  };
  return builder;
}

function fakeDatabase({ profileRows = [], documentRows = [], registryRows = [], registryError = null } = {}) {
  return {
    from(table) {
      if (table === 'psi_company_procurement_profile') return makeQuery(profileRows, null);
      if (table === 'psi_company_procurement_documents') return makeQuery(documentRows, null);
      if (table === 'psi_agt002_company_evidence_registry') return makeQuery(registryRows, registryError);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

// Table absent (PostgREST "unknown relation" code): fails soft, dossier still builds
// using only the profile/documents path — this is the state of any environment/rollback
// where 061 has not (yet, or anymore) been applied.
{
  const database = fakeDatabase({ profileRows: [profile], documentRows: documents, registryError: { code: 'PGRST205', message: 'relation not found' } });
  const dossier = await loadAgt002CompanyDossier(database);
  assert.equal(dossier.licenses.value, profile.supervigilancia_license, 'falls back to the pre-061 scalar path when the registry table is absent');
}

// Table absent (raw Postgres code, e.g. a direct pg connection instead of PostgREST):
// same fail-soft behavior.
{
  const database = fakeDatabase({ profileRows: [profile], documentRows: [], registryError: { code: '42P01', message: 'relation does not exist' } });
  const dossier = await loadAgt002CompanyDossier(database);
  assert.equal(dossier.licenses.status, 'reported', 'still resolves using the scalar fallback, not left broken by the missing table');
}

// Any other error code (permissions, connectivity, malformed query, ...) must propagate —
// this must never be silently swallowed as "no evidence".
{
  const database = fakeDatabase({ profileRows: [profile], documentRows: [], registryError: { code: '42501', message: 'permission denied for table psi_agt002_company_evidence_registry' } });
  await assert.rejects(
    () => loadAgt002CompanyDossier(database),
    error => error.code === '42501',
    'a real backend error on the registry table must fail closed, not fail soft',
  );
}

// Happy path: registry present and current/active -> loader wires registryEntries through
// to buildAgt002CompanyDossier, so canonical evidence wins over the stale scalar end to end.
{
  const entry = licenseRegistryEntry();
  const database = fakeDatabase({ profileRows: [profile], documentRows: [], registryRows: [entry] });
  const dossier = await loadAgt002CompanyDossier(database);
  assert.equal(dossier.licenses.status, 'reported');
  assert.equal(dossier.licenses.applicability_status, 'pending_case_validation');
  assert.equal(dossier.licenses.source.reference, 'psi_agt002_company_evidence_registry:supervigilancia_operating_license');
}

console.log('AGT-002 loadAgt002CompanyDossier fail-soft/fail-closed behavior passed');
