// AGT-002 integral analysis v3 — closed contract and structural validator.
//
// This module is a pure function library: no globals, no database access, no I/O. The
// caller (a future engine wiring, out of scope for this block) supplies both the
// untrusted model-shaped `value` and a `validationContext` carrying the governed ground
// truth (ordered requirement manifest, company-evidence catalog/version, legal corpus
// version, per-source-type reference allowlists and whether retrieval actually observed
// material omissions). Nothing here is inferred from the payload itself: every claim the
// payload makes about coverage, evidence or state is checked against that governed
// context, never trusted verbatim.
//
// Design: docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-design.md
// Audit:  docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION = 'agt002-integral-analysis-v3';

// ---------------------------------------------------------------------------
// Closed enum sets (7.1 - 7.13 of the design).
// ---------------------------------------------------------------------------

export const AGT002_INTEGRAL_UNIT_KINDS = Object.freeze(['tender_requirement', 'strategic_consideration']);

// Canonical institutional order: discard -> habilitating -> technical ->
// financial_execution -> strategic. The numeric rank below is the single source of truth
// for "category order violation" checks; it is never re-derived from array position.
export const AGT002_INTEGRAL_CATEGORIES = Object.freeze(['discard', 'habilitating', 'technical', 'financial_execution', 'strategic']);
const CATEGORY_RANK = new Map(AGT002_INTEGRAL_CATEGORIES.map((category, index) => [category, index + 1]));
const FORMAL_CATEGORIES = new Set(['discard', 'habilitating', 'technical', 'financial_execution']);

export const AGT002_INTEGRAL_ASSESSMENT_MODES = Object.freeze(['assessed', 'abstained']);

export const AGT002_INTEGRAL_CONCLUSION_STATUSES = Object.freeze([
  'supported_with_evidence', 'partially_supported', 'gap_evidenced', 'insufficient_evidence', 'human_validation_required',
]);
export const AGT002_INTEGRAL_CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low', 'unavailable']);

export const AGT002_INTEGRAL_BLOCKING_EFFECTS = Object.freeze(['blocker', 'conditional', 'non_blocking', 'undetermined']);
export const AGT002_INTEGRAL_BLOCKING_CURABILITY = Object.freeze(['curable', 'not_curable', 'undetermined', 'not_applicable']);

export const AGT002_INTEGRAL_PRESENCE_STATES = Object.freeze(['present', 'absent', 'unknown']);
export const AGT002_INTEGRAL_REVIEW_STATES = Object.freeze(['reviewed', 'partially_reviewed', 'not_reviewed']);
export const AGT002_INTEGRAL_VALIDITY_STATES = Object.freeze(['valid', 'expired', 'unknown', 'not_applicable']);
export const AGT002_INTEGRAL_APPLICABILITY_STATES = Object.freeze(['applicable', 'not_applicable', 'unknown']);
export const AGT002_INTEGRAL_COMPLIANCE_STATES = Object.freeze([
  'supported_pending_human_review', 'partially_supported_pending_human_review', 'gap_evidenced_pending_human_review', 'unknown',
]);

export const AGT002_INTEGRAL_SOURCE_TYPES = Object.freeze([
  'tender_document', 'company_evidence', 'legal_corpus', 'human_evidence', 'objective_validation',
]);
export const AGT002_INTEGRAL_EVIDENCE_PURPOSES = Object.freeze([
  'requirement_basis', 'company_capacity', 'legal_basis', 'commercial_context', 'milestone_basis', 'gap_basis',
]);

export const AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS = Object.freeze(['critical', 'high', 'medium', 'low', 'unknown']);
export const AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS = Object.freeze([
  'eligibility', 'competitiveness', 'delivery_capacity', 'financial_exposure', 'strategic_fit', 'unknown',
]);

export const AGT002_INTEGRAL_LEGAL_STATUSES = Object.freeze([
  'supported', 'partially_supported', 'unsupported', 'not_verified', 'not_applicable',
]);

export const AGT002_INTEGRAL_ACTION_TYPES = Object.freeze([
  'obtain_evidence', 'verify_validity', 'validate_applicability', 'remediate_gap',
  'estimate_delivery', 'estimate_financial_exposure', 'human_decision',
]);
export const AGT002_INTEGRAL_SUGGESTED_ROLES = Object.freeze([
  'tender_lead', 'legal', 'commercial', 'technical', 'financial', 'operations', 'management', 'authorized_human',
]);
export const AGT002_INTEGRAL_ACTION_PRIORITIES = Object.freeze(['critical', 'high', 'medium', 'low']);

export const AGT002_INTEGRAL_MILESTONE_STATUSES = Object.freeze(['verified', 'unverified', 'not_identified']);
export const AGT002_INTEGRAL_MILESTONE_TYPES = Object.freeze([
  'submission_deadline', 'clarification_deadline', 'cure_deadline', 'visit', 'hearing',
  'execution_start', 'execution_duration', 'internal_review', 'other', 'none',
]);

export const AGT002_INTEGRAL_ESCALATION_LEVELS = Object.freeze(['role_review', 'cross_functional', 'committee', 'management', 'none']);

export const AGT002_INTEGRAL_CLOSURE_STATUSES = Object.freeze(['open', 'evidence_satisfied', 'human_confirmation_required']);

// ---------------------------------------------------------------------------
// Closed key sets, one per nesting level of the contract (design section 5-7).
// ---------------------------------------------------------------------------

