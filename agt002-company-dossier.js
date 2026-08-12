import { AGT002_CONTEXT_V2_FIELDS, buildAgt002ContextV2 } from './agt002-context-v2.js';
import { assertAgt002CompanyEvidenceRegistryMinimalExposureSelect } from './agt002-company-evidence-classes.js';

export const AGT002_COMPANY_PROFILE_SELECT = 'id,legal_name,nit,rup_status,rup_updated_at,rup_unspsc_codes,authorized_services,supervigilancia_license,financial_capacity,organizational_capacity,experience_summary,certifications,recurring_documents,disqualifications_notes,source_document_name,updated_at,created_at';
export const AGT002_COMPANY_DOCUMENT_SELECT = 'id,document_type,display_name,issued_at,expires_at,version,content_hash,current,updated_at,created_at';
// P2-2: this legacy select reads the same psi_agt002_company_evidence_registry (061) as
// agt002-company-evidence-classes.js's own typed select, so it is guarded by the same
// minimum-exposure allowlist check — never select(*), never a column beyond this exact,
// unchanged list. Canonical, metadata-only: no storage_path/signed URL exists on this
// table, only metadata + provenance.
const AGT002_COMPANY_EVIDENCE_REGISTRY_LEGACY_ALLOWED_COLUMNS = Object.freeze([
  'entry_id', 'document_class', 'estado_integracion', 'source_reference', 'hash', 'human_gate',
  'metadata_only', 'vigencia_text', 'expiry', 'existence_status', 'applicability_status',
  'current', 'integration_active', 'updated_at', 'created_at',
]);
export const AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT = assertAgt002CompanyEvidenceRegistryMinimalExposureSelect(
  'entry_id,document_class,estado_integracion,source_reference,hash,human_gate,metadata_only,vigencia_text,expiry,existence_status,applicability_status,current,integration_active,updated_at,created_at',
  AGT002_COMPANY_EVIDENCE_REGISTRY_LEGACY_ALLOWED_COLUMNS,
);

// PostgREST/Postgres codes meaning "the table itself does not exist" — the only
// condition under which a query against an optional table is allowed to fail soft.
const TABLE_ABSENT_ERROR_CODES = ['PGRST205', '42P01'];

const EPOCH = '1970-01-01T00:00:00.000Z';

