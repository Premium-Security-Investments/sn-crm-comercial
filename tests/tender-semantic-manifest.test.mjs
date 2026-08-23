// AGT-002 / AGT-002-002 — TDD (RED) contract for the MISSING tender-native semantic stage.
//
// Today `tender-requirement-inventory.js` segments each snapshot into normalized paragraphs and
// turns every paragraph into a fake `Requisito documental <hash>` "requirement", while the real
// runtime frontier (requirement_manifest / retrieval requirements / model input) still comes from
// the fixed `deepAnalysis.matrix` four historical ids. Segmentation is not semantic analysis, and
// four historical ids are not this tender's obligations.
//
// This file defines the small, pure, deterministic, provider-free API that closes that gap:
//
//   import {
//     TENDER_SEMANTIC_MANIFEST_VERSION,
//     TENDER_SEMANTIC_UNRESOLVED_REASONS,
//     buildTenderSemanticManifest,
//     validateTenderSemanticManifest,
//     toAgt002RequirementManifest,
//     toAgt002RetrievalRequirements,
//     resolveTenderSemanticFrontier,
//   } from '../tender-semantic-manifest.js';
//
// CONTRACT THIS FILE PINS (no universal fixed keyword catalog anywhere):
//
//  A. Obligation clauses are detected STRUCTURALLY, from the tender's own text:
//     - A source unit is a FRONT DECLARATION when it reads as a heading (<= 80 chars, no
//       sentence-terminal '.') and carries an explicit front token of the SAME closed 3-front
//       taxonomy the requirement_manifest schema already fixes ({legal, financial, technical}):
//       accent-stripped `financier|financier(o|a)` => financial, `juridic|legal` => legal,
//       `tecnic|technical` => technical. This is the front taxonomy, NOT a requirement catalog.
//     - A source unit is an OBLIGATION CLAUSE when it carries a deontic marker
//       (deber(á|e|án|en) / se exige / es obligatorio / está obligado / se obliga ...). That is
//       grammar, not a topic list.
//     - The obligation's SUBJECT is read from the clause's own inline declaration
//       (`<Term>:` optionally preceded by numbering). It is never inferred from a topic table.
//
//  B. Everything is provenance-bound: every requirement cites >= 1 ANALYZABLE source unit of THIS
//     snapshot's inventory by {source_unit_id, unit_hash}, and the front carries its own
//     `front_evidence` citation (the heading unit that declared it). Nothing is invented.
//
//  C. Fail closed on ambiguity: an obligation clause with no derivable subject, or with no
//     preceding front declaration in its own document, becomes `unresolved_visible` with a closed
//     reason and forces `recommendation: 'pause'`. Certainty is never invented.
//
//  C-bis. A MODEL PROPOSAL's label is only real if the source says so: it must appear verbatim in
//     a source unit the requirement cites. Server-recomputed ids/hashes prove nothing about a
//     label, so the validator is handed the snapshot's own source text and re-derives the anchor.
//
//  D. The four historical ids (legal-rce-policy, legal-collective-life-policy,
//     financial-working-capital, technical-video-surveillance-scope) can only ever appear as
//     SUPPLEMENTAL SIGNALS. They are never the frontier and never the count.
//
// Run: node tests/tender-semantic-manifest.test.mjs

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';
import {
  TENDER_SEMANTIC_MANIFEST_VERSION,
  TENDER_SEMANTIC_UNRESOLVED_REASONS,
  assembleTenderSemanticManifest,
  buildTenderSemanticManifest,
  validateTenderSemanticManifest,
  toAgt002RequirementManifest,
  toAgt002RetrievalRequirements,
  resolveTenderSemanticFrontier,
} from '../tender-semantic-manifest.js';

const hash = value => createHash('sha256').update(value).digest('hex');

const HISTORICAL_FOUR = [
  'financial-working-capital',
  'legal-collective-life-policy',
  'legal-rce-policy',
  'technical-video-surveillance-scope',
];

