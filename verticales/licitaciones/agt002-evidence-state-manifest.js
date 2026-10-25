// Deterministic, traceable derivation of the AGT-002 integral v3 evidence_state
// (presence/review/validity/applicability/compliance) for each governed tender
// requirement — closing the audit's P0 gap "cumplimiento inferido por presencia".
//
// evidence_state must never be free model output, and no axis may ever be inferred from
// another. A requirement links to at most one real company-evidence class (one of the 17
// in agt002-company-evidence-classes.js) via an explicit, curated
// evidenceClassLinkByRequirementId entry — never by name matching or guessing. When a
// requirement has no governed link, or its linked class was never observed in the
// supplied evidenceClasses for this run, this module abstains to the safe unknown state
// rather than throwing: absence of *signal* is expected and safe, not a configuration
// error. Every axis is read from its own independent governed column of the linked
// class; none is ever derived from another, so "the document exists" alone can never
// promote review/validity/applicability/compliance.
//
// `compliance` never leaves "unknown" here: there is no real write path yet for it
// (agt002-company-evidence-classes.js's own compliance_status stays "pending_review" by
// construction — see that module's header comment), so no rule in this module may
// promote it. A governed compliance determination is out of scope until that write path
// exists; until then, "unknown" is the only honest value.
//
// Audit: docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md (P0
// "cumplimiento inferido por presencia").

import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_EVIDENCE_STATE_SAFE_UNKNOWN = Object.freeze({
  presence: 'unknown',
  review: 'not_reviewed',
  validity: 'unknown',
  applicability: 'unknown',
  compliance: 'unknown',
});

const RULE_NO_GOVERNED_LINK = 'no_governed_evidence_class_link';
const RULE_LINKED_CLASS_NOT_OBSERVED = 'linked_evidence_class_not_observed';
const RULE_COMPANY_EVIDENCE_CLASS_AXIS_PROJECTION = 'company_evidence_class_axis_projection';

const PRESENCE_MAP = new Map([['verified', 'present'], ['reported', 'present'], ['not_verified', 'absent']]);
const REVIEW_MAP = new Map([['approved', 'reviewed'], ['rejected', 'reviewed'], ['pending_human_review', 'not_reviewed']]);
const VALIDITY_MAP = new Map([['current', 'valid'], ['expired', 'expired'], ['unknown', 'unknown']]);
const APPLICABILITY_MAP = new Map([['applicable', 'applicable'], ['not_applicable', 'not_applicable'], ['pending_case_validation', 'unknown']]);

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`AGT-002 evidence-state manifest: ${label} debe ser texto no vacío.`);
  return value.trim();
}

// Each axis reads exactly one governed column of the linked class — never another axis
// of the same class, and never anything derived from this module's own output. This is
// the structural guarantee behind "presencia nunca muta los otros ejes".
function deriveClassEvidenceState(cls) {
  const presence = PRESENCE_MAP.get(cls.presence_status);
  const review = REVIEW_MAP.get(cls.review_status);
  const validity = VALIDITY_MAP.get(cls.validity_status);
  const applicability = APPLICABILITY_MAP.get(cls.applicability_status);
  if (!presence || !review || !validity || !applicability) {
    throw new Error(`AGT-002 evidence-state manifest: la clase de evidencia ${cls.entry_id} tiene un estado no reconocido.`);
  }
  return Object.freeze({ presence, review, validity, applicability, compliance: 'unknown' });
}

/**
 * Builds the governed evidence_state manifest, one entry per requirement in
 * `requirementManifest`, each `{ requirement_id, evidence_state, rule_id, provenance }`.
 *
 * `evidenceClassLinkByRequirementId`: an explicit, governed requirement_id ->
 * evidence_class_id mapping (plain object or Map), curated outside this function — never
 * invented here. `evidenceClasses`: the real 17-class catalog already built for this run
 * (agt002-company-evidence-classes.js's `buildAgt002CompanyEvidenceClasses(...).classes`),
 * consulted only for classes an explicit link actually points at.
 */
export function buildAgt002EvidenceStateManifest(requirementManifest, {
  evidenceClasses = [], evidenceClassLinkByRequirementId = {},
} = {}) {
  if (!Array.isArray(requirementManifest)) throw new Error('AGT-002 evidence-state manifest: requirementManifest debe ser un arreglo.');
  if (!Array.isArray(evidenceClasses)) throw new Error('AGT-002 evidence-state manifest: evidenceClasses debe ser un arreglo.');
  const link = evidenceClassLinkByRequirementId instanceof Map
    ? evidenceClassLinkByRequirementId
    : new Map(Object.entries(evidenceClassLinkByRequirementId || {}));
  const classById = new Map(evidenceClasses.map(cls => [cls.entry_id, cls]));

  return requirementManifest.map(entry => {
    const requirementId = requireNonEmptyString(entry?.requirement_id, 'requirement_id');

    if (!link.has(requirementId)) {
      return {
        requirement_id: requirementId, evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: RULE_NO_GOVERNED_LINK, provenance: null,
      };
    }

    const evidenceClassId = link.get(requirementId);
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(evidenceClassId)) {
      throw new Error(
        `AGT-002 evidence-state manifest: el requisito ${requirementId} enlaza a "${evidenceClassId}", que no es un `
        + 'identificador del catálogo cerrado de 17 clases de evidencia empresarial; se rechaza en lugar de fabricarlo (fail-closed).',
      );
    }

    const cls = classById.get(evidenceClassId);
    if (!cls) {
      return {
        requirement_id: requirementId,
        evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN,
        rule_id: RULE_LINKED_CLASS_NOT_OBSERVED,
        provenance: { evidence_class_id: evidenceClassId },
      };
    }

    return {
      requirement_id: requirementId,
      evidence_state: deriveClassEvidenceState(cls),
      rule_id: RULE_COMPANY_EVIDENCE_CLASS_AXIS_PROJECTION,
      provenance: { evidence_class_id: evidenceClassId, source: cls.source },
    };
  });
}
