import { AGT002_REQUIREMENT_EVIDENCE_STATUSES } from './agt002-requirement-evidence.js';
import {
  AGT002_INTEGRAL_ACTION_PRIORITIES,
  AGT002_INTEGRAL_ACTION_TYPES,
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  AGT002_INTEGRAL_APPLICABILITY_STATES,
  AGT002_INTEGRAL_ASSESSMENT_MODES,
  AGT002_INTEGRAL_BLOCKING_CURABILITY,
  AGT002_INTEGRAL_BLOCKING_EFFECTS,
  AGT002_INTEGRAL_CATEGORIES,
  AGT002_INTEGRAL_CLOSURE_STATUSES,
  AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS,
  AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS,
  AGT002_INTEGRAL_COMPLIANCE_STATES,
  AGT002_INTEGRAL_CONCLUSION_STATUSES,
  AGT002_INTEGRAL_CONFIDENCE_LEVELS,
  AGT002_INTEGRAL_ESCALATION_LEVELS,
  AGT002_INTEGRAL_EVIDENCE_PURPOSES,
  AGT002_INTEGRAL_LEGAL_STATUSES,
  AGT002_INTEGRAL_MILESTONE_TYPES,
  AGT002_INTEGRAL_PRESENCE_STATES,
  AGT002_INTEGRAL_REVIEW_STATES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_SUGGESTED_ROLES,
  AGT002_INTEGRAL_UNIT_KINDS,
  AGT002_INTEGRAL_VALIDITY_STATES,
  validateAgt002IntegralAnalysisV3,
  validateAgt002IntegralAnalysisV3Unit,
} from './agt002-integral-analysis-v3.js';

export const AGT002_PREVIEW_SCHEMA_VERSION = '2.0-preview.1';
// design section 4.2: the governed v3 envelope's schema_version (distinct from, and never
// interchangeable with, the v2 preview schema version above).
export const AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION = '3.0.0';
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

// ---------------------------------------------------------------------------
// Task 5 (v3): the model's v3 turn returns ONLY `{ integral_analysis }` — no run
// identity, snapshot/context/corpus versions, coverage, usage, or any v2 legacy key is
// ever offered as a slot the model could fill in. The JSON Schema below is the model-
// facing structural constraint (mirrors the v2 pattern above); the deep semantic
// invariants (evidence-or-abstention, five axes, ordering, allowlists) are enforced
// server-side by `validateAgt002IntegralAnalysisV3`, never by JSON Schema alone.
// ---------------------------------------------------------------------------

const INTEGRAL_MODEL_OUTPUT_KEYS = ['integral_analysis'];

const V3_WIRE_ID_MAX_LENGTH = 120;
const V3_WIRE_TITLE_MAX_LENGTH = 200;
const V3_WIRE_TEXT_MAX_LENGTH = 600;
const V3_WIRE_ARRAY_MAX_ITEMS = 30;

function v3ClosedObject(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

function v3String(maxLength = V3_WIRE_TEXT_MAX_LENGTH) {
  return { type: 'string', minLength: 1, maxLength };
}

function v3StringArray(maxLength = V3_WIRE_ID_MAX_LENGTH) {
  return { type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS, items: v3String(maxLength) };
}

function v3NullableString(maxLength = V3_WIRE_ID_MAX_LENGTH) {
  return { anyOf: [v3String(maxLength), { type: 'null' }] };
}

// OpenAI Structured Outputs documents `format` as a supported string keyword, with
// `date-time` explicitly listed — this is the one place milestone.at needs an actual
// date, so it uses the documented format rather than a bespoke pattern/regex.
function v3DateTimeString(maxLength = V3_WIRE_TEXT_MAX_LENGTH) {
  return { type: 'string', format: 'date-time', minLength: 1, maxLength };
}

function v3NullableDateTimeString(maxLength = V3_WIRE_ID_MAX_LENGTH) {
  return { anyOf: [v3DateTimeString(maxLength), { type: 'null' }] };
}

const v3EvidenceStateSchema = v3ClosedObject({
  presence: { type: 'string', enum: [...AGT002_INTEGRAL_PRESENCE_STATES] },
  review: { type: 'string', enum: [...AGT002_INTEGRAL_REVIEW_STATES] },
  validity: { type: 'string', enum: [...AGT002_INTEGRAL_VALIDITY_STATES] },
  applicability: { type: 'string', enum: [...AGT002_INTEGRAL_APPLICABILITY_STATES] },
  compliance: { type: 'string', enum: [...AGT002_INTEGRAL_COMPLIANCE_STATES] },
});

const V3_PURPOSES_BY_SOURCE_TYPE = Object.freeze({
  tender_document: ['requirement_basis', 'commercial_context', 'milestone_basis', 'gap_basis'],
  company_evidence: ['company_capacity'],
  legal_corpus: ['legal_basis', 'milestone_basis'],
  human_evidence: ['commercial_context', 'milestone_basis', 'gap_basis'],
  objective_validation: ['requirement_basis', 'commercial_context', 'milestone_basis', 'gap_basis'],
});

function governedStringValues(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()))].sort();
}

function v3GovernedNullableString(values, fallbackMaxLength = V3_WIRE_ID_MAX_LENGTH) {
  const governed = governedStringValues(values);
  return governed.length > 0
    ? { anyOf: [{ type: 'string', enum: governed }, { type: 'null' }] }
    : v3NullableString(fallbackMaxLength);
}

function v3GovernedStringArray(values) {
  const governed = governedStringValues(values);
  if (governed.length === 0) return { type: 'array', maxItems: 0, items: v3String(V3_WIRE_ID_MAX_LENGTH) };
  return { type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS, items: { type: 'string', enum: governed } };
}

function buildV3EvidenceRefsSchema(allowlist) {
  const branches = Object.entries(V3_PURPOSES_BY_SOURCE_TYPE).flatMap(([sourceType, purposes]) => {
    const refs = governedStringValues(allowlist?.[sourceType]);
    if (refs.length === 0) return [];
    return [v3ClosedObject({
      ref: { type: 'string', enum: refs },
      source_type: { type: 'string', const: sourceType },
      purpose: { type: 'string', enum: purposes },
    })];
  });
  if (branches.length > 0) {
    return { type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS, items: { anyOf: branches } };
  }
  return {
    type: 'array', maxItems: 0,
    items: v3ClosedObject({
      ref: v3String(V3_WIRE_ID_MAX_LENGTH),
      source_type: { type: 'string', enum: [...AGT002_INTEGRAL_SOURCE_TYPES] },
      purpose: { type: 'string', enum: [...AGT002_INTEGRAL_EVIDENCE_PURPOSES] },
    }),
  };
}