const document = ({ id, version, text, type = 'pliego' }) => ({
  document_id: id,
  document_version_id: version,
  content_hash: hash(text),
  extracted_text: text,
  document_type: type,
  name: `${id}.pdf`,
  current: true,
});

// ---------------------------------------------------------------------------
// Two genuinely disjoint tender snapshots. Neither carries any of the four
// historical obligations except where the source phrase truly exists (tender B
// really does say "Capital de trabajo"; tender A never does).
// ---------------------------------------------------------------------------

const A_PLIEGO_TEXT = [
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  'REQUISITOS TÉCNICOS',
  'Capacitación en accesibilidad: el contratista deberá certificar capacitación en accesibilidad para todo el personal operativo.',
  'El presente capítulo describe el objeto contractual y su alcance general.',
].join('\n');

const A_ANEXO_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');

const B_PLIEGO_TEXT = [
  'REQUISITOS JURÍDICOS',
  'Servicio canino: el contratista deberá disponer de un binomio canino certificado para la sede principal.',
  'REQUISITOS FINANCIEROS',
  'Capital de trabajo: el proponente deberá acreditar capital de trabajo igual o superior al presupuesto oficial del proceso.',
].join('\n');

const tenderADocuments = [
  document({ id: 'a-pliego', version: 'a-pliego-v1', text: A_PLIEGO_TEXT }),
  document({ id: 'a-anexo', version: 'a-anexo-v1', text: A_ANEXO_TEXT }),
];
const tenderBDocuments = [
  document({ id: 'b-pliego', version: 'b-pliego-v1', text: B_PLIEGO_TEXT }),
];

const SNAPSHOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SNAPSHOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const inventoryFor = (snapshotId, documents, documentGaps = []) =>
  buildTenderRequirementInventory({ snapshotId, documents, documentGaps });

const inventoryA = inventoryFor(SNAPSHOT_A, tenderADocuments);
const inventoryB = inventoryFor(SNAPSHOT_B, tenderBDocuments);

const semanticA = buildTenderSemanticManifest({ inventory: inventoryA, documents: tenderADocuments });
const semanticB = buildTenderSemanticManifest({ inventory: inventoryB, documents: tenderBDocuments });

const keysOf = manifest => manifest.requirements.map(item => item.obligation_key).sort();
const idsOf = manifest => manifest.requirements.map(item => item.requirement_id).sort();
const citationIdsOf = manifest => manifest.requirements.flatMap(item => item.citations.map(c => c.source_unit_id));
const byKey = (manifest, key) => manifest.requirements.find(item => item.obligation_key === key);

