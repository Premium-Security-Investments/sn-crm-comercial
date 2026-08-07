// Governed, human-curated source for the two maps AGT-002 integral v3
// (agt002-preview-engine.js) requires as explicit constructor configuration and never
// invents on its own:
//   categoryOverrides               (agt002-integral-category-manifest.js)
//   evidenceClassLinkByRequirementId (agt002-evidence-state-manifest.js)
//
// Backed by migration 064 (psi_agt002_integral_governance_overrides), scoped per
// opportunity_id because requirement_id is generated per pliego extraction
// (agt002-deep-analysis-matrix.js), not globally stable across opportunities. Every
// entry must carry a rationale, a traceable source_reference and a curator identity —
// this module never derives a category or an evidence-class link from keyword matching,
// document presence or intuition; a row missing any of those is rejected, not guessed.

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_INTEGRAL_GOVERNANCE_CATEGORIES = Object.freeze(['discard', 'habilitating', 'technical', 'financial_execution']);
export const AGT002_INTEGRAL_GOVERNANCE_OVERRIDE_KINDS = Object.freeze(['category_override', 'evidence_class_link']);

const AGT002_INTEGRAL_GOVERNANCE_OVERRIDES_SELECT = 'requirement_id,override_kind,category_value,evidence_class_id,rationale,source_reference,curated_by,curated_at';

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AGT-002 integral governance overrides: ${label} debe ser texto no vacío.`);
  return value.trim();
}

/**
 * Validates and folds raw curated rows (either DB rows or hand-built fixtures) into the
 * two maps the v3 engine consumes, plus a traceable provenance record keyed by
 * `${override_kind}:${requirement_id}`. Fails closed on any malformed, incomplete or
 * cross-kind-inconsistent row rather than silently dropping or guessing it.
 */
export function buildAgt002IntegralGovernanceOverrides({ overrideEntries = [] } = {}) {
  if (!Array.isArray(overrideEntries)) throw new Error('AGT-002 integral governance overrides: overrideEntries debe ser un arreglo.');

  const categoryOverrides = {};
  const evidenceClassLinkByRequirementId = {};
  const provenance = {};
  const seen = new Set();

  for (const raw of overrideEntries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('AGT-002 integral governance overrides: cada entrada debe ser un objeto.');
    }
    const requirementId = requireNonEmptyString(raw.requirement_id, 'requirement_id');
    const kind = raw.override_kind;
    if (!AGT002_INTEGRAL_GOVERNANCE_OVERRIDE_KINDS.includes(kind)) {
      throw new Error(`AGT-002 integral governance overrides: override_kind inválido para ${requirementId}: ${String(kind)}.`);
    }
    const dedupeKey = `${kind}:${requirementId}`;
    if (seen.has(dedupeKey)) {
      throw new Error(`AGT-002 integral governance overrides: entrada duplicada para ${requirementId} (${kind}).`);
    }
    seen.add(dedupeKey);

    const rationale = requireNonEmptyString(raw.rationale, `${requirementId}.rationale`);
    const sourceReference = requireNonEmptyString(raw.source_reference, `${requirementId}.source_reference`);
    const curatedBy = requireNonEmptyString(raw.curated_by, `${requirementId}.curated_by`);

    if (kind === 'category_override') {
      if (raw.evidence_class_id != null) {
        throw new Error(`AGT-002 integral governance overrides: ${requirementId} es category_override y no puede llevar evidence_class_id.`);
      }
      if (!AGT002_INTEGRAL_GOVERNANCE_CATEGORIES.includes(raw.category_value)) {
        throw new Error(`AGT-002 integral governance overrides: category_value inválido para ${requirementId}: ${String(raw.category_value)}.`);
      }
      categoryOverrides[requirementId] = raw.category_value;
      provenance[dedupeKey] = {
        requirement_id: requirementId, override_kind: kind, category_value: raw.category_value,
        rationale, source_reference: sourceReference, curated_by: curatedBy, curated_at: raw.curated_at ?? null,
      };
    } else {
      if (raw.category_value != null) {
        throw new Error(`AGT-002 integral governance overrides: ${requirementId} es evidence_class_link y no puede llevar category_value.`);
      }
      if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(raw.evidence_class_id)) {
        throw new Error(
          `AGT-002 integral governance overrides: evidence_class_id inválido para ${requirementId}: ${String(raw.evidence_class_id)}; `
          + 'no pertenece al catálogo cerrado de 17 clases de evidencia empresarial.',
        );
      }
      evidenceClassLinkByRequirementId[requirementId] = raw.evidence_class_id;
      provenance[dedupeKey] = {
        requirement_id: requirementId, override_kind: kind, evidence_class_id: raw.evidence_class_id,
        rationale, source_reference: sourceReference, curated_by: curatedBy, curated_at: raw.curated_at ?? null,
      };
    }
  }

  return Object.freeze({
    categoryOverrides: Object.freeze(categoryOverrides),
    evidenceClassLinkByRequirementId: Object.freeze(evidenceClassLinkByRequirementId),
    provenance: Object.freeze(provenance),
  });
}

// PostgREST/Postgres codes meaning "the table itself does not exist" — mirrors
// agt002-company-evidence-classes.js's own fail-soft handling of an optional table that
// predates the migration introducing it.
const TABLE_ABSENT_ERROR_CODES = ['PGRST205', '42P01'];

export async function loadAgt002IntegralGovernanceOverrides(database, opportunityId) {
  if (typeof opportunityId !== 'string' || !opportunityId.trim()) {
    throw new Error('AGT-002 integral governance overrides: opportunityId es obligatorio.');
  }
  const { data, error } = await database
    .from('psi_agt002_integral_governance_overrides')
    .select(AGT002_INTEGRAL_GOVERNANCE_OVERRIDES_SELECT)
    .eq('opportunity_id', opportunityId)
    .eq('current', true)
    .order('requirement_id');
  if (error) {
    if (TABLE_ABSENT_ERROR_CODES.includes(error.code)) return buildAgt002IntegralGovernanceOverrides({ overrideEntries: [] });
    throw error;
  }
  return buildAgt002IntegralGovernanceOverrides({ overrideEntries: data || [] });
}
