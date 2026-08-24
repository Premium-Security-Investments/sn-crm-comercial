// Deterministic literal-excerpt catalog for AGT-002 V4 semantic discovery labels.
//
// Why this exists (AGT-002 V4, repeated `v4_discovery_citation_anchor_invariant`):
// `canonicalizeProposal` in tender-semantic-discovery.js requires every proposed
// `requirements[].label` to be a LITERAL, contiguous excerpt of a source_unit the requirement
// itself cites, and `validateTenderSemanticManifest` re-anchors the same label against the
// snapshot's own documents. Those two gates are the only witnesses that separate a real obligation
// from an invented one, so neither may be relaxed, repaired, retried or fuzzily matched.
//
// The model-facing contract, however, was purely textual ("copy the fragment verbatim"), and a real
// model kept paraphrasing — every such run burned a provider turn and died at the anchor gate. This
// module removes the failure mode BY CONSTRUCTION instead of by persuasion: it derives, from the
// exact redacted text the request already carries, a bounded catalog of literal candidate excerpts,
// which tender-semantic-discovery.js then pins as the closed `enum` of
// `requirements.items.properties.label`. A paraphrase is no longer a schema-valid value at all, and
// the unchanged local gates keep doing exactly what they did before — including rejecting a catalog
// excerpt paired with a source_unit it does not belong to, which the wire schema cannot express.
//
// Every candidate this module emits is, by construction:
//   * a literal contiguous excerpt of the REDACTED visible text the request already sends (so it is
//     privacy-equivalent to content the provider receives regardless — nothing new is disclosed),
//   * AND a literal contiguous excerpt of the snapshot's OWN normalized source text (so it also
//     satisfies the manifest validator's independent re-anchor, and can never straddle a redaction
//     placeholder — such spans are dropped, never repaired),
//   * between TENDER_SEMANTIC_LABEL_MIN_CHARS and TENDER_SEMANTIC_LABEL_MAX_CHARS,
//   * free of control characters and of the ASCII double quote (U+0022) — the latter purely a
//     provider wire-compatibility gate (see hasAsciiDoubleQuote below), not a semantic one — and
//     carrying a derivable obligation key, matching what assembleTenderSemanticManifest already
//     demands of a label,
//   * deterministic and stable: the same snapshot always yields the same catalog, in the same
//     order, with no clock, randomness, locale-sensitive sort or iteration-order dependency.
//
// Nothing here is a requirement detector. It proposes SPANS OF THE EXPEDIENTE'S OWN TEXT, at a few
// fixed granularities, with no keyword list, no topic catalog and no notion of what an obligation
// is. Choosing which span (if any) names an obligation stays the model's job, and validating that
// choice stays the server's.
//
// v3 (AGT-002 V4 citation-anchor remediation, second half): the model no longer sends ANY
// source_unit id for a requirement. `candidates_by_unit_id` is therefore not merely a diagnostic —
// it is the reverse mapping tender-semantic-discovery.js derives every requirement citation from
// (see buildTenderSemanticLabelOwnerIndex below). That promotion changes what it has to mean:
// a unit OWNS a candidate when the unit's own text literally states it, not merely when this
// module happened to GENERATE it from that unit. The two differ whenever a span survives in one
// unit's candidate list and is also present verbatim in another unit's text (window offsets,
// `selectSpread` pruning, per-unit obligation-key dedup). Under generation-only crediting the
// model could not predict which units the server would bind — the very "wasted provider turn"
// class this remediation exists to remove — while containment IS predictable from the packet the
// model already receives, which is exactly what the v3 policy now promises it. Budget accounting
// (`units_dropped_by_budget`) deliberately keeps the narrower generation-based reading: a unit
// that lost every span it could ORIGINATE is a real coverage loss even if some other unit's
// surviving span happens to occur in its text too.

import { tenderSemanticObligationKey, TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS } from './tender-semantic-manifest.js';

// The same label bounds `canonicalizeProposal` and `assembleTenderSemanticManifest` already
// enforce. Declared here so the catalog can never offer a candidate those gates would reject.
export const TENDER_SEMANTIC_LABEL_MIN_CHARS = 3;
export const TENDER_SEMANTIC_LABEL_MAX_CHARS = 160;

// Per-unit bound: how many distinct granularities of the same paragraph may ever reach the schema.
// Bounds the enum against a pathological single-paragraph document.
export const TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT = 12;

// Global bound, expressed as a FLOOR rather than a ceiling on purpose: the effective cap is
// `max(visibleUnitCount, this)`, so the first allocation round (one candidate per visible unit) can
// never be truncated by the count cap. Coverage of the expediente is not something this module is
// allowed to silently trade away for a smaller schema; when a real bound would cost coverage the
// caller fails closed instead (see `units_dropped_by_budget`).
export const TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR = 600;

