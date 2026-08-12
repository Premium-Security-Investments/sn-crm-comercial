// Governed, auditable, NOT-executable draft of the two maps AGT-002 integral v3 needs
// as human-curated input (categoryOverrides / evidenceClassLinkByRequirementId — see
// agt002-integral-governance-overrides.js). This is a distinct, deliberately
// incompatible shape from a psi_agt002_integral_governance_overrides curated row: a
// proposal has no curated_by/curated_at, so it can never be fed straight into
// buildAgt002IntegralGovernanceOverrides — a human must read it, decide, and re-author
// real curated rows (migration/curation, never a runtime write path). Every requirement
// in the embedded requirement_manifest must be explicitly covered, on both governed
// axes, by exactly one proposal or one documented abstention; nothing may be silently
// missing, double-covered, orphaned, or carry raw document excerpt/text.
//
// Scope: preparing this specific opportunity's draft, not a generic auto-classifier —
// the proposals/abstentions are curated judgment (this session's reading of the real
// pliego clauses), never derived by keyword matching, document presence or intuition.

import { validateAgt002RequirementManifest } from './agt002-deep-analysis-matrix.js';
import { AGT002_INTEGRAL_GOVERNANCE_CATEGORIES } from './agt002-integral-governance-overrides.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from './agt002-company-evidence-classes.js';

export const AGT002_GOVERNANCE_DRAFT_ARTIFACT_TYPE = 'agt002_governance_draft_proposal';
export const AGT002_GOVERNANCE_DRAFT_STATUS = 'DRAFT';
export const AGT002_GOVERNANCE_DRAFT_AXES = Object.freeze(['category_override', 'evidence_class_link']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOP_LEVEL_KEYS = [
  'artifact_type', 'status', 'human_approval_required', 'version', 'opportunity_id', 'snapshot_id',
  'evidence_chunk_snapshot_ids', 'generated_at', 'requirement_manifest', 'chunk_citations',
  'category_override_proposals', 'evidence_class_link_proposals', 'abstentions', 'data_gaps',
];
const CATEGORY_PROPOSAL_KEYS = ['requirement_id', 'category_value', 'rationale', 'source_reference', 'caveat'];
const EVIDENCE_LINK_PROPOSAL_KEYS = ['requirement_id', 'evidence_class_id', 'rationale', 'source_reference'];
const ABSTENTION_KEYS = ['requirement_id', 'axis', 'reason', 'detail'];
const CHUNK_CITATION_KEYS = ['document_version_id', 'document_name', 'document_type', 'page', 'section', 'chunk_index', 'chunk_id', 'chunk_hash'];
const DATA_GAP_KEYS = ['gap_id', 'description', 'affected_document_ids'];
const FORBIDDEN_TEXT_KEYS = ['text', 'excerpt', 'text_content', 'raw_text', 'content'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireNonEmptyString(value, label) {
  if (!nonEmptyString(value)) throw new Error(`AGT-002 governance draft proposal: ${label} debe ser texto no vacío.`);
  return value.trim();
}

function requireUuid(value, label) {
  const trimmed = requireNonEmptyString(value, label);
  if (!UUID_PATTERN.test(trimmed)) throw new Error(`AGT-002 governance draft proposal: ${label} debe ser un UUID válido.`);
  return trimmed;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`AGT-002 governance draft proposal: ${label} debe ser un entero positivo.`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`AGT-002 governance draft proposal: ${label} debe ser un entero mayor o igual a cero.`);
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`AGT-002 governance draft proposal: ${label} debe ser una marca de tiempo ISO válida.`);
  }
  return value;
}

function findForbiddenTextKeyPaths(value, path = '') {
  const paths = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => paths.push(...findForbiddenTextKeyPaths(item, `${path}[${index}]`)));
    return paths;
  }
  if (!isRecord(value)) return paths;
  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_TEXT_KEYS.includes(key)) paths.push(nextPath);
    paths.push(...findForbiddenTextKeyPaths(value[key], nextPath));
  }
  return paths;
}

/**
 * Recursive, key-based leak scan over the ENTIRE artifact (including inside the embedded
 * requirement_manifest) — replaces both the old per-call, shallow forbidden-key check (which
 * only ran at a handful of named locations) and the old substring regex over
 * JSON.stringify(value) (which false-positived on legitimate prose merely mentioning one of
 * these words, and never checked the full FORBIDDEN_TEXT_KEYS vocabulary structurally against
 * the top-level object or requirement_manifest). Exported so it can be unit-tested directly
 * against arbitrary nesting, independent of this module's own closed schemas.
 */