const TOP_LEVEL_KEYS = ['contract_version', 'coverage', 'analysis_units'];
const COVERAGE_KEYS = [
  'manifest_version', 'expected_requirement_ids', 'analyzed_requirement_ids', 'material_omissions',
  'omission_reasons', 'company_evidence_manifest_version', 'company_evidence_class_ids', 'legal_corpus_version_id',
];
const UNIT_KEYS = [
  'unit_id', 'unit_kind', 'requirement_id', 'category', 'sequence', 'title', 'assessment_mode',
  'conclusion', 'blocking', 'evidence_state', 'evidence_refs', 'missing_evidence', 'commercial_impact',
  'legal_assessment', 'actions', 'milestone', 'escalation', 'closure', 'human_validation',
];
const CONCLUSION_KEYS = ['status', 'summary', 'confidence'];
const BLOCKING_KEYS = ['effect', 'curability', 'reason'];
const EVIDENCE_STATE_KEYS = ['presence', 'review', 'validity', 'applicability', 'compliance'];
const EVIDENCE_REF_KEYS = ['ref', 'source_type', 'purpose'];
const MISSING_EVIDENCE_KEYS = ['missing_id', 'evidence_class_id', 'needed_source_type', 'reason', 'critical'];
const COMMERCIAL_IMPACT_KEYS = ['level', 'summary', 'dimension'];
const LEGAL_ASSESSMENT_KEYS = ['status', 'basis_refs', 'summary', 'human_legal_review_required'];
const ACTION_KEYS = ['action_id', 'action_type', 'summary', 'basis_unit_id', 'suggested_role', 'priority', 'external_side_effect'];
const MILESTONE_KEYS = ['status', 'type', 'at', 'source_ref', 'summary'];
const ESCALATION_KEYS = ['required', 'level', 'reason'];
const CLOSURE_KEYS = ['status', 'condition', 'evidence_required'];
const HUMAN_VALIDATION_KEYS = ['required', 'status', 'reason'];

// ---------------------------------------------------------------------------
// Size/length bounds (design 11.2: "Límites de tamaño por summary/reason/condition y
// máximos por arreglo"). Chosen conservatively; every value here is a synthesis, never
// raw document/chunk text, so short bounds are intentional, not accidental.
// ---------------------------------------------------------------------------

const ID_MAX_LENGTH = 120;
const TITLE_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 600;
const ARRAY_MAX_ITEMS = 30;

// ---------------------------------------------------------------------------
// Sensitive-key deny list (design 7.5/11.4-11.5): defense in depth. Every closed key
// set above already excludes these by construction, so this only fires if a caller
// hands in an object built by other means (e.g. spreading raw provider output without
// going through this contract first).
// ---------------------------------------------------------------------------

const PROHIBITED_KEY_NAMES = new Set([
  'excerpt', 'chunk_text', 'raw_text', 'text', 'content', 'document_text', 'prompt', 'instructions',
  'person_name', 'full_name', 'name', 'email', 'phone', 'address', 'bank_account', 'account_number',
  'weapon', 'weapon_serial', 'credential', 'password', 'api_key', 'secret', 'ssn', 'national_id', 'national_id_number',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// `code`, when given, is attached as `error.code` — but ONLY ever a fixed literal passed by
// the caller at the (few) call sites below whose message never interpolates a model-supplied
// id/path/value. It must never be derived from `message` itself.
function fail(message, code) {
  const error = new Error(`AGT-002 integral-analysis-v3: ${message}`);
  if (code) error.code = code;
  throw error;
}

function exactKeys(value, expected, label, code) {
  if (!isRecord(value)) fail(`${label} debe ser un objeto.`, code);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every(key => Object.hasOwn(value, key))) {
    fail(`${label} tiene claves no permitidas o incompletas (contrato cerrado).`, code);
  }
  return value;
}

function assertNoProhibitedKeys(value, path = 'integral_analysis') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoProhibitedKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (PROHIBITED_KEY_NAMES.has(key)) {
      fail(`clave sensible o de contenido bruto no permitida: ${path}.${key}.`);
    }
    assertNoProhibitedKeys(value[key], `${path}.${key}`);
  }
}

function boundedString(value, maxLength, label) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail(`${label} debe ser texto no vacío y acotado (máx. ${maxLength} caracteres).`);
  }
  return value;
}

function nullableAllowlistedRef(value, allowedIds, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !allowedIds.includes(value)) {
    fail(`${label} debe ser null o un identificador permitido del catálogo.`);
  }
  return value;
}

function boundedArray(value, maxItems, label) {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(`${label} debe ser un arreglo acotado (máx. ${maxItems} elementos).`);
  }
  return value;
}

function requireEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    fail(`${label} no es un valor permitido: ${String(value)}.`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} debe ser booleano.`);
  return value;
}

function requirePositiveInt(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} debe ser un entero positivo.`);
  return value;
}

// ---------------------------------------------------------------------------
// Validation context normalization. The context is governed input assembled by the
// (future) engine layer, not part of the untrusted payload — but it is still checked
// defensively here since a malformed context would otherwise silently produce a
// meaningless validation pass.
// ---------------------------------------------------------------------------

