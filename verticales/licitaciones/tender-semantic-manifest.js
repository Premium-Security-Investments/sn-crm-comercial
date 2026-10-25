// Tender-native semantic manifest (AGT-002 / AGT-002-002).
//
// `tender-requirement-inventory.js` segments a snapshot into normalized paragraphs and disposes
// every one of them. That is an expediente ledger, not semantic analysis: a paragraph is not a
// requirement. Until this module existed, the only thing that reached the runtime frontier
// (document_evidence.requirement_manifest + the retrieval requirements + the model input) was the
// fixed historical four (legal-rce-policy, legal-collective-life-policy, financial-working-capital,
// technical-video-surveillance-scope) resolved from `deepAnalysis.matrix`. Four historical ids are
// not this tender's obligations.
//
// This module owns the tender's OWN obligations, and only those:
//
//   * A semantic requirement is an obligation / condition / evaluation criterion / deadline /
//     deliverable (TENDER_SEMANTIC_KINDS) that carries at least one exact citation
//     ({source_unit_id, unit_hash}) into an ANALYZABLE source unit of THIS snapshot's inventory,
//     plus a `front_evidence` citation for the front it was filed under. Nothing is invented:
//     identity, citations and hashes are derived here, by the server, never copied from untrusted
//     text or from a model response.
//
//   * A MODEL PROPOSAL carries one thing the server cannot re-derive: the label. Ids, hashes and
//     allowlists are all recomputed here over whatever text the model wrote, so a fully
//     self-consistent manifest proves nothing about the obligation it names — `Capital de trabajo`
//     over a clause that says `Nivel de apalancamiento` hashes just as cleanly. The only witness is
//     the expediente's own text, so a proposal is only ever assembled/validated against the
//     snapshot's INDEPENDENT source documents (`documents`), and every proposed label must appear
//     literally in a source unit the requirement itself cites. A boundary that cannot hand that
//     text over fails closed instead of persisting an invented obligation.
//
//   * There are two ways to obtain the requirement set, and both end in the SAME server-owned
//     assembler + validator:
//       1. `buildTenderSemanticManifest` — a deterministic, provider-free structural derivation.
//          It reads explicit clause grammar (a deontic marker) and an explicit inline subject
//          declaration (`<Term>:`) under an explicit front heading. It is a floor and a fixture
//          path, NOT a universal analyzer: a tender that states its obligations in tables, prose
//          or annexes derives nothing here and fails closed rather than pretending.
//       2. `assembleTenderSemanticManifest` — used by `tender-semantic-discovery.js` to
//          canonicalize a governed MODEL proposal over the same bounded source units. The model
//          proposes labels/fronts/citations; the server owns ids, hashes, allowlists and the final
//          validation.
//     There is no universal requirement keyword catalog anywhere in either path. The only closed
//     vocabularies are the front taxonomy the requirement_manifest schema already fixes, the
//     obligation kinds, and the disposition reasons.
//
//   * Discovery completeness and analyzed coverage are different facts. A manifest is NEVER
//     decision-ready just because obligations were found: `decision_ready` is false and
//     `recommendation` is 'pause' on every manifest this module BUILDS. Readiness is only ever
//     computed from real V3 output that dispositioned every requirement AND every source unit —
//     by `resolveTenderSemanticFrontier` (as a separate frontier summary) or by
//     `resolveTenderSemanticDecisionFrontier` (folded back into the manifest itself, so the
//     durable run carries what was analysed). Even then a human decides; nothing here
//     authorizes a GO.
//
//   * The historical four can only ever be SUPPLEMENTAL SIGNALS. They are never the frontier,
//     never the count, never the coverage.

import { createHash } from 'node:crypto';
import {
  validateTenderRequirementInventory,
  resolveTenderInventorySourceTexts,
} from './tender-requirement-inventory.js';
import { validateAgt002RequirementManifest } from './agt002-deep-analysis-matrix.js';

export const TENDER_SEMANTIC_MANIFEST_VERSION = 'tender_semantic_manifest.v1';

// The SAME closed 3-front taxonomy the requirement_manifest unit shape already fixes
// (agt002-deep-analysis-matrix.js). This is a front taxonomy, not a requirement catalog: it says
// where an obligation is filed, never what obligations exist. A proposed front outside it is
// rejected fail-closed — it is never coerced into one of the three.
export const TENDER_SEMANTIC_FRONTS = Object.freeze(['legal', 'financial', 'technical']);

// What a semantic requirement may BE. A source paragraph is not automatically a requirement; it
// only becomes one when it represents one of these and carries its own citations.
export const TENDER_SEMANTIC_KINDS = Object.freeze([
  'obligation',
  'condition',
  'evaluation_criterion',
  'deadline',
  'deliverable',
  'restriction',
]);

// Why an analyzable source unit carries no requirement of its own. Closed: an exclusion is an
// explicit, auditable statement, never a silent drop.
export const TENDER_SEMANTIC_EXCLUSION_REASONS = Object.freeze([
  'descriptive_or_contextual',
  'structural_or_navigational',
  'duplicate_source_unit',
  'not_an_obligation',
]);

// Reasons THIS stage may emit for a unit it could not resolve. An expediente-level gap keeps the
// inventory's own reason verbatim instead (origin 'inventory'), so a download failure is never
// relabelled as a semantic failure.
export const TENDER_SEMANTIC_UNRESOLVED_REASONS = Object.freeze([
  'subject_not_derivable',
  'front_not_derivable',
  'front_not_supported',
  'obligation_not_classifiable',
  'source_unit_not_dispositioned',
]);

export const TENDER_SEMANTIC_ORIGINS = Object.freeze(['structural_derivation', 'model_proposal']);

// Present ONLY so this module can prove they never enter a frontier. Never used to detect,
// classify or name a requirement.
export const TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS = Object.freeze([
  'financial-working-capital',
  'legal-collective-life-policy',
  'legal-rce-policy',
  'technical-video-surveillance-scope',
]);
const HISTORICAL_FIXED_ID_SET = new Set(TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS);

const MANIFEST_KEYS = Object.freeze([
  'semantic_manifest_version', 'snapshot_id', 'snapshot_hash', 'inventory_hash', 'origin',
  'proposal_hash', 'requirements', 'excluded', 'unresolved', 'coverage_ledger',
  'discovery_coverage', 'analyzed_coverage', 'decision_ready', 'recommendation',
  'human_review_required', 'semantic_manifest_hash',
]);
const REQUIREMENT_KEYS = Object.freeze([
  'requirement_id', 'obligation_key', 'kind', 'label', 'front', 'front_evidence', 'citations',
  'supplemental_signal_ids',
]);
const CITATION_KEYS = Object.freeze(['source_unit_id', 'unit_hash']);
const EXCLUDED_KEYS = Object.freeze(['source_unit_id', 'unit_hash', 'reason']);
const UNRESOLVED_KEYS = Object.freeze(['source_unit_id', 'unit_hash', 'origin', 'reason']);
const LEDGER_KEYS = Object.freeze([
  'total_source_units', 'cited_count', 'excluded_count', 'unresolved_count', 'every_source_unit_disposed',
]);
const COVERAGE_KEYS = Object.freeze([
  'status', 'total_source_units', 'dispositioned_source_units', 'requirement_count',
]);
const COVERAGE_STATUSES = new Set(['complete', 'partial', 'incomplete']);
const UNRESOLVED_ORIGINS = new Set(['semantic', 'inventory']);
// The only two readiness states a manifest may ever declare. 'ready_for_human_review' is not an
// authorization: `human_review_required` stays true in both, and no manifest ever says 'go'.
const TENDER_SEMANTIC_RECOMMENDATIONS = new Set(['pause', 'ready_for_human_review']);

