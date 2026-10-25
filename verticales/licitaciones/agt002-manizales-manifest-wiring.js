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
import { validateAgt002ManifestScope } from './agt002-tender-adapter.js';

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

const MANIFEST_DISPOSITIONS = ['analyzed_candidate', 'excluded_with_reason', 'unresolved_visible'];

// Tally the closed disposition vocabulary across one ledger, failing closed on any entry whose
// disposition is outside the vocabulary rather than silently dropping it.
function tallyLedgerDispositions(ledger) {
  const tally = { analyzed_candidate: 0, excluded_with_reason: 0, unresolved_visible: 0 };
  for (const item of Array.isArray(ledger) ? ledger : []) {
    if (!MANIFEST_DISPOSITIONS.includes(item?.disposition)) {
      throw new Error(`AGT-002 Manizales alcance: disposición fuera de vocabulario en el libro (${String(item?.disposition)}).`);
    }
    tally[item.disposition] += 1;
  }
  return tally;
}

// Derives the governed manifest_scope from an ALREADY-VALIDATED manifest (coverage,
// section_ledger, proposal_ledger, entries). Pure, deterministic, no I/O. The derived scope is
// finally run through the same closed validator the adapter/persistence enforce, so a derived and
// an envelope-carried scope pass the identical structural + arithmetic gate. Also cross-checks the
// derived counts against the manifest's own coverage block and fails closed on any drift.
function deriveScopeFromValidatedManifest(manifest) {
  const coverage = manifest.coverage;
  const sectionLedger = manifest.section_ledger;
  const proposalLedger = manifest.proposal_ledger;
  const entries = manifest.entries;

  const analyzableRequirementIds = entries.filter(entry => entry.analyzable === true).map(entry => entry.requirement_id);
  const sectionTally = tallyLedgerDispositions(sectionLedger);
  const proposalTally = tallyLedgerDispositions(proposalLedger);

  const scope = {
    registry_sections: coverage.registry_sections,
    pre_go_relevant: sectionLedger.length,
    proposal_sections: coverage.proposal_sections,
    analyzable_requirement_ids: analyzableRequirementIds,
    atomized_entry_count: entries.length,
    dispositions: {
      analyzed_candidate: sectionTally.analyzed_candidate + proposalTally.analyzed_candidate,
      excluded_with_reason: sectionTally.excluded_with_reason + proposalTally.excluded_with_reason,
      unresolved_visible: sectionTally.unresolved_visible + proposalTally.unresolved_visible,
    },
    section_ledger_accounted: sectionLedger.length,
    proposal_ledger_accounted: proposalLedger.length,
  };

  // Cross-check against the manifest's own coverage accounting: the scope must never disagree
  // with the closed figures the Phase-1 validator already proved (68/20/10, 15/20, 25/20).
  if (scope.atomized_entry_count !== coverage.entries.total
    || analyzableRequirementIds.length !== coverage.entries.analyzable
    || scope.section_ledger_accounted !== coverage.section_ledger.total
    || scope.proposal_ledger_accounted !== coverage.proposal_ledger.total) {
    throw new Error('AGT-002 Manizales alcance: los conteos derivados no concuerdan con la cobertura validada del manifiesto.');
  }

  // Final closed gate: identical to the adapter/persistence validator, so a server-derived and
  // an envelope-carried scope are structurally indistinguishable to every downstream consumer.
  return Object.freeze(validateAgt002ManifestScope(scope));
}

/**
 * Validates the checked-in Manizales integral manifest and derives the governed, top-level
 * `manifest_scope` from its coverage, ledgers and entries, in deterministic order. Fails closed
 * on a malformed source or a non-pilot opportunity/proceso identity — never a generic fallback.
 *
 * @param {object} manizalesManifestSource The parsed checked-in integral manifest artifact.
 * @returns {object} The frozen, closed manifest_scope.
 */
export function deriveAgt002ManizalesManifestScope(manizalesManifestSource) {
  const manifest = validateAgt002ManizalesIntegralManifest(manizalesManifestSource);
  if (manifest.opportunity_id !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID
    || manifest.proceso !== AGT002_INTEGRAL_MANIFEST_PROCESO) {
    throw new Error('AGT-002 Manizales alcance: la identidad de oportunidad/proceso no corresponde al piloto exacto.');
  }
  return deriveScopeFromValidatedManifest(manifest);
}

// Governed, human-readable labels for the manifest's status=unresolved_visible entries — the
// material omissions the engine never fed to the model (analyzable:false). Sourced verbatim from
// the same governed labels the extraction/pre-GO layers already use for these requirement ids
// (tender-requirement-extraction.js) plus the registry's own §1.8 section title for the lifecycle
// gate. Never invented, never a conclusion or compliance claim — a neutral identity label only.
const UNRESOLVED_MANIFEST_ENTRY_LABEL_BY_REQUIREMENT_ID = new Map([
  ['financial-working-capital', 'Capital de trabajo'],
  ['legal-rce-policy', 'Póliza de responsabilidad civil extracontractual (RCE)'],
  ['legal-collective-life-policy', 'Póliza de seguro de vida colectivo'],
  ['technical-video-surveillance-scope', 'Alcance de videovigilancia/CCTV'],
  ['lifecycle:cierre-prorroga', 'Cronograma: cierre y prórroga del proceso (§1.8)'],
]);

/**
 * Validates the checked-in Manizales integral manifest and derives the closed, minimal
 * presentation shape of its status=unresolved_visible entries (material omissions the engine
 * never fed to the model), in deterministic manifest order: requirement_id, a governed human
 * label, nullable category, origin, status and human_review_required. Never copies raw citation
 * text/quotes. Fails closed on a malformed source, a non-pilot identity, or an entry without a
 * pinned governed label — never a generic fallback or a fabricated label.
 *
 * @param {object} manizalesManifestSource The parsed checked-in integral manifest artifact.
 * @returns {ReadonlyArray<{
 *   requirement_id: string, label: string, category: string | null, origin: string,
 *   status: 'unresolved_visible', human_review_required: true,
 * }>}
 */
export function deriveAgt002ManizalesUnresolvedManifestEntries(manizalesManifestSource) {
  const manifest = validateAgt002ManizalesIntegralManifest(manizalesManifestSource);
  if (manifest.opportunity_id !== AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID
    || manifest.proceso !== AGT002_INTEGRAL_MANIFEST_PROCESO) {
    throw new Error('AGT-002 Manizales pendientes: la identidad de oportunidad/proceso no corresponde al piloto exacto.');
  }

  const entries = manifest.entries
    .filter(entry => entry.status === 'unresolved_visible')
    .map(entry => {
      const label = UNRESOLVED_MANIFEST_ENTRY_LABEL_BY_REQUIREMENT_ID.get(entry.requirement_id);
      if (!nonEmptyString(label)) {
        throw new Error(`AGT-002 Manizales pendientes: el requisito ${entry.requirement_id} no tiene una etiqueta humana gobernada.`);
      }
      if (entry.human_review_required !== true) {
        throw new Error(`AGT-002 Manizales pendientes: el requisito ${entry.requirement_id} no exige revisión humana (fail-closed).`);
      }
      return Object.freeze({
        requirement_id: entry.requirement_id,
        label,
        category: entry.category ?? null,
        origin: entry.origin,
        status: entry.status,
        human_review_required: true,
      });
    });

  return Object.freeze(entries);
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
    // The governed, server-owned top-level scope this run must carry beside integral_analysis.
    manifestScope: deriveScopeFromValidatedManifest(manifest),
  };
}