function normalizeValidationContext(rawContext) {
  if (!isRecord(rawContext)) fail('validationContext debe ser un objeto.');
  const {
    requirementManifestVersion, requirementManifest, companyEvidenceManifestVersion,
    companyEvidenceClassIds, legalCorpusVersionId, allowlist, materialOmissionsObserved,
    evidenceStateManifest,
  } = rawContext;

  if (typeof requirementManifestVersion !== 'string' || !requirementManifestVersion.trim()) {
    fail('validationContext.requirementManifestVersion debe ser texto no vacío.');
  }
  if (!Array.isArray(requirementManifest) || requirementManifest.length === 0) {
    fail('validationContext.requirementManifest debe ser un arreglo no vacío.');
  }
  const seenManifestIds = new Set();
  for (const entry of requirementManifest) {
    if (!isRecord(entry) || typeof entry.requirement_id !== 'string' || !entry.requirement_id.trim()) {
      fail('validationContext.requirementManifest tiene una entrada con requirement_id inválido.');
    }
    if (!FORMAL_CATEGORIES.has(entry.category)) {
      fail(`validationContext.requirementManifest tiene una categoría formal inválida para ${entry.requirement_id}.`);
    }
    if (seenManifestIds.has(entry.requirement_id)) {
      fail(`validationContext.requirementManifest tiene requirement_id duplicado: ${entry.requirement_id}.`);
    }
    seenManifestIds.add(entry.requirement_id);
  }

  if (typeof companyEvidenceManifestVersion !== 'string' || !companyEvidenceManifestVersion.trim()) {
    fail('validationContext.companyEvidenceManifestVersion debe ser texto no vacío.');
  }
  if (!Array.isArray(companyEvidenceClassIds)) fail('validationContext.companyEvidenceClassIds debe ser un arreglo.');
  if (legalCorpusVersionId !== null && (typeof legalCorpusVersionId !== 'string' || !legalCorpusVersionId.trim())) {
    fail('validationContext.legalCorpusVersionId debe ser texto no vacío o null.');
  }
  if (!isRecord(allowlist)) fail('validationContext.allowlist debe ser un objeto.');
  const normalizedAllowlist = {};
  for (const sourceType of AGT002_INTEGRAL_SOURCE_TYPES) {
    const ids = allowlist[sourceType];
    if (!Array.isArray(ids)) fail(`validationContext.allowlist.${sourceType} debe ser un arreglo.`);
    normalizedAllowlist[sourceType] = new Set(ids);
  }
  if (typeof materialOmissionsObserved !== 'boolean') {
    fail('validationContext.materialOmissionsObserved debe ser booleano.');
  }

  // Governed evidence-state map (audit P0 "cumplimiento inferido por presencia"): the
  // ONLY source of truth for a tender_requirement unit's evidence_state, one entry per
  // requirement_id, 1:1 with requirementManifest — never partial, never supplied by the
  // model. See buildAgt002EvidenceStateManifest (agt002-evidence-state-manifest.js) for
  // how a real caller assembles this fail-closed.
  if (!Array.isArray(evidenceStateManifest)) {
    fail('validationContext.evidenceStateManifest debe ser un arreglo (mapa gobernado de evidence_state por requirement_id).');
  }
  const evidenceStateByRequirementId = new Map();
  evidenceStateManifest.forEach((entry, index) => {
    const label = `validationContext.evidenceStateManifest[${index}]`;
    exactKeys(entry, ['requirement_id', 'evidence_state', 'rule_id', 'provenance'], label);
    if (typeof entry.requirement_id !== 'string' || !entry.requirement_id.trim()) {
      fail(`${label}.requirement_id debe ser texto no vacío.`);
    }
    if (!requirementManifest.some(manifestEntry => manifestEntry.requirement_id === entry.requirement_id)) {
      fail(`${label}.requirement_id no está en el manifiesto gobernado: ${entry.requirement_id}.`);
    }
    if (evidenceStateByRequirementId.has(entry.requirement_id)) {
      fail(`${label}.requirement_id duplicado en evidenceStateManifest: ${entry.requirement_id}.`);
    }
    validateEvidenceStateShape(entry.evidence_state, `${label}.evidence_state`);
    if (typeof entry.rule_id !== 'string' || !entry.rule_id.trim()) fail(`${label}.rule_id debe ser texto no vacío.`);
    if (entry.provenance !== null && !isRecord(entry.provenance)) fail(`${label}.provenance debe ser null o un objeto.`);
    evidenceStateByRequirementId.set(entry.requirement_id, entry.evidence_state);
  });
  for (const manifestEntry of requirementManifest) {
    if (!evidenceStateByRequirementId.has(manifestEntry.requirement_id)) {
      fail(`validationContext.evidenceStateManifest no cubre el requisito gobernado ${manifestEntry.requirement_id} (cobertura 1:1 obligatoria).`);
    }
  }

  return {
    requirementManifestVersion,
    requirementManifest,
    requirementManifestById: new Map(requirementManifest.map(entry => [entry.requirement_id, entry])),
    companyEvidenceManifestVersion,
    companyEvidenceClassIds,
    legalCorpusVersionId,
    allowlist: normalizedAllowlist,
    materialOmissionsObserved,
    evidenceStateByRequirementId,
  };
}

// ---------------------------------------------------------------------------
// Coverage validation (design section 5).
// ---------------------------------------------------------------------------

function validateCoverage(coverage, ctx) {
  exactKeys(coverage, COVERAGE_KEYS, 'integral_analysis.coverage', 'v3_invalid_coverage_shape');

  if (coverage.manifest_version !== ctx.requirementManifestVersion) {
    fail('coverage.manifest_version no coincide con la versión gobernada del manifiesto.', 'v3_coverage_manifest_version_mismatch');
  }

  const expectedIds = ctx.requirementManifest.map(entry => entry.requirement_id);
  if (!Array.isArray(coverage.expected_requirement_ids)
    || coverage.expected_requirement_ids.length !== expectedIds.length
    || coverage.expected_requirement_ids.some((id, index) => id !== expectedIds[index])) {
    fail(
      'coverage.expected_requirement_ids debe coincidir exactamente, en orden, con el manifiesto gobernado.',
      'v3_coverage_expected_requirement_ids_mismatch',
    );
  }

  // Design section 5, invariant 3: analyzed_requirement_ids must coincide EXACTLY, in the
  // same order, with expected_requirement_ids — never a mere duplicate-free subset of the
  // governed manifest. A partial or reordered list would silently understate coverage.
  if (!Array.isArray(coverage.analyzed_requirement_ids)
    || coverage.analyzed_requirement_ids.length !== expectedIds.length
    || coverage.analyzed_requirement_ids.some((id, index) => id !== expectedIds[index])) {
    fail(
      'coverage.analyzed_requirement_ids debe coincidir exactamente, en el mismo orden, con expected_requirement_ids/el manifiesto gobernado.',
      'v3_coverage_analyzed_requirement_ids_mismatch',
    );
  }

  requireBoolean(coverage.material_omissions, 'coverage.material_omissions');
  boundedArray(coverage.omission_reasons, ARRAY_MAX_ITEMS, 'coverage.omission_reasons');
  coverage.omission_reasons.forEach((reason, index) => boundedString(reason, TEXT_MAX_LENGTH, `coverage.omission_reasons[${index}]`));

  if (coverage.company_evidence_manifest_version !== ctx.companyEvidenceManifestVersion) {
    fail(
      'coverage.company_evidence_manifest_version no coincide con la versión gobernada del catálogo de 17 clases.',
      'v3_coverage_company_evidence_manifest_version_mismatch',
    );
  }
  const expectedClassIds = [...ctx.companyEvidenceClassIds].sort();
  const actualClassIds = Array.isArray(coverage.company_evidence_class_ids) ? [...coverage.company_evidence_class_ids].sort() : null;
  if (
    !Array.isArray(coverage.company_evidence_class_ids)
    || actualClassIds.length !== expectedClassIds.length
    || actualClassIds.some((id, index) => id !== expectedClassIds[index])
  ) {
    fail(
      'coverage.company_evidence_class_ids debe coincidir exactamente con las 17 clases empresariales gobernadas.',
      'v3_coverage_company_evidence_class_ids_mismatch',
    );
  }

  if (coverage.legal_corpus_version_id !== ctx.legalCorpusVersionId) {
    fail('coverage.legal_corpus_version_id no coincide con la versión de corpus jurídico gobernada.', 'v3_coverage_legal_corpus_version_mismatch');
  }
}