// AGT-002 milestone wire-contract hotfix: validateMilestone (agt002-integral-analysis-v3.js)
// enforces a status <-> at/source_ref cross-field invariant — "verified" requires both non-null,
// "not_identified" requires both null — that a flat, independently-typed object schema cannot
// express. A provider's structured output could therefore satisfy this wire schema (status
// "verified" with at/source_ref left null) while always failing validateMilestone downstream with
// v3_milestone_invariant, so no canonical run ever persisted. This closed three-branch anyOf,
// discriminated on status, makes that invalid combination structurally unrepresentable on the
// wire, using the same property-level anyOf-of-closed-objects pattern already proven against the
// live Codex provider by `evidence_state` below. "unverified" keeps its existing unconstrained
// at/source_ref semantics (nullable, no cross-field requirement) — validateMilestone imposes none.
// The semantic validator itself is unchanged and remains the sole authority on these invariants.
// Residual gap closed here: `at` was a plain string, so a schema-valid but non-date value (e.g.
// "tbd") could satisfy the wire schema and still fail validateMilestone's Date.parse check
// downstream. Both the non-null "verified" branch and the non-null side of "unverified"'s
// nullable branch now use the documented OpenAI Structured Outputs `format: 'date-time'`
// keyword instead of a plain string, so a non-date value is structurally unrepresentable.
function buildV3MilestoneSchema(hasGovernedContext, milestoneRefs) {
  const typeSchema = { type: 'string', enum: [...AGT002_INTEGRAL_MILESTONE_TYPES] };
  const governedRefs = hasGovernedContext ? governedStringValues(milestoneRefs) : [];
  const nullableSourceRef = hasGovernedContext
    ? (governedRefs.length > 0 ? v3GovernedNullableString(milestoneRefs, V3_WIRE_TEXT_MAX_LENGTH) : { type: 'null' })
    : v3NullableString();
  const nonNullSourceRef = hasGovernedContext
    ? (governedRefs.length > 0 ? { type: 'string', enum: governedRefs } : null)
    : v3String(V3_WIRE_ID_MAX_LENGTH);

  const branches = [
    v3ClosedObject({
      status: { type: 'string', const: 'not_identified' },
      type: typeSchema,
      at: { type: 'null' },
      source_ref: { type: 'null' },
      summary: v3String(),
    }),
    v3ClosedObject({
      status: { type: 'string', const: 'unverified' },
      type: typeSchema,
      at: v3NullableDateTimeString(),
      source_ref: nullableSourceRef,
      summary: v3String(),
    }),
  ];
  // When no allowlisted reference exists, "verified" is unsatisfiable (validateMilestone would
  // always reject a null source_ref for it) — drop the branch entirely rather than offer an
  // empty-enum dead end the provider could still pick.
  if (nonNullSourceRef !== null) {
    branches.push(v3ClosedObject({
      status: { type: 'string', const: 'verified' },
      type: typeSchema,
      at: v3DateTimeString(V3_WIRE_ID_MAX_LENGTH),
      source_ref: nonNullSourceRef,
      summary: v3String(),
    }));
  }
  return { anyOf: branches };
}

// Governed units fix: `category` and `evidence_state` are server-owned for a
// `tender_requirement` unit (assembled from validationContext, never model output — see
// `assembleAgt002GovernedIntegralAnalysisV3Units` below), so the wire schema must let the
// model express ONLY `null` for both there. The only non-null `category` the wire schema
// may ever offer is "strategic" (a `strategic_consideration` unit legitimately declares
// itself); no formal category (discard/habilitating/technical/financial_execution) is
// ever offered as a model-fillable value. `evidence_state` stays a real, model-owned
// object only for `strategic_consideration` (never governed there).
function buildV3AnalysisUnitSchema(validationContext) {
  const hasGovernedContext = isRecord(validationContext) && isRecord(validationContext.allowlist);
  const governedLegalStatuses = hasGovernedContext && validationContext.legalCorpusVersionId == null
    ? ['not_applicable', 'not_verified']
    : [...AGT002_INTEGRAL_LEGAL_STATUSES];
  const requirementIds = hasGovernedContext && Array.isArray(validationContext.requirementManifest)
    ? validationContext.requirementManifest.map(entry => entry?.requirement_id)
    : [];
  const companyEvidenceClassIds = hasGovernedContext ? validationContext.companyEvidenceClassIds : [];
  const legalBasisRefs = hasGovernedContext ? validationContext.allowlist.legal_corpus : [];
  const milestoneRefs = hasGovernedContext
    ? ['tender_document', 'human_evidence', 'legal_corpus', 'objective_validation']
      .flatMap(sourceType => validationContext.allowlist[sourceType] || [])
    : [];

  return v3ClosedObject({
  unit_id: v3String(V3_WIRE_ID_MAX_LENGTH),
  unit_kind: { type: 'string', enum: hasGovernedContext ? ['tender_requirement'] : [...AGT002_INTEGRAL_UNIT_KINDS] },
  requirement_id: hasGovernedContext
    ? (governedStringValues(requirementIds).length > 0
      ? { type: 'string', enum: governedStringValues(requirementIds) }
      : { type: 'null' })
    : v3NullableString(V3_WIRE_ID_MAX_LENGTH),
  category: hasGovernedContext
    ? { type: 'null' }
    : { anyOf: [{ type: 'string', enum: ['strategic'] }, { type: 'null' }] },
  sequence: { type: 'integer', minimum: 1 },
  title: v3String(V3_WIRE_TITLE_MAX_LENGTH),
  assessment_mode: { type: 'string', enum: [...AGT002_INTEGRAL_ASSESSMENT_MODES] },
  conclusion: v3ClosedObject({
    status: { type: 'string', enum: [...AGT002_INTEGRAL_CONCLUSION_STATUSES] },
    summary: v3String(),
    confidence: { type: 'string', enum: [...AGT002_INTEGRAL_CONFIDENCE_LEVELS] },
  }),
  blocking: v3ClosedObject({
    effect: { type: 'string', enum: [...AGT002_INTEGRAL_BLOCKING_EFFECTS] },
    curability: { type: 'string', enum: [...AGT002_INTEGRAL_BLOCKING_CURABILITY] },
    reason: v3String(),
  }),
  evidence_state: hasGovernedContext
    ? { type: 'null' }
    : { anyOf: [v3EvidenceStateSchema, { type: 'null' }] },
  evidence_refs: hasGovernedContext
    ? buildV3EvidenceRefsSchema(validationContext.allowlist)
    : {
      type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS,
      items: v3ClosedObject({
        ref: v3String(V3_WIRE_ID_MAX_LENGTH),
        source_type: { type: 'string', enum: [...AGT002_INTEGRAL_SOURCE_TYPES] },
        purpose: { type: 'string', enum: [...AGT002_INTEGRAL_EVIDENCE_PURPOSES] },
      }),
    },
  missing_evidence: {
    type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS,
    items: v3ClosedObject({
      missing_id: v3String(V3_WIRE_ID_MAX_LENGTH),
      evidence_class_id: hasGovernedContext
        ? (governedStringValues(companyEvidenceClassIds).length > 0
          ? v3GovernedNullableString(companyEvidenceClassIds)
          : { type: 'null' })
        : v3NullableString(V3_WIRE_ID_MAX_LENGTH),
      needed_source_type: { type: 'string', enum: [...AGT002_INTEGRAL_SOURCE_TYPES] },
      reason: v3String(),
      critical: { type: 'boolean' },
    }),
  },
  commercial_impact: v3ClosedObject({
    level: { type: 'string', enum: [...AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS] },
    summary: v3String(),
    dimension: { type: 'string', enum: [...AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS] },
  }),
  legal_assessment: v3ClosedObject({
    status: { type: 'string', enum: governedLegalStatuses },
    basis_refs: hasGovernedContext ? v3GovernedStringArray(legalBasisRefs) : v3StringArray(),
    summary: v3String(),
    human_legal_review_required: { type: 'boolean' },
  }),
  actions: {
    type: 'array', maxItems: V3_WIRE_ARRAY_MAX_ITEMS,
    items: v3ClosedObject({
      action_id: v3String(V3_WIRE_ID_MAX_LENGTH),
      action_type: { type: 'string', enum: [...AGT002_INTEGRAL_ACTION_TYPES] },
      summary: v3String(),
      basis_unit_id: v3String(V3_WIRE_ID_MAX_LENGTH),
      suggested_role: { type: 'string', enum: [...AGT002_INTEGRAL_SUGGESTED_ROLES] },
      priority: { type: 'string', enum: [...AGT002_INTEGRAL_ACTION_PRIORITIES] },
      external_side_effect: { type: 'boolean', const: false },
    }),
  },
  milestone: buildV3MilestoneSchema(hasGovernedContext, milestoneRefs),
  escalation: v3ClosedObject({
    required: { type: 'boolean' },
    level: { type: 'string', enum: [...AGT002_INTEGRAL_ESCALATION_LEVELS] },
    reason: v3String(),
  }),
  closure: v3ClosedObject({
    status: { type: 'string', enum: [...AGT002_INTEGRAL_CLOSURE_STATUSES] },
    condition: v3String(),
    evidence_required: v3StringArray(),
  }),
  human_validation: v3ClosedObject({
    required: { type: 'boolean', const: true },
    status: { type: 'string', const: 'pending' },
    reason: v3String(),
  }),
  });
}