export function findAgt002GovernanceDraftForbiddenTextKeyPaths(value) {
  return findForbiddenTextKeyPaths(value);
}

function requirementIdsOf(requirementManifest) {
  return new Set((requirementManifest?.requirement_manifest || []).map(entry => entry.requirement_id));
}

function validateChunkCitations(chunkCitations, knownRequirementIds) {
  if (!isRecord(chunkCitations)) throw new Error('AGT-002 governance draft proposal: chunk_citations debe ser un objeto.');
  for (const [requirementId, citations] of Object.entries(chunkCitations)) {
    if (!knownRequirementIds.has(requirementId)) {
      throw new Error(`AGT-002 governance draft proposal: chunk_citations referencia un requirement_id inexistente en el manifiesto: ${requirementId}.`);
    }
    if (!Array.isArray(citations)) throw new Error(`AGT-002 governance draft proposal: chunk_citations.${requirementId} debe ser un arreglo.`);
    for (const citation of citations) {
      if (!exactKeys(citation, CHUNK_CITATION_KEYS)) {
        throw new Error(`AGT-002 governance draft proposal: una cita de chunk tiene claves no permitidas (${requirementId}).`);
      }
      requireUuid(citation.document_version_id, `chunk_citations.${requirementId}.document_version_id`);
      requireNonEmptyString(citation.document_name, `chunk_citations.${requirementId}.document_name`);
      requireNonEmptyString(citation.document_type, `chunk_citations.${requirementId}.document_type`);
      requirePositiveInteger(citation.page, `chunk_citations.${requirementId}.page`);
      requirePositiveInteger(citation.section, `chunk_citations.${requirementId}.section`);
      requireNonNegativeInteger(citation.chunk_index, `chunk_citations.${requirementId}.chunk_index`);
      requireNonEmptyString(citation.chunk_id, `chunk_citations.${requirementId}.chunk_id`);
      if (!/^[0-9a-f]{64}$/.test(citation.chunk_hash || '')) {
        throw new Error(`AGT-002 governance draft proposal: chunk_citations.${requirementId}.chunk_hash debe ser SHA-256 hexadecimal.`);
      }
    }
  }
}

function validateCategoryOverrideProposals(proposals, knownRequirementIds, coverage) {
  if (!Array.isArray(proposals)) throw new Error('AGT-002 governance draft proposal: category_override_proposals debe ser un arreglo.');
  for (const proposal of proposals) {
    if (!exactKeys(proposal, CATEGORY_PROPOSAL_KEYS)) {
      throw new Error('AGT-002 governance draft proposal: una propuesta de category_override tiene claves no permitidas.');
    }
    const requirementId = requireNonEmptyString(proposal.requirement_id, 'category_override_proposals.requirement_id');
    if (!knownRequirementIds.has(requirementId)) {
      throw new Error(`AGT-002 governance draft proposal: category_override_proposals referencia un requirement_id inexistente en el manifiesto: ${requirementId}.`);
    }
    if (!AGT002_INTEGRAL_GOVERNANCE_CATEGORIES.includes(proposal.category_value)) {
      throw new Error(`AGT-002 governance draft proposal: category_value inválido para ${requirementId}: ${String(proposal.category_value)}.`);
    }
    requireNonEmptyString(proposal.rationale, `category_override_proposals.${requirementId}.rationale`);
    requireNonEmptyString(proposal.source_reference, `category_override_proposals.${requirementId}.source_reference`);
    if (proposal.caveat !== null && !nonEmptyString(proposal.caveat)) {
      throw new Error(`AGT-002 governance draft proposal: caveat de ${requirementId} debe ser null o texto no vacío.`);
    }
    coverage.category_override.record(requirementId, 'proposal');
  }
}

function validateEvidenceClassLinkProposals(proposals, knownRequirementIds, coverage) {
  if (!Array.isArray(proposals)) throw new Error('AGT-002 governance draft proposal: evidence_class_link_proposals debe ser un arreglo.');
  for (const proposal of proposals) {
    if (!exactKeys(proposal, EVIDENCE_LINK_PROPOSAL_KEYS)) {
      throw new Error('AGT-002 governance draft proposal: una propuesta de evidence_class_link tiene claves no permitidas.');
    }
    const requirementId = requireNonEmptyString(proposal.requirement_id, 'evidence_class_link_proposals.requirement_id');
    if (!knownRequirementIds.has(requirementId)) {
      throw new Error(`AGT-002 governance draft proposal: evidence_class_link_proposals referencia un requirement_id inexistente en el manifiesto: ${requirementId}.`);
    }
    if (!AGT002_COMPANY_EVIDENCE_CLASS_IDS.includes(proposal.evidence_class_id)) {
      throw new Error(`AGT-002 governance draft proposal: evidence_class_id inválido para ${requirementId}: ${String(proposal.evidence_class_id)}.`);
    }
    requireNonEmptyString(proposal.rationale, `evidence_class_link_proposals.${requirementId}.rationale`);
    requireNonEmptyString(proposal.source_reference, `evidence_class_link_proposals.${requirementId}.source_reference`);
    coverage.evidence_class_link.record(requirementId, 'proposal');
  }
}

