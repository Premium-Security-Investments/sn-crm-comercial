import { buildAgt002ObjectiveValidations } from './agt002-objective-validations.js';
import { buildAgt002ContextV2 } from './agt002-context-v2.js';
import { buildAgt002DocumentChunks } from './agt002-document-chunks.js';
import { buildAgt002DocumentRetrieval } from './agt002-document-retrieval.js';

export const AGT002_MAX_DOCUMENTS = 12;
export const AGT002_MAX_DOCUMENT_CHARS = 3000;
export const AGT002_MAX_TOTAL_DOCUMENT_CHARS = 36000;

// Server-side retrieval budgets for AGT002_DOCUMENT_RETRIEVAL. These are fixed
// constants validated by buildAgt002DocumentRetrieval, never values a caller/browser
// can widen or narrow.
export const AGT002_RETRIEVAL_MAX_CHUNKS = 40;
export const AGT002_RETRIEVAL_MAX_CHARS = 40000;
export const AGT002_RETRIEVAL_MAX_TOKENS = 12000;

const RETRIEVAL_FRONTS = ['legal', 'financial', 'technical'];
const RETRIEVAL_TERM_PATTERN = /[\p{L}\p{N}]{3,}/gu;

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

function normalizeRetrievalTerms(label) {
  const normalized = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return [...new Set(normalized.match(RETRIEVAL_TERM_PATTERN) ?? [])];
}

/**
 * Derives retrieval requirements from the existing deepAnalysis.matrix requirement
 * definitions (id + label), the only structured, non-invented source available at this
 * layer. Requirements without a derivable term set are dropped, never guessed.
 */
function buildRetrievalRequirements(deepAnalysis) {
  const matrix = deepAnalysis?.matrix && typeof deepAnalysis.matrix === 'object' && !Array.isArray(deepAnalysis.matrix)
    ? deepAnalysis.matrix
    : {};
  const requirements = [];
  const seen = new Set();
  for (const front of RETRIEVAL_FRONTS) {
    for (const requirement of Array.isArray(matrix[front]) ? matrix[front] : []) {
      const requirementId = typeof requirement?.id === 'string' ? requirement.id.trim() : '';
      const label = typeof requirement?.label === 'string' ? requirement.label.trim() : '';
      if (!requirementId || !label || seen.has(requirementId)) continue;
      const terms = normalizeRetrievalTerms(label);
      if (!terms.length) continue;
      seen.add(requirementId);
      requirements.push({ requirement_id: requirementId, terms });
    }
  }
  return requirements.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

function buildDocumentEvidencePackage({ snapshotId, documents, documentGaps, deepAnalysis }) {
  const requirements = buildRetrievalRequirements(deepAnalysis);
  if (!requirements.length) {
    throw new Error('AGT-002 Preview con recuperación de evidencia requiere al menos un requisito estructurado recuperable en deepAnalysis.matrix.');
  }

  const { chunks, gaps: extractionGaps } = buildAgt002DocumentChunks(documents ?? []);
  const snapshotChunks = chunks.map(chunk => ({ ...chunk, snapshot_id: snapshotId }));
  const gaps = [
    ...extractionGaps.map(gap => ({ document_id: gap.document_id, document_type: gap.document_type, name: gap.name, reason: gap.reason })),
    ...(Array.isArray(documentGaps) ? documentGaps : []).map(gap => ({
      document_id: String(gap?.document_id ?? ''),
      document_type: gap?.document_type ?? null,
      name: gap?.name ?? null,
      reason: String(gap?.reason ?? ''),
    })),
  ];

  return buildAgt002DocumentRetrieval({
    snapshot_id: snapshotId,
    chunks: snapshotChunks,
    gaps,
    requirements,
    max_chunks: AGT002_RETRIEVAL_MAX_CHUNKS,
    max_chars: AGT002_RETRIEVAL_MAX_CHARS,
    max_tokens: AGT002_RETRIEVAL_MAX_TOKENS,
  });
}

function buildContextV2Input({ snapshotId, contextV2Sections, documents, documentGaps, deepAnalysis, documentRetrieval }) {
  if (!contextV2Sections || typeof contextV2Sections !== 'object' || Array.isArray(contextV2Sections)) {
    throw new Error('AGT-002 Preview con contexto v2 requiere contextV2Sections completo.');
  }
  let validated;
  try {
    validated = buildAgt002ContextV2({
      snapshot_id: snapshotId,
      opportunity: contextV2Sections.opportunity,
      company_dossier: contextV2Sections.company_dossier,
      commercial_context: contextV2Sections.commercial_context,
      human_evidence: contextV2Sections.human_evidence ?? [],
    });
  } catch (error) {
    throw new Error(`AGT-002 Preview con contexto v2 requiere contextV2Sections completo: ${error.message}`);
  }

  const result = {
    schema_version: '1.0',
    snapshot_id: validated.snapshot_id,
    context_version: validated.context_version,
    opportunity: validated.opportunity,
    company_dossier: validated.company_dossier,
    commercial_context: validated.commercial_context,
    human_evidence: validated.human_evidence,
    objective_validations: sanitizeValue(buildAgt002ObjectiveValidations(deepAnalysis)),
  };

  if (documentRetrieval) {
    const retrieval = buildDocumentEvidencePackage({ snapshotId, documents, documentGaps, deepAnalysis });
    result.document_evidence = {
      ...retrieval,
      // Chunk text is redacted for the packet carried in previewInput; the untruncated,
      // unredacted chunk stays only inside buildAgt002DocumentRetrieval's own return value,
      // never serialized here, so no PII/secret can leak through this duplicate field.
      selected_chunks: retrieval.selected_chunks.map(chunk => ({ ...chunk, text: redactText(chunk.text) })),
    };
  } else {
    result.documents = prepareDocuments(documents);
  }

  return result;
}

export function buildAgt002PreviewInput({
  opportunity = {}, documents = [], documentGaps = [], companyProfile = {}, deepAnalysis = {}, snapshotId, canonicalOnly = false,
  contextV2 = false, contextV2Sections = null, documentRetrieval = false,
}) {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('AGT-002 Preview requiere un snapshot documental vigente.');
  }
  if (documentRetrieval && !contextV2) {
    throw new Error('AGT-002 Preview con recuperación de evidencia (AGT002_DOCUMENT_RETRIEVAL) requiere AGT002_CONTEXT_V2 habilitado.');
  }
  if (contextV2) {
    return buildContextV2Input({ snapshotId: snapshotId.trim(), contextV2Sections, documents, documentGaps, deepAnalysis, documentRetrieval });
  }

  const input = {
    schema_version: '1.0',
    snapshot_id: snapshotId.trim(),
    opportunity: {
      id: String(opportunity?.id ?? ''),
      company_name: redactText(opportunity?.company_name ?? ''),
      title: redactText(opportunity?.title ?? opportunity?.opportunity_name ?? ''),
    },
    company_profile: prepareCompanyProfile(companyProfile),
    documents: prepareDocuments(documents),
  };
  if (canonicalOnly) input.objective_validations = sanitizeValue(buildAgt002ObjectiveValidations(deepAnalysis));
  else input.deep_analysis = sanitizeValue(deepAnalysis);
  return input;
}
