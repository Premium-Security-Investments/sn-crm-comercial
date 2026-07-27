export const AGT002_PREVIEW_SCHEMA_VERSION = '2.0-preview.1';
export const AGT002_PREVIEW_RECOMMENDATIONS = new Set(['advance', 'advance_conditionally', 'pause', 'do_not_advance']);

const MODEL_OUTPUT_KEYS = ['recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required'];
const FINDING_KEYS = ['id', 'text', 'critical', 'evidence_refs'];
const FINDING_ARRAYS = ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified'];

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

/** Derives the closed set of citable evidence ids from the exact input sent to the model. */
export function collectAgt002PreviewEvidenceIds(previewInput) {
  const documents = Array.isArray(previewInput?.documents) ? previewInput.documents : [];
  const ids = new Set();
  for (const document of documents) {
    if (nonEmptyString(document?.evidence_id)) ids.add(document.evidence_id);
  }
  return [...ids].sort();
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
export function validateAgt002PreviewModelOutput(value, { allowedEvidenceIds = [] } = {}) {
  if (!isRecord(value)) {
    throw new Error('La salida de AGT-002 Preview debe ser un objeto JSON con estructura cerrada.');
  }
  const missing = MODEL_OUTPUT_KEYS.filter(key => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter(key => !MODEL_OUTPUT_KEYS.includes(key));
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
  return value;
}