// ---------------------------------------------------------------------------
// Per-unit nested-object validators (structural shape only — Task 2).
// ---------------------------------------------------------------------------

function validateConclusion(conclusion, unitId) {
  exactKeys(conclusion, CONCLUSION_KEYS, `analysis_units[${unitId}].conclusion`);
  requireEnum(conclusion.status, AGT002_INTEGRAL_CONCLUSION_STATUSES, `analysis_units[${unitId}].conclusion.status`);
  boundedString(conclusion.summary, TEXT_MAX_LENGTH, `analysis_units[${unitId}].conclusion.summary`);
  requireEnum(conclusion.confidence, AGT002_INTEGRAL_CONFIDENCE_LEVELS, `analysis_units[${unitId}].conclusion.confidence`);
}

function validateBlocking(blocking, unitId) {
  exactKeys(blocking, BLOCKING_KEYS, `analysis_units[${unitId}].blocking`);
  requireEnum(blocking.effect, AGT002_INTEGRAL_BLOCKING_EFFECTS, `analysis_units[${unitId}].blocking.effect`);
  requireEnum(blocking.curability, AGT002_INTEGRAL_BLOCKING_CURABILITY, `analysis_units[${unitId}].blocking.curability`);
  boundedString(blocking.reason, TEXT_MAX_LENGTH, `analysis_units[${unitId}].blocking.reason`);
}

// Shared shape/enum check for an evidence_state object, reused both for a unit's own
// evidence_state (label rooted at analysis_units[...]) and for each governed entry in
// validationContext.evidenceStateManifest (label rooted at validationContext...) — same
// closed contract either way.
function validateEvidenceStateShape(evidenceState, label) {
  exactKeys(evidenceState, EVIDENCE_STATE_KEYS, label);
  requireEnum(evidenceState.presence, AGT002_INTEGRAL_PRESENCE_STATES, `${label}.presence`);
  requireEnum(evidenceState.review, AGT002_INTEGRAL_REVIEW_STATES, `${label}.review`);
  requireEnum(evidenceState.validity, AGT002_INTEGRAL_VALIDITY_STATES, `${label}.validity`);
  requireEnum(evidenceState.applicability, AGT002_INTEGRAL_APPLICABILITY_STATES, `${label}.applicability`);
  requireEnum(evidenceState.compliance, AGT002_INTEGRAL_COMPLIANCE_STATES, `${label}.compliance`);
}

function validateEvidenceState(evidenceState, unitId) {
  validateEvidenceStateShape(evidenceState, `analysis_units[${unitId}].evidence_state`);
}

// Task 3 (design 7.5): a reference's purpose constrains which source types may satisfy
// it. This stops a model from citing e.g. company_evidence as the basis for a legal
// conclusion just because the closed enum permits the (source_type, purpose) pair in
// isolation.
const PURPOSE_ALLOWED_SOURCE_TYPES = new Map([
  ['requirement_basis', new Set(['tender_document', 'objective_validation'])],
  ['company_capacity', new Set(['company_evidence'])],
  ['legal_basis', new Set(['legal_corpus'])],
  ['commercial_context', new Set(['human_evidence', 'objective_validation', 'tender_document'])],
  ['milestone_basis', new Set(['tender_document', 'human_evidence', 'legal_corpus', 'objective_validation'])],
  ['gap_basis', new Set(['tender_document', 'human_evidence', 'objective_validation'])],
]);

function validateEvidenceRefs(evidenceRefs, unitId, ctx) {
  boundedArray(evidenceRefs, ARRAY_MAX_ITEMS, `analysis_units[${unitId}].evidence_refs`);
  const seenPairs = new Set();
  for (const [index, entry] of evidenceRefs.entries()) {
    const label = `analysis_units[${unitId}].evidence_refs[${index}]`;
    exactKeys(entry, EVIDENCE_REF_KEYS, label);
    boundedString(entry.ref, ID_MAX_LENGTH, `${label}.ref`);
    requireEnum(entry.source_type, AGT002_INTEGRAL_SOURCE_TYPES, `${label}.source_type`);
    requireEnum(entry.purpose, AGT002_INTEGRAL_EVIDENCE_PURPOSES, `${label}.purpose`);
    if (!ctx.allowlist[entry.source_type].has(entry.ref)) {
      fail(`${label}.ref no está en la allowlist de ${entry.source_type}: ${entry.ref}.`);
    }
    if (!PURPOSE_ALLOWED_SOURCE_TYPES.get(entry.purpose).has(entry.source_type)) {
      fail(`${label}: purpose "${entry.purpose}" no admite source_type "${entry.source_type}" (desajuste fuente/propósito).`);
    }
    const pairKey = `${entry.ref}::${entry.purpose}`;
    if (seenPairs.has(pairKey)) fail(`${label} referencia duplicada (ref, purpose) dentro de la misma unidad.`);
    seenPairs.add(pairKey);
  }
}

function validateMissingEvidence(missingEvidence, unitId, ctx) {
  boundedArray(missingEvidence, ARRAY_MAX_ITEMS, `analysis_units[${unitId}].missing_evidence`);
  const seenIds = new Set();
  for (const [index, entry] of missingEvidence.entries()) {
    const label = `analysis_units[${unitId}].missing_evidence[${index}]`;
    exactKeys(entry, MISSING_EVIDENCE_KEYS, label);
    boundedString(entry.missing_id, ID_MAX_LENGTH, `${label}.missing_id`);
    if (seenIds.has(entry.missing_id)) fail(`${label}.missing_id duplicado dentro de la misma unidad.`);
    seenIds.add(entry.missing_id);
    nullableAllowlistedRef(entry.evidence_class_id, ctx.companyEvidenceClassIds, `${label}.evidence_class_id`);
    requireEnum(entry.needed_source_type, AGT002_INTEGRAL_SOURCE_TYPES, `${label}.needed_source_type`);
    boundedString(entry.reason, TEXT_MAX_LENGTH, `${label}.reason`);
    requireBoolean(entry.critical, `${label}.critical`);
  }
}