/**
 * Closed JSON Schema handed to the model's turn/start for the v3 contract (Task 5,
 * revised by the governed-metadata fix): the model turn carries ONLY analysis_units.
 * `contract_version` and the entire `coverage` block are server-owned — assembled by
 * the engine from validationContext (see `buildAgt002GovernedIntegralAnalysisV3Coverage`
 * below), never offered as a slot the model could fill in. Making the model transcribe
 * server-owned metadata (manifest versions, the sorted 17-class catalog, etc.) verbatim
 * was exactly the failure mode behind the production
 * `v3_coverage_company_evidence_manifest_version_mismatch` rejection.
 */
export function buildAgt002IntegralAnalysisV3OutputJsonSchema(validationContext) {
  return v3ClosedObject({
    // Cross-field invariants, governed allowlists and exact coverage/order remain enforced
    // server-side by validateAgt002IntegralAnalysisV3 against the assembled object. This
    // wire schema mirrors only the closed structural shape the model itself may fill in.
    integral_analysis: v3ClosedObject({
      analysis_units: { type: 'array', minItems: 1, maxItems: V3_WIRE_ARRAY_MAX_ITEMS, items: buildV3AnalysisUnitSchema(validationContext) },
    }),
  });
}

const INTEGRAL_ANALYSIS_MODEL_OUTPUT_KEYS = ['analysis_units'];

/**
 * Assembles the governed `coverage` block (design section 5) exactly from
 * `validationContext` — the same governed ground truth
 * `validateAgt002IntegralAnalysisV3` itself checks against — never from the model.
 * `analyzed_requirement_ids` is set equal to the governed `expected_requirement_ids`
 * (design invariant 3: they must coincide exactly, in order); whether the model's own
 * `analysis_units` actually realize that coverage is a separate, still fully enforced
 * question, decided by `validateUnitsOrdering` inside `validateAgt002IntegralAnalysisV3`.
 */
function buildAgt002GovernedIntegralAnalysisV3Coverage(validationContext) {
  const ctx = isRecord(validationContext) ? validationContext : {};
  const requirementManifest = Array.isArray(ctx.requirementManifest) ? ctx.requirementManifest : [];
  const expectedRequirementIds = requirementManifest.map(entry => entry?.requirement_id);
  return {
    manifest_version: ctx.requirementManifestVersion,
    expected_requirement_ids: expectedRequirementIds,
    analyzed_requirement_ids: expectedRequirementIds,
    material_omissions: ctx.materialOmissionsObserved === true,
    omission_reasons: Array.isArray(ctx.omissionReasons) ? ctx.omissionReasons : [],
    company_evidence_manifest_version: ctx.companyEvidenceManifestVersion,
    company_evidence_class_ids: Array.isArray(ctx.companyEvidenceClassIds) ? [...ctx.companyEvidenceClassIds].sort() : [],
    legal_corpus_version_id: ctx.legalCorpusVersionId ?? null,
  };
}

function v3ShapeMismatch(message) {
  const error = new Error(message);
  error.code = 'v3_model_output_shape_mismatch';
  return error;
}

/**
 * Governed units fix: `category` and `evidence_state` are server-owned for a
 * `tender_requirement` unit, exactly like `contract_version`/`coverage` above — the model
 * turn must leave both `null` (enforced by the wire schema and re-checked here fail-closed),
 * and this assembles the real values from `validationContext.requirementManifest` /
 * `validationContext.evidenceStateManifest` by `requirement_id` BEFORE
 * `validateAgt002IntegralAnalysisV3` runs, so a model-supplied category or evidence_state
 * can never reach that validator even transiently. `strategic_consideration` units own both
 * fields themselves (no governed per-requirement entry exists for them) and are passed
 * through unchanged, other than fail-closed rejection of a `null` the model should never send.
 */
// Conservative evidence_refs normalization at the server-owned boundary (production
// `v3_evidence_reference_invariant` rejections): a ref that IS governed — present under
// exactly one validationContext.allowlist source-type bucket — but was mistagged by the
// model with the wrong source_type is corrected to the allowlisted bucket; this only ever
// narrows toward the governed allowlist, it never invents a ref that isn't there. A purpose
// is corrected only when the (possibly corrected) source_type admits exactly one purpose per
// V3_PURPOSES_BY_SOURCE_TYPE above (the exact inverse of agt002-integral-analysis-v3.js's
// private PURPOSE_ALLOWED_SOURCE_TYPES) — any source_type with more than one valid purpose is
// left for the model to have gotten right, never guessed. Corrections that collide into an
// identical (ref, purpose) pair collapse to the first occurrence, so no citation is
// double-counted. A ref absent from every bucket, or present in more than one (ambiguous), is
// left untouched — validateEvidenceRefs's hard, fail-closed rejection still applies to it.
function correctedEvidenceRefSourceType(entry, allowlist) {
  if (typeof entry.source_type === 'string' && Array.isArray(allowlist[entry.source_type]) && allowlist[entry.source_type].includes(entry.ref)) {
    return entry.source_type;
  }
  const matches = AGT002_INTEGRAL_SOURCE_TYPES.filter(sourceType => Array.isArray(allowlist[sourceType]) && allowlist[sourceType].includes(entry.ref));
  return matches.length === 1 ? matches[0] : entry.source_type;
}

