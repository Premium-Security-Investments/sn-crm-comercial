import { AGT002_CONTEXT_V2_FIELDS, buildAgt002ContextV2 } from './agt002-context-v2.js';

export const AGT002_COMPANY_PROFILE_SELECT = 'id,legal_name,nit,rup_status,rup_updated_at,rup_unspsc_codes,authorized_services,supervigilancia_license,financial_capacity,organizational_capacity,experience_summary,certifications,recurring_documents,disqualifications_notes,source_document_name,updated_at,created_at';
export const AGT002_COMPANY_DOCUMENT_SELECT = 'id,document_type,display_name,issued_at,expires_at,version,content_hash,current,updated_at,created_at';

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
    `type=${document.document_type}`,
    `name=${document.display_name}`,
    `version=${document.version}`,
    `issued_at=${document.issued_at}`,
    `expires_at=${document.expires_at || 'not_applicable'}`,
    `sha256=${document.content_hash}`,
  ].join('|');
}

function emptySection(keys, record, prefix) {
  return Object.fromEntries(keys.map(key => [
    key,
    evidence(null, `${prefix}:${key}`, record),
  ]));
}

export function buildAgt002CompanyDossier({ profile = {}, documents = [] }) {
  const current = currentDocuments(documents);
  const rupDocument = findDocument(current, /(^|_)rup($|_)/);
  const licenseDocument = findDocument(current, /licen|supervigilancia/);
  const certificationDocument = findDocument(current, /certif/);
  const nearestExpiryDocument = current
    .filter(document => document.expires_at)
    .sort((left, right) => String(left.expires_at).localeCompare(String(right.expires_at)))[0];
  const profileOptions = {
    label: profile.source_document_name || undefined,
  };
  const dossier = {
    legal_name: evidence(profile.legal_name, 'psi_company_procurement_profile:legal_name', profile, profileOptions),
    nit: evidence(profile.nit, 'psi_company_procurement_profile:nit', profile, profileOptions),
    rup_status: evidence(profile.rup_status, 'psi_company_procurement_profile:rup_status', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    rup_updated_at: evidence(profile.rup_updated_at, 'psi_company_procurement_profile:rup_updated_at', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    unspsc_codes: evidence(unspscCodes(profile.rup_unspsc_codes), 'psi_company_procurement_profile:rup_unspsc_codes', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    services: evidence(profile.authorized_services, 'psi_company_procurement_profile:authorized_services', profile, profileOptions),
    licenses: evidence(profile.supervigilancia_license, 'psi_company_procurement_profile:supervigilancia_license', profile, { ...profileOptions, expiresAt: licenseDocument?.expires_at }),
    financial_capacity: evidence(profile.financial_capacity, 'psi_company_procurement_profile:financial_capacity', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    organizational_capacity: evidence(profile.organizational_capacity, 'psi_company_procurement_profile:organizational_capacity', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    experience: evidence(profile.experience_summary, 'psi_company_procurement_profile:experience_summary', profile, { ...profileOptions, expiresAt: rupDocument?.expires_at }),
    certifications: evidence(profile.certifications, 'psi_company_procurement_profile:certifications', profile, { ...profileOptions, expiresAt: certificationDocument?.expires_at }),
    recurring_documents: evidence(current.map(documentEvidence), 'psi_company_procurement_documents:current', nearestExpiryDocument || profile, { status: 'verified', expiresAt: nearestExpiryDocument?.expires_at }),
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

export async function loadAgt002CompanyDossier(database) {
  const profileResult = await database
    .from('psi_company_procurement_profile')
    .select(AGT002_COMPANY_PROFILE_SELECT)
    .eq('singleton_key', 'seguridad_nacional')
    .maybeSingle();
  if (profileResult.error && !['PGRST205', '42P01'].includes(profileResult.error.code)) throw profileResult.error;
  const documents = await rows(
    database.from('psi_company_procurement_documents')
      .select(AGT002_COMPANY_DOCUMENT_SELECT)
      .eq('current', true)
      .order('document_type')
      .order('version', { ascending: false }),
  );
  return buildAgt002CompanyDossier({ profile: profileResult.data || {}, documents });
}