// ===========================================================================
// 1. Two disjoint snapshots produce distinct semantic manifests. Neither is
//    forced to four. Zero cross-tender citations or requirement ids.
// ===========================================================================
{
  assert.equal(semanticA.semantic_manifest_version, TENDER_SEMANTIC_MANIFEST_VERSION);
  assert.equal(semanticA.snapshot_id, SNAPSHOT_A);
  assert.equal(semanticB.snapshot_id, SNAPSHOT_B);

  // Each tender derives its own cardinality from its own snapshot: 3 vs 2, never 4.
  assert.equal(semanticA.requirements.length, 3, 'tender A derives exactly its own three obligations');
  assert.equal(semanticB.requirements.length, 2, 'tender B derives exactly its own two obligations');
  assert.notEqual(semanticA.requirements.length, 4);
  assert.notEqual(semanticB.requirements.length, 4);

  assert.deepEqual(keysOf(semanticA), ['capacitacion-en-accesibilidad', 'nivel-de-apalancamiento', 'residencia-de-datos']);
  assert.deepEqual(keysOf(semanticB), ['capital-de-trabajo', 'servicio-canino']);

  // Requirement identity is per-snapshot and never shared across tenders.
  for (const requirement of [...semanticA.requirements, ...semanticB.requirements]) {
    assert.match(requirement.requirement_id, /^sreq:[0-9a-f]{32}$/, 'requirement ids are derived, opaque and snapshot-bound');
  }
  const sharedIds = idsOf(semanticA).filter(id => idsOf(semanticB).includes(id));
  assert.deepEqual(sharedIds, [], 'no requirement id may be shared across two tenders');

  const sharedCitations = citationIdsOf(semanticA).filter(id => citationIdsOf(semanticB).includes(id));
  assert.deepEqual(sharedCitations, [], 'no citation may be shared across two tenders');

  // Every citation resolves to an ANALYZABLE source unit of that tender's own inventory.
  for (const [manifest, inventory] of [[semanticA, inventoryA], [semanticB, inventoryB]]) {
    const analyzable = new Map(inventory.source_units
      .filter(unit => unit.disposition === 'analyzable')
      .map(unit => [unit.source_unit_id, unit]));
    assert.equal(manifest.inventory_hash, inventory.inventory_hash, 'a semantic manifest binds to exactly one inventory identity');
    for (const requirement of manifest.requirements) {
      assert.ok(requirement.citations.length >= 1, 'a semantic requirement without provenance is impossible');
      for (const citation of requirement.citations) {
        assert.deepEqual(Object.keys(citation).sort(), ['source_unit_id', 'unit_hash']);
        const unit = analyzable.get(citation.source_unit_id);
        assert.ok(unit, `citation ${citation.source_unit_id} must point at an analyzable unit of this snapshot`);
        assert.equal(citation.unit_hash, unit.unit_hash);
      }
      // The front is itself evidence-backed: the heading unit that declared it.
      const frontUnit = analyzable.get(requirement.front_evidence.source_unit_id);
      assert.ok(frontUnit, 'the front must cite the source unit that declared it');
      assert.equal(requirement.front_evidence.unit_hash, frontUnit.unit_hash);
    }
  }

  // Deterministic: same snapshot, same manifest, byte for byte.
  assert.deepEqual(buildTenderSemanticManifest({ inventory: inventoryA, documents: tenderADocuments }), semanticA);
  assert.deepEqual(
    buildTenderSemanticManifest({ inventory: inventoryA, documents: [...tenderADocuments].reverse() }),
    semanticA,
    'document input order must not change the derived manifest',
  );
}

// ===========================================================================
// 2. An obligation OUTSIDE the historical four carries a meaningful,
//    source-derived label and front — never a generic paragraph-hash label.
// ===========================================================================
{
  const accessibility = byKey(semanticA, 'capacitacion-en-accesibilidad');
  assert.ok(accessibility, 'the accessibility-training obligation must exist as its own requirement');
  assert.equal(accessibility.label, 'Capacitación en accesibilidad', 'the label is the clause\'s own declared subject');
  assert.equal(accessibility.front, 'technical', 'the front comes from the section heading the clause sits under');
  assert.equal(
    accessibility.front_evidence.unit_hash,
    hash('REQUISITOS TÉCNICOS'),
    'the front cites the exact heading unit text that declared it',
  );

  const residency = byKey(semanticA, 'residencia-de-datos');
  assert.ok(residency, 'the data-residency obligation must exist as its own requirement');
  assert.equal(residency.label, 'Residencia de datos');
  assert.equal(residency.front, 'technical');

  const canine = byKey(semanticB, 'servicio-canino');
  assert.ok(canine, 'the canine-service obligation must exist as its own requirement');
  assert.equal(canine.label, 'Servicio canino');
  assert.equal(canine.front, 'legal');

  // No requirement may ever carry the P0 fake paragraph-hash label.
  for (const requirement of [...semanticA.requirements, ...semanticB.requirements]) {
    assert.doesNotMatch(requirement.label, /^Requisito documental [0-9a-f]{12}$/, 'a paragraph hash is not a requirement label');
    assert.ok(requirement.label.length >= 3);
  }

  // The AGT-002 projections carry the same real labels through to the runtime shapes.
  const requirementManifest = toAgt002RequirementManifest({ semanticManifest: semanticA, inventory: inventoryA });
  assert.equal(requirementManifest.requirement_manifest_version, '1.0');
  assert.deepEqual(
    requirementManifest.requirement_manifest.map(entry => entry.label).sort(),
    ['Capacitación en accesibilidad', 'Nivel de apalancamiento', 'Residencia de datos'],
  );
  for (const entry of requirementManifest.requirement_manifest) {
    assert.deepEqual(Object.keys(entry).sort(), ['front', 'label', 'requirement_id', 'sources', 'unresolved_sources']);
    assert.ok(entry.sources.length >= 1);
    for (const source of entry.sources) {
      assert.deepEqual(Object.keys(source).sort(), ['content_hash', 'document_id', 'document_version_id']);
      assert.match(source.content_hash, /^[0-9a-f]{64}$/);
    }
  }

  const retrievalRequirements = toAgt002RetrievalRequirements(semanticA);
  const accessibilityRetrieval = retrievalRequirements.find(item => item.requirement_id === accessibility.requirement_id);
  assert.ok(accessibilityRetrieval, 'every semantic requirement must be retrievable');
  assert.ok(
    accessibilityRetrieval.terms.includes('accesibilidad'),
    'retrieval terms are derived from the source-declared subject, so the clause is actually findable',
  );
}