function correctedEvidenceRefPurpose(purpose, sourceType) {
  const allowedPurposes = V3_PURPOSES_BY_SOURCE_TYPE[sourceType];
  if (!Array.isArray(allowedPurposes) || allowedPurposes.includes(purpose)) return purpose;
  return allowedPurposes.length === 1 ? allowedPurposes[0] : purpose;
}

function normalizeAgt002EvidenceReferencesUnit(unit, validationContext) {
  if (!isRecord(unit) || !Array.isArray(unit.evidence_refs)) return unit;
  const allowlist = isRecord(validationContext) && isRecord(validationContext.allowlist) ? validationContext.allowlist : null;
  if (!allowlist) return unit;

  let changed = false;
  const seenPairs = new Set();
  const correctedRefs = [];
  for (const entry of unit.evidence_refs) {
    if (!isRecord(entry) || typeof entry.ref !== 'string') {
      correctedRefs.push(entry);
      continue;
    }
    const sourceType = correctedEvidenceRefSourceType(entry, allowlist);
    const purpose = correctedEvidenceRefPurpose(entry.purpose, sourceType);
    const pairKey = `${entry.ref}::${purpose}`;
    if (seenPairs.has(pairKey)) { changed = true; continue; }
    seenPairs.add(pairKey);
    if (sourceType === entry.source_type && purpose === entry.purpose) {
      correctedRefs.push(entry);
    } else {
      changed = true;
      correctedRefs.push({ ...entry, source_type: sourceType, purpose });
    }
  }
  return changed ? { ...unit, evidence_refs: correctedRefs } : unit;
}

function normalizeAgt002EvidenceAbstentionUnit(unit) {
  if (!isRecord(unit) || !isRecord(unit.conclusion)) return unit;

  const evidenceRefs = Array.isArray(unit.evidence_refs) ? unit.evidence_refs.map(ref => (isRecord(ref) ? { ...ref } : ref)) : unit.evidence_refs;
  const missingEvidence = Array.isArray(unit.missing_evidence) ? unit.missing_evidence.map(item => (isRecord(item) ? { ...item } : item)) : unit.missing_evidence;
  const conclusion = { ...unit.conclusion };
  const hasEvidence = Array.isArray(evidenceRefs) && evidenceRefs.length > 0;

  const gapHasBasis = conclusion.status !== 'gap_evidenced' || evidenceRefs?.some(ref => ref?.purpose === 'gap_basis');
  const mustAbstain = !hasEvidence
    || conclusion.status === 'insufficient_evidence'
    || unit.assessment_mode === 'abstained'
    || conclusion.confidence === 'unavailable'
    || !gapHasBasis;

  if (!mustAbstain) {
    // human_validation_required is never high-confidence, even when evidence exists.
    if (conclusion.status === 'human_validation_required' && conclusion.confidence === 'high') conclusion.confidence = 'medium';
    return { ...unit, conclusion, evidence_refs: evidenceRefs, missing_evidence: missingEvidence };
  }

  if (!['insufficient_evidence', 'human_validation_required'].includes(conclusion.status)) {
    conclusion.status = 'insufficient_evidence';
  }
  conclusion.confidence = 'unavailable';

  const normalizedMissing = Array.isArray(missingEvidence) ? missingEvidence : [];
  if (conclusion.status === 'insufficient_evidence' && normalizedMissing.length === 0) {
    normalizedMissing.push({
      missing_id: 'AUTO-MISSING-EVIDENCE',
      evidence_class_id: null,
      needed_source_type: 'objective_validation',
      reason: 'No existe evidencia permitida suficiente para sostener una conclusión material; requiere validación humana.',
      critical: false,
    });
  }

  const blocking = isRecord(unit.blocking)
    ? { ...unit.blocking, effect: 'undetermined', curability: 'undetermined' }
    : unit.blocking;
  const closure = isRecord(unit.closure) && unit.closure.status === 'evidence_satisfied'
    ? { ...unit.closure, status: 'human_confirmation_required' }
    : unit.closure;

  return {
    ...unit,
    assessment_mode: 'abstained',
    conclusion,
    blocking,
    evidence_refs: evidenceRefs,
    missing_evidence: normalizedMissing,
    closure,
  };
}

function normalizeAgt002ConclusionToGovernedComplianceUnit(unit) {
  if (!isRecord(unit) || !isRecord(unit.conclusion) || !isRecord(unit.evidence_state)) return unit;
  const expectedComplianceByConclusion = new Map([
    ['supported_with_evidence', 'supported_pending_human_review'],
    ['partially_supported', 'partially_supported_pending_human_review'],
    ['gap_evidenced', 'gap_evidenced_pending_human_review'],
  ]);
  const expectedCompliance = expectedComplianceByConclusion.get(unit.conclusion.status);
  if (!expectedCompliance || unit.evidence_state.compliance === expectedCompliance) return unit;

  return normalizeAgt002EvidenceAbstentionUnit({
    ...unit,
    conclusion: {
      ...unit.conclusion,
      status: 'insufficient_evidence',
      confidence: 'unavailable',
    },
  });
}

function normalizeAgt002ConservativeLegalAssessmentUnit(unit, validationContext) {
  if (!isRecord(unit) || !isRecord(unit.legal_assessment)) return unit;
  const legal = unit.legal_assessment;
  const noPublishedLegalCorpus = validationContext?.legalCorpusVersionId == null;
  const unsupportedClaim = legal.status === 'supported' && (!Array.isArray(legal.basis_refs) || legal.basis_refs.length === 0);
  const invalidWithoutCorpus = noPublishedLegalCorpus && !['not_applicable', 'not_verified'].includes(legal.status);
  const missingRequiredReview = legal.status === 'not_verified' && legal.human_legal_review_required !== true;
  if (!(unsupportedClaim || invalidWithoutCorpus || missingRequiredReview)) return unit;

  return {
    ...unit,
    legal_assessment: {
      ...legal,
      status: 'not_verified',
      human_legal_review_required: true,
    },
  };
}

function normalizeAgt002ActionsUnit(unit) {
  if (!isRecord(unit) || !Array.isArray(unit.actions) || typeof unit.unit_id !== 'string') return unit;
  const seenActionIds = new Set();
  let changed = false;
  const actions = unit.actions.map((action, index) => {
    if (!isRecord(action)) return action;
    let actionId = action.action_id;
    if (seenActionIds.has(actionId)) {
      actionId = `${unit.unit_id}-ACTION-${index + 1}`;
      while (seenActionIds.has(actionId)) actionId += '-X';
    }
    seenActionIds.add(actionId);
    const suggestedRole = action.action_type === 'human_decision' ? 'authorized_human' : action.suggested_role;
    const normalized = {
      ...action,
      action_id: actionId,
      basis_unit_id: unit.unit_id,
      suggested_role: suggestedRole,
      external_side_effect: false,
    };
    if (
      normalized.action_id !== action.action_id
      || normalized.basis_unit_id !== action.basis_unit_id
      || normalized.suggested_role !== action.suggested_role
      || normalized.external_side_effect !== action.external_side_effect
    ) changed = true;
    return normalized;
  });
  return changed ? { ...unit, actions } : unit;
}