// Fixed word-window granularities, coarse first. Together with the whole-unit excerpt and the
// clause excerpts these cover obligations/conditions/plazos/entregables/restricciones stated as a
// whole paragraph, as one sentence inside it, or as a phrase inside a sentence.
const LABEL_WINDOW_WORDS = Object.freeze([16, 8]);

// A clause boundary in the already whitespace-collapsed unit text. Splitting on it yields pieces
// that are still contiguous substrings of the unit (the separator whitespace is what is dropped).
const CLAUSE_BOUNDARY = /(?<=[.;:])\s/;

// The placeholders redactText leaves behind. Splitting on them yields the spans that survived
// redaction untouched — the only spans of such a unit that are literal in BOTH the redacted text
// and the snapshot's own text. Without this, a unit carrying a contact detail would contribute no
// candidate at all (every window straddling a placeholder is dropped) and could only ever be
// excluded or left unresolved, which would understate this tender's obligations.
const REDACTION_PLACEHOLDER = /\[REDACTED_[A-Z_]+\]/;

// Punctuation/quotation that may be shaved off the ENDS of a span. Shaving only ever removes
// characters from the extremes, so the result stays a contiguous substring of the source text —
// it never adds a character the source does not have, which is what the policy forbids.
const EDGE_NOISE = /^[\s.,;:!?¡¿"'“”‘’«»()[\]{}·•\-–—_/\\|]+|[\s.,;:!?¡¿"'“”‘’«»()[\]{}·•\-–—_/\\|]+$/g;

const HISTORICAL_FIXED_ID_SET = new Set(TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS);

// The same control-character rejection assembleTenderSemanticManifest applies to a label. Written
// as a code-point scan rather than a regex literal so this source file carries no raw control byte
// of its own.
function hasControlChar(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

// Real canaries proved a JSON Schema string `enum` member carrying an ASCII double quote (U+0022)
// is rejected outright by the Codex/Luna bridge: the same literal value without that one character
// passes, and the full actual catalog (633 entries / 37,818 chars) passes once every U+0022-bearing
// candidate is excluded. This is a provider wire-compatibility gate, not a content judgement — a
// candidate is dropped here exactly as a control-character candidate already is (never stripped,
// never rewritten), so a span whose only viable form contains a quote is correctly left uncataloged.
function hasAsciiDoubleQuote(value) {
  return value.includes('"');
}

// Code-point ordering, deliberately NOT localeCompare: the catalog becomes part of a wire schema
// whose bytes must be identical on every host, and localeCompare is ICU/locale dependent.
function byCodePoint(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Crops one proposed span into a candidate that satisfies every label bound, or returns null.
 * Only ever trims from the ends (edge punctuation, then whole trailing words while too long), so
 * the returned value remains a literal contiguous excerpt of whatever the span came from.
 */
function cropCandidate(span) {
  let value = String(span ?? '').trim().replace(EDGE_NOISE, '');
  while (value.length > TENDER_SEMANTIC_LABEL_MAX_CHARS) {
    const cut = value.lastIndexOf(' ');
    // A single token longer than the label bound cannot be cropped on a word boundary; cutting it
    // mid-word would still be literal but reads as a broken excerpt, so it is dropped instead.
    if (cut <= 0) return null;
    value = value.slice(0, cut).replace(EDGE_NOISE, '');
  }
  if (value.length < TENDER_SEMANTIC_LABEL_MIN_CHARS) return null;
  if (hasControlChar(value)) return null;
  if (hasAsciiDoubleQuote(value)) return null;
  return value;
}

/**
 * The ordered, deduplicated candidate list for ONE source unit, most-general first.
 *
 * @param {string} visibleText The redacted text this unit contributes to the provider request.
 * @param {string} sourceText The snapshot's own (unredacted) normalized text for the same unit.
 */
function unitLabelCandidates(visibleText, sourceText) {
  const ordered = [];
  const seenCandidates = new Set();
  const seenObligationKeys = new Set();

  const push = span => {
    const candidate = cropCandidate(span);
    if (!candidate || seenCandidates.has(candidate)) return;
    // Exact-by-construction, checked rather than assumed: the candidate must literally occur in
    // BOTH the text the model receives and the text both validators re-anchor against. A span that
    // touches a redaction placeholder fails the second check and is dropped — never rewritten.
    if (!visibleText.includes(candidate) || !sourceText.includes(candidate)) return;
    const obligationKey = tenderSemanticObligationKey(candidate);
    // A candidate the assembler would reject anyway (no derivable obligation key, a historical
    // fixed id, or a same-obligation duplicate of one already offered for this unit) is never
    // emitted: the schema must not trap the model into a guaranteed local rejection.
    if (!obligationKey || seenObligationKeys.has(obligationKey)) return;
    if (HISTORICAL_FIXED_ID_SET.has(candidate) || HISTORICAL_FIXED_ID_SET.has(obligationKey)) return;
    seenCandidates.add(candidate);
    seenObligationKeys.add(obligationKey);
    ordered.push(candidate);
  };

  push(visibleText);
  for (const clause of visibleText.split(CLAUSE_BOUNDARY)) push(clause);
  for (const survivingSpan of visibleText.split(REDACTION_PLACEHOLDER)) push(survivingSpan);
  const words = visibleText.split(' ');
  for (const size of LABEL_WINDOW_WORDS) {
    const stride = Math.max(1, Math.floor(size / 2));
    for (let start = 0; start < words.length; start += stride) {
      push(words.slice(start, start + size).join(' '));
    }
  }
  return ordered;
}

/**
 * Keeps `limit` evenly spaced entries of an already priority-ordered list, always including the
 * first and the last. Truncating the tail instead would drop every fine-grained window of a long
 * paragraph; spreading keeps one candidate of each granularity.
 */
function selectSpread(values, limit) {
  if (values.length <= limit) return values;
  if (limit <= 1) return values.slice(0, Math.max(0, limit));
  const picked = [];
  const seenIndexes = new Set();
  for (let slot = 0; slot < limit; slot += 1) {
    const index = Math.round((slot * (values.length - 1)) / (limit - 1));
    if (seenIndexes.has(index)) continue;
    seenIndexes.add(index);
    picked.push(values[index]);
  }
  return picked;
}

/**
 * Builds the deterministic, bounded literal-excerpt catalog for one discovery request.
 *
 * Allocation is ROUND-MAJOR across units (every unit contributes its first candidate before any
 * unit contributes its second), so a global bound degrades granularity, never coverage. The first
 * round is provably within both bounds — each unit's first candidate is no longer than that unit's
 * own text, and the count cap is floored at the unit count — so a healthy expediente never loses a
 * unit here. If it ever did (an operator-lowered `maxCatalogChars`), the affected units are
 * reported in `units_dropped_by_budget` and the caller fails closed rather than shipping a schema
 * that silently makes part of the expediente unlabelable.
 *
 * @param {object} args
 * @param {Array} args.units Visible source units: {source_unit_id, text (redacted), source_text}.
 * @param {number} args.maxCatalogChars Total character budget for the emitted catalog.
 * @returns {{candidates: string[], candidates_by_unit_id: Map<string, string[]>,
 *   units_without_eligible_candidates: string[], units_dropped_by_budget: string[],
 *   total_chars: number}}
 */
export function buildTenderSemanticLabelCatalog({ units = [], maxCatalogChars } = {}) {
  if (!Array.isArray(units)) throw new Error('El catálogo de etiquetas literales requiere la lista de unidades visibles.');
  if (!Number.isInteger(maxCatalogChars) || maxCatalogChars <= 0) {
    throw new Error('El catálogo de etiquetas literales requiere un presupuesto de caracteres entero positivo.');
  }

  const perUnit = units.map(unit => {
    const visibleText = String(unit?.text ?? '');
    const sourceText = String(unit?.source_text ?? '');
    return {
      source_unit_id: String(unit?.source_unit_id ?? ''),
      visible_text: visibleText,
      source_text: sourceText,
      available: selectSpread(unitLabelCandidates(visibleText, sourceText), TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT),
    };
  });

  const totalCap = Math.max(perUnit.length, TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR);
  const chosen = [];
  const chosenSet = new Set();
  let totalChars = 0;
  for (let round = 0; round < TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT; round += 1) {
    for (const entry of perUnit) {
      const candidate = entry.available[round];
      // An exact duplicate of a candidate another unit already contributed is not re-added: it is
      // the SAME literal string, so it still anchors in this unit too (identical paragraphs are the
      // only way this happens) and `candidates_by_unit_id` below still credits it to both.
      if (candidate === undefined || chosenSet.has(candidate)) continue;
      if (chosen.length >= totalCap || totalChars + candidate.length > maxCatalogChars) continue;
      chosenSet.add(candidate);
      chosen.push(candidate);
      totalChars += candidate.length;
    }
  }

  const candidatesByUnitId = new Map();
  const unitsWithoutEligibleCandidates = [];
  const unitsDroppedByBudget = [];
  for (const entry of perUnit) {
    // What this unit can ORIGINATE and that survived the bounds. This — never the containment
    // credit below — is what the budget accounting reads, so a unit whose own spans were all
    // dropped is still reported as a coverage loss the caller must fail closed on.
    const own = entry.available.filter(candidate => chosenSet.has(candidate));
    const ownSet = new Set(own);
    // Ownership is containment, checked against BOTH texts exactly as `push` already checks a
    // generated span: the fragment must be literal in the redacted text the model receives (so the
    // model can see for itself that this unit is bound) AND in the snapshot's own text (so
    // validateTenderSemanticManifest's independent re-anchor holds for the citation derived from
    // it). Own candidates come first, most-general first, so the unit's own most representative
    // excerpt stays the head of its list; foreign contained candidates follow in catalog
    // allocation order. Both segments are deterministic — no clock, no locale, no set iteration.
    const foreign = chosen.filter(candidate => !ownSet.has(candidate)
      && entry.visible_text.includes(candidate)
      && entry.source_text.includes(candidate));
    candidatesByUnitId.set(entry.source_unit_id, [...own, ...foreign]);
    if (!entry.available.length) {
      // This unit cannot yield ANY 3..160-char literal excerpt with a derivable obligation key —
      // it could never have carried a label under the unchanged gates either, so this is not a
      // regression. It stays dispositionable as excluded/unresolved by the existing contract.
      unitsWithoutEligibleCandidates.push(entry.source_unit_id);
    } else if (!own.length) {
      unitsDroppedByBudget.push(entry.source_unit_id);
    }
  }

  return {
    candidates: [...chosen].sort(byCodePoint),
    candidates_by_unit_id: candidatesByUnitId,
    units_without_eligible_candidates: unitsWithoutEligibleCandidates,
    units_dropped_by_budget: unitsDroppedByBudget,
    total_chars: totalChars,
  };
}

/**
 * The reverse of `candidates_by_unit_id`: for each catalog candidate, EVERY visible source unit
 * that owns it.
 *
 * This is the whole point of the v3 discovery wire contract. The model returns a `label` and
 * nothing else about provenance; tender-semantic-discovery.js looks the label up here and derives
 * the requirement's `front_evidence` and `citations` from the answer. No source id ever travels
 * from the model, so there is no model-provided id left to disagree with the label — the relation
 * the wire JSON Schema provably could not express (a `label` enum member belonging to the units a
 * separate `source_unit_ids` array names) stops being a relation the model can get wrong.
 *
 * Order is fixed twice over, because it decides both the citation list and which owner becomes the
 * requirement's front evidence:
 *   * across units, `orderedUnitIds` as given — the discovery source packet's own deterministic
 *     order (document_id, then document_version_id, then paragraph index, then source_unit_id, all
 *     compared as strings/numbers, never by locale);
 *   * within a unit, that unit's `candidates_by_unit_id` order, which is itself deterministic.
 * The FIRST owner of a candidate is therefore stable for a given snapshot, and re-running the same
 * snapshot re-derives the identical mapping.
 *
 * A candidate absent from every unit's list simply has no entry: the caller must treat that as a
 * fail-closed rejection, never as "no citations needed". Nothing here invents an owner.
 *
 * @param {object} args
 * @param {string[]} args.orderedUnitIds Visible source unit ids, in source-packet order.
 * @param {Map<string, string[]>} args.candidatesByUnitId `candidates_by_unit_id` from the catalog.
 * @returns {Map<string, string[]>} candidate -> owning source_unit_ids (frozen, deduplicated).
 */
export function buildTenderSemanticLabelOwnerIndex({ orderedUnitIds = [], candidatesByUnitId } = {}) {
  if (!Array.isArray(orderedUnitIds)) {
    throw new Error('El índice de propietarios de etiquetas requiere la lista ordenada de unidades visibles.');
  }
  if (!(candidatesByUnitId instanceof Map)) {
    throw new Error('El índice de propietarios de etiquetas requiere el mapa de candidatos por unidad del catálogo.');
  }
  const owners = new Map();
  for (const sourceUnitId of orderedUnitIds) {
    for (const candidate of candidatesByUnitId.get(sourceUnitId) ?? []) {
      if (!owners.has(candidate)) owners.set(candidate, []);
      const ownerIds = owners.get(candidate);
      if (!ownerIds.includes(sourceUnitId)) ownerIds.push(sourceUnitId);
    }
  }
  for (const ownerIds of owners.values()) Object.freeze(ownerIds);
  return owners;
}