function validateCommercialImpact(commercialImpact, unitId) {
  exactKeys(commercialImpact, COMMERCIAL_IMPACT_KEYS, `analysis_units[${unitId}].commercial_impact`);
  requireEnum(commercialImpact.level, AGT002_INTEGRAL_COMMERCIAL_IMPACT_LEVELS, `analysis_units[${unitId}].commercial_impact.level`);
  boundedString(commercialImpact.summary, TEXT_MAX_LENGTH, `analysis_units[${unitId}].commercial_impact.summary`);
  requireEnum(commercialImpact.dimension, AGT002_INTEGRAL_COMMERCIAL_IMPACT_DIMENSIONS, `analysis_units[${unitId}].commercial_impact.dimension`);
}

function validateLegalAssessment(legalAssessment, unitId, ctx) {
  exactKeys(legalAssessment, LEGAL_ASSESSMENT_KEYS, `analysis_units[${unitId}].legal_assessment`);
  requireEnum(legalAssessment.status, AGT002_INTEGRAL_LEGAL_STATUSES, `analysis_units[${unitId}].legal_assessment.status`);
  boundedArray(legalAssessment.basis_refs, ARRAY_MAX_ITEMS, `analysis_units[${unitId}].legal_assessment.basis_refs`);
  for (const [index, ref] of legalAssessment.basis_refs.entries()) {
    const label = `analysis_units[${unitId}].legal_assessment.basis_refs[${index}]`;
    boundedString(ref, ID_MAX_LENGTH, label);
    if (!ctx.allowlist.legal_corpus.has(ref)) fail(`${label} no está en la allowlist del corpus jurídico publicado: ${ref}.`);
  }
  boundedString(legalAssessment.summary, TEXT_MAX_LENGTH, `analysis_units[${unitId}].legal_assessment.summary`);
  requireBoolean(legalAssessment.human_legal_review_required, `analysis_units[${unitId}].legal_assessment.human_legal_review_required`);
}

function validateActions(actions, unitId) {
  boundedArray(actions, ARRAY_MAX_ITEMS, `analysis_units[${unitId}].actions`);
  const seenIds = new Set();
  for (const [index, action] of actions.entries()) {
    const label = `analysis_units[${unitId}].actions[${index}]`;
    exactKeys(action, ACTION_KEYS, label);
    boundedString(action.action_id, ID_MAX_LENGTH, `${label}.action_id`);
    if (seenIds.has(action.action_id)) fail(`${label}.action_id duplicado dentro de la misma unidad.`);
    seenIds.add(action.action_id);
    requireEnum(action.action_type, AGT002_INTEGRAL_ACTION_TYPES, `${label}.action_type`);
    boundedString(action.summary, TEXT_MAX_LENGTH, `${label}.summary`);
    boundedString(action.basis_unit_id, ID_MAX_LENGTH, `${label}.basis_unit_id`);
    if (action.basis_unit_id !== unitId) fail(`${label}.basis_unit_id debe coincidir con el unit_id contenedor.`);
    requireEnum(action.suggested_role, AGT002_INTEGRAL_SUGGESTED_ROLES, `${label}.suggested_role`);
    requireEnum(action.priority, AGT002_INTEGRAL_ACTION_PRIORITIES, `${label}.priority`);
    if (action.external_side_effect !== false) fail(`${label}.external_side_effect debe ser siempre false en el envelope de IA.`);
  }
}

function validateMilestone(milestone, unitId, ctx) {
  exactKeys(milestone, MILESTONE_KEYS, `analysis_units[${unitId}].milestone`);
  requireEnum(milestone.status, AGT002_INTEGRAL_MILESTONE_STATUSES, `analysis_units[${unitId}].milestone.status`);
  requireEnum(milestone.type, AGT002_INTEGRAL_MILESTONE_TYPES, `analysis_units[${unitId}].milestone.type`);
  if (milestone.at !== null) {
    if (typeof milestone.at !== 'string' || Number.isNaN(Date.parse(milestone.at))) {
      fail(`analysis_units[${unitId}].milestone.at debe ser null o una fecha ISO-8601 válida.`);
    }
  }
  if (milestone.source_ref !== null) {
    const allAllowlisted = new Set([...ctx.allowlist.tender_document, ...ctx.allowlist.human_evidence, ...ctx.allowlist.legal_corpus, ...ctx.allowlist.objective_validation]);
    if (typeof milestone.source_ref !== 'string' || !allAllowlisted.has(milestone.source_ref)) {
      fail(`analysis_units[${unitId}].milestone.source_ref debe ser null o una referencia permitida.`);
    }
  }
  boundedString(milestone.summary, TEXT_MAX_LENGTH, `analysis_units[${unitId}].milestone.summary`);

  // Task 3 (design 7.10): a verified milestone must be traceable to a concrete date and
  // source; an unidentified milestone must not smuggle in either.
  if (milestone.status === 'verified' && (milestone.at === null || milestone.source_ref === null)) {
    fail(`analysis_units[${unitId}].milestone: status "verified" exige "at" y "source_ref" no nulos.`);
  }
  if (milestone.status === 'not_identified' && (milestone.at !== null || milestone.source_ref !== null)) {
    fail(`analysis_units[${unitId}].milestone: status "not_identified" exige "at" y "source_ref" nulos.`);
  }
}

function validateEscalation(escalation, unitId) {
  exactKeys(escalation, ESCALATION_KEYS, `analysis_units[${unitId}].escalation`);
  requireBoolean(escalation.required, `analysis_units[${unitId}].escalation.required`);
  requireEnum(escalation.level, AGT002_INTEGRAL_ESCALATION_LEVELS, `analysis_units[${unitId}].escalation.level`);
  boundedString(escalation.reason, TEXT_MAX_LENGTH, `analysis_units[${unitId}].escalation.reason`);

  // Task 3 (design 7.11): "required: false exige level: none" and the converse — a
  // named level implies escalation was in fact required.
  if (escalation.required === false && escalation.level !== 'none') {
    fail(`analysis_units[${unitId}].escalation: required=false exige level="none".`);
  }
  if (escalation.required === true && escalation.level === 'none') {
    fail(`analysis_units[${unitId}].escalation: required=true exige un level distinto de "none".`);
  }
}