function normalizeAgt002CriticalEscalationUnit(unit) {
  if (!isRecord(unit) || !isRecord(unit.escalation)) return unit;
  const notCurableBlocker = unit.blocking?.effect === 'blocker' && unit.blocking?.curability === 'not_curable';
  const materialLegalUncertainty = unit.legal_assessment?.status === 'not_verified'
    && unit.legal_assessment?.human_legal_review_required === true;
  const criticalExposure = unit.commercial_impact?.level === 'critical';
  const criticalCondition = notCurableBlocker || materialLegalUncertainty || criticalExposure;
  const required = criticalCondition || unit.escalation.required === true;
  const level = required
    ? (unit.escalation.level === 'none' ? 'role_review' : unit.escalation.level)
    : 'none';
  if (required === unit.escalation.required && level === unit.escalation.level) return unit;

  return {
    ...unit,
    escalation: {
      ...unit.escalation,
      required,
      level,
    },
  };
}

function buildAgt002GovernedAbstentionUnit(requirementId, sequence, usedUnitIds) {
  let unitId = `GOVERNED-ABSTENTION-${sequence}`;
  while (usedUnitIds.has(unitId)) unitId += '-X';
  usedUnitIds.add(unitId);
  return {
    unit_id: unitId,
    unit_kind: 'tender_requirement',
    requirement_id: requirementId,
    category: null,
    sequence,
    title: `Requisito ${requirementId}`,
    assessment_mode: 'abstained',
    conclusion: {
      status: 'insufficient_evidence',
      summary: 'El modelo no entregó una unidad única para este requisito; se exige revisión humana.',
      confidence: 'unavailable',
    },
    blocking: {
      effect: 'undetermined',
      curability: 'undetermined',
      reason: 'No se determina efecto ni subsanabilidad sin una unidad única y evidencia revisada.',
    },
    evidence_state: null,
    evidence_refs: [],
    missing_evidence: [],
    commercial_impact: {
      level: 'unknown',
      summary: 'Impacto comercial no determinado; requiere revisión humana.',
      dimension: 'unknown',
    },
    legal_assessment: {
      status: 'not_verified',
      basis_refs: [],
      summary: 'Evaluación jurídica no verificada; requiere revisión humana.',
      human_legal_review_required: true,
    },
    actions: [],
    milestone: {
      status: 'not_identified',
      type: 'none',
      at: null,
      source_ref: null,
      summary: 'No se identificó un hito verificable para la unidad omitida o duplicada.',
    },
    escalation: {
      required: true,
      level: 'role_review',
      reason: 'Unidad omitida o duplicada por el modelo; revisión del responsable requerida.',
    },
    closure: {
      status: 'human_confirmation_required',
      condition: 'El responsable revisa el requisito y confirma la evidencia aplicable.',
      evidence_required: ['human_evidence'],
    },
    human_validation: {
      required: true,
      status: 'pending',
      reason: 'Validar manualmente el requisito omitido o duplicado.',
    },
  };
}

function normalizeAgt002TenderUnitsToManifestOrder(analysisUnits, validationContext) {
  if (!Array.isArray(analysisUnits) || !Array.isArray(validationContext?.requirementManifest)) return analysisUnits;
  const expectedIds = validationContext.requirementManifest.map(entry => entry?.requirement_id);
  if (expectedIds.some(id => typeof id !== 'string')) return analysisUnits;

  const unitsByRequirementId = new Map();
  const usedUnitIds = new Set();
  const strategicUnits = [];
  for (const unit of analysisUnits) {
    if (!isRecord(unit) || typeof unit.unit_id !== 'string') continue;
    usedUnitIds.add(unit.unit_id);
    if (unit.unit_kind === 'strategic_consideration') {
      strategicUnits.push(unit);
      continue;
    }
    if (unit.unit_kind !== 'tender_requirement' || typeof unit.requirement_id !== 'string') continue;
    const bucket = unitsByRequirementId.get(unit.requirement_id) || [];
    bucket.push(unit);
    unitsByRequirementId.set(unit.requirement_id, bucket);
  }

  const formalUnits = expectedIds.map((requirementId, index) => {
    const matchingUnits = unitsByRequirementId.get(requirementId) || [];
    if (matchingUnits.length !== 1) {
      return buildAgt002GovernedAbstentionUnit(requirementId, index + 1, usedUnitIds);
    }
    const unit = matchingUnits[0];
    return unit.sequence === index + 1 ? unit : { ...unit, sequence: index + 1 };
  });
  const normalizedStrategicUnits = strategicUnits.map((unit, index) => {
    const sequence = formalUnits.length + index + 1;
    return unit.sequence === sequence ? unit : { ...unit, sequence };
  });
  return [...formalUnits, ...normalizedStrategicUnits];
}

function assembleAgt002GovernedIntegralAnalysisV3Units(analysisUnits, validationContext) {
  const ctx = isRecord(validationContext) ? validationContext : {};
  const requirementManifest = Array.isArray(ctx.requirementManifest) ? ctx.requirementManifest : [];
  const categoryByRequirementId = new Map(requirementManifest.map(entry => [entry?.requirement_id, entry?.category]));
  const evidenceStateManifest = Array.isArray(ctx.evidenceStateManifest) ? ctx.evidenceStateManifest : [];
  const evidenceStateByRequirementId = new Map(evidenceStateManifest.map(entry => [entry?.requirement_id, entry?.evidence_state]));

  const orderedAnalysisUnits = normalizeAgt002TenderUnitsToManifestOrder(analysisUnits, validationContext);
  return (Array.isArray(orderedAnalysisUnits) ? orderedAnalysisUnits : []).map(modelUnit => {
    if (!isRecord(modelUnit)) return modelUnit;
    const unit = normalizeAgt002CriticalEscalationUnit(
      normalizeAgt002ActionsUnit(
        normalizeAgt002ConservativeLegalAssessmentUnit(
          normalizeAgt002EvidenceAbstentionUnit(
            normalizeAgt002EvidenceReferencesUnit(modelUnit, validationContext),
          ),
          validationContext,
        ),
      ),
    );
    if (unit.unit_kind === 'tender_requirement') {
      if (unit.category !== null || unit.evidence_state !== null) {
        throw v3ShapeMismatch(
          `La salida de AGT-002 Preview v3 (analysis_units[${String(unit.unit_id)}]) es tender_requirement y debe dejar `
          + 'category y evidence_state en null; ambos son gobernados por el servidor y nunca se aceptan de la respuesta del modelo.',
        );
      }
      const governedEvidenceState = evidenceStateByRequirementId.get(unit.requirement_id);
      return normalizeAgt002ConclusionToGovernedComplianceUnit({
        ...unit,
        category: categoryByRequirementId.get(unit.requirement_id),
        evidence_state: isRecord(governedEvidenceState) ? { ...governedEvidenceState } : governedEvidenceState,
      });
    }
    if (unit.unit_kind === 'strategic_consideration' && (unit.category === null || unit.evidence_state === null)) {
      throw v3ShapeMismatch(
        `La salida de AGT-002 Preview v3 (analysis_units[${String(unit.unit_id)}]) es strategic_consideration y debe declarar `
        + 'su propia category ("strategic") y evidence_state; ninguno de los dos puede quedar en null.',
      );
    }
    return unit;
  });
}