// ===========================================================================
// 3. "Apalancamiento 51%-60%" is apalancamiento. It is never
//    `financial-working-capital` / "Capital de trabajo" unless that phrase
//    genuinely exists in the source.
// ===========================================================================
{
  const leverage = byKey(semanticA, 'nivel-de-apalancamiento');
  assert.ok(leverage, 'the leverage obligation must be identified from its own clause');
  assert.match(leverage.obligation_key, /(^|-)apalancamiento(-|$)/, 'the obligation key is the source subject term');
  assert.match(leverage.label, /apalancamiento/i);
  assert.equal(leverage.front, 'financial');
  assert.equal(leverage.front_evidence.unit_hash, hash('REQUISITOS FINANCIEROS'));

  // Nothing in tender A may be relabeled as the historical working-capital requirement.
  for (const requirement of semanticA.requirements) {
    assert.doesNotMatch(requirement.label, /capital de trabajo/i, 'tender A never says "Capital de trabajo"');
    assert.equal(HISTORICAL_FOUR.includes(requirement.obligation_key), false);
    assert.equal(HISTORICAL_FOUR.includes(requirement.requirement_id), false);
    assert.deepEqual(requirement.supplemental_signal_ids, [], 'a source-derived obligation needs no historical signal to exist');
  }
  assert.equal(keysOf(semanticA).includes('capital-de-trabajo'), false);

  // And the phrase is only used where it truly appears (tender B).
  const workingCapital = byKey(semanticB, 'capital-de-trabajo');
  assert.ok(workingCapital, 'tender B does say "Capital de trabajo", so it keeps its own source-derived requirement');
  assert.equal(workingCapital.label, 'Capital de trabajo');
  assert.equal(workingCapital.front, 'financial');
  assert.notEqual(workingCapital.requirement_id, 'financial-working-capital', 'even a matching phrase keeps snapshot-bound identity');
}

