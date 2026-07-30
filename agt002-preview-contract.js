import { AGT002_REQUIREMENT_EVIDENCE_STATUSES } from './agt002-requirement-evidence.js';

export const AGT002_PREVIEW_SCHEMA_VERSION = '2.0-preview.1';
export const AGT002_PREVIEW_RECOMMENDATIONS = new Set(['advance', 'advance_conditionally', 'pause', 'do_not_advance']);

const MODEL_OUTPUT_KEYS = ['recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required'];
const LEGAL_MODEL_OUTPUT_KEYS = [...MODEL_OUTPUT_KEYS, 'legal_findings'];
const FINDING_KEYS = ['id', 'text', 'critical', 'evidence_refs'];
const FINDING_ARRAYS = ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified'];
const REQUIREMENT_EVIDENCE_KEYS = ['requirement_id', 'front', 'status', 'evidence_refs', 'rationale'];
const REQUIREMENT_EVIDENCE_STATUS_SET = new Set(AGT002_REQUIREMENT_EVIDENCE_STATUSES);
const REQUIREMENT_EVIDENCE_POSITIVE_STATUSES = new Set(['cumplido_con_evidencia', 'cumplimiento_parcial']);

// AGT002_LEGAL_CORPUS (Task33): separates every legal finding into exactly one of five closed
// classes (design 7.6 "El análisis separa"). tender_requirement/company_evidence/inference
// assert facts and must cite documentary/contextual evidence_refs; they are never renamed as
// law. legal_obligation is the only class that may carry a legal citation, and only from the
// package's verified allowlist. human_legal_review carries the fixed, visible abstention
// statement for sources whose vigencia/applicability could not be confirmed.
export const AGT002_LEGAL_FINDING_CLASSIFICATIONS = Object.freeze([
  'tender_requirement', 'legal_obligation', 'company_evidence', 'inference', 'human_legal_review',
]);
export const AGT002_LEGAL_HUMAN_REVIEW_STATEMENT = 'No verificado jurídicamente; requiere revisión humana';
const LEGAL_FINDING_KEYS = ['classification', 'text', 'evidence_refs', 'legal_citation_ids'];
const LEGAL_FACT_CLASSIFICATIONS = new Set(['tender_requirement', 'company_evidence', 'inference']);