/**
 * Validates a v3 model turn: rejects anything other than the single `integral_analysis`
 * key, then rejects anything inside it other than the single model-owned
 * `analysis_units` key — `contract_version`/`coverage` are never accepted from the
 * model, however well-formed, so a forged/stale copy can never be smuggled in and never
 * silently merged with the governed values. The engine then constructs the governed
 * `contract_version` and `coverage` from `validationContext`, assembles the governed
 * per-unit `category`/`evidence_state` (see
 * `assembleAgt002GovernedIntegralAnalysisV3Units` above), and validates the fully
 * assembled object with the SAME existing invariant authority
 * (`validateAgt002IntegralAnalysisV3`), unchanged.
 */
export function validateAgt002PreviewModelOutputV3(value, validationContext) {
  if (!isRecord(value) || !exactKeys(value, INTEGRAL_MODEL_OUTPUT_KEYS)) {
    throw new Error('La salida de AGT-002 Preview v3 debe exponer únicamente la clave integral_analysis.');
  }
  if (!exactKeys(value.integral_analysis, INTEGRAL_ANALYSIS_MODEL_OUTPUT_KEYS)) {
    const error = new Error(
      'La salida de AGT-002 Preview v3 (integral_analysis) debe exponer únicamente la clave analysis_units; '
      + 'contract_version y coverage son gobernados por el servidor y nunca se aceptan de la respuesta del modelo.',
    );
    error.code = 'v3_model_output_shape_mismatch';
    throw error;
  }
  const governedIntegralAnalysis = {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: buildAgt002GovernedIntegralAnalysisV3Coverage(validationContext),
    analysis_units: assembleAgt002GovernedIntegralAnalysisV3Units(value.integral_analysis.analysis_units, validationContext),
  };
  try {
    return validateAgt002IntegralAnalysisV3(governedIntegralAnalysis, validationContext);
  } catch (error) {
    if (error?.code) throw error;
    const message = typeof error?.message === 'string' ? error.message : '';
    const structuralDomains = [
      ['conclusion', 'v3_conclusion_shape_invariant'],
      ['blocking', 'v3_blocking_shape_invariant'],
      ['evidence_state', 'v3_evidence_state_shape_invariant'],
      ['evidence_refs', 'v3_evidence_refs_shape_invariant'],
      ['missing_evidence', 'v3_missing_evidence_shape_invariant'],
      ['commercial_impact', 'v3_commercial_impact_shape_invariant'],
      ['legal_assessment', 'v3_legal_assessment_shape_invariant'],
      ['actions', 'v3_actions_shape_invariant'],
      ['milestone', 'v3_milestone_shape_invariant'],
      ['escalation', 'v3_escalation_shape_invariant'],
      ['closure', 'v3_closure_shape_invariant'],
      ['human_validation', 'v3_human_validation_shape_invariant'],
    ];
    const matched = structuralDomains.find(([field]) => message.includes(`.${field}`));
    error.code = matched?.[1] || 'v3_unit_shape_invariant';
    throw error;
  }
}

/**
 * Explicit version-keyed dispatch — never duck typing. `version` MUST be the
 * server-configured contract version (from `AGT002_INTEGRAL_CONTRACT_V3`), never
 * inferred from the shape of `value` itself; an unrecognized version fails closed.
 */
export function validateAgt002PreviewModelOutputByVersion(version, value, options = {}) {
  if (version === 'v2') return validateAgt002PreviewModelOutput(value, options);
  if (version === 'v3') return validateAgt002PreviewModelOutputV3(value, options.v3ValidationContext);
  throw new Error(`Versión de contrato AGT-002 Preview desconocida o no soportada: ${String(version)}.`);
}

// ---------------------------------------------------------------------------
// Durable batched analysis — dedicated batch wire contract (Task 5B,
// docs/plans/2026-09-03-agt002-durable-batched-analysis.md §7). A batch turn offers the
// model ONLY the `tender_requirement` units assigned to one contiguous planner slice
// (agt002-integral-analysis-batches.js): `unit_id`/`sequence`/`category`/`evidence_state`
// are never offered on the wire (structurally absent, not merely forced to null as in the
// single-turn contract above), `requirement_id` is restricted to that batch's own assigned
// ids, and `strategic_consideration` never exists as an option. The server assembles the
// four governed fields, validates each unit with the SAME unweakened
// `validateAgt002IntegralAnalysisV3Unit`, and only the final merge re-runs the unchanged
// full `validateAgt002IntegralAnalysisV3` as sole authority over global ordering/coverage.
// ---------------------------------------------------------------------------

// Every existing v3 model-fillable unit key except the four server-owned ones
// (unit_id, sequence, category, evidence_state) — the single source of truth for both the
// batch wire schema below and the batch runtime validator's structural key check.
export const AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS = Object.freeze([
  'unit_kind', 'requirement_id', 'title', 'assessment_mode', 'conclusion', 'blocking',
  'evidence_refs', 'missing_evidence', 'commercial_impact', 'legal_assessment', 'actions',
  'milestone', 'escalation', 'closure', 'human_validation',
]);

// A batch turn narrows only the `tender_document` bucket of the governed allowlist to this
// batch's projected `citation_allowlist` (design §6/§7: "keep company evidence and legal
// evidence... as governed context"). Every other source-type bucket stays exactly the full,
// unsliced `validationContext.allowlist` the single-turn contract already uses.
function buildAgt002IntegralAnalysisV3BatchScopedContext(validationContext, batch) {
  const ctx = isRecord(validationContext) ? validationContext : {};
  const citationAllowlist = Array.isArray(batch?.citation_allowlist) ? batch.citation_allowlist : [];
  const allowlist = isRecord(ctx.allowlist)
    ? { ...ctx.allowlist, tender_document: citationAllowlist }
    : { tender_document: citationAllowlist };
  return { ...ctx, allowlist };
}

/**
 * Closed JSON Schema for ONE batch's model turn (Task 5B). Reuses the existing
 * `buildV3AnalysisUnitSchema` field-by-field definitions (governed allowlists, enums,
 * bounds) against a batch-scoped context — requirement manifest narrowed to
 * `batch.requirement_ids` (so `requirement_id` and `unit_kind` are governed exactly like the
 * single-turn contract already governs them) and the tender_document allowlist narrowed to
 * `batch.citation_allowlist` — then keeps only the model-fillable keys in
 * `AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS`. `contract_version`/`coverage` are never
 * offered on a batch turn: they are assembled once, only at merge time.
 */
export function buildAgt002IntegralAnalysisV3BatchOutputJsonSchema(validationContext, batch) {
  const ctx = isRecord(validationContext) ? validationContext : {};
  const requirementIds = Array.isArray(batch?.requirement_ids) ? batch.requirement_ids : [];
  const scopedRequirementManifest = Array.isArray(ctx.requirementManifest)
    ? ctx.requirementManifest.filter(entry => requirementIds.includes(entry?.requirement_id))
    : [];
  const scopedValidationContext = {
    ...buildAgt002IntegralAnalysisV3BatchScopedContext(validationContext, batch),
    requirementManifest: scopedRequirementManifest,
  };

  const fullUnitSchema = buildV3AnalysisUnitSchema(scopedValidationContext);
  const unitProperties = {};
  for (const key of AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS) unitProperties[key] = fullUnitSchema.properties[key];
  const unitSchema = v3ClosedObject(unitProperties);

  return v3ClosedObject({
    integral_analysis: v3ClosedObject({
      analysis_units: { type: 'array', minItems: requirementIds.length, maxItems: requirementIds.length, items: unitSchema },
    }),
  });
}