const MAX_LABEL_CHARS = 160;
const MIN_LABEL_CHARS = 3;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const COMBINING_MARKS = /[̀-ͯ]/g;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  if (!isRecord(value) || Object.keys(value).length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} tiene claves inválidas en el manifiesto semántico.`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

// The SAME normalization the inventory applies when it segments a document into source units
// (tender-requirement-inventory.js), so "literally present in the source" is compared over exactly
// the text the inventory hashed — never a looser, meaning-changing normalization.
function normalizedSourceText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim().normalize('NFC');
}

export function stripTenderSemanticAccents(value) {
  return String(value ?? '').normalize('NFD').replace(COMBINING_MARKS, '');
}

function folded(value) {
  return stripTenderSemanticAccents(value).toLowerCase();
}

/** Deterministic, opaque-but-readable key for an obligation's own declared subject. */
export function tenderSemanticObligationKey(label) {
  return folded(label).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Retrieval terms are derived from the obligation's OWN source-declared subject, so the clause is
 * actually findable in its own tender. Same normalization the AGT-002 retrieval layer already
 * applies to a requirement label.
 */
export function tenderSemanticRetrievalTerms(label) {
  // Alphabetic fragments shorter than three characters remain noise (articles and unit symbols),
  // but two-or-more digit values are valid source anchors for requirements expressed only as a
  // numeric range, for example "°C a 35 °C (50 °F a 95 °F".
  const normalized = folded(label).replace(/\s+/g, ' ').trim();
  const tokens = [...new Set(normalized.match(/[\p{L}\p{N}]{3,}|\p{N}{2,}/gu) ?? [])];
  // A label accepted by the semantic-manifest contract is source-anchored and non-empty, but it
  // can legitimately consist only of symbols, units, roman numerals or one-character words. The
  // old empty list made that valid checkpoint impossible to project into retrieval and failed the
  // run later as v4_discovered_input_assembly_failed. Preserve the complete normalized source
  // phrase as the single honest fallback; never invent a keyword or fall back to the historical
  // requirement catalog.
  return tokens.length > 0 ? tokens : (normalized ? [normalized] : []);
}

// ---------------------------------------------------------------------------------------------
// Assembly (shared by the structural path and the governed model-proposal path)
// ---------------------------------------------------------------------------------------------

function canonicalCitation(citation, unitsById, label) {
  exactKeys(citation, CITATION_KEYS, label);
  const unit = unitsById.get(citation.source_unit_id);
  if (!unit || unit.disposition !== 'analyzable') {
    throw new Error(`${label}: la cita ${String(citation.source_unit_id)} no corresponde a una unidad analizable de este snapshot.`);
  }
  if (!isSha256(citation.unit_hash) || citation.unit_hash !== unit.unit_hash) {
    throw new Error(`${label}: el hash de la cita ${unit.source_unit_id} no coincide con la unidad del inventario.`);
  }
  return { source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash };
}

function requirementIdFor({ snapshotId, inventoryHash, front, obligationKey, kind, frontEvidence, citations }) {
  const digest = sha256([
    TENDER_SEMANTIC_MANIFEST_VERSION,
    snapshotId,
    inventoryHash,
    front,
    obligationKey,
    kind,
    frontEvidence.source_unit_id,
    frontEvidence.unit_hash,
    stableJson(citations),
  ].join('\x00'));
  return `sreq:${digest.slice(0, 32)}`;
}

function manifestHash(value) {
  const { semantic_manifest_hash: _hash, ...withoutHash } = value;
  return sha256(stableJson(withoutHash));
}

/**
 * The single server-owned assembler. Both the deterministic structural derivation and the
 * canonicalized model proposal end here, so identity, hashes, coverage arithmetic and the final
 * fail-closed validation are computed exactly once, in one place, from the inventory — never from
 * whatever proposed the requirement.
 *
 * A MODEL PROPOSAL additionally requires the snapshot's own `documents`: this is the only place a
 * proposal enters the system, and a proposed label that the expediente's own text does not state is
 * an invented obligation no recomputed hash can detect. Assembling one without that independent
 * text is refused outright rather than producing a manifest nobody can anchor afterwards.
 *
 * @param {object} args
 * @param {object} args.inventory The snapshot's tender requirement inventory.
 * @param {Array|null} args.documents The snapshot's own documents, used as the INDEPENDENT source
 *   text a model-proposed label is anchored against. Required for `model_proposal`.
 * @param {'structural_derivation'|'model_proposal'} args.origin How the requirement set was obtained.
 * @param {string|null} args.proposalHash sha256 of the canonicalized proposal, or null.
 * @param {Array} args.requirements Proposed requirements: {kind, label, front, front_evidence, citations}.
 * @param {Array} args.excluded Analyzable units explicitly carrying no requirement: {source_unit_id, reason}.
 * @param {Array} args.unresolved Analyzable units this stage could not resolve: {source_unit_id, reason}.
 */
export function assembleTenderSemanticManifest({
  inventory, documents = null, origin, proposalHash = null, requirements = [], excluded = [], unresolved = [],
}) {
  const validatedInventory = validateTenderRequirementInventory(inventory);
  if (!TENDER_SEMANTIC_ORIGINS.includes(origin)) {
    throw new Error(`Origen de manifiesto semántico inválido: ${String(origin)}.`);
  }
  if (proposalHash !== null && !isSha256(proposalHash)) {
    throw new Error('El hash de la propuesta del manifiesto semántico debe ser sha256 o nulo.');
  }
  // Fail closed at the only door a model proposal can come through: no independent source text,
  // no proposal. Nothing further is assembled, so an unanchorable proposal never exists at all.
  if (origin === 'model_proposal' && !Array.isArray(documents)) {
    throw new Error('Una propuesta de modelo sólo puede ensamblarse contra los documentos fuente del propio expediente: falta el texto independiente que ancla cada etiqueta.');
  }

  const unitsById = new Map(validatedInventory.source_units.map(unit => [unit.source_unit_id, unit]));
  const dispositioned = new Set();

  const assembledRequirements = [];
  const seenObligationKeys = new Set();
  for (const [index, proposed] of requirements.entries()) {
    const label = `requirements[${index}]`;
    if (!isRecord(proposed)) throw new Error(`${label} debe ser un objeto en el manifiesto semántico.`);
    if (!TENDER_SEMANTIC_FRONTS.includes(proposed.front)) {
      throw new Error(`${label}: el front "${String(proposed.front)}" no pertenece a la taxonomía cerrada del manifiesto de requisitos.`);
    }
    if (!TENDER_SEMANTIC_KINDS.includes(proposed.kind)) {
      throw new Error(`${label}: el tipo de requisito "${String(proposed.kind)}" no pertenece al vocabulario cerrado.`);
    }
    const rawLabel = typeof proposed.label === 'string' ? proposed.label.trim().normalize('NFC') : '';
    if (rawLabel.length < MIN_LABEL_CHARS || rawLabel.length > MAX_LABEL_CHARS || CONTROL_CHARS.test(rawLabel)) {
      throw new Error(`${label}: la etiqueta del requisito es vacía o no es una etiqueta válida.`);
    }
    const obligationKey = tenderSemanticObligationKey(rawLabel);
    if (!obligationKey) throw new Error(`${label}: la etiqueta no produce una clave de obligación derivable.`);
    if (HISTORICAL_FIXED_ID_SET.has(rawLabel) || HISTORICAL_FIXED_ID_SET.has(obligationKey)) {
      throw new Error(`${label}: un identificador histórico fijo nunca es una obligación propia de este proceso.`);
    }
    if (seenObligationKeys.has(obligationKey)) {
      throw new Error(`${label}: obligación duplicada en el manifiesto semántico (${obligationKey}).`);
    }
    seenObligationKeys.add(obligationKey);

    const frontEvidence = canonicalCitation(proposed.front_evidence, unitsById, `${label}.front_evidence`);
    if (!Array.isArray(proposed.citations) || proposed.citations.length === 0) {
      throw new Error(`${label}: un requisito semántico sin procedencia es imposible; requiere al menos una cita.`);
    }
    const citedIds = new Set();
    const citations = proposed.citations.map((citation, citationIndex) => {
      const canonical = canonicalCitation(citation, unitsById, `${label}.citations[${citationIndex}]`);
      if (citedIds.has(canonical.source_unit_id)) {
        throw new Error(`${label}: cita duplicada para la unidad ${canonical.source_unit_id}.`);
      }
      citedIds.add(canonical.source_unit_id);
      return canonical;
    }).sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id));

    dispositioned.add(frontEvidence.source_unit_id);
    for (const citation of citations) dispositioned.add(citation.source_unit_id);

    assembledRequirements.push({
      requirement_id: requirementIdFor({
        snapshotId: validatedInventory.snapshot_id,
        inventoryHash: validatedInventory.inventory_hash,
        front: proposed.front,
        obligationKey,
        kind: proposed.kind,
        frontEvidence,
        citations,
      }),
      obligation_key: obligationKey,
      kind: proposed.kind,
      label: rawLabel,
      front: proposed.front,
      front_evidence: frontEvidence,
      citations,
      // A source-derived obligation needs no historical signal to exist. This stays empty here and
      // may only ever be populated by a governed correlation step, never to justify a requirement.
      supplemental_signal_ids: [],
    });
  }
  assembledRequirements.sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));

  const assembledExcluded = [];
  for (const [index, entry] of excluded.entries()) {
    const label = `excluded[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} debe ser un objeto en el manifiesto semántico.`);
    const unit = unitsById.get(entry.source_unit_id);
    if (!unit || unit.disposition !== 'analyzable') {
      throw new Error(`${label}: ${String(entry.source_unit_id)} no es una unidad analizable de este snapshot.`);
    }
    if (!TENDER_SEMANTIC_EXCLUSION_REASONS.includes(entry.reason)) {
      throw new Error(`${label}: razón de exclusión fuera del vocabulario cerrado (${String(entry.reason)}).`);
    }
    if (dispositioned.has(unit.source_unit_id)) {
      throw new Error(`${label}: la unidad ${unit.source_unit_id} ya está dispuesta; no puede excluirse y citarse a la vez.`);
    }
    dispositioned.add(unit.source_unit_id);
    assembledExcluded.push({ source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash, reason: entry.reason });
  }
  assembledExcluded.sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id));

  const assembledUnresolved = [];
  for (const [index, entry] of unresolved.entries()) {
    const label = `unresolved[${index}]`;
    if (!isRecord(entry)) throw new Error(`${label} debe ser un objeto en el manifiesto semántico.`);
    const unit = unitsById.get(entry.source_unit_id);
    if (!unit || unit.disposition !== 'analyzable') {
      throw new Error(`${label}: ${String(entry.source_unit_id)} no es una unidad analizable de este snapshot.`);
    }
    if (!TENDER_SEMANTIC_UNRESOLVED_REASONS.includes(entry.reason)) {
      throw new Error(`${label}: razón sin resolver fuera del vocabulario cerrado (${String(entry.reason)}).`);
    }
    if (dispositioned.has(unit.source_unit_id)) {
      throw new Error(`${label}: la unidad ${unit.source_unit_id} ya está dispuesta.`);
    }
    dispositioned.add(unit.source_unit_id);
    assembledUnresolved.push({
      source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash, origin: 'semantic', reason: entry.reason,
    });
  }

  // An expediente-level gap (download failure, unverifiable hash, unextractable document) stays
  // visible with the inventory's own reason. It is never re-labelled as a semantic failure and
  // never silently dropped: it is exactly why the run cannot be complete.
  for (const unit of validatedInventory.source_units) {
    if (unit.disposition === 'analyzable') continue;
    assembledUnresolved.push({
      source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash, origin: 'inventory', reason: unit.reason,
    });
    dispositioned.add(unit.source_unit_id);
  }

  // Every analyzable unit must carry an explicit disposition. An undispositioned unit is a hole in
  // the analysis, so it becomes visibly unresolved rather than quietly absent.
  for (const unit of validatedInventory.source_units) {
    if (unit.disposition !== 'analyzable' || dispositioned.has(unit.source_unit_id)) continue;
    assembledUnresolved.push({
      source_unit_id: unit.source_unit_id,
      unit_hash: unit.unit_hash,
      origin: 'semantic',
      reason: 'source_unit_not_dispositioned',
    });
    dispositioned.add(unit.source_unit_id);
  }
  assembledUnresolved.sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id));

  const total = validatedInventory.source_units.length;
  const citedCount = new Set(assembledRequirements.flatMap(requirement => [
    requirement.front_evidence.source_unit_id,
    ...requirement.citations.map(citation => citation.source_unit_id),
  ])).size;
  const dispositionedCount = dispositioned.size;
  const discoveryStatus = total === 0 || dispositionedCount !== total
    ? 'incomplete'
    : assembledUnresolved.length > 0 ? 'partial' : 'complete';

  const manifest = {
    semantic_manifest_version: TENDER_SEMANTIC_MANIFEST_VERSION,
    snapshot_id: validatedInventory.snapshot_id,
    snapshot_hash: validatedInventory.snapshot_hash,
    inventory_hash: validatedInventory.inventory_hash,
    origin,
    proposal_hash: proposalHash,
    requirements: assembledRequirements,
    excluded: assembledExcluded,
    unresolved: assembledUnresolved,
    coverage_ledger: {
      total_source_units: total,
      cited_count: citedCount,
      excluded_count: assembledExcluded.length,
      unresolved_count: assembledUnresolved.length,
      every_source_unit_disposed: dispositionedCount === total,
    },
    // What DISCOVERY covered: which source units were dispositioned and how many obligations were
    // derived from them.
    discovery_coverage: {
      status: discoveryStatus,
      total_source_units: total,
      dispositioned_source_units: dispositionedCount,
      requirement_count: assembledRequirements.length,
    },
    // What was ANALYZED. Discovering an obligation is not analysing it: nothing has been through
    // the V3 contract at this point, so this is always 'incomplete' here. Only
    // resolveTenderSemanticDecisionFrontier, fed with real V3 output, may raise it.
    analyzed_coverage: {
      status: 'incomplete',
      total_source_units: total,
      dispositioned_source_units: 0,
      requirement_count: 0,
    },
    // Never decision-ready at discovery time, no matter how complete discovery was.
    decision_ready: false,
    recommendation: 'pause',
    human_review_required: true,
    semantic_manifest_hash: '',
  };
  manifest.semantic_manifest_hash = manifestHash(manifest);
  return validateTenderSemanticManifest(manifest, { inventory: validatedInventory, documents });
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * Fail-closed re-validation of a semantic manifest. Used to self-check the assembler's own output
 * and — far more importantly — to re-check an untrusted manifest that arrived from anywhere else
 * (a caller's analysis context, a durable job payload, a persisted envelope) before it is allowed
 * to become the runtime frontier.
 *
 * Structural and provenance checks run BEFORE the manifest-hash check, so a forged citation is
 * reported as a forged citation instead of being masked by the resulting hash drift.
 *
 * `documents` is the snapshot's own INDEPENDENT source text. When it is supplied for a
 * `model_proposal` manifest, every proposed label is re-anchored here: the source units are
 * reconstructed from those documents (which proves they are this expediente's, not another's) and
 * the label must appear literally in at least one unit the requirement itself cites. Recomputed
 * ids and hashes say nothing about a label, so this is the only check that can tell a real
 * obligation apart from an invented one.
 *
 * @param {object} value The manifest to re-validate.
 * @param {object} [options]
 * @param {object|null} [options.inventory] The inventory the manifest must be bound to.
 * @param {Array|null} [options.documents] The snapshot's own documents (independent source text).
 */
export function validateTenderSemanticManifest(value, { inventory = null, documents = null } = {}) {
  exactKeys(value, MANIFEST_KEYS, 'El manifiesto semántico');
  if (value.semantic_manifest_version !== TENDER_SEMANTIC_MANIFEST_VERSION) {
    throw new Error('Versión de manifiesto semántico inválida.');
  }
  if (typeof value.snapshot_id !== 'string' || !value.snapshot_id.trim()) {
    throw new Error('El manifiesto semántico requiere snapshot_id.');
  }
  if (!isSha256(value.snapshot_hash) || !isSha256(value.inventory_hash) || !isSha256(value.semantic_manifest_hash)) {
    throw new Error('Hash de manifiesto semántico, inventario o snapshot inválido.');
  }
  if (!TENDER_SEMANTIC_ORIGINS.includes(value.origin)) throw new Error('Origen de manifiesto semántico inválido.');
  if (value.proposal_hash !== null && !isSha256(value.proposal_hash)) {
    throw new Error('El hash de la propuesta del manifiesto semántico debe ser sha256 o nulo.');
  }
  if (value.origin === 'structural_derivation' && value.proposal_hash !== null) {
    throw new Error('Una derivación estructural del manifiesto semántico no puede declarar una propuesta.');
  }
  if (value.origin === 'model_proposal' && value.proposal_hash === null) {
    throw new Error('Una propuesta de modelo requiere el hash de la propuesta canonicalizada.');
  }
  for (const key of ['requirements', 'excluded', 'unresolved']) {
    if (!Array.isArray(value[key])) throw new Error(`El manifiesto semántico requiere ${key} como lista.`);
  }
  exactKeys(value.coverage_ledger, LEDGER_KEYS, 'coverage_ledger');
  exactKeys(value.discovery_coverage, COVERAGE_KEYS, 'discovery_coverage');
  exactKeys(value.analyzed_coverage, COVERAGE_KEYS, 'analyzed_coverage');
  if (!COVERAGE_STATUSES.has(value.discovery_coverage.status) || !COVERAGE_STATUSES.has(value.analyzed_coverage.status)) {
    throw new Error('Estado de cobertura inválido en el manifiesto semántico.');
  }
  // No manifest — discovered or finalized — ever authorizes a decision or produces a GO: human
  // review is mandatory, and the strongest readiness it may declare is 'ready_for_human_review'.
  // Whether that readiness is EARNED is arithmetic, checked against the coverage below.
  if (typeof value.decision_ready !== 'boolean'
    || !TENDER_SEMANTIC_RECOMMENDATIONS.has(value.recommendation)
    || value.decision_ready !== (value.recommendation === 'ready_for_human_review')
    || value.human_review_required !== true) {
    throw new Error('El manifiesto semántico debe pausar la decisión y exigir revisión humana.');
  }

  const requirementIds = new Set();
  const obligationKeys = new Set();
  const citedUnitIds = new Set();
  const dispositioned = new Set();
  for (const requirement of value.requirements) {
    exactKeys(requirement, REQUIREMENT_KEYS, 'Un requisito');
    if (typeof requirement.requirement_id !== 'string' || !/^sreq:[0-9a-f]{32}$/.test(requirement.requirement_id)) {
      throw new Error('Identidad de requisito semántico inválida: debe ser derivada y ligada al snapshot.');
    }
    if (requirementIds.has(requirement.requirement_id)) {
      throw new Error(`requirement_id duplicado en el manifiesto semántico: ${requirement.requirement_id}.`);
    }
    requirementIds.add(requirement.requirement_id);
    if (HISTORICAL_FIXED_ID_SET.has(requirement.requirement_id) || HISTORICAL_FIXED_ID_SET.has(requirement.obligation_key)) {
      throw new Error('Un identificador histórico fijo nunca es un requisito propio del proceso.');
    }
    if (!TENDER_SEMANTIC_FRONTS.includes(requirement.front)) throw new Error('Front inválido en el manifiesto semántico.');
    if (!TENDER_SEMANTIC_KINDS.includes(requirement.kind)) throw new Error('Tipo de requisito inválido en el manifiesto semántico.');
    if (typeof requirement.label !== 'string'
      || requirement.label.trim().length < MIN_LABEL_CHARS
      || requirement.label.length > MAX_LABEL_CHARS
      || CONTROL_CHARS.test(requirement.label)) {
      throw new Error(`Etiqueta inválida para el requisito ${requirement.requirement_id}.`);
    }
    if (typeof requirement.obligation_key !== 'string' || requirement.obligation_key !== tenderSemanticObligationKey(requirement.label)) {
      throw new Error(`La clave de obligación de ${requirement.requirement_id} no se deriva de su propia etiqueta.`);
    }
    if (obligationKeys.has(requirement.obligation_key)) {
      throw new Error(`Obligación duplicada en el manifiesto semántico: ${requirement.obligation_key}.`);
    }
    obligationKeys.add(requirement.obligation_key);
    if (!Array.isArray(requirement.supplemental_signal_ids)
      || requirement.supplemental_signal_ids.some(id => typeof id !== 'string')) {
      throw new Error(`supplemental_signal_ids inválido para ${requirement.requirement_id}.`);
    }
    exactKeys(requirement.front_evidence, CITATION_KEYS, 'front_evidence');
    if (!isSha256(requirement.front_evidence.unit_hash)) {
      throw new Error(`Hash de front_evidence inválido para ${requirement.requirement_id}.`);
    }
    if (!Array.isArray(requirement.citations) || requirement.citations.length === 0) {
      throw new Error(`El requisito ${requirement.requirement_id} requiere al menos una cita: un requisito sin procedencia es imposible.`);
    }
    const seenCitations = new Set();
    for (const citation of requirement.citations) {
      exactKeys(citation, CITATION_KEYS, 'Una cita');
      if (typeof citation.source_unit_id !== 'string' || !citation.source_unit_id.trim() || !isSha256(citation.unit_hash)) {
        throw new Error(`Cita inválida para el requisito ${requirement.requirement_id}.`);
      }
      if (seenCitations.has(citation.source_unit_id)) {
        throw new Error(`Cita duplicada para el requisito ${requirement.requirement_id}.`);
      }
      seenCitations.add(citation.source_unit_id);
      citedUnitIds.add(citation.source_unit_id);
      dispositioned.add(citation.source_unit_id);
    }
    citedUnitIds.add(requirement.front_evidence.source_unit_id);
    dispositioned.add(requirement.front_evidence.source_unit_id);

    const expectedId = requirementIdFor({
      snapshotId: value.snapshot_id,
      inventoryHash: value.inventory_hash,
      front: requirement.front,
      obligationKey: requirement.obligation_key,
      kind: requirement.kind,
      frontEvidence: requirement.front_evidence,
      citations: requirement.citations,
    });
    if (expectedId !== requirement.requirement_id) {
      throw new Error(`La identidad del requisito ${requirement.requirement_id} no se deriva de su snapshot, obligación y citas.`);
    }
  }

  for (const entry of value.excluded) {
    exactKeys(entry, EXCLUDED_KEYS, 'Una exclusión');
    if (!TENDER_SEMANTIC_EXCLUSION_REASONS.includes(entry.reason)) {
      throw new Error('Razón de exclusión fuera del vocabulario cerrado del manifiesto semántico.');
    }
    if (!isSha256(entry.unit_hash)) throw new Error('Hash de exclusión inválido en el manifiesto semántico.');
    if (dispositioned.has(entry.source_unit_id)) {
      throw new Error(`La unidad ${entry.source_unit_id} tiene disposición duplicada en el manifiesto semántico.`);
    }
    dispositioned.add(entry.source_unit_id);
  }

  for (const entry of value.unresolved) {
    exactKeys(entry, UNRESOLVED_KEYS, 'Una unidad sin resolver');
    if (!UNRESOLVED_ORIGINS.has(entry.origin)) {
      throw new Error('Origen inválido para una unidad sin resolver del manifiesto semántico.');
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error('Una unidad sin resolver requiere una razón explícita.');
    }
    if (entry.origin === 'semantic' && !TENDER_SEMANTIC_UNRESOLVED_REASONS.includes(entry.reason)) {
      throw new Error('Razón sin resolver fuera del vocabulario cerrado del manifiesto semántico.');
    }
    if (!isSha256(entry.unit_hash)) throw new Error('Hash inválido para una unidad sin resolver.');
    if (dispositioned.has(entry.source_unit_id)) {
      throw new Error(`La unidad ${entry.source_unit_id} tiene disposición duplicada en el manifiesto semántico.`);
    }
    dispositioned.add(entry.source_unit_id);
  }

  const ledger = value.coverage_ledger;
  if (!Number.isInteger(ledger.total_source_units)
    || ledger.cited_count !== citedUnitIds.size
    || ledger.excluded_count !== value.excluded.length
    || ledger.unresolved_count !== value.unresolved.length
    || ledger.every_source_unit_disposed !== (dispositioned.size === ledger.total_source_units)) {
    throw new Error('El libro de cobertura del manifiesto semántico no concuerda con su contenido.');
  }
  if (value.discovery_coverage.requirement_count !== value.requirements.length
    || value.discovery_coverage.total_source_units !== ledger.total_source_units
    || value.discovery_coverage.dispositioned_source_units !== dispositioned.size) {
    throw new Error('La cobertura de descubrimiento del manifiesto semántico no concuerda con sus disposiciones.');
  }
  const expectedDiscoveryStatus = ledger.total_source_units === 0 || dispositioned.size !== ledger.total_source_units
    ? 'incomplete'
    : value.unresolved.length > 0 ? 'partial' : 'complete';
  if (value.discovery_coverage.status !== expectedDiscoveryStatus) {
    throw new Error('El estado de cobertura de descubrimiento no corresponde a las disposiciones del manifiesto semántico.');
  }
  if (value.analyzed_coverage.total_source_units !== ledger.total_source_units) {
    throw new Error('La cobertura analizada del manifiesto semántico no concuerda con el inventario.');
  }
  // Analyzed coverage is what the V3 turn actually dispositioned, and it can never exceed what
  // discovery accounted for. A manifest that has not been finalized carries zeros here (status
  // 'incomplete'); only resolveTenderSemanticDecisionFrontier may raise it, and only to numbers
  // that reconcile with this same content.
  const analyzed = value.analyzed_coverage;
  if (!Number.isInteger(analyzed.dispositioned_source_units) || analyzed.dispositioned_source_units < 0
    || analyzed.dispositioned_source_units > ledger.total_source_units
    || !Number.isInteger(analyzed.requirement_count) || analyzed.requirement_count < 0
    || analyzed.requirement_count > value.requirements.length) {
    throw new Error('La cobertura analizada del manifiesto semántico no concuerda con su contenido.');
  }
  const analyzedEverything = ledger.total_source_units > 0
    && value.requirements.length > 0
    && analyzed.dispositioned_source_units === ledger.total_source_units
    && analyzed.requirement_count === value.requirements.length;
  const analyzedNothing = analyzed.dispositioned_source_units === 0 && analyzed.requirement_count === 0;
  // A visibly unresolved unit keeps the analysis 'partial' even when every requirement and unit
  // went through V3: the expediente itself was never whole.
  const expectedAnalyzedStatus = analyzedEverything
    ? (value.unresolved.length > 0 ? 'partial' : 'complete')
    : analyzedNothing ? 'incomplete' : 'partial';
  if (analyzed.status !== expectedAnalyzedStatus) {
    throw new Error('La cobertura analizada del manifiesto semántico no corresponde al análisis V3 que declara.');
  }
  // Readiness is never a claim: it is exactly "discovery covered the whole expediente with no
  // visible gap AND V3 dispositioned every requirement and every source unit". Anything else,
  // including a hand-set flag, is rejected fail-closed.
  const expectedDecisionReady = expectedDiscoveryStatus === 'complete'
    && value.unresolved.length === 0
    && expectedAnalyzedStatus === 'complete';
  if (value.decision_ready !== expectedDecisionReady) {
    throw new Error('El manifiesto semántico declara una decisión que su cobertura descubierta y analizada no sostiene.');
  }

  if (inventory !== null && inventory !== undefined) {
    const validatedInventory = validateTenderRequirementInventory(inventory);
    if (validatedInventory.snapshot_id !== value.snapshot_id
      || validatedInventory.inventory_hash !== value.inventory_hash
      || validatedInventory.snapshot_hash !== value.snapshot_hash) {
      throw new Error('El manifiesto semántico pertenece a otro inventario/snapshot: está ligado a exactamente una identidad de expediente.');
    }
    const unitsById = new Map(validatedInventory.source_units.map(unit => [unit.source_unit_id, unit]));
    if (ledger.total_source_units !== unitsById.size) {
      throw new Error('El manifiesto semántico no contabiliza todas las unidades del inventario.');
    }
    for (const requirement of value.requirements) {
      for (const citation of [requirement.front_evidence, ...requirement.citations]) {
        const unit = unitsById.get(citation.source_unit_id);
        if (!unit) {
          throw new Error(`Cita inexistente en este inventario para ${requirement.requirement_id}: ${citation.source_unit_id}.`);
        }
        if (unit.disposition !== 'analyzable') {
          throw new Error(`Cita no analizable para ${requirement.requirement_id}: una unidad sin resolver nunca es evidencia citable.`);
        }
        if (unit.unit_hash !== citation.unit_hash) {
          throw new Error(`Hash de cita alterado para ${requirement.requirement_id}: ${citation.source_unit_id}.`);
        }
      }
    }
    for (const entry of [...value.excluded, ...value.unresolved]) {
      const unit = unitsById.get(entry.source_unit_id);
      if (!unit || unit.unit_hash !== entry.unit_hash) {
        throw new Error(`Disposición inválida en el manifiesto semántico: la unidad ${String(entry.source_unit_id)} no pertenece a este inventario.`);
      }
    }
    for (const unit of validatedInventory.source_units) {
      if (!dispositioned.has(unit.source_unit_id)) {
        throw new Error(`El manifiesto semántico deja sin disponer la unidad ${unit.source_unit_id}.`);
      }
    }
  }

  // The literal anchor of a model-proposed label. Deliberately AFTER the inventory checks (a
  // manifest bound to another expediente is reported as such) and BEFORE the hash check (an
  // invented label is reported as an invented label, not as hash drift).
  if (value.origin === 'model_proposal' && documents !== null && documents !== undefined) {
    if (inventory === null || inventory === undefined) {
      throw new Error('El texto fuente de una propuesta de modelo sólo puede reconstruirse contra el inventario del mismo snapshot: falta el inventario.');
    }
    // Reconstructing the units from the documents is itself the proof that this text IS this
    // expediente's: another tender's documents never rebuild these source unit ids and hashes.
    const sourceTexts = resolveTenderInventorySourceTexts({ inventory, documents });
    for (const requirement of value.requirements) {
      const label = normalizedSourceText(requirement.label);
      const anchored = requirement.citations.some(citation => {
        const unitText = sourceTexts.get(citation.source_unit_id)?.text;
        return typeof unitText === 'string' && unitText.includes(label);
      });
      if (!anchored) {
        throw new Error(`La etiqueta del requisito ${requirement.requirement_id} no aparece literalmente en el texto de ninguna unidad fuente que cita: una propuesta sin anclaje en el expediente es una obligación inventada.`);
      }
    }
  }

  if (manifestHash(value) !== value.semantic_manifest_hash) {
    throw new Error('El hash del manifiesto semántico no coincide con su contenido.');
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Deterministic structural derivation (fast path / fixture path — NOT a universal analyzer)
// ---------------------------------------------------------------------------------------------

// Grammar, not a topic list: these are the deontic constructions a Spanish tender clause uses to
// impose an obligation. They say THAT something is required, never WHAT.
const DEONTIC_PATTERNS = [
  /\bdeber(?:a|an|as|e|en|emos|ia|ian)\b/,
  /\bse exige\b/,
  /\bse exigira\b/,
  /\bes obligatori[oa]\b/,
  /\besta obligad[oa]\b/,
  /\bse obliga\b/,
  /\bqueda obligad[oa]\b/,
  /\btendra que\b/,
  /\bsera obligatori[oa]\b/,
];

// The front taxonomy tokens, accent-stripped. Same closed 3 fronts as the requirement_manifest
// schema. A heading that declares no front declares nothing.
const FRONT_TOKEN_PATTERNS = [
  { front: 'financial', pattern: /\bfinancier/ },
  { front: 'legal', pattern: /\b(?:juridic|legal)/ },
  { front: 'technical', pattern: /\b(?:tecnic|technical)/ },
];

const HEADING_MAX_CHARS = 80;
// `<Term>:` — the clause's own inline subject declaration, optionally preceded by numbering.
const INLINE_SUBJECT_PATTERN = /^(?:[0-9]+(?:[.\-][0-9]+)*[.)]?\s+)?([^:.\n]{3,80}):\s+\S/;

function hasDeonticMarker(text) {
  const normalized = folded(text);
  return DEONTIC_PATTERNS.some(pattern => pattern.test(normalized));
}

function frontDeclaredBy(text) {
  // A heading reads as a heading: short, and not a sentence.
  if (text.length > HEADING_MAX_CHARS || /\.\s*$/.test(text)) return null;
  if (hasDeonticMarker(text)) return null;
  const normalized = folded(text);
  const matches = FRONT_TOKEN_PATTERNS.filter(entry => entry.pattern.test(normalized));
  // An ambiguous heading declaring two fronts declares neither.
  return matches.length === 1 ? matches[0].front : null;
}

function inlineSubjectOf(text) {
  const match = INLINE_SUBJECT_PATTERN.exec(text);
  if (!match) return null;
  const subject = match[1].trim().normalize('NFC');
  // "El proponente deberá acreditar lo siguiente:" declares a sentence, not a subject.
  if (subject.length < MIN_LABEL_CHARS || hasDeonticMarker(subject)) return null;
  return subject;
}

/**
 * Deterministic, provider-free derivation of this snapshot's own obligations from its own text.
 *
 * Scope, stated honestly: this reads EXPLICIT clause structure only — a deontic marker, an inline
 * `<Term>:` subject declaration, and a front heading in the clause's own document. A tender that
 * expresses its obligations in tables, running prose, annex cross-references or addenda derives
 * nothing here, and the caller fails closed instead of inventing certainty. The governed model
 * discovery stage (tender-semantic-discovery.js) is what covers those tenders; this remains the
 * deterministic floor, the offline path and the fixture path.
 *
 * Ambiguity is never resolved by invention: a clause with no derivable subject, or no front
 * declared by its own document, becomes a visible unresolved unit and the run pauses.
 */
export function buildTenderSemanticManifest({ inventory, documents }) {
  const validatedInventory = validateTenderRequirementInventory(inventory);
  const texts = resolveTenderInventorySourceTexts({ inventory: validatedInventory, documents });

  const byDocument = new Map();
  for (const [sourceUnitId, entry] of texts) {
    const key = `${entry.document_id}\x00${entry.document_version_id}`;
    if (!byDocument.has(key)) byDocument.set(key, []);
    byDocument.get(key).push({ source_unit_id: sourceUnitId, ...entry });
  }

  const requirements = [];
  const excluded = [];
  const unresolved = [];
  const headingUnitIds = new Set();
  const frontEvidenceUsed = new Set();

  for (const key of [...byDocument.keys()].sort()) {
    const units = byDocument.get(key).sort((left, right) => left.index - right.index);
    let currentFront = null;
    for (const unit of units) {
      if (hasDeonticMarker(unit.text)) {
        const subject = inlineSubjectOf(unit.text);
        if (!subject) {
          unresolved.push({ source_unit_id: unit.source_unit_id, reason: 'subject_not_derivable' });
          continue;
        }
        if (!currentFront) {
          unresolved.push({ source_unit_id: unit.source_unit_id, reason: 'front_not_derivable' });
          continue;
        }
        requirements.push({
          kind: 'obligation',
          label: subject,
          front: currentFront.front,
          front_evidence: { source_unit_id: currentFront.source_unit_id, unit_hash: currentFront.unit_hash },
          citations: [{ source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash }],
        });
        continue;
      }
      const front = frontDeclaredBy(unit.text);
      if (front) {
        headingUnitIds.add(unit.source_unit_id);
        currentFront = { front, source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash };
        continue;
      }
      excluded.push({ source_unit_id: unit.source_unit_id, reason: 'descriptive_or_contextual' });
    }
  }

  // The same subject declared twice is a genuine ambiguity, not a merge opportunity: the first
  // clause keeps the obligation and the second stays visibly unresolved instead of silently
  // overwriting it or inventing a distinction the source never made.
  const seenKeys = new Set();
  const dedupedRequirements = [];
  for (const requirement of requirements) {
    const obligationKey = tenderSemanticObligationKey(requirement.label);
    if (seenKeys.has(obligationKey)) {
      for (const citation of requirement.citations) {
        unresolved.push({ source_unit_id: citation.source_unit_id, reason: 'obligation_not_classifiable' });
      }
      continue;
    }
    seenKeys.add(obligationKey);
    frontEvidenceUsed.add(requirement.front_evidence.source_unit_id);
    dedupedRequirements.push(requirement);
  }

  // A front heading nobody filed an obligation under is structural text, not evidence.
  for (const sourceUnitId of headingUnitIds) {
    if (frontEvidenceUsed.has(sourceUnitId)) continue;
    excluded.push({ source_unit_id: sourceUnitId, reason: 'structural_or_navigational' });
  }

  return assembleTenderSemanticManifest({
    inventory: validatedInventory,
    origin: 'structural_derivation',
    proposalHash: null,
    requirements: dedupedRequirements,
    excluded,
    unresolved,
  });
}

// ---------------------------------------------------------------------------------------------
// Projections into the existing AGT-002 runtime shapes
// ---------------------------------------------------------------------------------------------

/**
 * Projects the semantic manifest into the EXISTING closed requirement_manifest unit shape
 * ({requirement_id, front, label, sources[], unresolved_sources[]}) that retrieval, the V3
 * validator and persistence already enforce — so the tender's own obligations become the runtime
 * frontier without a new table, a new schema version or a migration.
 *
 * A manifest with zero resolved requirements is never projected: there is no honest frontier to
 * build, and the run must pause instead of falling back to the historical four.
 */
export function toAgt002RequirementManifest({ semanticManifest, inventory, documents = null }) {
  const validatedInventory = validateTenderRequirementInventory(inventory);
  const manifest = validateTenderSemanticManifest(semanticManifest, { inventory: validatedInventory, documents });
  if (manifest.requirements.length === 0) {
    throw new Error(
      'El manifiesto semántico no resolvió ningún requisito propio de este proceso: la ejecución queda en pausa y nunca recae en el catálogo histórico fijo.',
    );
  }
  const unitsById = new Map(validatedInventory.source_units.map(unit => [unit.source_unit_id, unit]));

  const entries = manifest.requirements.map(requirement => {
    const sourcesByKey = new Map();
    for (const citation of requirement.citations) {
      const unit = unitsById.get(citation.source_unit_id);
      const source = {
        document_id: unit.document_id,
        document_version_id: unit.document_version_id,
        content_hash: unit.content_hash,
      };
      sourcesByKey.set(`${source.document_id}\x00${source.document_version_id}\x00${source.content_hash}`, source);
    }
    const sources = [...sourcesByKey.values()].sort((left, right) => (
      left.document_version_id.localeCompare(right.document_version_id)
      || left.document_id.localeCompare(right.document_id)
    ));
    return {
      requirement_id: requirement.requirement_id,
      front: requirement.front,
      label: requirement.label,
      sources,
      // Every citation resolves by construction (the validator above proved it), so a semantic
      // requirement never carries an unresolved provenance source.
      unresolved_sources: [],
    };
  }).sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));

  // Same closed structural gate the persistence boundary applies, so a derived frontier and a
  // governed one are indistinguishable to every downstream consumer.
  return validateAgt002RequirementManifest({ requirement_manifest_version: '1.0', requirement_manifest: entries });
}

/**
 * Retrieval requirements derived from each obligation's OWN source-declared subject, so the
 * tender's own clause is what the retrieval layer goes looking for.
 */
export function toAgt002RetrievalRequirements(semanticManifest) {
  const manifest = validateTenderSemanticManifest(semanticManifest);
  if (manifest.requirements.length === 0) {
    throw new Error('El manifiesto semántico no resolvió ningún requisito recuperable: la ejecución queda en pausa.');
  }
  return manifest.requirements.map(requirement => {
    const terms = tenderSemanticRetrievalTerms(requirement.label);
    if (!terms.length) {
      throw new Error(`El requisito ${requirement.requirement_id} no produce términos de recuperación desde su propia etiqueta.`);
    }
    return { requirement_id: requirement.requirement_id, terms };
  }).sort((left, right) => left.requirement_id.localeCompare(right.requirement_id));
}

// ---------------------------------------------------------------------------------------------
// Frontier + readiness
// ---------------------------------------------------------------------------------------------

function historicalSignalIds(historicalAnalysis) {
  const ids = historicalAnalysis?.requirement_ids;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim()))].sort();
}

/**
 * Resolves the runtime frontier for a tender: exactly this snapshot's own semantic requirements.
 *
 * The historical fixed extractors survive only as `supplemental_signal_ids`. They never enter
 * `requirement_ids`, never contribute to `requirement_count`, and a run whose only requirement
 * signal is that fixed catalog is flagged `historical_catalog_only` and stays paused.
 *
 * `decision_ready` is NOT a function of discovery. It requires, additionally, real V3 output
 * (`analyzedCoverage`) that dispositioned every manifest requirement AND every source unit the
 * manifest accounted for. Even then this returns `human_review_required: true` and produces no GO:
 * a human decides.
 *
 * @param {object} args
 * @param {object} args.semanticManifest This snapshot's validated semantic manifest.
 * @param {object|null} args.historicalAnalysis Legacy `{requirement_ids}` (supplemental only).
 * @param {object|null} args.analyzedCoverage `{analyzed_requirement_ids, dispositioned_source_unit_ids}` from V3.
 * @param {Array|null} args.documents The snapshot's own documents; when given, a model-proposed
 *   label is re-anchored against them.
 */
export function resolveTenderSemanticFrontier({
  semanticManifest, historicalAnalysis = null, analyzedCoverage = null, inventory = null, documents = null,
}) {
  const manifest = validateTenderSemanticManifest(semanticManifest, { inventory, documents });
  const requirementIds = manifest.requirements.map(requirement => requirement.requirement_id).sort();
  const supplementalSignalIds = historicalSignalIds(historicalAnalysis);

  for (const requirementId of requirementIds) {
    if (HISTORICAL_FIXED_ID_SET.has(requirementId)) {
      throw new Error('Un identificador histórico fijo nunca puede entrar en la frontera de requisitos.');
    }
  }

  const analyzedRequirementIds = Array.isArray(analyzedCoverage?.analyzed_requirement_ids)
    ? [...new Set(analyzedCoverage.analyzed_requirement_ids.filter(id => typeof id === 'string'))].sort()
    : null;
  const dispositionedSourceUnitIds = Array.isArray(analyzedCoverage?.dispositioned_source_unit_ids)
    ? new Set(analyzedCoverage.dispositioned_source_unit_ids.filter(id => typeof id === 'string'))
    : null;

  const manifestSourceUnitIds = new Set([
    ...manifest.requirements.flatMap(requirement => [
      requirement.front_evidence.source_unit_id,
      ...requirement.citations.map(citation => citation.source_unit_id),
    ]),
    ...manifest.excluded.map(entry => entry.source_unit_id),
    ...manifest.unresolved.map(entry => entry.source_unit_id),
  ]);

  const everyRequirementAnalyzed = analyzedRequirementIds !== null
    && requirementIds.length > 0
    && analyzedRequirementIds.length === requirementIds.length
    && analyzedRequirementIds.every((id, index) => id === requirementIds[index]);
  const everySourceUnitAnalyzed = dispositionedSourceUnitIds !== null
    && [...manifestSourceUnitIds].every(id => dispositionedSourceUnitIds.has(id));

  const decisionReady = manifest.discovery_coverage.status === 'complete'
    && manifest.unresolved.length === 0
    && everyRequirementAnalyzed
    && everySourceUnitAnalyzed;

  return {
    frontier_source: 'tender_semantic_manifest',
    requirement_ids: requirementIds,
    requirement_count: requirementIds.length,
    supplemental_signal_ids: supplementalSignalIds,
    // A run with no tender-native requirement and nothing but the fixed catalog behind it is a
    // historical catalog, not integral coverage of this tender.
    historical_catalog_only: requirementIds.length === 0 && supplementalSignalIds.length > 0,
    decision_ready: decisionReady,
    recommendation: decisionReady ? 'ready_for_human_review' : 'pause',
    // Always. This module never decides and never authorizes a GO.
    human_review_required: true,
  };
}

/**
 * Finalizes a DISCOVERED manifest against the V3 output that actually analysed it, returning the
 * manifest that may be persisted as the audit record of this run.
 *
 * `resolveTenderSemanticFrontier` above answers "what is the frontier, and is it ready?" as a
 * separate summary object. This answers the persistence question instead: the manifest itself must
 * carry, inside its own hashed content, what V3 dispositioned — otherwise the durable run says
 * "analysis pending" forever, no matter how complete the analysis was.
 *
 * Nothing here is a claim. Identity, citations, hashes, requirements, exclusions and unresolved
 * units are carried over verbatim from the validated discovery manifest; only `analyzed_coverage`,
 * `decision_ready` and `recommendation` are recomputed, from the intersection of what V3 reports
 * with what the manifest itself accounted for — so an id V3 invented, or one it repeated, can
 * never inflate coverage. `decision_ready` stays false whenever discovery was partial or left a
 * visible unresolved unit, and `human_review_required` stays true unconditionally: this never
 * authorizes a GO.
 *
 * @param {object} args
 * @param {object} args.semanticManifest The validated discovery-stage manifest.
 * @param {object|null} args.inventory The inventory the manifest is bound to (re-checked when given).
 * @param {Array|null} args.documents The snapshot's own documents; when given, a model-proposed
 *   label is re-anchored against them before and after finalization.
 * @param {string[]} args.analyzedRequirementIds Requirement ids the V3 result dispositioned.
 * @param {string[]} args.analyzedSourceUnitIds Source unit ids the V3 result covered.
 */
export function resolveTenderSemanticDecisionFrontier({
  semanticManifest, inventory = null, documents = null, analyzedRequirementIds = [], analyzedSourceUnitIds = [],
}) {
  const manifest = validateTenderSemanticManifest(semanticManifest, { inventory, documents });

  const requirementIds = new Set(manifest.requirements.map(requirement => requirement.requirement_id));
  const manifestSourceUnitIds = new Set([
    ...manifest.requirements.flatMap(requirement => [
      requirement.front_evidence.source_unit_id,
      ...requirement.citations.map(citation => citation.source_unit_id),
    ]),
    ...manifest.excluded.map(entry => entry.source_unit_id),
    ...manifest.unresolved.map(entry => entry.source_unit_id),
  ]);

  const analyzedRequirements = new Set((Array.isArray(analyzedRequirementIds) ? analyzedRequirementIds : [])
    .filter(id => typeof id === 'string' && requirementIds.has(id)));
  const analyzedSourceUnits = new Set((Array.isArray(analyzedSourceUnitIds) ? analyzedSourceUnitIds : [])
    .filter(id => typeof id === 'string' && manifestSourceUnitIds.has(id)));

  const total = manifest.coverage_ledger.total_source_units;
  const analyzedEverything = total > 0
    && requirementIds.size > 0
    && analyzedSourceUnits.size === total
    && analyzedRequirements.size === requirementIds.size;
  const analyzedNothing = analyzedSourceUnits.size === 0 && analyzedRequirements.size === 0;
  const analyzedStatus = analyzedEverything
    ? (manifest.unresolved.length > 0 ? 'partial' : 'complete')
    : analyzedNothing ? 'incomplete' : 'partial';

  const decisionReady = manifest.discovery_coverage.status === 'complete'
    && manifest.unresolved.length === 0
    && analyzedStatus === 'complete';

  const finalized = {
    ...manifest,
    analyzed_coverage: {
      status: analyzedStatus,
      total_source_units: total,
      dispositioned_source_units: analyzedSourceUnits.size,
      requirement_count: analyzedRequirements.size,
    },
    decision_ready: decisionReady,
    recommendation: decisionReady ? 'ready_for_human_review' : 'pause',
    // Always. Readiness here means "ready for a human to decide", never a decision.
    human_review_required: true,
    semantic_manifest_hash: '',
  };
  finalized.semantic_manifest_hash = manifestHash(finalized);
  return validateTenderSemanticManifest(finalized, { inventory, documents });
}