const legalFindingSchema = {
  type: 'object',
  additionalProperties: false,
  required: LEGAL_FINDING_KEYS,
  properties: {
    classification: { type: 'string', enum: [...AGT002_LEGAL_FINDING_CLASSIFICATIONS] },
    text: { type: 'string', minLength: 1 },
    evidence_refs: { type: 'array', items: { type: 'string', minLength: 1 } },
    legal_citation_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  required: FINDING_KEYS,
  properties: {
    id: { type: 'string', minLength: 1 },
    text: { type: 'string', minLength: 1 },
    critical: { type: 'boolean' },
    evidence_refs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
};

/** Closed JSON Schema passed to Codex App Server turn/start.outputSchema. */
export const AGT002_PREVIEW_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: MODEL_OUTPUT_KEYS,
  properties: {
    recommendation: { type: 'string', enum: [...AGT002_PREVIEW_RECOMMENDATIONS] },
    summary: { type: 'string', minLength: 1 },
    strengths: { type: 'array', items: findingSchema },
    weaknesses: { type: 'array', items: findingSchema },
    blockers: { type: 'array', items: findingSchema },
    questions: { type: 'array', items: findingSchema },
    unverified: { type: 'array', items: findingSchema },
    next_action: { type: 'string', minLength: 1 },
    human_review_required: { type: 'boolean', const: true },
  },
};

/**
 * Closed schema builder for the model-side outputSchema. `AGT002_PREVIEW_OUTPUT_JSON_SCHEMA`
 * stays the exact legacy constant (byte-identical, never mutated) for flag off / rollback;
 * `legalCorpus: true` returns a new object that additionally requires `legal_findings`.
 */
export function buildAgt002PreviewOutputJsonSchema({
  legalCorpus = false, allowedEvidenceIds = [], allowedLegalCitationIds = [],
} = {}) {
  if (!legalCorpus) return AGT002_PREVIEW_OUTPUT_JSON_SCHEMA;
  const evidenceRefItems = allowedEvidenceIds.length > 0
    ? { type: 'string', enum: [...new Set(allowedEvidenceIds)].sort() }
    : legalFindingSchema.properties.evidence_refs.items;
  const legalCitationItems = allowedLegalCitationIds.length > 0
    ? { type: 'string', enum: [...new Set(allowedLegalCitationIds)].sort() }
    : legalFindingSchema.properties.legal_citation_ids.items;
  const constrainedLegalFindingSchema = {
    ...legalFindingSchema,
    properties: {
      ...legalFindingSchema.properties,
      evidence_refs: { ...legalFindingSchema.properties.evidence_refs, items: evidenceRefItems },
      legal_citation_ids: { ...legalFindingSchema.properties.legal_citation_ids, items: legalCitationItems },
    },
  };
  return {
    ...AGT002_PREVIEW_OUTPUT_JSON_SCHEMA,
    required: [...MODEL_OUTPUT_KEYS, 'legal_findings'],
    properties: {
      ...AGT002_PREVIEW_OUTPUT_JSON_SCHEMA.properties,
      legal_findings: { type: 'array', items: constrainedLegalFindingSchema },
    },
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function collectSourcedValueIds(section, ids) {
  if (!isRecord(section)) return;
  for (const value of Object.values(section)) {
    if (isRecord(value) && nonEmptyString(value.source?.reference)) ids.add(value.source.reference.trim());
  }
}

/**
 * Derives the closed set of citable evidence ids from the exact input sent to the model.
 *
 * When AGT002_DOCUMENT_RETRIEVAL attached a closed document_evidence packet
 * (buildAgt002DocumentRetrieval, Task 26/27), document evidence ids come EXACTLY from its
 * citation_allowlist — never by re-walking `documents` — so an omitted/non-allowlisted
 * chunk can never become citable even if a stale/corrupted entry for it still exists
 * elsewhere in the payload. Without document_evidence (flag off / v1), the legacy
 * documents[].evidence_id derivation is unchanged.
 */
export function collectAgt002PreviewEvidenceIds(previewInput) {
  const ids = new Set();
  const citationAllowlist = previewInput?.document_evidence?.citation_allowlist;
  if (Array.isArray(citationAllowlist)) {
    for (const reference of citationAllowlist) {
      if (nonEmptyString(reference)) ids.add(reference);
    }
  } else {
    const documents = Array.isArray(previewInput?.documents) ? previewInput.documents : [];
    for (const document of documents) {
      if (nonEmptyString(document?.evidence_id)) ids.add(document.evidence_id);
    }
  }
  // Context v2 sourced fields (opportunity/company_dossier/commercial_context) are
  // citable evidence too; v1 previewInput sections are flat strings, so this is a no-op then.
  collectSourcedValueIds(previewInput?.opportunity, ids);
  collectSourcedValueIds(previewInput?.company_dossier, ids);
  collectSourcedValueIds(previewInput?.commercial_context, ids);
  for (const item of Array.isArray(previewInput?.human_evidence) ? previewInput.human_evidence : []) {
    if (isRecord(item) && nonEmptyString(item.source?.reference)) ids.add(item.source.reference.trim());
  }
  return [...ids].sort();
}

/**
 * Derives the closed universe of citable legal citation ids from the exact `legal_evidence`
 * package attached to previewInput (Task33), kept strictly separate from
 * `collectAgt002PreviewEvidenceIds`'s documentary/contextual universe: `verified` is the
 * official allowlist a `legal_obligation` finding may cite; `all` additionally includes
 * human-review-only citations so a `human_legal_review` finding can reference the uncertain
 * source it is warning about.
 */
export function collectAgt002PreviewLegalCitationIds(previewInput) {
  const legalEvidence = previewInput?.legal_evidence;
  const verified = new Set();
  const all = new Set();
  if (isRecord(legalEvidence)) {
    for (const reference of Array.isArray(legalEvidence.citation_allowlist) ? legalEvidence.citation_allowlist : []) {
      if (nonEmptyString(reference)) {
        verified.add(reference);
        all.add(reference);
      }
    }
    for (const item of Array.isArray(legalEvidence.human_legal_review_items) ? legalEvidence.human_legal_review_items : []) {
      const citationId = item?.citation?.citation_id;
      if (nonEmptyString(citationId)) all.add(citationId);
    }
  }
  return { verified: [...verified].sort(), all: [...all].sort() };
}

function validateLegalFinding(item, { allowedEvidenceIds, verifiedLegalCitationIds, allLegalCitationIds }) {
  if (!exactKeys(item, LEGAL_FINDING_KEYS)
    || !AGT002_LEGAL_FINDING_CLASSIFICATIONS.includes(item.classification)
    || !nonEmptyString(item.text)
    || !Array.isArray(item.evidence_refs)
    || !item.evidence_refs.every(reference => nonEmptyString(reference))
    || !Array.isArray(item.legal_citation_ids)
    || !item.legal_citation_ids.every(reference => nonEmptyString(reference))) {
    throw new Error('legal_findings debe contener hallazgos cerrados con clasificación, texto, evidence_refs y legal_citation_ids válidos.');
  }

  if (LEGAL_FACT_CLASSIFICATIONS.has(item.classification)) {
    if (item.evidence_refs.length < 1) {
      throw new Error(`legal_findings.${item.classification} debe citar al menos un evidence_ref del expediente documental o contextual enviado a AGT-002 Preview.`);
    }
    for (const reference of item.evidence_refs) {
      if (!allowedEvidenceIds.has(reference)) {
        throw new Error(`legal_findings.${item.classification} cita un evidence_id que no fue enviado a AGT-002 Preview: ${reference}.`);
      }
    }
    if (item.legal_citation_ids.length > 0) {
      throw new Error(`legal_findings.${item.classification} no puede citar identificadores jurídicos: ${item.classification} no se renombra como derecho.`);
    }
    return;
  }

  if (item.classification === 'legal_obligation') {
    if (item.evidence_refs.length > 0) {
      throw new Error('legal_findings.legal_obligation no puede citar evidence_refs documentales; toda obligación normativa se sustenta solo en citas jurídicas oficiales.');
    }
    if (item.legal_citation_ids.length < 1) {
      throw new Error('legal_findings.legal_obligation requiere al menos una citation ID de la allowlist jurídica oficial verificada.');
    }
    for (const citationId of item.legal_citation_ids) {
      if (!verifiedLegalCitationIds.has(citationId)) {
        throw new Error(`legal_findings.legal_obligation cita un identificador jurídico que no pertenece a la allowlist oficial verificada del paquete: ${citationId}.`);
      }
    }
    return;
  }

  // human_legal_review
  if (item.text !== AGT002_LEGAL_HUMAN_REVIEW_STATEMENT) {
    throw new Error(`legal_findings.human_legal_review debe usar exactamente el texto: «${AGT002_LEGAL_HUMAN_REVIEW_STATEMENT}».`);
  }
  if (item.evidence_refs.length > 0) {
    throw new Error('legal_findings.human_legal_review no puede citar evidence_refs documentales.');
  }
  for (const citationId of item.legal_citation_ids) {
    if (!allLegalCitationIds.has(citationId)) {
      throw new Error(`legal_findings.human_legal_review cita un identificador jurídico desconocido o no enviado a AGT-002 Preview: ${citationId}.`);
    }
  }
}

function validateFinding(item, allowedEvidenceIds, field) {
  if (!exactKeys(item, FINDING_KEYS)
    || !nonEmptyString(item.id)
    || !nonEmptyString(item.text)
    || typeof item.critical !== 'boolean'
    || !Array.isArray(item.evidence_refs)
    || item.evidence_refs.length < 1
    || !item.evidence_refs.every(reference => nonEmptyString(reference))) {
    throw new Error(`${field} debe contener hallazgos cerrados con evidence_refs válido.`);
  }
  for (const reference of item.evidence_refs) {
    if (!allowedEvidenceIds.has(reference)) {
      throw new Error(`${field} cita un evidence_id que no fue enviado a AGT-002 Preview: ${reference}.`);
    }
  }
}

/**
 * Validates the model's closed content-only output: identity, snapshot, schema and policy
 * are never trusted from the model and must be assigned by the caller after this passes.
 */
export function validateAgt002PreviewModelOutput(value, {
  allowedEvidenceIds = [], legalCorpus = false, legalCitationIds = { verified: [], all: [] },
  requireLegalAbstention = false, requiredHumanReviewCitationIds = [],
} = {}) {
  if (!isRecord(value)) {
    throw new Error('La salida de AGT-002 Preview debe ser un objeto JSON con estructura cerrada.');
  }
  const expectedKeys = legalCorpus ? LEGAL_MODEL_OUTPUT_KEYS : MODEL_OUTPUT_KEYS;
  const missing = expectedKeys.filter(key => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter(key => !expectedKeys.includes(key));
  if (missing.length) throw new Error(`La salida de AGT-002 Preview omite claves obligatorias: ${missing.join(', ')}.`);
  if (unexpected.length) throw new Error(`La salida de AGT-002 Preview incluye claves inesperadas y no cerradas: ${unexpected.join(', ')}.`);
  if (!AGT002_PREVIEW_RECOMMENDATIONS.has(value.recommendation)) {
    throw new Error('La recomendación de AGT-002 Preview no es válida.');
  }
  if (!nonEmptyString(value.summary)) throw new Error('El resumen (summary) es obligatorio.');
  if (!nonEmptyString(value.next_action)) throw new Error('La siguiente acción (next_action) es obligatoria.');
  if (value.human_review_required !== true) throw new Error('AGT-002 Preview siempre requiere revisión humana.');

  const evidenceSet = new Set(Array.isArray(allowedEvidenceIds) ? allowedEvidenceIds : []);
  for (const field of FINDING_ARRAYS) {
    if (!Array.isArray(value[field])) throw new Error(`${field} debe ser un arreglo.`);
    value[field].forEach(item => validateFinding(item, evidenceSet, field));
  }

  if (legalCorpus) {
    if (!Array.isArray(value.legal_findings)) throw new Error('legal_findings debe ser un arreglo.');
    const verifiedLegalCitationIds = new Set(Array.isArray(legalCitationIds?.verified) ? legalCitationIds.verified : []);
    const allLegalCitationIds = new Set(Array.isArray(legalCitationIds?.all) ? legalCitationIds.all : []);
    value.legal_findings.forEach(item => validateLegalFinding(item, { allowedEvidenceIds: evidenceSet, verifiedLegalCitationIds, allLegalCitationIds }));
    const humanReviewFindings = value.legal_findings.filter(item => item.classification === 'human_legal_review');
    if (requireLegalAbstention && humanReviewFindings.length < 1) {
      throw new Error(`La salida jurídica debe abstenerse explícitamente con «${AGT002_LEGAL_HUMAN_REVIEW_STATEMENT}».`);
    }
    const representedReviewCitations = new Set(humanReviewFindings.flatMap(item => item.legal_citation_ids));
    for (const citationId of Array.isArray(requiredHumanReviewCitationIds) ? requiredHumanReviewCitationIds : []) {
      if (!representedReviewCitations.has(citationId)) {
        throw new Error(`La salida jurídica omitió una fuente incierta que requiere revisión humana: ${citationId}.`);
      }
    }
  }
  return value;
}

/**
 * Closed output section for the requirement-to-company-evidence crosswalk: classifies
 * compliance signal only, never a GO/NO-GO decision. Every positive classification
 * (cumplido_con_evidencia, cumplimiento_parcial) must cite evidence present in the exact
 * input sent to AGT-002 Preview; other statuses may cite nothing (absence is the finding).
 */
export function validateAgt002RequirementEvidenceCrosswalk(items, { allowedEvidenceIds = [] } = {}) {
  if (!Array.isArray(items)) throw new Error('El cruce de requisitos y evidencia debe ser una lista.');
  const evidenceSet = new Set(Array.isArray(allowedEvidenceIds) ? allowedEvidenceIds : []);
  const seen = new Set();
  for (const item of items) {
    if (!exactKeys(item, REQUIREMENT_EVIDENCE_KEYS)
      || !nonEmptyString(item.requirement_id)
      || !nonEmptyString(item.rationale)
      || !REQUIREMENT_EVIDENCE_STATUS_SET.has(item.status)
      || !Array.isArray(item.evidence_refs)
      || !item.evidence_refs.every(reference => nonEmptyString(reference))) {
      throw new Error('El cruce de requisitos y evidencia debe tener estructura cerrada válida.');
    }
    if (seen.has(item.requirement_id)) {
      throw new Error(`El cruce de requisitos y evidencia tiene requirement_id duplicado: ${item.requirement_id}.`);
    }
    seen.add(item.requirement_id);
    if (REQUIREMENT_EVIDENCE_POSITIVE_STATUSES.has(item.status) && item.evidence_refs.length < 1) {
      throw new Error(`${item.requirement_id}: una clasificación positiva del cruce requiere al menos una cita de evidencia.`);
    }
    for (const reference of item.evidence_refs) {
      if (!evidenceSet.has(reference)) {
        throw new Error(`${item.requirement_id} cita un evidence_id que no fue enviado a AGT-002 Preview: ${reference}.`);
      }
    }
  }
  return items;
}
