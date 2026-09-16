// AGT-002 stakeholder-brief PREVIEW adapter — wraps the existing, already-governed
// `buildAgt002StakeholderBrief` projector (agt002-stakeholder-brief.js) behind a feature
// flag and a self-contained governed source: a single canonical AGT-002 envelope
// (schema_version/agent_id/status + a governed `integral_analysis` block of V3 units).
//
// The adapter derives BOTH the V3 unit lineage summaries and the citation allowlist
// itself from the envelope — a caller-supplied `governedInput` may never inject or
// override `allowlist` / `integralAnalysisUnits`, since those are exactly the governed
// invariants this adapter exists to protect. `buildAgt002StakeholderBrief` remains the
// sole owner of all five-block validation, source-unit citation ownership, pending
// human approval, and `external_side_effect: false` invariants.
//
// Pure function: no I/O, no globals, no database/network/clock/random access. Never
// mutates `envelope` or `governedInput`.

import { buildAgt002StakeholderBrief } from './agt002-stakeholder-brief.js';
import { AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION } from './agt002-preview-contract.js';
import {
  AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
  AGT002_INTEGRAL_CATEGORIES,
  AGT002_INTEGRAL_SOURCE_TYPES,
  AGT002_INTEGRAL_UNIT_KINDS,
} from './agt002-integral-analysis-v3.js';

function fail(message) {
  throw new Error(`AGT-002 stakeholder brief preview: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

// Fail-closed canonical envelope validation: object shape, schema_version, agent_id,
// status, and the governed integral_analysis contract_version. Returns the raw
// analysis_units array on success.
function validateEnvelope(envelope) {
  if (!isRecord(envelope)) fail('envelope debe ser un objeto.');
  if (envelope.schema_version !== AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION) {
    fail(`envelope.schema_version debe ser exactamente "${AGT002_INTEGRAL_ENVELOPE_SCHEMA_VERSION}" (envelope canónico AGT-002).`);
  }
  if (envelope.agent_id !== 'AGT-002') fail('envelope.agent_id debe ser exactamente "AGT-002".');
  if (envelope.status !== 'completed') fail('envelope.status debe ser exactamente "completed".');

  const integralAnalysis = envelope.integral_analysis;
  if (!isRecord(integralAnalysis)) fail('envelope.integral_analysis debe ser un objeto.');
  if (integralAnalysis.contract_version !== AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION) {
    fail(`envelope.integral_analysis.contract_version debe ser exactamente "${AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION}" (integral-analysis-v3).`);
  }
  if (!nonEmptyArray(integralAnalysis.analysis_units)) {
    fail('envelope.integral_analysis.analysis_units debe ser un arreglo no vacío.');
  }
  return integralAnalysis.analysis_units;
}

const BLOCK_CHECKS = [
  ['process_summary', governedInput => isRecord(governedInput.processSummary)],
  ['timeline', governedInput => nonEmptyArray(governedInput.timelineEntries)],
  ['questionnaire_cross_check', governedInput => nonEmptyArray(governedInput.questionnaireCrossCheckEntries)],
  ['requirements_checklist', governedInput => nonEmptyArray(governedInput.requirementManifest) && nonEmptyArray(governedInput.requirementsChecklistItems)],
  ['treatment_plan', governedInput => nonEmptyArray(governedInput.treatmentPlanActions)],
];

function computeMissingInputs(governedInput) {
  const gi = isRecord(governedInput) ? governedInput : {};
  return BLOCK_CHECKS.filter(([, isPresent]) => !isPresent(gi)).map(([name]) => name);
}

// Derives validationContext EXCLUSIVELY from the server-owned opportunityId, the
// envelope's integral_analysis units, and governedInput.requirementManifest — never
// from a caller-supplied allowlist/integralAnalysisUnits (those governedInput keys, if
// present, are simply never read here).
function buildValidationContext(opportunityId, analysisUnits, requirementManifest) {
  const unitsById = new Map();
  const integralAnalysisUnits = [];
  const allowlistSets = {};
  for (const sourceType of AGT002_INTEGRAL_SOURCE_TYPES) allowlistSets[sourceType] = new Set();

  for (const unit of analysisUnits) {
    if (!isRecord(unit)) fail('envelope.integral_analysis.analysis_units[] debe ser un objeto.');
    if (!nonEmptyString(unit.unit_id)) fail('envelope.integral_analysis.analysis_units[] tiene un unit_id inválido.');
    if (unitsById.has(unit.unit_id)) {
      fail(`envelope.integral_analysis.analysis_units tiene unit_id duplicado: ${unit.unit_id}.`);
    }
    if (!AGT002_INTEGRAL_CATEGORIES.includes(unit.category)) {
      fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}].category no pertenece a la enumeración V3 cerrada (category no permitida).`);
    }
    if (!nonEmptyArray(unit.evidence_refs)) {
      fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}].evidence_refs debe ser un arreglo no vacío.`);
    }

    // Strip the V3 `purpose` field from each evidence ref, retaining only {ref, source_type}.
    const strippedRefs = unit.evidence_refs.map(evidenceRef => {
      if (!isRecord(evidenceRef) || !nonEmptyString(evidenceRef.ref) || !AGT002_INTEGRAL_SOURCE_TYPES.includes(evidenceRef.source_type)) {
        fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}].evidence_refs[] tiene un ref o source_type inválido.`);
      }
      allowlistSets[evidenceRef.source_type].add(evidenceRef.ref);
      return { ref: evidenceRef.ref, source_type: evidenceRef.source_type };
    });

    if (!AGT002_INTEGRAL_UNIT_KINDS.includes(unit.unit_kind)) {
      fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}].unit_kind no pertenece a la enumeración V3 cerrada (unit_kind no permitido).`);
    }
    if (unit.unit_kind === 'tender_requirement') {
      if (!nonEmptyString(unit.requirement_id)) {
        fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}] tiene un requirement_id inválido.`);
      }
    } else if (unit.requirement_id !== null) {
      fail(`envelope.integral_analysis.analysis_units[${unit.unit_id}]: strategic_consideration debe tener requirement_id null.`);
    }

    unitsById.set(unit.unit_id, { requirement_id: unit.requirement_id });
    integralAnalysisUnits.push({ unit_id: unit.unit_id, category: unit.category, evidence_refs: strippedRefs });
  }

  const manifest = Array.isArray(requirementManifest) ? requirementManifest : [];
  for (const entry of manifest) {
    if (!isRecord(entry) || !nonEmptyString(entry.source_unit_id)) {
      fail('governedInput.requirementManifest[] tiene un source_unit_id inválido.');
    }
    const sourceUnit = unitsById.get(entry.source_unit_id);
    if (!sourceUnit) {
      fail(`governedInput.requirementManifest[${entry.requirement_id}].source_unit_id no existe en las unidades V3 del envelope: ${entry.source_unit_id}.`);
    }
    if (sourceUnit.requirement_id !== entry.requirement_id) {
      fail(`governedInput.requirementManifest[${entry.requirement_id}]: requirement_id no coincide con el requirement_id de la unidad V3 fuente "${entry.source_unit_id}".`);
    }
  }

  const allowlist = {};
  for (const sourceType of AGT002_INTEGRAL_SOURCE_TYPES) allowlist[sourceType] = [...allowlistSets[sourceType]];

  return {
    opportunityId,
    integralAnalysisContractVersion: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    integralAnalysisUnits,
    requirementManifest: manifest,
    allowlist,
  };
}