// ===========================================================================
// 4. The fixed four may appear only as SUPPLEMENTAL SIGNALS — never frontier,
//    never count.
// ===========================================================================
{
  const frontier = resolveTenderSemanticFrontier({
    semanticManifest: semanticB,
    historicalAnalysis: { requirement_ids: [...HISTORICAL_FOUR] },
  });

  assert.equal(frontier.frontier_source, 'tender_semantic_manifest');
  assert.deepEqual(frontier.requirement_ids, idsOf(semanticB), 'the frontier is exactly this tender\'s semantic requirements');
  assert.equal(frontier.requirement_count, 2, 'the count is the tender\'s own cardinality, never four');
  for (const historicalId of HISTORICAL_FOUR) {
    assert.equal(frontier.requirement_ids.includes(historicalId), false, `${historicalId} may never enter the frontier`);
  }
  assert.deepEqual(frontier.supplemental_signal_ids, [...HISTORICAL_FOUR].sort(), 'the historical four survive only as signals');
  assert.equal(frontier.historical_catalog_only, false);
  assert.equal(frontier.human_review_required, true);

  // Descubrir el manifiesto no equivale a analizarlo: la cobertura de descubrimiento puede estar
  // completa, pero la cobertura V3 sigue incompleta y la decisión permanece pausada.
  assert.equal(semanticB.discovery_coverage.status, 'complete');
  assert.equal(semanticB.discovery_coverage.requirement_count, 2);
  assert.equal(semanticB.analyzed_coverage.status, 'incomplete');
  assert.equal(semanticB.unresolved.length, 0);
  assert.equal(semanticB.decision_ready, false);
  assert.equal(semanticB.recommendation, 'pause');
  assert.equal(frontier.decision_ready, false);
  assert.equal(frontier.recommendation, 'pause');

  // Sólo una salida V3 que disponga exactamente todo el manifiesto y todas las unidades fuente
  // puede quedar lista para revisión humana (nunca autoriza GO).
  const analyzedFrontier = resolveTenderSemanticFrontier({
    semanticManifest: semanticB,
    historicalAnalysis: { requirement_ids: [...HISTORICAL_FOUR] },
    analyzedCoverage: {
      analyzed_requirement_ids: idsOf(semanticB),
      dispositioned_source_unit_ids: inventoryB.source_units.map(unit => unit.source_unit_id),
    },
  });
  assert.equal(analyzedFrontier.decision_ready, true);
  assert.equal(analyzedFrontier.recommendation, 'ready_for_human_review');
  assert.equal(analyzedFrontier.human_review_required, true);
}

// ===========================================================================
// 5. Citation / source-unit / hash tampering fails closed.
// ===========================================================================
{
  // The untampered manifest validates, standalone and cross-checked against its inventory.
  validateTenderSemanticManifest(semanticA);
  validateTenderSemanticManifest(semanticA, { inventory: inventoryA });

  const forged = () => structuredClone(semanticA);

  const tamperedHash = forged();
  tamperedHash.requirements[0].citations[0].unit_hash = hash('forjado');
  assert.throws(() => validateTenderSemanticManifest(tamperedHash), /cita|hash|manifiesto/i, 'a forged unit_hash fails closed');
  assert.throws(() => validateTenderSemanticManifest(tamperedHash, { inventory: inventoryA }), /cita|hash|manifiesto/i);

  const tamperedLabel = forged();
  tamperedLabel.requirements[0].label = 'Capital de trabajo';
  assert.throws(() => validateTenderSemanticManifest(tamperedLabel), /hash|manifiesto|obligaci[oó]n|clave/i, 'relabeling breaks the canonical semantic identity');

  const tamperedManifestHash = forged();
  tamperedManifestHash.semantic_manifest_hash = hash('forjado');
  assert.throws(() => validateTenderSemanticManifest(tamperedManifestHash), /hash|manifiesto/i);

  const tamperedInventoryHash = forged();
  tamperedInventoryHash.inventory_hash = inventoryB.inventory_hash;
  assert.throws(() => validateTenderSemanticManifest(tamperedInventoryHash), /hash|inventario|manifiesto|identidad|requisito/i);

  // A citation borrowed from ANOTHER tender's snapshot can never be accepted.
  const crossTender = forged();
  crossTender.requirements[0].citations = [{ ...semanticB.requirements[0].citations[0] }];
  assert.throws(
    () => validateTenderSemanticManifest(crossTender, { inventory: inventoryA }),
    /cita|unidad|manifiesto/i,
    'a citation from another tender must never resolve',
  );

  // A citation pointing at a real but NON-ANALYZABLE unit (a visible gap) fails closed too:
  // a requirement can never be evidenced by something the expediente could not read.
  const gappedDocuments = tenderADocuments;
  const gappedInventory = inventoryFor(SNAPSHOT_A, gappedDocuments, [{ document_id: 'a-falta', reason: 'download_failed' }]);
  const gapUnit = gappedInventory.source_units.find(unit => unit.document_id === 'a-falta');
  assert.equal(gapUnit.disposition, 'unresolved_visible');
  const gappedSemantic = buildTenderSemanticManifest({ inventory: gappedInventory, documents: gappedDocuments });
  const citesGap = structuredClone(gappedSemantic);
  citesGap.requirements[0].citations = [{ source_unit_id: gapUnit.source_unit_id, unit_hash: gapUnit.unit_hash }];
  assert.throws(
    () => validateTenderSemanticManifest(citesGap, { inventory: gappedInventory }),
    /cita|analizable|manifiesto/i,
    'an unresolved unit is never citable evidence',
  );

  // The gap itself stays visible and forces the pause; it is never silently dropped.
  assert.equal(gappedSemantic.unresolved.some(item => item.source_unit_id === gapUnit.source_unit_id), true);
  assert.equal(gappedSemantic.unresolved.find(item => item.source_unit_id === gapUnit.source_unit_id).reason, 'download_failed');
  assert.equal(gappedSemantic.discovery_coverage.status, 'partial');
  assert.equal(gappedSemantic.analyzed_coverage.status, 'incomplete');
  assert.equal(gappedSemantic.decision_ready, false);
  assert.equal(gappedSemantic.recommendation, 'pause');
}