function validateClosure(closure, unitId) {
  exactKeys(closure, CLOSURE_KEYS, `analysis_units[${unitId}].closure`);
  requireEnum(closure.status, AGT002_INTEGRAL_CLOSURE_STATUSES, `analysis_units[${unitId}].closure.status`);
  boundedString(closure.condition, TEXT_MAX_LENGTH, `analysis_units[${unitId}].closure.condition`);
  boundedArray(closure.evidence_required, ARRAY_MAX_ITEMS, `analysis_units[${unitId}].closure.evidence_required`);
  closure.evidence_required.forEach((item, index) => boundedString(item, ID_MAX_LENGTH, `analysis_units[${unitId}].closure.evidence_required[${index}]`));
}

function validateHumanValidation(humanValidation, unitId) {
  exactKeys(humanValidation, HUMAN_VALIDATION_KEYS, `analysis_units[${unitId}].human_validation`);
  if (humanValidation.required !== true) fail(`analysis_units[${unitId}].human_validation.required debe ser true en el envelope de IA.`);
  if (humanValidation.status !== 'pending') fail(`analysis_units[${unitId}].human_validation.status debe ser "pending" en el envelope de IA.`);
  boundedString(humanValidation.reason, TEXT_MAX_LENGTH, `analysis_units[${unitId}].human_validation.reason`);
}

// ---------------------------------------------------------------------------
// Task 3 — cross-field invariants (design 7.2-7.4, 7.8-7.9, 7.11-7.12): evidence-or-
// abstention, the five independent axes, and legal/operational controls. These run
// after every per-field validator above has already confirmed shape/enum closure, so
// each check here can assume well-typed values and focus purely on the relationship
// between fields.
// ---------------------------------------------------------------------------

const MATERIAL_CONCLUSION_STATUSES = new Set(['supported_with_evidence', 'partially_supported', 'gap_evidenced']);

// Exact conclusion.status -> evidence_state.compliance correspondence (independent
// review P0: a material conclusion can never coexist with compliance "unknown" nor
// with a mismatched pending_human_review value).
const CONCLUSION_STATUS_TO_COMPLIANCE = new Map([
  ['supported_with_evidence', 'supported_pending_human_review'],
  ['partially_supported', 'partially_supported_pending_human_review'],
  ['gap_evidenced', 'gap_evidenced_pending_human_review'],
]);

