// AGT-002 stakeholder brief — closed contract and pure validator/projector for
// Licitaciones. Same discipline as the two sibling artifacts it is modeled after:
// agt002-integral-analysis-v3.js (closed key sets, allowlisted source refs, fail-closed
// invariants, `external_side_effect` always false) and agt002-governance-draft-proposal.js
// (build+validate pair, status/approval fields pinned to governance literals).
//
// Pure function library: no I/O, no globals, no database access. `validate` is a
// structural re-check of an untrusted model-shaped `value` against the governed
// `validationContext` (opportunity id, requirement manifest, per-source-type reference
// allowlist); on success it returns the SAME object, never normalized or mutated, so a
// caller can never mistake a validated-and-rewritten payload for what was actually
// produced. `build` assembles a fresh, normalized envelope from caller-supplied parts and
// immediately self-validates it before returning.

import {
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  AGT002_INTEGRAL_CATEGORIES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_SUGGESTED_ROLES,
  AGT002_INTEGRAL_ACTION_PRIORITIES,
  AGT002_INTEGRAL_VALIDITY_STATES,
} from './agt002-integral-analysis-v3.js';

export const AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION = 'agt002-stakeholder-brief-v1';

// This projector is scoped to Licitaciones only — a single fixed modality, not an enum.
export const AGT002_STAKEHOLDER_BRIEF_MODALITY = 'licitacion_publica';

export const AGT002_STAKEHOLDER_BRIEF_TIMELINE_STATUSES = Object.freeze(['documented', 'pending', 'conflicting']);
// General facts (process_summary) share the exact same closed status set.
const FACT_STATUSES = AGT002_STAKEHOLDER_BRIEF_TIMELINE_STATUSES;
export const AGT002_STAKEHOLDER_BRIEF_MATCH_STATUSES = Object.freeze(['consistent', 'contradictory', 'unverifiable']);
export const AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES = Object.freeze([
  'legal', 'financial', 'technical', 'experience', 'scoring',
]);
export const AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_STATUSES = Object.freeze(['complete', 'gap', 'pending']);
// Real, imported governed V3 validity-state enum — the SAME frozen reference, never a
// parallel/duplicated copy.
export const AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES = AGT002_INTEGRAL_VALIDITY_STATES;

// Real, imported governed V3 source-type enum — never a parallel/duplicated copy.
const SOURCE_TYPES = AGT002_INTEGRAL_SOURCE_TYPES;

const ID_MAX_LENGTH = 120;
const TEXT_MAX_LENGTH = 600;
const ARRAY_MAX_ITEMS = 30;

const TOP_LEVEL_KEYS = [
  'contract_version', 'opportunity_id', 'human_review_required',
  'process_summary', 'timeline', 'questionnaire_cross_check', 'requirements_checklist', 'treatment_plan',
];
const PROCESS_SUMMARY_KEYS = [
  'entity', 'modality', 'process_number', 'object', 'official_budget', 'execution_term', 'contractual_validity',
];
const FACT_KEYS = ['status', 'value', 'conflicting_values', 'source_refs'];
const TIMELINE_ENTRY_KEYS = ['milestone_id', 'label', 'status', 'documented_at', 'conflicting_values', 'source_refs', 'note'];
const CONFLICTING_VALUE_KEYS = ['value', 'source_ref'];
const SOURCE_REF_KEYS = ['ref', 'source_type'];
const QUESTIONNAIRE_ENTRY_KEYS = ['question_id', 'question_summary', 'questionnaire_ref', 'document_ref', 'match_status', 'contradiction_detail'];
const REQUIREMENT_ITEM_KEYS = [
  'requirement_id', 'category', 'source_unit_id', 'document', 'accreditation_method', 'citation', 'validity', 'status', 'owner', 'missing_evidence',
];
const ACTION_KEYS = ['action_id', 'summary', 'basis_ref', 'suggested_role', 'priority', 'external_side_effect'];
const HUMAN_APPROVAL_KEYS = ['required', 'status', 'approver', 'approved_at'];
const INTEGRAL_UNIT_KEYS = ['unit_id', 'category', 'evidence_refs'];
const REQUIREMENT_MANIFEST_ENTRY_KEYS = ['requirement_id', 'category', 'source_unit_id'];

