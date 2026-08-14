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
  AGT002_INTEGRAL_MILESTONE_STATUSES,
  AGT002_INTEGRAL_MILESTONE_TYPES,
  AGT002_INTEGRAL_PRESENCE_STATES,
  AGT002_INTEGRAL_REVIEW_STATES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_SUGGESTED_ROLES,
  AGT002_INTEGRAL_UNIT_KINDS,
  AGT002_INTEGRAL_VALIDITY_STATES,
  validateAgt002IntegralAnalysisV3,
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

const v3EvidenceStateSchema = v3ClosedObject({
  presence: { type: 'string', enum: [...AGT002_INTEGRAL_PRESENCE_STATES] },
  review: { type: 'string', enum: [...AGT002_INTEGRAL_REVIEW_STATES] },
  validity: { type: 'string', enum: [...AGT002_INTEGRAL_VALIDITY_STATES] },
  applicability: { type: 'string', enum: [...AGT002_INTEGRAL_APPLICABILITY_STATES] },
  compliance: { type: 'string', enum: [...AGT002_INTEGRAL_COMPLIANCE_STATES] },
});

const v3AnalysisUnitSchema = v3ClosedObject({
  unit_id: v3String(V3_WIRE_ID_MAX_LENGTH),
  unit_kind: { type: 'string', enum: [...AGT002_INTEGRAL_UNIT_KINDS] },
  requirement_id: v3NullableString(V3_WIRE_ID_MAX_LENGTH),
  category: { type: 'string', enum: [...AGT002_INTEGRAL_CATEGORIES] },
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
  evidence_state: v3EvidenceStateSchema,
  evidence_refs: {
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
      evidence_class_id: v3NullableString(V3_WIRE_ID_MAX_LENGTH),
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
    status: { type: 'string', enum: [...AGT002_INTEGRAL_LEGAL_STATUSES] },
    basis_refs: v3StringArray(),
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
  milestone: v3ClosedObject({
    status: { type: 'string', enum: [...AGT002_INTEGRAL_MILESTONE_STATUSES] },
    type: { type: 'string', enum: [...AGT002_INTEGRAL_MILESTONE_TYPES] },
    at: v3NullableString(),
    source_ref: v3NullableString(),
    summary: v3String(),
  }),
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

/** Closed JSON Schema handed to the model's turn/start for the v3 contract (Task 5). */
export function buildAgt002IntegralAnalysisV3OutputJsonSchema() {
  return v3ClosedObject({
    // Cross-field invariants, governed allowlists and exact coverage/order remain enforced
    // server-side by validateAgt002IntegralAnalysisV3. This wire schema mirrors only the
    // complete closed structural shape required by Codex Structured Outputs.
    integral_analysis: v3ClosedObject({
      contract_version: { type: 'string', const: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION },
      coverage: v3ClosedObject({
        manifest_version: v3String(V3_WIRE_ID_MAX_LENGTH),
        expected_requirement_ids: v3StringArray(),
        analyzed_requirement_ids: v3StringArray(),
        material_omissions: { type: 'boolean' },
        omission_reasons: v3StringArray(V3_WIRE_TEXT_MAX_LENGTH),
        company_evidence_manifest_version: v3String(V3_WIRE_ID_MAX_LENGTH),
        company_evidence_class_ids: v3StringArray(),
        legal_corpus_version_id: v3NullableString(),
      }),
      analysis_units: { type: 'array', minItems: 1, maxItems: V3_WIRE_ARRAY_MAX_ITEMS, items: v3AnalysisUnitSchema },
    }),
  });
}

/**
 * Validates a v3 model turn: rejects anything other than the single `integral_analysis`
 * key, then delegates the payload itself to the pure v3 validator with the caller-
 * supplied governed `validationContext` (manifest/allowlists/corpus). This function owns
 * only the "nothing besides integral_analysis was smuggled onto the turn" boundary.
 */
export function validateAgt002PreviewModelOutputV3(value, validationContext) {
  if (!isRecord(value) || !exactKeys(value, INTEGRAL_MODEL_OUTPUT_KEYS)) {
    throw new Error('La salida de AGT-002 Preview v3 debe exponer únicamente la clave integral_analysis.');
  }
  return validateAgt002IntegralAnalysisV3(value.integral_analysis, validationContext);
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