function validateUnitInvariants(unit, ctx) {
  const unitId = unit.unit_id;
  const {
    conclusion, blocking, evidence_state: evidenceState, evidence_refs: evidenceRefs, missing_evidence: missingEvidence,
    commercial_impact: commercialImpact, legal_assessment: legalAssessment, actions, escalation, closure,
  } = unit;

  // Evidence or abstention (7.2).
  if (MATERIAL_CONCLUSION_STATUSES.has(conclusion.status) && evidenceRefs.length === 0) {
    fail(`analysis_units[${unitId}]: conclusion.status "${conclusion.status}" exige al menos una referencia de evidencia.`);
  }
  if (conclusion.status === 'insufficient_evidence') {
    if (unit.assessment_mode !== 'abstained') {
      fail(`analysis_units[${unitId}]: conclusion.status "insufficient_evidence" exige assessment_mode "abstained".`);
    }
    if (missingEvidence.length === 0) {
      fail(`analysis_units[${unitId}]: conclusion.status "insufficient_evidence" exige al menos un missing_evidence.`);
    }
  }
  if (unit.assessment_mode === 'abstained' && !['insufficient_evidence', 'human_validation_required'].includes(conclusion.status)) {
    fail(`analysis_units[${unitId}]: assessment_mode "abstained" sólo permite conclusion.status "insufficient_evidence" o "human_validation_required".`);
  }
  if (conclusion.confidence === 'unavailable' && unit.assessment_mode !== 'abstained') {
    fail(`analysis_units[${unitId}]: conclusion.confidence "unavailable" exige assessment_mode "abstained".`);
  }
  if (unit.assessment_mode === 'abstained' && conclusion.confidence !== 'unavailable') {
    fail(`analysis_units[${unitId}]: assessment_mode "abstained" exige conclusion.confidence "unavailable".`);
  }
  if (conclusion.status === 'gap_evidenced' && !evidenceRefs.some(ref => ref.purpose === 'gap_basis')) {
    fail(`analysis_units[${unitId}]: conclusion.status "gap_evidenced" exige una referencia con purpose "gap_basis".`);
  }

  // human_validation_required (P1 - independent review): never "high" confidence, and
  // outside explicit abstention it must carry at least one evidence reference — sustento
  // or abstention, never neither.
  if (conclusion.status === 'human_validation_required') {
    if (conclusion.confidence === 'high') {
      fail(`analysis_units[${unitId}]: conclusion.status "human_validation_required" no admite conclusion.confidence "high".`);
    }
    if (unit.assessment_mode !== 'abstained' && evidenceRefs.length === 0) {
      fail(`analysis_units[${unitId}]: conclusion.status "human_validation_required" con assessment_mode distinto de "abstained" exige al menos una referencia de evidencia.`);
    }
  }

  // Five independent axes (7.4).
  if (evidenceState.presence === 'absent') {
    if (evidenceState.review === 'reviewed') {
      fail(`analysis_units[${unitId}]: evidence_state.review "reviewed" es inválido con presence "absent".`);
    }
    if (evidenceState.validity === 'valid' || evidenceState.validity === 'expired') {
      fail(`analysis_units[${unitId}]: evidence_state.validity "${evidenceState.validity}" es inválido con presence "absent".`);
    }
  }
  if (evidenceState.compliance !== 'unknown') {
    if (evidenceState.review === 'not_reviewed') {
      fail(`analysis_units[${unitId}]: evidence_state.compliance material exige review distinto de "not_reviewed".`);
    }
    if (evidenceRefs.length === 0) {
      fail(`analysis_units[${unitId}]: evidence_state.compliance material exige al menos una referencia de evidencia.`);
    }
  }
  if (evidenceState.compliance === 'supported_pending_human_review') {
    if (evidenceState.validity !== 'valid') {
      fail(`analysis_units[${unitId}]: compliance "supported_pending_human_review" exige evidence_state.validity "valid".`);
    }
    if (evidenceState.applicability === 'unknown') {
      fail(`analysis_units[${unitId}]: compliance "supported_pending_human_review" no admite evidence_state.applicability "unknown".`);
    }
  }

  // Material conclusion <-> compliance exact correspondence (P0 - independent review):
  // a material conclusion.status (supported_with_evidence / partially_supported /
  // gap_evidenced) can never coexist with evidence_state.compliance "unknown" nor with
  // any pending_human_review value other than its own exact counterpart.
  if (MATERIAL_CONCLUSION_STATUSES.has(conclusion.status)) {
    const expectedCompliance = CONCLUSION_STATUS_TO_COMPLIANCE.get(conclusion.status);
    if (evidenceState.compliance !== expectedCompliance) {
      fail(
        `analysis_units[${unitId}]: conclusion.status "${conclusion.status}" exige evidence_state.compliance `
        + `"${expectedCompliance}" (recibido "${evidenceState.compliance}").`,
      );
    }
  }

  // Blocking effect / curability (7.3).
  if (blocking.effect === 'blocker' && unit.assessment_mode === 'abstained') {
    fail(`analysis_units[${unitId}]: blocking.effect "blocker" es inválido con assessment_mode "abstained" (debe ser "undetermined").`);
  }
  if (blocking.curability === 'not_curable') {
    const hasSupport = evidenceRefs.some(ref => ref.source_type === 'tender_document' || ref.source_type === 'legal_corpus');
    if (!hasSupport) fail(`analysis_units[${unitId}]: blocking.curability "not_curable" exige evidencia del pliego o fundamento jurídico.`);
  }
  if ((blocking.effect === 'blocker' || blocking.effect === 'conditional') && actions.length === 0) {
    fail(`analysis_units[${unitId}]: blocking.effect "${blocking.effect}" exige al menos una acción.`);
  }

  // Legal assessment (7.8) and corpus-null invariant (design section 5, invariant 7).
  if (legalAssessment.status === 'supported' && legalAssessment.basis_refs.length === 0) {
    fail(`analysis_units[${unitId}]: legal_assessment.status "supported" exige basis_refs no vacío.`);
  }
  if (legalAssessment.status === 'not_verified' && legalAssessment.human_legal_review_required !== true) {
    fail(`analysis_units[${unitId}]: legal_assessment.status "not_verified" exige human_legal_review_required=true.`);
  }
  if (ctx.legalCorpusVersionId === null && !['not_applicable', 'not_verified'].includes(legalAssessment.status)) {
    fail(`analysis_units[${unitId}]: sin legal_corpus_version_id publicado, legal_assessment.status debe ser "not_applicable" o "not_verified".`);
  }

  // Actions / roles (7.9).
  for (const action of actions) {
    if (action.action_type === 'human_decision' && action.suggested_role !== 'authorized_human') {
      fail(`analysis_units[${unitId}]: action_type "human_decision" exige suggested_role "authorized_human".`);
    }
  }

  // Escalation for a defined critical condition (7.11).
  const notCurableBlocker = blocking.effect === 'blocker' && blocking.curability === 'not_curable';
  const materialLegalUncertainty = legalAssessment.status === 'not_verified' && legalAssessment.human_legal_review_required === true;
  const criticalExposure = commercialImpact.level === 'critical';
  if ((notCurableBlocker || materialLegalUncertainty || criticalExposure) && escalation.required !== true) {
    fail(`analysis_units[${unitId}]: condición crítica definida (bloqueo no subsanable, incertidumbre jurídica material o exposición crítica) exige escalation.required=true.`);
  }

  // Closure (7.12).
  if (closure.status === 'evidence_satisfied') {
    if (evidenceRefs.length === 0) {
      fail(`analysis_units[${unitId}]: closure.status "evidence_satisfied" exige evidencia allowlisted.`);
    }
    if (actions.some(action => action.action_type !== 'human_decision')) {
      fail(`analysis_units[${unitId}]: closure.status "evidence_satisfied" no admite acciones pendientes distintas de "human_decision".`);
    }
  }
}

// ---------------------------------------------------------------------------
// Coverage-level material-omissions invariant (design section 5, invariant 5): if the
// governed context observed material retrieval omissions, the payload must say so, and
// every unit must abstain rather than silently presenting a partial-input analysis as
// if it were complete.
// ---------------------------------------------------------------------------