function fail(message) {
  throw new Error(`AGT-002 stakeholder brief: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) fail(`${label} debe ser un objeto.`);
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || !expectedKeys.every(key => Object.hasOwn(value, key))) {
    fail(`${label} tiene claves no permitidas o incompletas (contrato cerrado).`);
  }
  return value;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmptyString(value, label) {
  if (!nonEmptyString(value)) fail(`${label} debe ser texto no vacío.`);
  return value;
}

// Free-declared ids (milestone_id, question_id, action_id) are bounded exactly like the
// sibling V3 contract (ID_MAX_LENGTH=120) — never unbounded caller-chosen text.
function requireBoundedId(value, label) {
  requireNonEmptyString(value, label);
  if (value.length > ID_MAX_LENGTH) {
    fail(`${label} excede el límite de ${ID_MAX_LENGTH} caracteres (id acotado).`);
  }
  return value;
}

// Free text is bounded exactly like the sibling V3 contract (TEXT_MAX_LENGTH=600) — every
// synthesized string is a summary/label, never raw document/chunk text.
function requireBoundedText(value, label) {
  requireNonEmptyString(value, label);
  if (value.length > TEXT_MAX_LENGTH) {
    fail(`${label} excede el límite de ${TEXT_MAX_LENGTH} caracteres (texto acotado).`);
  }
  return value;
}

function requirePositiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${label} debe ser un número positivo.`);
  }
  return value;
}

function requireEnum(value, allowedValues, label) {
  if (!allowedValues.includes(value)) fail(`${label} no es un valor permitido: ${String(value)}.`);
  return value;
}

// documented_at must be a canonical UTC ISO-8601 timestamp — exactly the form produced by
// `new Date(value).toISOString()` — never a rolled/lenient date string (e.g. "2024-02-30")
// or a non-canonical variant (missing millis, non-UTC offset, etc.).
function isCanonicalIsoDateTime(value) {
  if (!nonEmptyString(value) || value.length > TEXT_MAX_LENGTH) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString() === value;
}

// Arrays are bounded exactly like the sibling V3 contract (ARRAY_MAX_ITEMS=30).
function requireBoundedArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} debe ser un arreglo.`);
  if (value.length > ARRAY_MAX_ITEMS) {
    fail(`${label} excede el máximo acotado de ${ARRAY_MAX_ITEMS} elementos.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Governed validation context normalization.
// ---------------------------------------------------------------------------