// Server-owned assembly (design §7): `unit_id` is the deterministic `UNIT-<requirement_id>`
// construction; `sequence` is the requirement's GLOBAL 1-based position in the full,
// unsliced governed manifest (never re-based per batch); `category`/`evidence_state` come
// from the same governed maps the single-turn assembler
// (`assembleAgt002GovernedIntegralAnalysisV3Units`) already uses.
//
// The assembled unit is then run through the EXISTING, unchanged `normalizeAgt002ActionsUnit`
// and `normalizeAgt002CriticalEscalationUnit` — the same conservative normalizations the
// single-turn assembler already applies, in the same order — before the shared validator sees
// it (production `v3_action_invariant` and `v3_escalation_invariant` rejections on
// durable_batched_v1). This is a parity fix, not a relaxation: the batch wire contract
// removes `unit_id` from the unit key set entirely, so the deterministic `UNIT-<requirement_id>`
// that `actions[].basis_unit_id` must equal is structurally invisible to the model on a batch
// turn — it is a server-owned identity the model cannot govern, exactly like the duplicate
// `action_id`, the mandatory `authorized_human` role for a `human_decision`, and the
// always-false `external_side_effect`. Normalization must run AFTER `unit_id` exists (the
// normalizer no-ops without it) and BEFORE the unweakened `validateAgt002IntegralAnalysisV3Unit`,
// which stays the sole authority over every enum, bound and shape — an invalid `action_type`,
// `priority` or `suggested_role`, or a malformed action object, is never repaired here and
// still fails closed.
//
// `normalizeAgt002CriticalEscalationUnit` is the same story for invariant 7.11 (production
// `v3_escalation_invariant` on durable_batched_v1): a defined critical condition — a not-curable
// blocker, material legal uncertainty (`legal_assessment.status` "not_verified" with
// `human_legal_review_required` true), or critical commercial exposure — demands
// `escalation.required=true` with a level other than "none", and that is a deterministic
// consequence of fields already present in the unit, not a judgement the model gets to make.
// The normalizer runs OUTERMOST, exactly as in the single-turn assembler, and reproduces that
// path's deterministic `required`/`level` correspondence input for input — this is a parity
// move, not a new rule. Concretely: `required` becomes true for a governed critical condition,
// and a model-declared `required=true` is never dropped; on an escalation that ends up required,
// a "none" level is lifted to the minimum named `role_review` while any other named level the
// model chose is preserved as-is. It is NOT a monotonic "only ever raises" transform: when no
// critical condition holds and the model did not declare `required=true`, the contradictory
// {required:false, <named level>} pair the validator forbids is resolved by collapsing the level
// to "none" — the only value consistent with the `required=false` the model itself declared, and
// exactly the lowering the single-turn path already performs on the same input. `reason` is
// never touched. Everything else stays with the unweakened validator: a malformed `escalation`
// object, an invalid `escalation.level` enum on an escalation that is in fact required, an
// unevidenced critical condition, the legal-assessment invariant and the human-validation gate
// are never repaired here and still fail closed.
function assembleAgt002IntegralAnalysisV3BatchUnit(wireUnit, requirementId, validationContext) {
  const ctx = isRecord(validationContext) ? validationContext : {};
  const requirementManifest = Array.isArray(ctx.requirementManifest) ? ctx.requirementManifest : [];
  const manifestIndex = requirementManifest.findIndex(entry => entry?.requirement_id === requirementId);
  const manifestEntry = manifestIndex === -1 ? undefined : requirementManifest[manifestIndex];
  const evidenceStateManifest = Array.isArray(ctx.evidenceStateManifest) ? ctx.evidenceStateManifest : [];
  const evidenceStateEntry = evidenceStateManifest.find(entry => entry?.requirement_id === requirementId);
  const governedEvidenceState = evidenceStateEntry?.evidence_state;
  return normalizeAgt002CriticalEscalationUnit(
    normalizeAgt002ActionsUnit({
      ...wireUnit,
      unit_id: `UNIT-${requirementId}`,
      sequence: manifestIndex + 1,
      category: manifestEntry?.category ?? null,
      evidence_state: isRecord(governedEvidenceState) ? { ...governedEvidenceState } : (governedEvidenceState ?? null),
    }),
  );
}

/**
 * Runtime validator + assembler for one batch's raw model turn (Task 5B). Rejects any of
 * the four server-owned unit keys if present at all (the batch unit key set is exact, so an
 * extra key fails the structural check below), any non-`tender_requirement` unit, any
 * coverage other than the exact assigned `requirement_ids` once each in assigned order, any
 * `tender_document` evidence ref outside `batch.citation_allowlist`, and any unit that
 * remains non-abstained while the governed context observed material omissions. Every unit
 * is then validated with the extracted, unweakened `validateAgt002IntegralAnalysisV3Unit`.
 * Returns `{ analysis_units }` only — batch-local, fully governed units ready for merge;
 * never a full envelope (no `contract_version`/`coverage` at this stage).
 */
