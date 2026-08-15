// AGT002_INTEGRAL_CONTRACT_V3 — Phase 3 wiring of the checked-in, versioned Manizales
// SA-24-2026 integral manifest into the V3 preview runtime.
//
// This module is a pure, deterministic function library: no I/O, no clock, no network. It
// takes an already-parsed `manizalesManifestSource` (the checked-in
// data/agt002/manizales-sa-24-2026.integral-manifest.v1.json artifact), re-validates it
// with the Phase-1 fail-closed validator (never trusting it verbatim), and derives — from
// its ANALYZABLE entries in deterministic manifest order — the three governed inputs the
// V3 engine needs:
//   1. requirement_manifest: the existing buildAgt002RequirementManifest unit shape
//      ({requirement_id, front, label, sources[], unresolved_sources[]}), with citation-
//      derived resolved sources (document id / version / provenance hash). No raw or open
//      source text (source_text_by_document_id / citation quotes) is ever copied out.
//   2. categoryOverrides: requirement_id -> the manifest entry's governed category, so
//      deriveAgt002IntegralCategoryManifest is fully governed (legal-front proposals carry
//      an explicit closed category; the técnico=>technical mapping is preserved).
//   3. evidenceClassLinkByRequirementId: requirement_id -> the manifest entry's
//      evidence_class_id when non-null; a null evidence class carries no link, so
//      buildAgt002EvidenceStateManifest abstains to AGT002_EVIDENCE_STATE_SAFE_UNKNOWN.
//
// Fail-closed: a malformed source, or one whose opportunity/proceso identity is not the
// exact pilot, throws (via the reused Phase-1 validator). There is never a generic
// fallback.