function normalizeValidationContext(rawContext) {
  if (!isRecord(rawContext)) fail('validationContext debe ser un objeto.');
  const {
    opportunityId, integralAnalysisContractVersion, integralAnalysisUnits, requirementManifest, allowlist,
  } = rawContext;

  if (!nonEmptyString(opportunityId)) fail('validationContext.opportunityId debe ser texto no vacío.');

  if (integralAnalysisContractVersion !== AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION) {
    fail(`validationContext.integralAnalysisContractVersion debe ser exactamente "${AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION}" (gobernado V3).`);
  }

  if (!isRecord(allowlist)) fail('validationContext.allowlist debe ser un objeto.');
  const normalizedAllowlist = {};
  for (const sourceType of SOURCE_TYPES) {
    const ids = allowlist[sourceType];
    if (!Array.isArray(ids)) fail(`validationContext.allowlist.${sourceType} debe ser un arreglo.`);
    normalizedAllowlist[sourceType] = new Set(ids);
  }
  const ctxForAllowlist = { allowlist: normalizedAllowlist };

  // The governed manifest of V3 analysis units (the MVP lineage anchor): closed, unique,
  // real-V3-category-enforced.
  if (!Array.isArray(integralAnalysisUnits) || integralAnalysisUnits.length === 0) {
    fail('validationContext.integralAnalysisUnits debe ser un arreglo no vacío (manifiesto gobernado de unidades V3).');
  }
  const integralAnalysisUnitsById = new Map();
  for (const unit of integralAnalysisUnits) {
    exactKeys(unit, INTEGRAL_UNIT_KEYS, 'validationContext.integralAnalysisUnits[]');
    if (!nonEmptyString(unit.unit_id)) fail('validationContext.integralAnalysisUnits[] tiene un unit_id inválido.');
    if (integralAnalysisUnitsById.has(unit.unit_id)) {
      fail(`validationContext.integralAnalysisUnits tiene unit_id duplicado: ${unit.unit_id}.`);
    }
    if (!AGT002_INTEGRAL_CATEGORIES.includes(unit.category)) {
      fail(`validationContext.integralAnalysisUnits[${unit.unit_id}].category no pertenece a la enumeración V3 cerrada (category no permitida).`);
    }
    if (!Array.isArray(unit.evidence_refs) || unit.evidence_refs.length === 0) {
      fail(`validationContext.integralAnalysisUnits[${unit.unit_id}].evidence_refs debe ser un arreglo no vacío.`);
    }
    const evidenceRefKeys = new Set();
    for (const evidenceRef of unit.evidence_refs) {
      validateSourceRef(evidenceRef, ctxForAllowlist, `validationContext.integralAnalysisUnits[${unit.unit_id}].evidence_refs[]`);
      evidenceRefKeys.add(sourceRefKey(evidenceRef));
    }
    integralAnalysisUnitsById.set(unit.unit_id, { category: unit.category, evidenceRefKeys });
  }

  if (!Array.isArray(requirementManifest) || requirementManifest.length === 0) {
    fail('validationContext.requirementManifest debe ser un arreglo no vacío.');
  }
  const requirementManifestById = new Map();
  for (const entry of requirementManifest) {
    exactKeys(entry, REQUIREMENT_MANIFEST_ENTRY_KEYS, 'validationContext.requirementManifest[]');
    if (!nonEmptyString(entry.requirement_id)) {
      fail('validationContext.requirementManifest tiene una entrada con requirement_id inválido.');
    }
    if (!AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES.includes(entry.category)) {
      fail(`validationContext.requirementManifest tiene una category inválida para ${entry.requirement_id}.`);
    }
    if (requirementManifestById.has(entry.requirement_id)) {
      fail(`validationContext.requirementManifest tiene requirement_id duplicado: ${entry.requirement_id}.`);
    }
    if (!integralAnalysisUnitsById.has(entry.source_unit_id)) {
      fail(`validationContext.requirementManifest[${entry.requirement_id}].source_unit_id no referencia ninguna unidad V3 gobernada (integralAnalysisUnits).`);
    }
    requirementManifestById.set(entry.requirement_id, entry);
  }

  return {
    opportunityId, requirementManifestById, allowlist: normalizedAllowlist, integralAnalysisUnitsById,
  };
}

function sourceRefKey(refObj) {
  return `${refObj.source_type}::${refObj.ref}`;
}

// A source_ref/citation must always be an allowlisted (ref, source_type) pair, scoped to
// this opportunity's governed allowlist — never null, never a free-form string.
function validateSourceRef(refObj, ctx, label) {
  if (!isRecord(refObj)) fail(`${label} debe ser una referencia válida (source_ref/citation, no nula).`);
  exactKeys(refObj, SOURCE_REF_KEYS, label);
  requireEnum(refObj.source_type, SOURCE_TYPES, `${label}.source_type`);
  if (typeof refObj.ref !== 'string' || !ctx.allowlist[refObj.source_type].has(refObj.ref)) {
    fail(`${label}.ref no está en la allowlist permitida (permitida) para source_type "${refObj.source_type}".`);
  }
  return refObj;
}