function timestamp(value, fallback = EPOCH) {
  const parsed = new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function expiry(value) {
  if (!value) return undefined;
  return timestamp(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

function source(reference, record, { expiresAt, label } = {}) {
  const result = {
    type: 'database',
    reference,
    observed_at: timestamp(record?.updated_at || record?.created_at),
  };
  if (label) result.label = label;
  if (expiresAt) result.expires_at = expiry(expiresAt);
  return result;
}

function evidence(value, reference, record, options = {}) {
  const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  return {
    status: missing ? 'not_verified' : (options.status || 'reported'),
    value: missing ? null : value,
    source: missing
      ? { type: 'system', reference: `missing:${reference}`, observed_at: timestamp(record?.updated_at || record?.created_at) }
      : source(reference, record, options),
  };
}

function currentDocuments(documents) {
  return (Array.isArray(documents) ? documents : [])
    .filter(document => document?.current === true)
    .sort((left, right) => `${left.document_type}:${left.version}:${left.id}`.localeCompare(`${right.document_type}:${right.version}:${right.id}`));
}

function findDocument(documents, matcher) {
  return documents.find(document => matcher.test(String(document.document_type || '').toLowerCase()));
}

function unspscCodes(value) {
  if (Array.isArray(value)) return value.map(String).filter(code => /^\d{8}$/.test(code));
  return [...new Set(String(value || '').match(/\b\d{8}\b/g) || [])].sort();
}

function documentEvidence(document) {
  return [
    `evidence_id=company_document:${document.id}`,
    'kind=stored_file',
    `type=${document.document_type}`,
    `name=${document.display_name}`,
    `version=${document.version}`,
    `issued_at=${document.issued_at}`,
    `expires_at=${document.expires_at || 'not_applicable'}`,
    `sha256=${document.content_hash}`,
  ].join('|');
}

// Defense in depth, mirroring currentDocuments(): loadAgt002CompanyDossier already
// filters current=true and integration_active=true server-side, but a caller building
// the dossier directly (tests, or a future caller) must not be able to smuggle in a
// superseded or deactivated registry entry just by omitting those filters.
function activeRegistryEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry?.current === true && entry?.integration_active === true)
    .sort((left, right) => String(left.entry_id).localeCompare(String(right.entry_id)));
}

function findRegistryEntry(entries, matcher) {
  return entries.find(entry => matcher.test(String(entry.entry_id || '').toLowerCase()) || matcher.test(String(entry.document_class || '').toLowerCase()));
}

function findRegistryEntryById(entries, entryId) {
  return entries.find(entry => entry.entry_id === entryId);
}

// The scalar value remains factual-only (document class, vigencia, provenance and
// integration state). Applicability is carried by the optional structured sibling
// field validated by agt002-context-v2.js, never folded into this text.
function registryLicenseValue(entry) {
  return [
    `document_class=${entry.document_class}`,
    `vigencia=${entry.vigencia_text}`,
    `source_reference=${entry.source_reference}`,
    `estado_integracion=${entry.estado_integracion}`,
  ].join('|');
}

function registryEvidenceLine(entry) {
  return [
    `evidence_id=company_evidence_registry:${entry.entry_id}`,
    'kind=canonical_metadata',
    `metadata_only=${entry.metadata_only}`,
    `type=${entry.document_class}`,
    `estado_integracion=${entry.estado_integracion}`,
    `vigencia=${entry.vigencia_text}`,
    `expires_at=${entry.expiry || 'not_applicable'}`,
    `sha256=${entry.hash || 'not_available'}`,
    `applicability_status=${entry.applicability_status}`,
  ].join('|');
}

function nearestExpiry(list, expiryField) {
  return list
    .filter(item => item?.[expiryField])
    .sort((left, right) => String(left[expiryField]).localeCompare(String(right[expiryField])))[0];
}

function emptySection(keys, record, prefix) {
  return Object.fromEntries(keys.map(key => [
    key,
    evidence(null, `${prefix}:${key}`, record),
  ]));
}

export function buildAgt002CompanyDossier({ profile = {}, documents = [], registryEntries = [] }) {
  const current = currentDocuments(documents);
  const registry = activeRegistryEntries(registryEntries);
  const rupDocument = findDocument(current, /(^|_)rup($|_)/);
  const licenseDocument = findDocument(current, /licen|supervigilancia/);
  const certificationDocument = findDocument(current, /certif/);
  const nearestExpiryDocument = current
    .filter(document => document.expires_at)
    .sort((left, right) => String(left.expires_at).localeCompare(String(right.expires_at)))[0];
  const profileOptions = {
    label: profile.source_document_name || undefined,
  };

  // Precedence for `licenses`: the canonical operating-license metadata wins over
  // the obsolete free-text scalar because it identifies the exact administrative act,
  // provenance and observed expiry. Real uploaded files remain fully visible as separate
  // recurring_documents evidence; they do not contain an extracted factual summary that
  // can safely replace this slot. If the exact registry key is unavailable, fall back to a
  // SuperVigilancia-specific match, then to the legacy scalar. A generic /licen/ fallback is
  // deliberately forbidden because it can select communications_license instead.
  const licenseRegistryEntry = findRegistryEntryById(registry, 'supervigilancia_operating_license')
    || findRegistryEntry(registry, /supervigilancia|licencia de funcionamiento/);
  const licenses = licenseRegistryEntry
    ? evidence(
      registryLicenseValue(licenseRegistryEntry),
      `psi_agt002_company_evidence_registry:${licenseRegistryEntry.entry_id}`,
      licenseRegistryEntry,
      { status: licenseRegistryEntry.existence_status || 'reported', expiresAt: licenseRegistryEntry.expiry, label: licenseRegistryEntry.document_class },
    )
    : evidence(profile.supervigilancia_license, 'psi_company_procurement_profile:supervigilancia_license', profile, { ...profileOptions, expiresAt: licenseDocument?.expires_at });
  if (licenseRegistryEntry) licenses.applicability_status = licenseRegistryEntry.applicability_status;

  // recurring_documents differentiates stored files (kind=stored_file, real uploads with a
  // content_hash) from canonical registry entries (kind=canonical_metadata, metadata-only and
  // still INTEGRADO_PROVISIONAL_PENDIENTE_REVISION_HUMANA) within one wire-schema-valid array —
  // the context v2 sourced-value shape has no room for two separate sibling keys. Status is only
  // ever 'verified' when at least one real stored file is present; registry entries existing on
  // their own can never push this field to verified/cumplido/applicable by themselves.
  const documentLines = current.map(documentEvidence);
  const registryLines = registry.map(registryEvidenceLine);
  const recurringExpiryDocument = nearestExpiryDocument || nearestExpiry(registry, 'expiry');
  const recurringOptions = { expiresAt: nearestExpiryDocument?.expires_at || recurringExpiryDocument?.expiry };
  if (documentLines.length > 0) recurringOptions.status = 'verified';

  const dossier = {
    legal_name: evidence(profile.legal_name, 'psi_company_procurement_profile:legal_name', profile, profileOptions),
    nit: evidence(profile.nit, 'psi_company_procurement_profile:nit', profile, profileOptions),
    rup_status: evidence(profile.rup_status, 'psi_company_procurement_profile:rup_status', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    rup_updated_at: evidence(profile.rup_updated_at, 'psi_company_procurement_profile:rup_updated_at', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    unspsc_codes: evidence(unspscCodes(profile.rup_unspsc_codes), 'psi_company_procurement_profile:rup_unspsc_codes', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    services: evidence(profile.authorized_services, 'psi_company_procurement_profile:authorized_services', profile, profileOptions),
    licenses,
    financial_capacity: evidence(profile.financial_capacity, 'psi_company_procurement_profile:financial_capacity', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    organizational_capacity: evidence(profile.organizational_capacity, 'psi_company_procurement_profile:organizational_capacity', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    experience: evidence(profile.experience_summary, 'psi_company_procurement_profile:experience_summary', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    certifications: evidence(profile.certifications, 'psi_company_procurement_profile:certifications', profile, { ...profileOptions, expiresAt: certificationDocument?.expires_at }),
    recurring_documents: evidence(
      [...documentLines, ...registryLines],
      'psi_company_procurement_documents:current+psi_agt002_company_evidence_registry:current',
      nearestExpiryDocument || recurringExpiryDocument || profile,
      recurringOptions,
    ),
    restrictions: evidence(profile.disqualifications_notes, 'psi_company_procurement_profile:disqualifications_notes', profile, profileOptions),
  };

  const validated = buildAgt002ContextV2({
    snapshot_id: profile.id || current[0]?.id || 'agt002-company-dossier-unbound',
    opportunity: emptySection(AGT002_CONTEXT_V2_FIELDS.opportunity, profile, 'opportunity'),
    company_dossier: dossier,
    commercial_context: emptySection(AGT002_CONTEXT_V2_FIELDS.commercial_context, profile, 'commercial_context'),
    human_evidence: [],
  });
  return validated.company_dossier;
}

async function rows(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Only for the optional registry table (061): fails soft exclusively when the table
// itself does not exist yet (a database that hasn't run 061), so a rollback of 061 or an
// environment that predates it degrades to the pre-hotfix dossier instead of breaking.
// Any other error (permissions, connectivity, a malformed query) still propagates —
// this must never silently hide a real backend failure as "no evidence".
async function optionalRows(query) {
  const { data, error } = await query;
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return [];
    throw error;
  }
  return data || [];
}

export async function loadAgt002CompanyDossier(database) {
  const profileResult = await database
    .from('psi_company_procurement_profile')
    .select(AGT002_COMPANY_PROFILE_SELECT)
    .eq('singleton_key', 'seguridad_nacional')
    .maybeSingle();
  if (profileResult.error && !TABLE_ABSENT_ERROR_CODES.includes(profileResult.error.code)) throw profileResult.error;
  const documents = await rows(
    database.from('psi_company_procurement_documents')
      .select(AGT002_COMPANY_DOCUMENT_SELECT)
      .eq('current', true)
      .order('document_type')
      .order('version', { ascending: false }),
  );
  const registryEntries = await optionalRows(
    database.from('psi_agt002_company_evidence_registry')
      .select(AGT002_COMPANY_EVIDENCE_REGISTRY_SELECT)
      .eq('current', true)
      .eq('integration_active', true)
      .order('entry_id'),
  );
  return buildAgt002CompanyDossier({ profile: profileResult.data || {}, documents, registryEntries });
}