export function validateAgt002PreviewModelOutputV3Batch(value, { validationContext, batch } = {}) {
  if (!isRecord(value) || !exactKeys(value, INTEGRAL_MODEL_OUTPUT_KEYS)) {
    throw new Error('La salida de un lote de AGT-002 Preview v3 debe exponer únicamente la clave integral_analysis.');
  }
  if (!exactKeys(value.integral_analysis, INTEGRAL_ANALYSIS_MODEL_OUTPUT_KEYS)) {
    const error = new Error(
      'La salida de un lote de AGT-002 Preview v3 (integral_analysis) debe exponer únicamente la clave analysis_units; '
      + 'contract_version y coverage son gobernados por el servidor y nunca se aceptan de un turno de lote.',
    );
    error.code = 'v3_batch_model_output_shape_mismatch';
    throw error;
  }
  if (!isRecord(batch) || !Array.isArray(batch.requirement_ids) || batch.requirement_ids.length === 0) {
    throw new Error('batch.requirement_ids debe ser un arreglo no vacío para validar un lote de AGT-002 Preview v3.');
  }
  const expectedRequirementIds = batch.requirement_ids;
  const analysisUnits = value.integral_analysis.analysis_units;
  if (!Array.isArray(analysisUnits)) {
    throw new Error('La salida de un lote de AGT-002 Preview v3 (analysis_units) debe ser un arreglo.');
  }

  const scopedContext = buildAgt002IntegralAnalysisV3BatchScopedContext(validationContext, batch);
  const materialOmissionsObserved = isRecord(validationContext) && validationContext.materialOmissionsObserved === true;

  const assembledUnits = analysisUnits.map((wireUnit, index) => {
    if (!isRecord(wireUnit) || !exactKeys(wireUnit, AGT002_INTEGRAL_ANALYSIS_BATCH_UNIT_KEYS)) {
      const error = new Error(
        `analysis_units[${index}] de un lote de AGT-002 Preview v3 tiene claves no permitidas o incompletas `
        + '(contrato cerrado del lote); unit_id/sequence/category/evidence_state son gobernados por el servidor '
        + 'y nunca se aceptan de un turno de lote.',
      );
      error.code = 'v3_batch_unit_shape_mismatch';
      throw error;
    }
    if (wireUnit.unit_kind !== 'tender_requirement') {
      const error = new Error(
        `analysis_units[${index}]: un turno de lote de AGT-002 Preview v3 solo admite unit_kind "tender_requirement"; `
        + 'strategic_consideration nunca se ofrece ni se acepta en el contrato de lote.',
      );
      error.code = 'v3_batch_unit_kind_invariant';
      throw error;
    }
    if (materialOmissionsObserved && wireUnit.assessment_mode !== 'abstained') {
      const error = new Error(
        `analysis_units[${index}]: el contexto gobernado observó omisiones materiales; toda unidad del lote debe `
        + 'usar assessment_mode "abstained".',
      );
      error.code = 'v3_material_omissions_abstention_required';
      throw error;
    }
    return assembleAgt002IntegralAnalysisV3BatchUnit(wireUnit, wireUnit.requirement_id, scopedContext);
  });

  const actualRequirementIds = assembledUnits.map(unit => unit.requirement_id);
  const coverageMatches = actualRequirementIds.length === expectedRequirementIds.length
    && actualRequirementIds.every((id, index) => id === expectedRequirementIds[index]);
  if (!coverageMatches) {
    const error = new Error(
      'La cobertura local del lote de AGT-002 Preview v3 no coincide exactamente, en el orden asignado, con los '
      + 'requirement_id asignados a este lote (sin faltantes, duplicados ni reordenamiento).',
    );
    error.code = 'v3_batch_coverage_mismatch';
    throw error;
  }

  const validatedUnits = assembledUnits.map(unit => (
    validateAgt002IntegralAnalysisV3Unit(unit, scopedContext, { allowedRequirementIds: expectedRequirementIds })
  ));

  return { analysis_units: validatedUnits };
}

/**
 * Deterministically concatenates already-validated `{ analysis_units }` batch results, in
 * the exact order given (Task 5B). Fails closed on any cross-batch `unit_id`/
 * `requirement_id` collision, builds `contract_version` plus the governed `coverage` block
 * via the EXISTING unchanged `buildAgt002GovernedIntegralAnalysisV3Coverage`, and runs the
 * EXISTING unchanged `validateAgt002IntegralAnalysisV3` over the merged object as the sole
 * final authority over global ordering, duplicate ids, exact coverage, legal/evidence
 * allowlists, omission abstention and every cross-field invariant.
 */
export function mergeAgt002IntegralAnalysisV3Batches(validatedBatchResults, validationContext) {
  if (!Array.isArray(validatedBatchResults) || validatedBatchResults.length === 0) {
    throw new Error('mergeAgt002IntegralAnalysisV3Batches requiere un arreglo no vacío de resultados de lote ya validados.');
  }
  const mergedUnits = [];
  const seenUnitIds = new Set();
  const seenRequirementIds = new Set();
  for (const [batchIndex, result] of validatedBatchResults.entries()) {
    if (!isRecord(result) || !Array.isArray(result.analysis_units)) {
      throw new Error(`mergeAgt002IntegralAnalysisV3Batches: el resultado del lote ${batchIndex} no tiene analysis_units.`);
    }
    for (const unit of result.analysis_units) {
      if (!isRecord(unit) || typeof unit.unit_id !== 'string' || typeof unit.requirement_id !== 'string') {
        throw new Error(`mergeAgt002IntegralAnalysisV3Batches: el lote ${batchIndex} tiene una unidad sin unit_id/requirement_id válido.`);
      }
      if (seenUnitIds.has(unit.unit_id) || seenRequirementIds.has(unit.requirement_id)) {
        const error = new Error(
          `mergeAgt002IntegralAnalysisV3Batches: colisión entre lotes para el requirement_id "${unit.requirement_id}" `
          + '— cada requisito gobernado debe aparecer exactamente una vez en toda la fusión.',
        );
        error.code = 'v3_batch_merge_collision';
        throw error;
      }
      seenUnitIds.add(unit.unit_id);
      seenRequirementIds.add(unit.requirement_id);
      mergedUnits.push(unit);
    }
  }

  const merged = {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: buildAgt002GovernedIntegralAnalysisV3Coverage(validationContext),
    analysis_units: mergedUnits,
  };

  return validateAgt002IntegralAnalysisV3(merged, validationContext);
}

/**
 * Deterministically completes legal abstention coverage (E5 follow-up): the model is not
 * required to individually enumerate every uncertain source correctly — it only has to not
 * get it *wrong*. Given a `value` that has ALREADY passed a first
 * `validateAgt002PreviewModelOutput` pass (so every present `legal_findings` item, including
 * any human_legal_review one, is already known to be structurally well-formed: exact
 * abstention text, no documentary evidence_refs, citations drawn only from the package sent
 * to the model), this appends exactly one more well-formed `human_legal_review` finding
 * covering whichever `requiredHumanReviewCitationIds` (the deterministic
 * `legal_evidence.human_legal_review_items` from the input, never model-supplied) the model's
 * own findings did not already cite — and does nothing else.
 *
 * This never touches, reorders, or drops any existing finding of ANY classification
 * (tender_requirement / legal_obligation / company_evidence / inference / human_legal_review):
 * a malformed human_legal_review the model DID produce already threw in the first validation
 * pass and never reaches here; a well-formed one that only cites a subset is left exactly as
 * the model wrote it, with only the still-missing citations appended as a second finding. When
 * nothing is missing (or the input carries no deterministic uncertain sources at all), `value`
 * is returned unchanged. The caller must always re-run `validateAgt002PreviewModelOutput` with
 * the real `requireLegalAbstention` / `requiredHumanReviewCitationIds` on the result — this
 * function only ever produces input that pass should accept, never a bypass of it.
 */
export function completeAgt002PreviewLegalAbstention(value, { requiredHumanReviewCitationIds = [] } = {}) {
  if (!isRecord(value) || !Array.isArray(value.legal_findings)) return value;
  const required = [...new Set(Array.isArray(requiredHumanReviewCitationIds) ? requiredHumanReviewCitationIds : [])].sort();
  if (required.length === 0) return value;

  const humanReviewFindings = value.legal_findings.filter(item => isRecord(item) && item.classification === 'human_legal_review');
  const represented = new Set(humanReviewFindings.flatMap(item => Array.isArray(item.legal_citation_ids) ? item.legal_citation_ids : []));
  const missing = required.filter(citationId => !represented.has(citationId));
  if (missing.length === 0) return value;

  return {
    ...value,
    legal_findings: [
      ...value.legal_findings,
      { classification: 'human_legal_review', text: AGT002_LEGAL_HUMAN_REVIEW_STATEMENT, evidence_refs: [], legal_citation_ids: missing },
    ],
  };
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