// General fact (process_summary field), governed shape {status, value, conflicting_values,
// source_refs}. `valueValidator(value, label)` type-checks a documented/conflicting value —
// never a bare scalar smuggled past the fact wrapper (requirement: "general facts without
// hallucination").
function validateFact(factObj, ctx, label, valueValidator) {
  if (!isRecord(factObj)) {
    fail(`${label} debe ser un objeto de hecho gobernado {status, value, conflicting_values, source_refs}, no un escalar.`);
  }
  exactKeys(factObj, FACT_KEYS, label);
  requireEnum(factObj.status, FACT_STATUSES, `${label}.status`);
  if (!Array.isArray(factObj.source_refs)) fail(`${label}.source_refs debe ser un arreglo.`);
  requireBoundedArray(factObj.source_refs, `${label}.source_refs`);
  if (!Array.isArray(factObj.conflicting_values)) fail(`${label}.conflicting_values debe ser un arreglo.`);
  requireBoundedArray(factObj.conflicting_values, `${label}.conflicting_values`);

  if (factObj.status === 'documented') {
    valueValidator(factObj.value, `${label}.value`);
    if (factObj.conflicting_values.length !== 0) {
      fail(`${label}: status "documented" no admite conflicting_values no vacío.`);
    }
    if (factObj.source_refs.length === 0) {
      fail(`${label}: status "documented" exige source_refs no vacío y allowlisted.`);
    }
    factObj.source_refs.forEach((refObj, index) => validateSourceRef(refObj, ctx, `${label}.source_refs[${index}]`));
  } else if (factObj.status === 'pending') {
    if (factObj.value !== null) fail(`${label}: status "pending" exige value nulo.`);
    if (factObj.source_refs.length !== 0) fail(`${label}: status "pending" exige source_refs vacío.`);
    if (factObj.conflicting_values.length !== 0) fail(`${label}: status "pending" exige conflicting_values vacío.`);
  } else {
    // conflicting: refs live per-value, never on the fact object itself, and the value
    // itself is never chosen/collapsed automatically.
    if (factObj.value !== null) {
      fail(`${label}: status "conflicting" exige value nulo (los valores viven en conflicting_values).`);
    }
    if (factObj.source_refs.length !== 0) {
      fail(`${label}: status "conflicting" exige source_refs vacío (las referencias viven en cada conflicting_value).`);
    }
    if (factObj.conflicting_values.length < 2) {
      fail(`${label}: status "conflicting" exige al menos dos conflicting_values distintos.`);
    }
    const seenValues = new Set();
    factObj.conflicting_values.forEach((conflictingValue, index) => {
      const cvLabel = `${label}.conflicting_values[${index}]`;
      exactKeys(conflictingValue, CONFLICTING_VALUE_KEYS, cvLabel);
      valueValidator(conflictingValue.value, `${cvLabel}.value`);
      if (seenValues.has(conflictingValue.value)) {
        fail(`${label}: conflicting_values contiene valores duplicados; deben ser distintos.`);
      }
      seenValues.add(conflictingValue.value);
      validateSourceRef(conflictingValue.source_ref, ctx, `${cvLabel}.source_ref`);
    });
  }
}

// ---------------------------------------------------------------------------
// Block validators.
// ---------------------------------------------------------------------------

function validateProcessSummary(processSummary, ctx) {
  exactKeys(processSummary, PROCESS_SUMMARY_KEYS, 'process_summary');
  validateFact(processSummary.entity, ctx, 'process_summary.entity', requireBoundedText);
  if (processSummary.modality !== AGT002_STAKEHOLDER_BRIEF_MODALITY) {
    fail(`process_summary.modality debe ser "${AGT002_STAKEHOLDER_BRIEF_MODALITY}" (contrato exclusivo de Licitaciones/modalidad).`);
  }
  validateFact(processSummary.process_number, ctx, 'process_summary.process_number', requireBoundedText);
  validateFact(processSummary.object, ctx, 'process_summary.object', requireBoundedText);
  validateFact(
    processSummary.official_budget, ctx, 'process_summary.official_budget',
    (value, label) => requirePositiveNumber(value, `${label} (presupuesto oficial)`),
  );
  validateFact(processSummary.execution_term, ctx, 'process_summary.execution_term', requireBoundedText);
  validateFact(processSummary.contractual_validity, ctx, 'process_summary.contractual_validity', requireBoundedText);
}

