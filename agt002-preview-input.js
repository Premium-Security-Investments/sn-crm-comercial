import { buildAgt002ObjectiveValidations } from './agt002-objective-validations.js';
import { buildAgt002ContextV2 } from './agt002-context-v2.js';
import { buildAgt002DocumentChunks } from './agt002-document-chunks.js';
import { buildAgt002DocumentRetrieval } from './agt002-document-retrieval.js';
import { AGT002_LEGAL_REVIEW_REASONS, isAgt002OfficialLegalUrl } from './agt002-legal-corpus.js';

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

// AGT002_LEGAL_CORPUS (Task33): the exact fixed statement a human_legal_review item must
// render when a legal source's vigencia/applicability could not be confirmed (design 7.6).
const AGT002_LEGAL_EVIDENCE_STATEMENT = 'No verificado jurídicamente; requiere revisión humana';

const LEGAL_PACKAGE_KEYS = [
  'corpus_version', 'as_of', 'query', 'verified_legal_evidence', 'human_legal_review_items',
  'coverage', 'omissions', 'allowed_citation_ids',
];
const LEGAL_QUERY_KEYS = ['process_stage', 'modality', 'topics', 'sector', 'max_results'];
const LEGAL_CITATION_KEYS = [
  'citation_id', 'source_id', 'norm_type', 'norm_number', 'year', 'article_or_section',
  'issuing_authority', 'official_url', 'verified_at', 'corpus_version', 'label',
];
const LEGAL_VERIFIED_ITEM_KEYS = ['source_id', 'topic', 'sector', 'citation', 'statement'];
const LEGAL_REVIEW_ITEM_KEYS = ['source_id', 'topic', 'sector', 'citation', 'statement', 'reasons'];
const LEGAL_COVERAGE_KEYS = ['matched_source_ids', 'considered_count', 'returned_count'];
const LEGAL_OMISSION_KEYS = ['source_id', 'reason'];

function isLegalRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireLegalString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label} debe ser texto no vacío.`);
  }
  return value.trim();
}

function requireLegalStringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || !value.every(item => typeof item === 'string')) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label} debe ser una lista de texto${allowEmpty ? '' : ' no vacía'}.`);
  }
  return [...value];
}

function requireLegalTagList(value, label) {
  const list = requireLegalStringArray(value, label, { allowEmpty: false });
  if (!list.every(tag => tag.trim().length > 0)) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label} debe ser una lista de etiquetas no vacía.`);
  }
  return list.map(tag => tag.trim());
}

function requireLegalExactKeys(value, expectedKeys, label) {
  if (!isLegalRecord(value)) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label} debe ser un objeto.`);
  }
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter(key => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter(key => !expected.has(key));
  if (missing.length || unknown.length) {
    throw new Error(
      `AGT-002 Preview con evidencia jurídica: ${label} tiene una clave no permitida o desconocida (faltantes: ${missing.join(', ') || 'ninguna'}; desconocidas: ${unknown.join(', ') || 'ninguna'}).`,
    );
  }
}

/** Never trusts a citation blindly: rebuilds it field-by-field and re-checks the official URL. */
function rebuildLegalCitation(raw, { corpusVersion, label }) {
  requireLegalExactKeys(raw, LEGAL_CITATION_KEYS, label);
  const sourceId = requireLegalString(raw.source_id, `${label}.source_id`);
  const citationId = requireLegalString(raw.citation_id, `${label}.citation_id`);
  const version = requireLegalString(raw.corpus_version, `${label}.corpus_version`);
  if (version !== corpusVersion) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.corpus_version no coincide con la versión declarada del paquete (${corpusVersion}).`);
  }
  if (citationId !== `citation:${sourceId}:${version}`) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.citation_id no es la cita canónica derivada de source_id y corpus_version.`);
  }
  const officialUrl = requireLegalString(raw.official_url, `${label}.official_url`);
  if (!isAgt002OfficialLegalUrl(officialUrl)) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.official_url debe ser HTTPS y pertenecer a un host oficial permitido.`);
  }
  if (!Number.isInteger(raw.year)) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.year debe ser un entero.`);
  }
  return {
    citation_id: citationId,
    source_id: sourceId,
    norm_type: requireLegalString(raw.norm_type, `${label}.norm_type`),
    norm_number: requireLegalString(raw.norm_number, `${label}.norm_number`),
    year: raw.year,
    article_or_section: requireLegalString(raw.article_or_section, `${label}.article_or_section`),
    issuing_authority: requireLegalString(raw.issuing_authority, `${label}.issuing_authority`),
    official_url: officialUrl,
    verified_at: requireLegalString(raw.verified_at, `${label}.verified_at`),
    corpus_version: version,
    label: requireLegalString(raw.label, `${label}.label`),
  };
}