function validateMaterialOmissionsInvariant(value, ctx) {
  if (ctx.materialOmissionsObserved && value.coverage.material_omissions !== true) {
    fail(
      'coverage.material_omissions debe ser true: el contexto gobernado observó omisiones materiales de retrieval.',
      'v3_material_omissions_flag_mismatch',
    );
  }
  if (value.coverage.material_omissions === true) {
    const nonAbstained = value.analysis_units.filter(unit => unit.assessment_mode !== 'abstained');
    if (nonAbstained.length > 0) {
      fail(
        'coverage.material_omissions=true exige que todas las unidades usen assessment_mode "abstained".',
        'v3_material_omissions_abstention_required',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Unit-level structural + ordering validation (Task 2), invariants (Task 3) are added
// by validateUnitInvariants below and invoked from the same per-unit pass.
// ---------------------------------------------------------------------------

function validateUnitShape(unit, ctx) {
  const label = 'analysis_units[]';
  exactKeys(unit, UNIT_KEYS, label);
  boundedString(unit.unit_id, ID_MAX_LENGTH, `${label}.unit_id`);
  const unitId = unit.unit_id;

  requireEnum(unit.unit_kind, AGT002_INTEGRAL_UNIT_KINDS, `analysis_units[${unitId}].unit_kind`);
  requireEnum(unit.category, AGT002_INTEGRAL_CATEGORIES, `analysis_units[${unitId}].category`);
  requirePositiveInt(unit.sequence, `analysis_units[${unitId}].sequence`);
  boundedString(unit.title, TITLE_MAX_LENGTH, `analysis_units[${unitId}].title`);
  requireEnum(unit.assessment_mode, AGT002_INTEGRAL_ASSESSMENT_MODES, `analysis_units[${unitId}].assessment_mode`);

  if (unit.unit_kind === 'strategic_consideration') {
    if (unit.requirement_id !== null) fail(`analysis_units[${unitId}]: strategic_consideration debe tener requirement_id null.`);
    if (unit.category !== 'strategic') fail(`analysis_units[${unitId}]: strategic_consideration debe usar category "strategic".`);
  } else {
    if (unit.category === 'strategic') fail(`analysis_units[${unitId}]: tender_requirement no puede usar category "strategic".`);
    if (typeof unit.requirement_id !== 'string' || !ctx.requirementManifestById.has(unit.requirement_id)) {
      fail(`analysis_units[${unitId}]: requirement_id debe estar allowlisted en el manifiesto gobernado.`);
    }
    const manifestEntry = ctx.requirementManifestById.get(unit.requirement_id);
    if (manifestEntry.category !== unit.category) {
      fail(`analysis_units[${unitId}]: category no coincide con la categoría gobernada del manifiesto para ${unit.requirement_id}.`);
    }
  }

  validateConclusion(unit.conclusion, unitId);
  validateBlocking(unit.blocking, unitId);
  validateEvidenceState(unit.evidence_state, unitId);
  validateEvidenceRefs(unit.evidence_refs, unitId, ctx);
  validateMissingEvidence(unit.missing_evidence, unitId, ctx);
  validateCommercialImpact(unit.commercial_impact, unitId);
  validateLegalAssessment(unit.legal_assessment, unitId, ctx);
  validateActions(unit.actions, unitId);
  validateMilestone(unit.milestone, unitId, ctx);
  validateEscalation(unit.escalation, unitId);
  validateClosure(unit.closure, unitId);
  validateHumanValidation(unit.human_validation, unitId);

  validateUnitInvariants(unit, ctx);
  validateGovernedEvidenceStateMatch(unit, ctx);
}

// ---------------------------------------------------------------------------
// Governed origin of the five axes (audit P0 "cumplimiento inferido por presencia"):
// evidence_state is checked LAST, after every closed-enum and cross-axis-invariant check
// above already ran, so those keep failing with their own specific message when a
// mutation violates them. Only a well-formed, invariant-consistent evidence_state that
// still does not match the governed per-requirement_id map reaches this check — it is
// the final backstop proving the axes are never free model output: they must equal
// exactly what validationContext.evidenceStateManifest (built by
// buildAgt002EvidenceStateManifest, agt002-evidence-state-manifest.js) says, or the
// model's claim is rejected outright. strategic_consideration units have no
// requirement_id and therefore no governed entry to match — they are out of scope for
// this layer and keep only the pre-existing enum/invariant checks.
// ---------------------------------------------------------------------------

function validateGovernedEvidenceStateMatch(unit, ctx) {
  if (unit.unit_kind !== 'tender_requirement') return;
  const governedEvidenceState = ctx.evidenceStateByRequirementId.get(unit.requirement_id);
  const mismatch = EVIDENCE_STATE_KEYS.some(key => unit.evidence_state[key] !== governedEvidenceState[key]);
  if (mismatch) {
    fail(
      `analysis_units[${unit.unit_id}]: evidence_state no coincide con el mapa gobernado por requirement_id `
      + '(governed evidence-state map) — los cinco ejes deben provenir de estado gobernado explícito o de abstención '
      + '("unknown"/"not_reviewed"), nunca de salida libre del modelo.',
    );
  }
}

function validateUnitsOrdering(units, ctx) {
  const seenUnitIds = new Set();
  const seenRequirementIds = new Set();
  let previousSequence = 0;
  let previousCategoryRank = 0;
  const formalRequirementIdsInOrder = [];

  for (const unit of units) {
    if (seenUnitIds.has(unit.unit_id)) fail(`unit_id duplicado: ${unit.unit_id}.`);
    seenUnitIds.add(unit.unit_id);

    if (!(unit.sequence > previousSequence)) {
      fail(`analysis_units[${unit.unit_id}].sequence debe ser estrictamente ascendente.`);
    }
    previousSequence = unit.sequence;

    const categoryRank = CATEGORY_RANK.get(unit.category);
    if (categoryRank < previousCategoryRank) {
      fail(`analysis_units[${unit.unit_id}]: violación de orden institucional de categorías.`);
    }
    previousCategoryRank = categoryRank;

    if (unit.unit_kind === 'tender_requirement') {
      if (seenRequirementIds.has(unit.requirement_id)) fail(`requirement_id duplicado: ${unit.requirement_id}.`);
      seenRequirementIds.add(unit.requirement_id);
      formalRequirementIdsInOrder.push(unit.requirement_id);
    }
  }

  const expectedOrder = ctx.requirementManifest.map(entry => entry.requirement_id);
  if (
    formalRequirementIdsInOrder.length !== expectedOrder.length
    || formalRequirementIdsInOrder.some((id, index) => id !== expectedOrder[index])
  ) {
    fail(
      'El orden y la cobertura de tender_requirement no coinciden exactamente con el manifiesto gobernado (uno por requisito, en orden).',
      'v3_requirement_coverage_order_mismatch',
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Validates a model-shaped `integral_analysis` payload against the closed AGT-002 v3
 * contract and the governed validationContext. Throws on any violation; on success
 * returns the SAME object (never normalized, never mutated) so callers cannot mistake
 * a validated-and-rewritten payload for the payload actually produced.
 */
export function validateAgt002IntegralAnalysisV3(value, validationContext) {
  const ctx = normalizeValidationContext(validationContext);
  assertNoProhibitedKeys(value);
  exactKeys(value, TOP_LEVEL_KEYS, 'integral_analysis', 'v3_invalid_top_level_shape');
  if (value.contract_version !== AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION) {
    fail(`contract_version debe ser "${AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION}".`, 'v3_contract_version_mismatch');
  }
  validateCoverage(value.coverage, ctx);

  if (!Array.isArray(value.analysis_units) || value.analysis_units.length === 0) {
    fail('analysis_units debe ser un arreglo no vacío.', 'v3_analysis_units_empty');
  }
  for (const unit of value.analysis_units) validateUnitShape(unit, ctx);
  validateUnitsOrdering(value.analysis_units, ctx);
  validateMaterialOmissionsInvariant(value, ctx);

  return value;
}