function validateTimeline(timeline, ctx) {
  exactKeys(timeline, ['entries'], 'timeline');
  requireBoundedArray(timeline.entries, 'timeline.entries');
  if (timeline.entries.length === 0) fail('timeline.entries debe ser un arreglo no vacío.');

  const milestoneIds = new Set();
  for (const entry of timeline.entries) {
    exactKeys(entry, TIMELINE_ENTRY_KEYS, 'timeline entry');
    requireBoundedId(entry.milestone_id, 'timeline entry milestone_id');
    if (milestoneIds.has(entry.milestone_id)) fail(`timeline: milestone_id duplicado: ${entry.milestone_id}.`);
    milestoneIds.add(entry.milestone_id);
    requireBoundedText(entry.label, 'timeline entry label');
    requireEnum(entry.status, AGT002_STAKEHOLDER_BRIEF_TIMELINE_STATUSES, 'timeline entry status');
    if (entry.note !== null && !nonEmptyString(entry.note)) {
      fail(`timeline entry ${entry.milestone_id}: note debe ser null o texto no vacío.`);
    }
    if (entry.note !== null) requireBoundedText(entry.note, `timeline entry ${entry.milestone_id} note`);

    // Malformed non-array refs/conflicts must fail closed, never be silently treated as
    // "empty" (review gap closure).
    if (!Array.isArray(entry.conflicting_values)) {
      fail(`timeline entry ${entry.milestone_id}: conflicting_values debe ser un arreglo.`);
    }
    if (!Array.isArray(entry.source_refs)) {
      fail(`timeline entry ${entry.milestone_id}: source_refs debe ser un arreglo.`);
    }
    requireBoundedArray(entry.conflicting_values, `timeline entry ${entry.milestone_id} conflicting_values`);
    requireBoundedArray(entry.source_refs, `timeline entry ${entry.milestone_id} source_refs`);
    const hasConflictingValues = entry.conflicting_values.length !== 0;
    const hasSourceRefs = entry.source_refs.length !== 0;

    if (entry.status === 'documented') {
      if (!isCanonicalIsoDateTime(entry.documented_at)) {
        fail(`timeline entry ${entry.milestone_id}: status "documented" exige documented_at en formato ISO-8601 UTC canónico (fecha ISO válida).`);
      }
      if (!hasSourceRefs) {
        fail(`timeline entry ${entry.milestone_id}: status "documented" exige source_refs no vacío y allowlisted.`);
      }
      if (hasConflictingValues) fail(`timeline entry ${entry.milestone_id}: status "documented" no admite conflicting_values.`);
      entry.source_refs.forEach((ref, index) => validateSourceRef(ref, ctx, `timeline entry ${entry.milestone_id} source_refs[${index}]`));
    } else if (entry.status === 'pending') {
      if (entry.documented_at !== null) fail(`timeline entry ${entry.milestone_id}: status "pending" exige documented_at nulo.`);
      if (hasSourceRefs) fail(`timeline entry ${entry.milestone_id}: status "pending" exige source_refs vacío.`);
      if (hasConflictingValues) fail(`timeline entry ${entry.milestone_id}: status "pending" no admite conflicting_values.`);
    } else {
      // conflicting: source refs live on each conflicting_value, never on the entry itself.
      if (entry.documented_at !== null) fail(`timeline entry ${entry.milestone_id}: status "conflicting" exige documented_at nulo.`);
      if (hasSourceRefs) fail(`timeline entry ${entry.milestone_id}: status "conflicting" exige source_refs vacío.`);
      if (!Array.isArray(entry.conflicting_values) || entry.conflicting_values.length < 2) {
        fail(`timeline entry ${entry.milestone_id}: status "conflicting" exige al menos dos conflicting_values distintos.`);
      }
      const seenValues = new Set();
      entry.conflicting_values.forEach((conflictingValue, index) => {
        const label = `timeline entry ${entry.milestone_id} conflicting_values[${index}]`;
        exactKeys(conflictingValue, CONFLICTING_VALUE_KEYS, label);
        if (!isCanonicalIsoDateTime(conflictingValue.value)) {
          fail(`timeline entry ${entry.milestone_id}: conflicting_values[${index}].value "${conflictingValue.value}" debe ser una fecha ISO-8601 UTC canónica (fecha ISO válida).`);
        }
        if (seenValues.has(conflictingValue.value)) {
          fail(`timeline entry ${entry.milestone_id}: conflicting_values contiene valores duplicados; deben ser distintos.`);
        }
        seenValues.add(conflictingValue.value);
        validateSourceRef(conflictingValue.source_ref, ctx, `${label}.source_ref`);
      });
    }
  }
  return milestoneIds;
}