/**
 * Pure adapter: `enabled !== true` short-circuits to the disabled result without
 * inspecting any other argument. When enabled, validates the canonical envelope
 * fail-closed, checks governedInput completeness (returning 'unavailable' with the
 * named missing blocks otherwise), enforces the server-owned opportunityId boundary,
 * derives a governed validationContext solely from the envelope + requirementManifest,
 * and delegates all remaining brief semantics to `buildAgt002StakeholderBrief`.
 */
export function buildAgt002StakeholderBriefPreview({
  enabled, opportunityId, envelope, governedInput,
} = {}) {
  if (enabled !== true) {
    return { status: 'disabled', stakeholder_brief: null, missing_inputs: [] };
  }

  const analysisUnits = validateEnvelope(envelope);

  const missingInputs = computeMissingInputs(governedInput);
  if (missingInputs.length > 0) {
    return { status: 'unavailable', stakeholder_brief: null, missing_inputs: missingInputs };
  }

  if (!nonEmptyString(opportunityId)) fail('opportunityId (gobernado por el servidor) debe ser texto no vacío.');
  if (governedInput.opportunityId !== opportunityId) {
    fail('governedInput.opportunityId no coincide con el opportunityId gobernado por el servidor (fail closed ante opportunity mixta).');
  }

  const validationContext = buildValidationContext(opportunityId, analysisUnits, governedInput.requirementManifest);

  const brief = buildAgt002StakeholderBrief({
    opportunityId,
    processSummary: governedInput.processSummary,
    timelineEntries: governedInput.timelineEntries,
    questionnaireCrossCheckEntries: governedInput.questionnaireCrossCheckEntries,
    requirementsChecklistItems: governedInput.requirementsChecklistItems,
    treatmentPlanActions: governedInput.treatmentPlanActions,
  }, validationContext);

  return { status: 'available', stakeholder_brief: brief, missing_inputs: [] };
}