function rebuildVerifiedLegalItem(raw, index, corpusVersion) {
  const label = `legal_evidence.verified_legal_evidence[${index}]`;
  requireLegalExactKeys(raw, LEGAL_VERIFIED_ITEM_KEYS, label);
  const sourceId = requireLegalString(raw.source_id, `${label}.source_id`);
  const topic = requireLegalTagList(raw.topic, `${label}.topic`);
  const sector = requireLegalTagList(raw.sector, `${label}.sector`);
  const citation = rebuildLegalCitation(raw.citation, { corpusVersion, label: `${label}.citation` });
  if (citation.source_id !== sourceId) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.citation no corresponde al source_id declarado.`);
  }
  return { source_id: sourceId, topic, sector, citation, statement: requireLegalString(raw.statement, `${label}.statement`) };
}

function rebuildHumanLegalReviewItem(raw, index, corpusVersion) {
  const label = `legal_evidence.human_legal_review_items[${index}]`;
  requireLegalExactKeys(raw, LEGAL_REVIEW_ITEM_KEYS, label);
  const sourceId = requireLegalString(raw.source_id, `${label}.source_id`);
  const topic = requireLegalTagList(raw.topic, `${label}.topic`);
  const sector = requireLegalTagList(raw.sector, `${label}.sector`);
  const citation = rebuildLegalCitation(raw.citation, { corpusVersion, label: `${label}.citation` });
  if (citation.source_id !== sourceId) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.citation no corresponde al source_id declarado.`);
  }
  const statement = requireLegalString(raw.statement, `${label}.statement`);
  if (statement !== AGT002_LEGAL_EVIDENCE_STATEMENT) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.statement debe ser exactamente «${AGT002_LEGAL_EVIDENCE_STATEMENT}».`);
  }
  const reasons = requireLegalStringArray(raw.reasons, `${label}.reasons`, { allowEmpty: false });
  if (!reasons.every(reason => AGT002_LEGAL_REVIEW_REASONS.includes(reason))) {
    throw new Error(`AGT-002 Preview con evidencia jurídica: ${label}.reasons solo puede contener razones cerradas reconocidas.`);
  }
  return { source_id: sourceId, topic, sector, citation, statement, reasons: [...new Set(reasons)].sort() };
}

function rebuildLegalQuery(raw) {
  requireLegalExactKeys(raw, LEGAL_QUERY_KEYS, 'legal_evidence.query');
  const processStage = raw.process_stage == null ? null : requireLegalString(raw.process_stage, 'legal_evidence.query.process_stage');
  const modality = raw.modality == null ? null : requireLegalString(raw.modality, 'legal_evidence.query.modality');
  const topics = requireLegalStringArray(raw.topics, 'legal_evidence.query.topics');
  const sector = requireLegalStringArray(raw.sector, 'legal_evidence.query.sector');
  if (raw.max_results != null && (!Number.isInteger(raw.max_results) || raw.max_results <= 0)) {
    throw new Error('AGT-002 Preview con evidencia jurídica: legal_evidence.query.max_results debe ser un entero mayor que cero o nulo.');
  }
  return { process_stage: processStage, modality, topics, sector, max_results: raw.max_results == null ? null : raw.max_results };
}

/**
 * Validates and rebuilds field-by-field the closed `legal_evidence` section from an explicit
 * legal evidence package (produced by Task32's `retrieveAgt002LegalEvidence`, never re-derived
 * here — this module never reads a corpus, network or clock). Every citation is re-verified
 * against the official-host allowlist and its own canonical shape; nothing is trusted verbatim,
 * so an invented/altered field never survives into the model input. `citation_allowlist` is
 * always recomputed from `verified_legal_evidence`, never taken from the caller, and
 * `abstention_state` is derived, never supplied — a package with no eligible source always
 * abstains rather than letting an invented allowlist through.
 */
function buildLegalEvidenceSection(legalEvidencePackage) {
  if (!isLegalRecord(legalEvidencePackage)) {
    throw new Error('AGT-002 Preview con evidencia jurídica (AGT002_LEGAL_CORPUS) requiere un paquete de recuperación jurídica explícito (Task32).');
  }
  requireLegalExactKeys(legalEvidencePackage, LEGAL_PACKAGE_KEYS, 'legal_evidence');

  const corpusVersion = requireLegalString(legalEvidencePackage.corpus_version, 'legal_evidence.corpus_version');
  const asOf = requireLegalString(legalEvidencePackage.as_of, 'legal_evidence.as_of');
  const query = rebuildLegalQuery(legalEvidencePackage.query);

  if (!Array.isArray(legalEvidencePackage.verified_legal_evidence)) {
    throw new Error('AGT-002 Preview con evidencia jurídica: verified_legal_evidence debe ser una lista.');
  }
  if (!Array.isArray(legalEvidencePackage.human_legal_review_items)) {
    throw new Error('AGT-002 Preview con evidencia jurídica: human_legal_review_items debe ser una lista.');
  }

  const verifiedLegalEvidence = legalEvidencePackage.verified_legal_evidence
    .map((item, index) => rebuildVerifiedLegalItem(item, index, corpusVersion))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));
  const humanLegalReviewItems = legalEvidencePackage.human_legal_review_items
    .map((item, index) => rebuildHumanLegalReviewItem(item, index, corpusVersion))
    .sort((left, right) => left.source_id.localeCompare(right.source_id));

  const seenSourceIds = new Set();
  for (const item of [...verifiedLegalEvidence, ...humanLegalReviewItems]) {
    if (seenSourceIds.has(item.source_id)) {
      throw new Error(`AGT-002 Preview con evidencia jurídica: source_id duplicado entre evidencia verificada y en revisión: ${item.source_id}.`);
    }
    seenSourceIds.add(item.source_id);
  }

  requireLegalExactKeys(legalEvidencePackage.coverage, LEGAL_COVERAGE_KEYS, 'legal_evidence.coverage');
  const matchedSourceIds = requireLegalStringArray(legalEvidencePackage.coverage.matched_source_ids, 'legal_evidence.coverage.matched_source_ids');
  if (!Number.isInteger(legalEvidencePackage.coverage.considered_count) || legalEvidencePackage.coverage.considered_count < 0) {
    throw new Error('AGT-002 Preview con evidencia jurídica: legal_evidence.coverage.considered_count debe ser un entero mayor o igual a cero.');
  }
  if (legalEvidencePackage.coverage.considered_count !== matchedSourceIds.length) {
    throw new Error('AGT-002 Preview con evidencia jurídica: legal_evidence.coverage.considered_count no coincide con matched_source_ids.');
  }
  if (!Number.isInteger(legalEvidencePackage.coverage.returned_count) || legalEvidencePackage.coverage.returned_count < 0) {
    throw new Error('AGT-002 Preview con evidencia jurídica: legal_evidence.coverage.returned_count debe ser un entero mayor o igual a cero.');
  }
  if (legalEvidencePackage.coverage.returned_count !== verifiedLegalEvidence.length + humanLegalReviewItems.length) {
    throw new Error('AGT-002 Preview con evidencia jurídica: legal_evidence.coverage.returned_count no coincide con la evidencia entregada.');
  }

  if (!Array.isArray(legalEvidencePackage.omissions)) {
    throw new Error('AGT-002 Preview con evidencia jurídica: omissions debe ser una lista.');
  }
  const omissions = legalEvidencePackage.omissions.map((raw, index) => {
    const label = `legal_evidence.omissions[${index}]`;
    requireLegalExactKeys(raw, LEGAL_OMISSION_KEYS, label);
    return {
      source_id: requireLegalString(raw.source_id, `${label}.source_id`),
      reason: requireLegalString(raw.reason, `${label}.reason`),
    };
  }).sort((left, right) => left.source_id.localeCompare(right.source_id));

  const citationAllowlist = verifiedLegalEvidence.map(item => item.citation.citation_id).sort();
  const providedAllowlist = requireLegalStringArray(legalEvidencePackage.allowed_citation_ids, 'legal_evidence.allowed_citation_ids');
  const sortedProvidedAllowlist = [...providedAllowlist].sort();
  if (JSON.stringify(sortedProvidedAllowlist) !== JSON.stringify(citationAllowlist)) {
    throw new Error('AGT-002 Preview con evidencia jurídica: allowed_citation_ids no coincide con la evidencia jurídica verificada del paquete (allowlist no confiable).');
  }

  return {
    corpus_version: corpusVersion,
    as_of: asOf,
    query,
    verified_legal_evidence: verifiedLegalEvidence,
    human_legal_review_items: humanLegalReviewItems,
    citation_allowlist: citationAllowlist,
    coverage: { matched_source_ids: matchedSourceIds, considered_count: legalEvidencePackage.coverage.considered_count, returned_count: legalEvidencePackage.coverage.returned_count },
    omissions,
    abstention_state: verifiedLegalEvidence.length > 0 ? 'grounded' : 'abstained',
  };
}

function buildContextV2Input({
  snapshotId, contextV2Sections, documents, documentGaps, deepAnalysis, documentRetrieval, legalCorpus, legalEvidencePackage,
}) {
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

  if (legalCorpus) {
    result.legal_evidence = buildLegalEvidenceSection(legalEvidencePackage);
  }

  return result;
}

export function buildAgt002PreviewInput({
  opportunity = {}, documents = [], documentGaps = [], companyProfile = {}, deepAnalysis = {}, snapshotId, canonicalOnly = false,
  contextV2 = false, contextV2Sections = null, documentRetrieval = false, legalCorpus = false, legalEvidencePackage = null,
}) {
  if (typeof snapshotId !== 'string' || !snapshotId.trim()) {
    throw new Error('AGT-002 Preview requiere un snapshot documental vigente.');
  }
  if (documentRetrieval && !contextV2) {
    throw new Error('AGT-002 Preview con recuperación de evidencia (AGT002_DOCUMENT_RETRIEVAL) requiere AGT002_CONTEXT_V2 habilitado.');
  }
  if (legalCorpus && !contextV2) {
    throw new Error('AGT-002 Preview con evidencia jurídica (AGT002_LEGAL_CORPUS) requiere AGT002_CONTEXT_V2 habilitado.');
  }
  if (contextV2) {
    return buildContextV2Input({
      snapshotId: snapshotId.trim(), contextV2Sections, documents, documentGaps, deepAnalysis, documentRetrieval, legalCorpus, legalEvidencePackage,
    });
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