function validateQuestionnaireCrossCheck(block, ctx) {
  exactKeys(block, ['entries'], 'questionnaire_cross_check');
  requireBoundedArray(block.entries, 'questionnaire_cross_check.entries');
  if (block.entries.length === 0) {
    fail('questionnaire_cross_check.entries debe ser un arreglo no vacío.');
  }
  const seenQuestionIds = new Set();
  for (const entry of block.entries) {
    exactKeys(entry, QUESTIONNAIRE_ENTRY_KEYS, 'questionnaire_cross_check entry');
    requireBoundedId(entry.question_id, 'questionnaire_cross_check entry question_id');
    if (seenQuestionIds.has(entry.question_id)) {
      fail(`questionnaire_cross_check: question_id duplicado: ${entry.question_id}.`);
    }
    seenQuestionIds.add(entry.question_id);
    requireBoundedText(entry.question_summary, `questionnaire_cross_check entry ${entry.question_id} question_summary`);
    validateSourceRef(entry.questionnaire_ref, ctx, `questionnaire_cross_check entry ${entry.question_id} questionnaire_ref`);
    validateSourceRef(entry.document_ref, ctx, `questionnaire_cross_check entry ${entry.question_id} document_ref`);
    requireEnum(entry.match_status, AGT002_STAKEHOLDER_BRIEF_MATCH_STATUSES, `questionnaire_cross_check entry ${entry.question_id} match_status`);

    if (entry.match_status === 'contradictory') {
      if (!nonEmptyString(entry.contradiction_detail)) {
        fail(`questionnaire_cross_check entry ${entry.question_id}: match_status "contradictory" exige contradiction_detail no nulo.`);
      }
      requireBoundedText(entry.contradiction_detail, `questionnaire_cross_check entry ${entry.question_id} contradiction_detail`);
    } else if (entry.contradiction_detail !== null) {
      fail(`questionnaire_cross_check entry ${entry.question_id}: match_status "${entry.match_status}" exige contradiction_detail nulo.`);
    }
  }
}