function validateAbstentions(abstentions, knownRequirementIds, coverage) {
  if (!Array.isArray(abstentions)) throw new Error('AGT-002 governance draft proposal: abstentions debe ser un arreglo.');
  for (const abstention of abstentions) {
    if (!exactKeys(abstention, ABSTENTION_KEYS)) {
      throw new Error('AGT-002 governance draft proposal: una abstención tiene claves no permitidas.');
    }
    const requirementId = requireNonEmptyString(abstention.requirement_id, 'abstentions.requirement_id');
    if (!knownRequirementIds.has(requirementId)) {
      throw new Error(`AGT-002 governance draft proposal: abstentions referencia un requirement_id inexistente en el manifiesto: ${requirementId}.`);
    }
    if (!AGT002_GOVERNANCE_DRAFT_AXES.includes(abstention.axis)) {
      throw new Error(`AGT-002 governance draft proposal: axis inválido en abstención de ${requirementId}: ${String(abstention.axis)}.`);
    }
    requireNonEmptyString(abstention.reason, `abstentions.${requirementId}.reason`);
    requireNonEmptyString(abstention.detail, `abstentions.${requirementId}.detail`);
    coverage[abstention.axis].record(requirementId, 'abstention');
  }
}

function validateDataGaps(dataGaps) {
  if (!Array.isArray(dataGaps)) throw new Error('AGT-002 governance draft proposal: data_gaps debe ser un arreglo.');
  for (const gap of dataGaps) {
    if (!exactKeys(gap, DATA_GAP_KEYS)) throw new Error('AGT-002 governance draft proposal: un data_gap tiene claves no permitidas.');
    requireNonEmptyString(gap.gap_id, 'data_gaps.gap_id');
    requireNonEmptyString(gap.description, `data_gaps.${gap.gap_id}.description`);
    if (!Array.isArray(gap.affected_document_ids) || gap.affected_document_ids.some(id => !nonEmptyString(id))) {
      throw new Error(`AGT-002 governance draft proposal: affected_document_ids inválido en data_gap ${gap.gap_id}.`);
    }
  }
}

// The real snapshot_id(s) actually backing the persisted chunk evidence in chunk_citations
// — which the append-only chunking pipeline may have run against a snapshot other than this
// draft's canonical `snapshot_id` (see the P2 finding on snapshot_id semantics: anchoring is
// sound via content_hash, but `snapshot_id` alone could be misread as "the chunks come from
// this snapshot"). A required, closed field so the draft can never omit that disclosure.
function validateEvidenceChunkSnapshotIds(value) {
  if (!Array.isArray(value)) {
    throw new Error('AGT-002 governance draft proposal: evidence_chunk_snapshot_ids debe ser un arreglo.');
  }
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    requireUuid(entry, `evidence_chunk_snapshot_ids[${index}]`);
    if (seen.has(entry)) {
      throw new Error(`AGT-002 governance draft proposal: evidence_chunk_snapshot_ids contiene un duplicado: ${entry}.`);
    }
    seen.add(entry);
  }
  const sorted = [...value].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(value)) {
    throw new Error('AGT-002 governance draft proposal: evidence_chunk_snapshot_ids debe estar ordenado ascendentemente.');
  }
}

function makeAxisCoverageTracker(axisLabel) {
  const seen = new Map();
  return {
    record(requirementId, kind) {
      if (seen.has(requirementId)) {
        throw new Error(
          `AGT-002 governance draft proposal: ${requirementId} está cubierto más de una vez en el eje "${axisLabel}" `
          + `(${seen.get(requirementId)} y ${kind}); debe cubrirse exactamente una vez.`,
        );
      }
      seen.set(requirementId, kind);
    },
    assertCompleteCoverage(knownRequirementIds) {
      const missing = [...knownRequirementIds].filter(id => !seen.has(id)).sort();
      if (missing.length) {
        throw new Error(
          `AGT-002 governance draft proposal: cobertura incompleta en el eje "${axisLabel}"; `
          + `sin propuesta ni abstención para: ${missing.join(', ')}.`,
        );
      }
    },
  };
}

