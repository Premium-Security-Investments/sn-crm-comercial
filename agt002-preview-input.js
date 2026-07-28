export const AGT002_MAX_DOCUMENTS = 12;
export const AGT002_MAX_DOCUMENT_CHARS = 3000;
export const AGT002_MAX_TOTAL_DOCUMENT_CHARS = 36000;

const COMPANY_PROFILE_FIELDS = [
  'working_capital',
  'guarantee_capacity_pct',
  'rup_expires_at',
];

function redactText(value) {
  return String(value ?? '')
    .replace(/\b(?:c[eé]dula|cc|nit)\s*[:#-]?\s*[0-9][0-9.\s-]{5,}[0-9]\b/gi, '[REDACTED_ID]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){2}\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED_SECRET]')
    .replace(/([?&](?:token|key|signature|sig|secret|authorization)=)[^&#\s]+/gi, '$1[REDACTED_SECRET]');
}

function sanitizeValue(value) {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sanitizeValue(nested)])
  );
}

function stableDocumentId(document) {
  const id = document?.id ?? document?.document_id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error('Cada documento requiere un identificador estable para AGT-002 Preview.');
  }
  return id.trim();
}

function prepareDocuments(documents) {
  let remainingBudget = AGT002_MAX_TOTAL_DOCUMENT_CHARS;
  return [...(documents || [])]
    .map(document => ({ document, documentId: stableDocumentId(document) }))
    .sort((left, right) => left.documentId.localeCompare(right.documentId))
    .slice(0, AGT002_MAX_DOCUMENTS)
    .map(({ document, documentId }) => {
      const available = Math.max(0, Math.min(AGT002_MAX_DOCUMENT_CHARS, remainingBudget));
      const excerpt = redactText(document?.extracted_text ?? document?.content ?? '').slice(0, available);
      remainingBudget -= excerpt.length;
      return {
        document_id: documentId,
        evidence_id: `document:${documentId}`,
        name: redactText(document?.name ?? ''),
        document_type: String(document?.document_type ?? ''),
        trust: 'untrusted_document_excerpt',
        excerpt,
      };
    });
}

function prepareCompanyProfile(companyProfile) {
  const profile = {};
  for (const field of COMPANY_PROFILE_FIELDS) {
    if (companyProfile?.[field] !== undefined && companyProfile?.[field] !== null) {
      profile[field] = sanitizeValue(companyProfile[field]);
    }
  }
  return profile;
}

export function buildAgt002PreviewInput({ opportunity = {}, documents = [], companyProfile = {}, deepAnalysis = {}, snapshotId }) {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('AGT-002 Preview requiere un snapshot documental vigente.');
  }
  return {
    schema_version: '1.0',
    snapshot_id: snapshotId.trim(),
    opportunity: {
      id: String(opportunity?.id ?? ''),
      company_name: redactText(opportunity?.company_name ?? ''),
      title: redactText(opportunity?.title ?? opportunity?.opportunity_name ?? ''),
    },
    company_profile: prepareCompanyProfile(companyProfile),
    deep_analysis: sanitizeValue(deepAnalysis),
    documents: prepareDocuments(documents),
  };
}