function validateRequirementsChecklist(block, ctx) {
  exactKeys(block, ['items'], 'requirements_checklist');
  requireBoundedArray(block.items, 'requirements_checklist.items');
  if (block.items.length === 0) {
    fail('requirements_checklist.items debe ser un arreglo no vacío.');
  }

  const categoriesPresent = new Set();
  const seenRequirementIds = new Set();
  for (const item of block.items) {
    exactKeys(item, REQUIREMENT_ITEM_KEYS, 'requirements_checklist item');
    requireNonEmptyString(item.requirement_id, 'requirements_checklist item requirement_id');
    requireEnum(item.category, AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES, `requirements_checklist item ${item.requirement_id} category`);

    const manifestEntry = ctx.requirementManifestById.get(item.requirement_id);
    if (!manifestEntry) {
      fail(`requirements_checklist item ${item.requirement_id}: requirement_id no está en el manifiesto gobernado (manifest).`);
    }
    if (manifestEntry.category !== item.category) {
      fail(`requirements_checklist item ${item.requirement_id}: category no coincide con la categoría gobernada del manifiesto.`);
    }
    if (seenRequirementIds.has(item.requirement_id)) fail(`requirements_checklist: requirement_id duplicado: ${item.requirement_id}.`);
    seenRequirementIds.add(item.requirement_id);
    categoriesPresent.add(item.category);

    // Lineage: the checklist item's source_unit_id must trace back to exactly the
    // governed V3 unit the manifest declares for this requirement_id (requirement:
    // "explicitly lineage-checked projection of governed V3 units").
    requireNonEmptyString(item.source_unit_id, `requirements_checklist item ${item.requirement_id} source_unit_id`);
    if (item.source_unit_id !== manifestEntry.source_unit_id) {
      fail(`requirements_checklist item ${item.requirement_id}: source_unit_id no coincide con el manifiesto gobernado (manifest) de la unidad V3.`);
    }

    requireBoundedText(item.document, `requirements_checklist item ${item.requirement_id} document`);
    requireBoundedText(item.accreditation_method, `requirements_checklist item ${item.requirement_id} accreditation_method`);
    validateSourceRef(item.citation, ctx, `requirements_checklist item ${item.requirement_id} citation source_ref`);
    // The citation must be one of the governed V3 unit's OWN evidence_refs — a reference
    // that is globally allowlisted but belongs to a different unit still fails closed.
    const unit = ctx.integralAnalysisUnitsById.get(item.source_unit_id);
    if (!unit.evidenceRefKeys.has(sourceRefKey(item.citation))) {
      fail(`requirements_checklist item ${item.requirement_id}: citation no está entre los evidence_refs de la unidad V3 gobernada "${item.source_unit_id}".`);
    }
    requireEnum(item.validity, AGT002_STAKEHOLDER_BRIEF_VALIDITY_STATES, `requirements_checklist item ${item.requirement_id} validity`);
    requireEnum(item.status, AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_STATUSES, `requirements_checklist item ${item.requirement_id} status`);
    if (item.validity === 'expired' && item.status === 'complete') {
      fail(`requirements_checklist item ${item.requirement_id}: validity "expired" no admite status "complete" (fail closed).`);
    }
    requireEnum(item.owner, AGT002_INTEGRAL_SUGGESTED_ROLES, `requirements_checklist item ${item.requirement_id} owner`);

    if (!Array.isArray(item.missing_evidence)) {
      fail(`requirements_checklist item ${item.requirement_id}: missing_evidence debe ser un arreglo de texto no vacío.`);
    }
    requireBoundedArray(item.missing_evidence, `requirements_checklist item ${item.requirement_id} missing_evidence`);
    item.missing_evidence.forEach((evidence, index) => {
      requireBoundedText(evidence, `requirements_checklist item ${item.requirement_id} missing_evidence[${index}]`);
    });
    if (item.status === 'gap' && item.missing_evidence.length === 0) {
      fail(`requirements_checklist item ${item.requirement_id}: status "gap" exige al menos un missing_evidence.`);
    }
    if (item.status !== 'gap' && item.missing_evidence.length > 0) {
      fail(`requirements_checklist item ${item.requirement_id}: status "${item.status}" no admite missing_evidence (solo "gap" lo admite).`);
    }
  }

  for (const category of AGT002_STAKEHOLDER_BRIEF_REQUIREMENT_CATEGORIES) {
    if (!categoriesPresent.has(category)) {
      fail(`requirements_checklist no cubre la categoría gobernada "${category}" (legal/financial/technical/experience/scoring).`);
    }
  }

  // Exhaustive coverage: the checklist must cover every governed requirementManifest
  // entry exactly once, not merely one item per category (requirement: "full manifest
  // coverage", not category-set coverage).
  for (const requirementId of ctx.requirementManifestById.keys()) {
    if (!seenRequirementIds.has(requirementId)) {
      fail(`requirements_checklist: falta cobertura del requirement_id gobernado del manifiesto (manifest) "${requirementId}".`);
    }
  }
}

function validateTreatmentPlan(block, ctx, milestoneIds) {
  exactKeys(block, ['actions', 'human_approval'], 'treatment_plan');
  requireBoundedArray(block.actions, 'treatment_plan.actions');
  if (block.actions.length === 0) {
    fail('treatment_plan.actions debe ser un arreglo no vacío.');
  }

  const seenActionIds = new Set();
  for (const action of block.actions) {
    exactKeys(action, ACTION_KEYS, 'treatment_plan action');
    requireBoundedId(action.action_id, 'treatment_plan action action_id');
    if (seenActionIds.has(action.action_id)) fail(`treatment_plan: action_id duplicado: ${action.action_id}.`);
    seenActionIds.add(action.action_id);
    requireBoundedText(action.summary, `treatment_plan action ${action.action_id} summary`);
    requireNonEmptyString(action.basis_ref, `treatment_plan action ${action.action_id} basis_ref`);
    if (!milestoneIds.has(action.basis_ref)) {
      fail(`treatment_plan action ${action.action_id}: basis_ref no coincide con ningún milestone_id declarado en timeline.`);
    }
    // Real, imported governed V3 enums — never a free-form string.
    requireEnum(action.suggested_role, AGT002_INTEGRAL_SUGGESTED_ROLES, `treatment_plan action ${action.action_id} suggested_role`);
    requireEnum(action.priority, AGT002_INTEGRAL_ACTION_PRIORITIES, `treatment_plan action ${action.action_id} priority`);
    if (action.external_side_effect !== false) {
      fail(`treatment_plan action ${action.action_id}: external_side_effect debe ser siempre false (ninguna acción externa se ejecuta).`);
    }
  }

  exactKeys(block.human_approval, HUMAN_APPROVAL_KEYS, 'treatment_plan human_approval');
  if (block.human_approval.required !== true) fail('treatment_plan human_approval.required debe ser true; la aprobación humana nunca es opcional.');
  if (block.human_approval.status !== 'pending') fail('treatment_plan human_approval.status debe ser "pending"; nunca puede declararse ya aprobado.');
  if (block.human_approval.approver !== null) fail('treatment_plan human_approval.approver debe ser null; nunca se asigna aprobador en este artefacto.');
  if (block.human_approval.approved_at !== null) fail('treatment_plan human_approval.approved_at debe ser null; nunca se declara aprobado en este artefacto.');
}