/**
 * Defensive structural re-check: validates a built (or persisted/untrusted) draft
 * envelope from scratch — status/human_approval_required are the mechanical gate that
 * keeps this artifact out of runtime; requirement_manifest reuses the real extraction
 * validator (never a private re-implementation); every proposal/abstention/citation is
 * cross-checked against that same manifest for traceability and exhaustive, non-
 * duplicated coverage on both governed axes.
 */
export function validateAgt002GovernanceDraftProposal(value) {
  // Runs first, before any other structural/business-rule check: a text-leak risk takes
  // priority over any other defect, and this scan is recursive over the whole object graph
  // (including inside requirement_manifest), so it does not depend on — and must not be
  // shadowed by — the narrower exactKeys() checks below.
  const forbiddenPaths = findForbiddenTextKeyPaths(value);
  if (forbiddenPaths.length) {
    throw new Error(`AGT-002 governance draft proposal: el artefacto no puede persistir texto de documento (${forbiddenPaths.join(', ')}).`);
  }

  if (!exactKeys(value, TOP_LEVEL_KEYS)) {
    throw new Error('AGT-002 governance draft proposal: el artefacto tiene claves no permitidas o incompletas.');
  }
  if (value.artifact_type !== AGT002_GOVERNANCE_DRAFT_ARTIFACT_TYPE) {
    throw new Error('AGT-002 governance draft proposal: artifact_type inválido.');
  }
  if (value.status !== AGT002_GOVERNANCE_DRAFT_STATUS) {
    throw new Error('AGT-002 governance draft proposal: status debe ser DRAFT; este artefacto nunca puede declararse aprobado.');
  }
  if (value.human_approval_required !== true) {
    throw new Error('AGT-002 governance draft proposal: human_approval_required debe ser true; un borrador nunca puede omitir la aprobación humana.');
  }
  requirePositiveInteger(value.version, 'version');
  requireUuid(value.opportunity_id, 'opportunity_id');
  requireUuid(value.snapshot_id, 'snapshot_id');
  validateEvidenceChunkSnapshotIds(value.evidence_chunk_snapshot_ids);
  requireIsoTimestamp(value.generated_at, 'generated_at');

  validateAgt002RequirementManifest(value.requirement_manifest);
  const knownRequirementIds = requirementIdsOf(value.requirement_manifest);

  const coverage = {
    category_override: makeAxisCoverageTracker('category_override'),
    evidence_class_link: makeAxisCoverageTracker('evidence_class_link'),
  };

  validateChunkCitations(value.chunk_citations, knownRequirementIds);
  validateCategoryOverrideProposals(value.category_override_proposals, knownRequirementIds, coverage);
  validateEvidenceClassLinkProposals(value.evidence_class_link_proposals, knownRequirementIds, coverage);
  validateAbstentions(value.abstentions, knownRequirementIds, coverage);
  validateDataGaps(value.data_gaps);

  coverage.category_override.assertCompleteCoverage(knownRequirementIds);
  coverage.evidence_class_link.assertCompleteCoverage(knownRequirementIds);

  return value;
}

/**
 * Assembles the closed-shape draft envelope and immediately self-validates it — the same
 * fail-closed discipline as buildAgt002RequirementManifest/buildAgt002IntegralGovernance
 * Overrides: this never returns a shape it has not itself proven traceable, exhaustively
 * covered and free of raw document text.
 */
export function buildAgt002GovernanceDraftProposal({
  opportunityId, snapshotId, evidenceChunkSnapshotIds, generatedAt, version, requirementManifest,
  chunkCitations = {}, categoryOverrideProposals = [], evidenceClassLinkProposals = [],
  abstentions = [], dataGaps = [],
} = {}) {
  const draft = {
    artifact_type: AGT002_GOVERNANCE_DRAFT_ARTIFACT_TYPE,
    status: AGT002_GOVERNANCE_DRAFT_STATUS,
    human_approval_required: true,
    version,
    opportunity_id: opportunityId,
    snapshot_id: snapshotId,
    evidence_chunk_snapshot_ids: evidenceChunkSnapshotIds,
    generated_at: generatedAt,
    requirement_manifest: requirementManifest,
    chunk_citations: chunkCitations,
    category_override_proposals: categoryOverrideProposals,
    evidence_class_link_proposals: evidenceClassLinkProposals,
    abstentions,
    data_gaps: dataGaps,
  };
  return validateAgt002GovernanceDraftProposal(draft);
}
