import { deepStrictEqual } from 'node:assert';
import { validateTenderAnalysisResult } from './tender-analysis-domain.js';
import { validateAgt002IntegralAnalysisV3 } from './agt002-integral-analysis-v3.js';
import { projectAgt002IntegralV3ToV2 } from './agt002-v3-compatibility.js';
import { validateAgt002IntegralGovernanceProvenance } from './agt002-integral-governance-overrides.js';

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
  if (value.schema_version !== '2.0-preview.1') throw new Error('La versión de esquema AGT-002 no es compatible.');
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

// ---------------------------------------------------------------------------
// Task 5 (v3): a distinct, closed envelope shape (design section 4.2) — schema_version
// "3.0.0", carrying only `integral_analysis` plus governed run/context/coverage/corpus
// metadata. It intentionally does NOT accept the v2 envelope's keys (recommendation,
// strengths, ...) and the v2 validator above does not accept these v3 keys either: the
// two shapes reject each other's payload by construction, never a hybrid.
// ---------------------------------------------------------------------------

// v3's envelope carries the engine's own real output shape (design section 4.2/4.3): the
// `v2_projection` field the engine attaches for existing v2 readers, and a `usage` object
// with `rate_limit` (the codex_app_server provider never returns a cost figure) instead of
// v2's `cost_usd`. This is a DISTINCT closed shape from the v2 envelope/USAGE_KEYS above —
// v2 is untouched — reconciled here so the real producer (agt002-preview-engine.js
// runOnceV3) and this same-version consumer accept exactly the same object, never a
// hand-approximated fixture.
const ENVELOPE_KEYS_V3 = [
  'schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'context_version_id',
  'status', 'method', 'integral_analysis', 'evidence_coverage', 'legal_corpus_version_id',
  'human_review_required', 'v2_projection', 'usage',
];
const ENVELOPE_KEYS_V3_WITH_GOVERNANCE = [...ENVELOPE_KEYS_V3, 'governance_provenance'];
const USAGE_KEYS_V3 = ['provider', 'model', 'input_tokens', 'output_tokens', 'rate_limit'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates the closed AGT-002 v3 envelope. `integralValidationContext` is the governed
 * ground truth (ordered requirement manifest, company-evidence catalog, allowlists,
 * corpus version) the engine already assembled — never read from the payload.
 */
export function validateAgt002TenderAnalysisEnvelopeV3(value, integralValidationContext) {
  if (!exactKeys(value, ENVELOPE_KEYS_V3)
    && !exactKeys(value, ENVELOPE_KEYS_V3_WITH_GOVERNANCE)) {
    throw new Error('El envelope AGT-002 v3 debe ser cerrado.');
  }
  if (value.schema_version !== '3.0.0') throw new Error('La versión de esquema AGT-002 v3 no es compatible.');
  if (value.agent_id !== 'AGT-002') throw new Error('El productor debe ser AGT-002.');
  if (!isUuid(value.run_id) || !isUuid(value.snapshot_id)) throw new Error('Run y snapshot deben ser UUID.');
  if (value.context_version_id !== null && !isUuid(value.context_version_id)) {
    throw new Error('La versión de contexto AGT-002 v3 debe ser UUID o null.');
  }
  if (!nonEmptyString(value.policy_version)) throw new Error('La política debe ser texto.');
  if (value.status !== 'completed' || value.method !== 'agent_ai') throw new Error('El envelope AGT-002 v3 no está completado.');
  validateAgt002IntegralAnalysisV3(value.integral_analysis, integralValidationContext);
  if (!isPlainObject(value.evidence_coverage)) throw new Error('evidence_coverage AGT-002 v3 debe ser un objeto.');
  if (value.legal_corpus_version_id !== null && !isUuid(value.legal_corpus_version_id)) {
    throw new Error('legal_corpus_version_id AGT-002 v3 debe ser UUID o null.');
  }
  if (value.human_review_required !== true) throw new Error('La revisión humana es obligatoria.');
  if (value.governance_provenance !== undefined) {
    validateAgt002IntegralGovernanceProvenance(value.governance_provenance);
  }
  // Defense in depth (design section 9.9/11.9): the carried v2_projection is never trusted
  // as-is — it must equal, field for field, the deterministic projection this same module
  // derives from the already-validated integral_analysis. A hand-typed or stale projection
  // is rejected outright rather than silently persisted or adapted.
  const recomputedProjection = projectAgt002IntegralV3ToV2(value.integral_analysis);
  try {
    deepStrictEqual(value.v2_projection, recomputedProjection);
  } catch {
    throw new Error('v2_projection AGT-002 v3 no coincide con la proyección determinística recomputada desde integral_analysis.');
  }
  if (!exactKeys(value.usage, USAGE_KEYS_V3)
    || !nonEmptyString(value.usage.provider)
    || !nonEmptyString(value.usage.model)
    || !Number.isInteger(value.usage.input_tokens) || value.usage.input_tokens < 0
    || !Number.isInteger(value.usage.output_tokens) || value.usage.output_tokens < 0
    || (value.usage.rate_limit !== null && !isPlainObject(value.usage.rate_limit))) {
    throw new Error('El uso AGT-002 v3 no es válido.');
  }
  return value;
}

/**
 * Maps the closed v3 envelope into the shared tender domain result: validates the
 * envelope, derives the deterministic v2 projection from its `integral_analysis`, and
 * attaches only the governed identity fields the projection itself never owns.
 */
export function adaptAgt002TenderAnalysisV3(envelope, integralValidationContext) {
  const validated = validateAgt002TenderAnalysisEnvelopeV3(envelope, integralValidationContext);
  const projection = projectAgt002IntegralV3ToV2(validated.integral_analysis);
  return validateTenderAnalysisResult({
    ...projection,
    run_id: validated.run_id,
    snapshot_id: validated.snapshot_id,
    agent_id: validated.agent_id,
    method: validated.method,
    producer: 'AGT-002',
  });
}

const CONTINUITY_KEYS = [
  'opportunity_id', 'tender_id', 'snapshot_id', 'canonical_run_id',
  'context_version_id', 'legal_corpus_version_id', 'evidence_coverage', 'open_questions',
];
const EVIDENCE_COVERAGE_REF_KEYS = ['material_omissions', 'omitted_count'];

function isNullableUuid(value) {
  return value === null || isUuid(value);
}

function validateEvidenceCoverageRef(value) {
  if (!exactKeys(value, EVIDENCE_COVERAGE_REF_KEYS)
    || typeof value.material_omissions !== 'boolean'
    || !Number.isInteger(value.omitted_count) || value.omitted_count < 0) {
    throw new Error('La cobertura de evidencia de continuidad debe ser un resumen cerrado por referencia.');
  }
}

/**
 * Validates the closed, allowlisted set of references a post-GO Mesa carries forward from the
 * pre-GO case: opportunity, snapshot, canonical run, context version, evidence coverage, legal
 * corpus version, and open questions. Every field is an id/summary, never raw document or chunk
 * text, so this can never smuggle case content into a Mesa message.
 */
export function validateAgt002WorkbenchContinuityReference(value) {
  if (!exactKeys(value, CONTINUITY_KEYS)) throw new Error('La referencia de continuidad AGT-002 debe ser cerrada.');
  if (!isUuid(value.opportunity_id)) throw new Error('La referencia de continuidad AGT-002 requiere opportunity_id UUID.');
  if (!isUuid(value.tender_id)) throw new Error('La referencia de continuidad AGT-002 requiere tender_id UUID.');
  if (!isUuid(value.snapshot_id)) throw new Error('La referencia de continuidad AGT-002 requiere snapshot_id UUID.');
  if (!isUuid(value.canonical_run_id)) throw new Error('La referencia de continuidad AGT-002 requiere canonical_run_id UUID.');
  if (!isNullableUuid(value.context_version_id)) throw new Error('La versión de contexto de continuidad debe ser UUID o null.');
  if (!isNullableUuid(value.legal_corpus_version_id)) throw new Error('La versión del corpus jurídico de continuidad debe ser UUID o null.');
  validateEvidenceCoverageRef(value.evidence_coverage);
  if (!Array.isArray(value.open_questions)) throw new Error('Las preguntas abiertas de continuidad deben ser un arreglo.');
  value.open_questions.forEach((item) => validateFinding(item, 'open_questions'));
  return value;
}

/**
 * Builds the continuity reference from the already-validated AGT-002 envelope (snapshot_id,
 * run_id, and its closed `questions` findings) plus the caller-supplied case/version refs.
 * Never re-derives evidence from raw documents: it only carries ids the caller already has.
 */
export function buildAgt002WorkbenchContinuityReference(envelope, refs) {
  const validatedEnvelope = validateAgt002TenderAnalysisEnvelope(envelope);
  return validateAgt002WorkbenchContinuityReference({
    opportunity_id: refs?.opportunity_id,
    tender_id: refs?.tender_id,
    snapshot_id: validatedEnvelope.snapshot_id,
    canonical_run_id: validatedEnvelope.run_id,
    context_version_id: refs?.context_version_id ?? null,
    legal_corpus_version_id: refs?.legal_corpus_version_id ?? null,
    evidence_coverage: refs?.evidence_coverage,
    open_questions: validatedEnvelope.questions,
  });
}