// ---------------------------------------------------------------------------
// Public entry points.
// ---------------------------------------------------------------------------

/**
 * Validates a model-shaped stakeholder brief against the closed AGT-002 contract and the
 * governed validationContext (opportunity id, requirement manifest, source-ref allowlist).
 * Throws on any violation; on success returns the SAME object (never normalized, never
 * mutated) so a caller cannot mistake a validated-and-rewritten payload for what the
 * caller actually produced.
 */
export function validateAgt002StakeholderBrief(value, validationContext) {
  const ctx = normalizeValidationContext(validationContext);
  exactKeys(value, TOP_LEVEL_KEYS, 'stakeholder_brief');

  if (value.contract_version !== AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION) {
    fail(`contract_version debe ser "${AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION}".`);
  }
  if (value.opportunity_id !== ctx.opportunityId) {
    fail('opportunity_id no coincide con el opportunityId gobernado del validationContext (fail closed ante IDs mixtos).');
  }
  if (value.human_review_required !== true) {
    fail('human_review_required debe ser true; este artefacto siempre exige revisión humana antes de cualquier acción.');
  }

  validateProcessSummary(value.process_summary, ctx);
  const milestoneIds = validateTimeline(value.timeline, ctx);
  validateQuestionnaireCrossCheck(value.questionnaire_cross_check, ctx);
  validateRequirementsChecklist(value.requirements_checklist, ctx);
  validateTreatmentPlan(value.treatment_plan, ctx, milestoneIds);

  return value;
}

/**
 * Assembles the closed-shape stakeholder brief envelope from caller-supplied parts and
 * immediately self-validates it via validateAgt002StakeholderBrief — never returns a
 * shape it has not itself proven governed/allowlisted/human-review-gated. Governance
 * fields (human_review_required, treatment_plan.human_approval) are always synthesized
 * here as their fixed literals, never taken from caller input.
 */
export function buildAgt002StakeholderBrief({
  opportunityId, processSummary, timelineEntries, questionnaireCrossCheckEntries,
  requirementsChecklistItems, treatmentPlanActions,
} = {}, validationContext) {
  // Deep-clone every nested part of the caller-supplied input before assembling the
  // envelope — a shallow copy would still alias nested arrays/objects, letting the
  // caller mutate the already-returned brief after the fact (requirement: "deep
  // anti-aliasing").
  const brief = {
    contract_version: AGT002_STAKEHOLDER_BRIEF_CONTRACT_VERSION,
    opportunity_id: opportunityId,
    human_review_required: true,
    process_summary: structuredClone(processSummary || {}),
    timeline: { entries: structuredClone(timelineEntries || []) },
    questionnaire_cross_check: { entries: structuredClone(questionnaireCrossCheckEntries || []) },
    requirements_checklist: { items: structuredClone(requirementsChecklistItems || []) },
    treatment_plan: {
      actions: structuredClone(treatmentPlanActions || []),
      human_approval: { required: true, status: 'pending', approver: null, approved_at: null },
    },
  };
  return validateAgt002StakeholderBrief(brief, validationContext);
}