// ===========================================================================
// 6. The same text under a different snapshot identity can never share
//    requirement identity or citations.
// ===========================================================================
{
  const sameTextDocuments = [document({ id: 'shared-pliego', version: 'shared-v1', text: A_PLIEGO_TEXT })];
  const first = inventoryFor('11111111-1111-4111-8111-111111111111', sameTextDocuments);
  const second = inventoryFor('22222222-2222-4222-8222-222222222222', sameTextDocuments);
  const firstSemantic = buildTenderSemanticManifest({ inventory: first, documents: sameTextDocuments });
  const secondSemantic = buildTenderSemanticManifest({ inventory: second, documents: sameTextDocuments });

  // Identical obligations, deliberately identical labels — but never identical identity.
  assert.deepEqual(keysOf(firstSemantic), keysOf(secondSemantic));
  assert.deepEqual(idsOf(firstSemantic).filter(id => idsOf(secondSemantic).includes(id)), [],
    'identical text in two snapshots must not share a requirement id');
  assert.deepEqual(citationIdsOf(firstSemantic).filter(id => citationIdsOf(secondSemantic).includes(id)), [],
    'identical text in two snapshots must not share a citation');
  assert.notEqual(firstSemantic.semantic_manifest_hash, secondSemantic.semantic_manifest_hash);

  // And a manifest built for one snapshot never validates against the other's inventory.
  assert.throws(
    () => validateTenderSemanticManifest(firstSemantic, { inventory: second }),
    /inventario|snapshot|cita|manifiesto/i,
    'a semantic manifest is bound to exactly one snapshot identity',
  );
}

