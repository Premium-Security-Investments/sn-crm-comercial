import { validateTenderAnalysisResult } from './tender-analysis-domain.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ENVELOPE_KEYS = [
  'schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'status', 'method',
  'recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified',
  'next_action', 'human_review_required', 'usage',
];
const FINDING_KEYS = ['id', 'text', 'critical', 'evidence_refs'];
const USAGE_KEYS = ['provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd'];
const SNAPSHOT_KEYS = ['snapshot_id', 'opportunity_id', 'tender_id', 'document_hash', 'profile_hash', 'documents', 'company_profile'];
const DOCUMENT_KEYS = ['document_id', 'name', 'document_type', 'content', 'content_sha256', 'current'];
const COMPANY_PROFILE_KEYS = ['profile_version', 'fields'];
const COMPANY_FIELD_KEYS = ['key', 'label', 'value', 'source'];
const RECOMMENDATIONS = new Set(['advance', 'advance_conditionally', 'pause', 'do_not_advance']);

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isUuid(value) {
  return UUID.test(String(value || ''));
}

function isSha256(value) {
  return SHA256.test(String(value || ''));
}

function validateFinding(item, field) {
  if (!exactKeys(item, FINDING_KEYS)
    || !nonEmptyString(item.id)
    || !nonEmptyString(item.text)
    || typeof item.critical !== 'boolean'
    || !Array.isArray(item.evidence_refs)
    || !item.evidence_refs.every((reference) => nonEmptyString(reference))) {
    throw new Error(`${field} debe contener hallazgos cerrados.`);
  }
}

function validateDocument(document) {
  return exactKeys(document, DOCUMENT_KEYS)
    && nonEmptyString(document.document_id)
    && nonEmptyString(document.name)
    && nonEmptyString(document.document_type)
    && typeof document.content === 'string'
    && isSha256(document.content_sha256)
    && typeof document.current === 'boolean';
}

function validateCompanyField(field) {
  return exactKeys(field, COMPANY_FIELD_KEYS)
    && typeof field.key === 'string'
    && typeof field.label === 'string'
    && typeof field.value === 'string'
    && (typeof field.source === 'string' || field.source === null);
}

function isValidSnapshot(snapshot) {
  return exactKeys(snapshot, SNAPSHOT_KEYS)
    && isUuid(snapshot.snapshot_id)
    && isUuid(snapshot.opportunity_id)
    && isUuid(snapshot.tender_id)
    && isSha256(snapshot.document_hash)
    && isSha256(snapshot.profile_hash)
    && Array.isArray(snapshot.documents)
    && snapshot.documents.every(validateDocument)
    && exactKeys(snapshot.company_profile, COMPANY_PROFILE_KEYS)
    && nonEmptyString(snapshot.company_profile.profile_version)
    && Array.isArray(snapshot.company_profile.fields)
    && snapshot.company_profile.fields.every(validateCompanyField);
}

export function validateAgt002TenderAnalysisRequest(snapshot) {
  if (!isValidSnapshot(snapshot)) {
    throw new Error('El snapshot SIIO está incompleto o no tiene la forma esperada.');
  }
  return snapshot;
}

export function validateAgt002TenderAnalysisEnvelope(value) {
  if (!exactKeys(value, ENVELOPE_KEYS)) throw new Error('El envelope AGT-002 debe ser cerrado.');
  if (value.schema_version !== '2.0-draft') throw new Error('La versión de esquema AGT-002 no es compatible.');
  if (value.agent_id !== 'AGT-002') throw new Error('El productor debe ser AGT-002.');
  if (!isUuid(value.run_id) || !isUuid(value.snapshot_id)) throw new Error('Run y snapshot deben ser UUID.');
  if (!nonEmptyString(value.policy_version)) throw new Error('La política debe ser texto.');
  if (value.status !== 'completed' || value.method !== 'agent_ai') throw new Error('El envelope AGT-002 no está completado.');
  if (!RECOMMENDATIONS.has(value.recommendation)) throw new Error('La recomendación AGT-002 no es válida.');
  if (!nonEmptyString(value.summary) || !nonEmptyString(value.next_action)) throw new Error('Resumen y siguiente acción son obligatorios.');
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
    if (!Array.isArray(value[field])) throw new Error(`${field} debe ser arreglo.`);
    value[field].forEach((item) => validateFinding(item, field));
  }
  if (!exactKeys(value.usage, USAGE_KEYS)
    || !nonEmptyString(value.usage.provider)
    || !nonEmptyString(value.usage.model)
    || !Number.isInteger(value.usage.input_tokens) || value.usage.input_tokens < 0
    || !Number.isInteger(value.usage.output_tokens) || value.usage.output_tokens < 0
    || typeof value.usage.cost_usd !== 'number' || !Number.isFinite(value.usage.cost_usd) || value.usage.cost_usd < 0) {
    throw new Error('El uso AGT-002 no es válido.');
  }
  return value;
}

/** Maps the closed institutional envelope into the shared tender domain without relabeling it. */
export function adaptAgt002TenderAnalysis(envelope) {
  const validated = validateAgt002TenderAnalysisEnvelope(envelope);
  return validateTenderAnalysisResult({ ...validated, producer: 'AGT-002' });
}