import {
  validateAgt002ManizalesIntegralManifest,
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from './agt002-manizales-integral-manifest.js';
import { validateAgt002RequirementManifest } from './agt002-deep-analysis-matrix.js';

// The requirement_manifest unit shape only allows front in {legal, financial, technical}.
// The governed category is always supplied as an explicit override, so the front here is
// never consulted by deriveAgt002IntegralCategoryManifest's FRONT_CATEGORY_MAP fallback;
// it is a deterministic, closed projection of the governed category for the unit shape:
//   - habilitating  -> legal      (front 'legal' has no direct category map, so it MUST be
//                                   accompanied by an explicit closed override — which it is)
//   - technical     -> technical  (preserves the deterministic técnico=>technical mapping)
//   - financial_execution -> financial
// Any other category (e.g. an analyzable 'discard') has no deterministic front and fails
// closed rather than being fabricated.
const FRONT_BY_CATEGORY = new Map([
  ['habilitating', 'legal'],
  ['technical', 'technical'],
  ['financial_execution', 'financial'],
]);

const PROVENANCE_HASH_PREFIX = 'provenance-sha256:';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// A resolved source is derived ONLY from a vigente, resolved citation. document_id, version
// and the 64-hex provenance digest are the only citation fields copied — never the quote
// text or char ranges — into the closed {document_id, document_version_id, content_hash}
// source tuple the requirement_manifest validator enforces.
function citationSource(citation) {
  if (typeof citation.hash !== 'string' || !citation.hash.startsWith(PROVENANCE_HASH_PREFIX)) {
    throw new Error(`AGT-002 Manizales wiring: cita sin hash de provenance válido (${citation.document_id}).`);
  }
  const contentHash = citation.hash.slice(PROVENANCE_HASH_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new Error(`AGT-002 Manizales wiring: hash de provenance no es un sha256 hexadecimal de 64 caracteres (${citation.document_id}).`);
  }
  if (!nonEmptyString(citation.document_id) || !nonEmptyString(citation.version)) {
    throw new Error('AGT-002 Manizales wiring: cita sin document_id/version resolubles.');
  }
  return {
    document_id: citation.document_id.trim(),
    document_version_id: citation.version.trim(),
    content_hash: contentHash,
  };
}

/**
 * Validates the checked-in Manizales integral manifest and derives the governed V3 wiring
 * from its analyzable entries, in deterministic manifest order. Fails closed on a malformed
 * source or a non-pilot opportunity/proceso identity — never a generic fallback.
 *
 * @param {object} manizalesManifestSource The parsed checked-in integral manifest artifact.
 * @returns {{
 *   opportunity_id: string,
 *   proceso: string,
 *   analyzableRequirementIds: string[],
 *   requirementManifest: { requirement_manifest_version: string, requirement_manifest: object[] },
 *   categoryOverrides: Record<string, string>,
 *   evidenceClassLinkByRequirementId: Record<string, string>,
 * }}
 */
export function deriveAgt002ManizalesManifestWiring(manizalesManifestSource) {
  // Reuse the Phase-1 fail-closed validator verbatim: it re-derives every provenance hash,
  // re-checks citation resolution against source_text, pins the exact pilot opportunity_id
  // and proceso, and rejects any malformed/foreign artifact before we read a single entry.
  const manifest = validateAgt002ManizalesIntegralManifest(manizalesManifestSource);

  // Defensive: the validator already pins these, but never advance on an artifact whose
  // identity does not match the exact pilot constants.
  if (manifest.opportunity_id !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID
    || manifest.proceso !== AGT002_INTEGRAL_MANIFEST_PROCESO) {
    throw new Error('AGT-002 Manizales wiring: la identidad de oportunidad/proceso no corresponde al piloto exacto.');
  }

  const labelByRequirementId = new Map(
    (Array.isArray(manifest.proposal_ledger) ? manifest.proposal_ledger : [])
      .filter(entry => nonEmptyString(entry?.requirement_id) && nonEmptyString(entry?.label))
      .map(entry => [entry.requirement_id, entry.label.trim()]),
  );

  const analyzableEntries = manifest.entries.filter(entry => entry.analyzable === true);

  const requirementManifestEntries = [];
  const categoryOverrides = {};
  const evidenceClassLinkByRequirementId = {};

  for (const entry of analyzableEntries) {
    const requirementId = entry.requirement_id;
    const front = FRONT_BY_CATEGORY.get(entry.category);
    if (!front) {
      throw new Error(
        `AGT-002 Manizales wiring: la categoría gobernada "${String(entry.category)}" del requisito ${requirementId} `
        + 'no tiene un front determinista para la forma del manifiesto de requisitos (fail-closed).',
      );
    }
    const label = labelByRequirementId.get(requirementId);
    if (!nonEmptyString(label)) {
      throw new Error(`AGT-002 Manizales wiring: el requisito analizable ${requirementId} no tiene etiqueta en el proposal_ledger.`);
    }

    // Deterministic, deduplicated resolved sources from the entry's vigente, resolved
    // citations only, sorted by document_version_id like buildAgt002RequirementManifest.
    const sourcesByKey = new Map();
    for (const citation of entry.citations) {
      if (!(citation.is_vigente && citation.resolved)) continue;
      const source = citationSource(citation);
      sourcesByKey.set(`${source.document_id}::${source.document_version_id}::${source.content_hash}`, source);
    }
    const sources = [...sourcesByKey.values()].sort((left, right) => (
      left.document_version_id.localeCompare(right.document_version_id)
      || left.document_id.localeCompare(right.document_id)
    ));
    if (sources.length === 0) {
      // An analyzable entry is guaranteed by the manifest contract to have >=1 vigente
      // resolved citation; a source-less analyzable entry is a contract breach, not a
      // silently-dropped requirement.
      throw new Error(`AGT-002 Manizales wiring: el requisito analizable ${requirementId} no resolvió ninguna fuente vigente.`);
    }

    requirementManifestEntries.push({
      requirement_id: requirementId,
      front,
      label,
      sources,
      unresolved_sources: [],
    });
    categoryOverrides[requirementId] = entry.category;
    if (entry.evidence_class_id !== null && entry.evidence_class_id !== undefined) {
      evidenceClassLinkByRequirementId[requirementId] = entry.evidence_class_id;
    }
  }

  // Self-validate the derived manifest against the same closed structural contract the
  // persistence layer enforces (no text fields, exact source keys, resolved provenance).
  const requirementManifest = validateAgt002RequirementManifest({
    requirement_manifest_version: '1.0',
    requirement_manifest: requirementManifestEntries,
  });

  return {
    opportunity_id: manifest.opportunity_id,
    proceso: manifest.proceso,
    analyzableRequirementIds: requirementManifestEntries.map(entry => entry.requirement_id),
    requirementManifest,
    categoryOverrides,
    evidenceClassLinkByRequirementId,
  };
}