// ===========================================================================
// 7. Ambiguity is never resolved by invention: it becomes unresolved_visible
//    and pauses.
// ===========================================================================
{
  // (a) An obligation clause with no source-declared subject.
  const ambiguousSubject = [document({
    id: 'c-pliego', version: 'c-pliego-v1',
    text: ['REQUISITOS FINANCIEROS', 'El proponente deberá acreditar suficiencia patrimonial conforme a la ley.'].join('\n'),
  })];
  const ambiguousInventory = inventoryFor('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ambiguousSubject);
  const ambiguous = buildTenderSemanticManifest({ inventory: ambiguousInventory, documents: ambiguousSubject });

  assert.deepEqual(ambiguous.requirements, [], 'an unclassifiable obligation is never turned into a confident requirement');
  assert.equal(ambiguous.unresolved.length, 1);
  assert.equal(ambiguous.unresolved[0].reason, 'subject_not_derivable');
  assert.ok(TENDER_SEMANTIC_UNRESOLVED_REASONS.includes(ambiguous.unresolved[0].reason));
  assert.equal(ambiguous.decision_ready, false);
  assert.equal(ambiguous.recommendation, 'pause');
  assert.equal(ambiguous.human_review_required, true);

  // (b) An obligation clause whose front the source never declares.
  const noFront = [document({
    id: 'd-pliego', version: 'd-pliego-v1',
    text: 'Plan de manejo ambiental: el contratista deberá presentar un plan de manejo ambiental aprobado.',
  })];
  const noFrontInventory = inventoryFor('dddddddd-dddd-4ddd-8ddd-dddddddddddd', noFront);
  const noFrontSemantic = buildTenderSemanticManifest({ inventory: noFrontInventory, documents: noFront });

  assert.deepEqual(noFrontSemantic.requirements, [], 'a front is never guessed from a topic table');
  assert.equal(noFrontSemantic.unresolved.length, 1);
  assert.equal(noFrontSemantic.unresolved[0].reason, 'front_not_derivable');
  assert.equal(noFrontSemantic.recommendation, 'pause');

  // A paused manifest can never be projected into a runtime requirement manifest.
  assert.throws(
    () => toAgt002RequirementManifest({ semanticManifest: ambiguous, inventory: ambiguousInventory }),
    /requisito|manifiesto|pausa/i,
    'a manifest with zero resolved requirements must not become a runtime frontier',
  );
}

// ===========================================================================
// 8. A historical four-only V3 result without ready tender-specific analyzed
//    coverage stays PAUSED. The four never become the frontier or the count.
// ===========================================================================
{
  // The V3 run that shipped historically: requirement_manifest == the fixed four, and the
  // snapshot has no ready tender-native analyzed coverage behind it.
  const historicalFourOnlyV3 = { requirement_ids: [...HISTORICAL_FOUR] };

  // (a) No semantic analysis at all for this snapshot.
  const emptyDocuments = [];
  const emptyInventory = inventoryFor('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', emptyDocuments);
  const emptySemantic = buildTenderSemanticManifest({ inventory: emptyInventory, documents: emptyDocuments });
  const emptyFrontier = resolveTenderSemanticFrontier({ semanticManifest: emptySemantic, historicalAnalysis: historicalFourOnlyV3 });

  assert.deepEqual(emptyFrontier.requirement_ids, [], 'the historical four never fill an empty frontier');
  assert.equal(emptyFrontier.requirement_count, 0);
  assert.deepEqual(emptyFrontier.supplemental_signal_ids, [...HISTORICAL_FOUR].sort());
  assert.equal(emptyFrontier.historical_catalog_only, true, 'a four-only run is flagged as a historical catalog, not integral coverage');
  assert.equal(emptyFrontier.decision_ready, false);
  assert.equal(emptyFrontier.recommendation, 'pause');
  assert.equal(emptyFrontier.human_review_required, true);

  // (b) Semantic analysis exists but is not ready (a visible gap in the expediente).
  const partialInventory = inventoryFor(SNAPSHOT_A, tenderADocuments, [{ document_id: 'a-adenda', reason: 'download_failed' }]);
  const partialSemantic = buildTenderSemanticManifest({ inventory: partialInventory, documents: tenderADocuments });
  const partialFrontier = resolveTenderSemanticFrontier({ semanticManifest: partialSemantic, historicalAnalysis: historicalFourOnlyV3 });

  assert.equal(partialSemantic.requirements.length, 3, 'the readable obligations are still derived');
  assert.equal(partialFrontier.requirement_count, 3, 'the count is still the tender\'s own, never four');
  assert.equal(partialFrontier.historical_catalog_only, false);
  assert.equal(partialFrontier.decision_ready, false, 'an incomplete expediente can never be decision ready');
  assert.equal(partialFrontier.recommendation, 'pause');
  for (const historicalId of HISTORICAL_FOUR) {
    assert.equal(partialFrontier.requirement_ids.includes(historicalId), false);
  }

  // (c) The historical four are never accepted as a substitute frontier, even if a caller
  //     tries to pass them as the semantic requirement set.
  assert.throws(
    () => resolveTenderSemanticFrontier({
      semanticManifest: { ...semanticA, requirements: HISTORICAL_FOUR.map(id => ({ requirement_id: id })) },
      historicalAnalysis: historicalFourOnlyV3,
    }),
    /manifiesto|hash|requisito/i,
    'a hand-built four-id "semantic manifest" must not pass the frontier gate',
  );
}

// ===========================================================================
// 9. A MODEL PROPOSAL's label must be literally anchored in the source text of a
//    unit it cites.
//
//    A proposed requirement's ids, hashes and allowlists are all recomputed by the
//    server, so they prove exactly nothing about the label: the server will happily
//    hash whatever text the model wrote. `Capital de trabajo` over a clause that says
//    `Nivel de apalancamiento` is a fully self-consistent manifest and a fabricated
//    obligation. The only thing that can tell them apart is the expediente's own text,
//    so the validator must RECEIVE it — an independent source-text map / the snapshot's
//    documents — and reject a model_proposal label it cannot find verbatim in at least
//    one cited source unit. Every boundary that ACCEPTS a model proposal (persistence,
//    the preview packet) must therefore hand that text over; a boundary that cannot is
//    fail-closed, which is pinned where those boundaries live
//    (tests/agt002-preview-persistence.test.mjs).
// ===========================================================================
{
  const leverage = byKey(semanticA, 'nivel-de-apalancamiento');
  assert.ok(leverage, 'sanity: tender A really does declare the leverage obligation');

  // The governed model-proposal path: the model proposes {kind, label, front, citations}; the
  // server owns identity, hashes and the final validation over exactly these bounded units.
  const modelProposal = label => assembleTenderSemanticManifest({
    inventory: inventoryA,
    documents: tenderADocuments,
    origin: 'model_proposal',
    proposalHash: hash(`propuesta-modelo:${label}`),
    requirements: [{
      kind: 'obligation',
      label,
      front: 'financial',
      front_evidence: { ...leverage.front_evidence },
      citations: leverage.citations.map(citation => ({ ...citation })),
    }],
  });

  // A label the source actually states, checked against the source text itself, passes.
  const anchored = modelProposal('Nivel de apalancamiento');
  assert.deepEqual(
    validateTenderSemanticManifest(anchored, { inventory: inventoryA, documents: tenderADocuments }),
    anchored,
    'a label literally present in a cited source unit is a real, anchored obligation',
  );
  assert.equal(anchored.origin, 'model_proposal');
  assert.match(anchored.proposal_hash, /^[0-9a-f]{64}$/, 'a model proposal always carries its canonicalized proposal hash');

  // An invented label over the very same citations fails closed, even though every id and hash
  // in the manifest was recomputed by the server and is internally consistent.
  assert.throws(
    () => validateTenderSemanticManifest(
      modelProposal('Capital de trabajo'),
      { inventory: inventoryA, documents: tenderADocuments },
    ),
    /etiqueta|literal|texto|fuente|cita|propuesta/i,
    'a proposed label absent from every cited source unit is invented, whatever its hashes say',
  );

  // The source text must be THIS expediente's own: another tender's documents can never stand in
  // as the independent text a label is anchored against.
  assert.throws(
    () => validateTenderSemanticManifest(anchored, { inventory: inventoryA, documents: tenderBDocuments }),
    /texto|fuente|documento|unidad|inventario|manifiesto/i,
    'anchoring is checked against the snapshot\'s own reconstructed source units, never arbitrary text',
  );

  // A structural derivation reads its labels FROM the source text, so it keeps validating
  // standalone: this new requirement is about proposals, not about the deterministic path.
  validateTenderSemanticManifest(semanticA);
  validateTenderSemanticManifest(semanticA, { inventory: inventoryA, documents: tenderADocuments });
}

console.log('tender-native semantic manifest fail-closed contract passed');
