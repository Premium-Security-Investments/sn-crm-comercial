import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
} from '../tender-semantic-label-catalog.js';
import { tenderSemanticObligationKey } from '../tender-semantic-manifest.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { buildAgt002PreviewInput, buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

// AGT-002 V4 semantic discovery, policy v4 — the coverage remediation that follows the derived
// citations (tests/tender-semantic-discovery-derived-citations.test.mjs).
//
// After v3 removed the label/citation relation, the remaining recurring REAL V4 failure was
// `v4_discovery_coverage_invariant`: a schema-valid proposal that classified most of the expediente
// correctly and simply left one or two visible source units off `excluded`/`unresolved`. Rejecting
// it destroyed the whole turn — every correct requirement included — over an omission the model
// cannot see and therefore cannot fix on a retry, and it bought nothing: an unlisted unit is not an
// inference the model got wrong, it is an inference the model never made.
//
// v4 completes that coverage deterministically instead of rejecting it. This file pins the whole
// contract of that completion:
//
//   1. an undispositioned VISIBLE unit is appended to unresolved with the exact
//      {source_unit_id, unit_hash, origin, reason} the manifest contract expects, and with the
//      closed reason `source_unit_not_dispositioned` — nothing about it is inferred;
//   2. the completion is SAFE because it stays visible downstream: the manifest carries the
//      unresolved entry, `decision_ready` is false, discovery coverage is 'partial', and the real
//      analysis packet (agt002-preview-input.js) raises `material_omissions`;
//   3. the append order is deterministic — visible units in source-packet order, then omitted ones
//      — proven against the canonical proposal hash the run itself derives;
//   4. every EXPLICIT model claim is still rejected fail-closed: overlap with a derived citation,
//      a repeated disposition, a repeated obligation, and a foreign/hallucinated source_unit_id;
//   5. an omitted-by-budget unit is completed exactly once, never duplicated;
//   6. the policy version moved to v4, and the policy text tells the model the truth about what an
//      omission costs without ever presenting it as a valid answer.
//
// No provider, network, bridge, DB, environment or UI is touched anywhere below.

const hash = value => createHash('sha256').update(value).digest('hex');

const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const OPPORTUNITY_ID = '11111111-2222-4333-8444-555555555555';

// Five distinct paragraphs, so no candidate is co-owned and every ownership below is unambiguous.
// A single document means the source packet's order is exactly the paragraph order.
const PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros cinco dias habiles de cada mes.',
  'El plazo de ejecucion del contrato sera de doce meses contados a partir del acta de inicio del contrato.',
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad.',
  'Si el proponente es un consorcio, cada integrante debera aportar el certificado de existencia y representacion legal.',
];
const PLIEGO_TEXT = PARAGRAPHS.join('\n\n');

const documents = [{
  document_id: 'pliego',
  document_version_id: 'pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

// The SAME inventory builder the analysis packet uses, so the manifest this file discovers can be
// handed straight to buildAgt002PreviewInput without a second, differently-partitioned inventory.
const inventory = buildAgt002TenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture must produce one analyzable unit per paragraph');

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const unitHashById = new Map(inventory.source_units.map(unit => [unit.source_unit_id, unit.unit_hash]));

// The exact packet order discoverTenderSemanticManifest builds (single document, so the paragraph
// index decides). Every determinism claim below is stated against this order.
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitIdByParagraph = PARAGRAPHS.map(paragraph => {
  const unit = packetUnits.find(entry => entry.text === paragraph);
  assert.ok(unit, `fixture must resolve the source unit for: ${paragraph.slice(0, 40)}`);
  return unit.source_unit_id;
});

const catalog = buildTenderSemanticLabelCatalog({ units: packetUnits, maxCatalogChars: 40_000 });
const ownerIndex = buildTenderSemanticLabelOwnerIndex({
  orderedUnitIds: packetUnits.map(unit => unit.source_unit_id),
  candidatesByUnitId: catalog.candidates_by_unit_id,
});

/** A catalog candidate literally stated by exactly one source unit, and by no other. */
function candidateExclusiveTo(sourceUnitId) {
  const found = catalog.candidates.find(candidate => {
    const owners = ownerIndex.get(candidate) ?? [];
    return owners.length === 1 && owners[0] === sourceUnitId;
  });
  assert.ok(found, `fixture must expose a candidate exclusive to ${sourceUnitId}`);
  return found;
}

const LABEL = candidateExclusiveTo(unitIdByParagraph[0]);

function requirement(label = LABEL) {
  return { kind: 'obligation', label, front: 'technical', category: 'technical' };
}

function fakeClient(proposal) {
  const captured = {};
  return {
    captured,
    run: async request => {
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 2, output_tokens: 3 } };
    },
  };
}

function run(proposal, overrides = {}) {
  return discoverTenderSemanticManifest({
    client: fakeClient(proposal),
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-coverage-completion',
    inventory,
    documents,
    ...overrides,
  });
}

async function assertRejection(promiseFactory, { code, message }) {
  let caught;
  try {
    await promiseFactory();
    assert.fail('expected a rejection but none occurred');
  } catch (error) {
    caught = error;
  }
  assert.match(caught.message, message);
  assert.equal(caught.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(caught.code, code, `expected code "${code}", got "${caught.code}" (message: ${caught.message})`);
  assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(caught.code), 'code must be a closed catalog member');
  return caught;
}

// ---------------------------------------------------------------------------------------------
// 6. The canonical disposition behaviour changed materially, so the policy version moved with it,
//    and the policy text states the new truth without ever making omission an acceptable answer.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v4',
    'a proposal that omits a source unit is now canonicalized differently, which is a material change '
    + 'to this module\'s contract and must bump the policy version',
  );

  // Still asked for in full: the classification duty is what produces a classified expediente.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Dispón todas las source_units exactamente una vez/,
    'the policy must still require every source unit to be dispositioned exactly once',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /No omitas unidades\./,
    'the policy must still tell the model not to omit units',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Clasifica todo lo que el texto recibido te permita clasificar/,
    'the policy must ask the model to classify everything it can',
  );
  // And told the truth about what happens if it omits one anyway.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /el servidor la conservará por su cuenta como unidad sin resolver con la razón "source_unit_not_dispositioned"/,
    'the policy must state that an unlisted visible unit is preserved server-side as unresolved',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /mantiene el análisis en pausa, sin disponibilidad para decidir/,
    'the policy must state that a preserved omission blocks decision readiness',
  );
  // Never as a licence: an omission is not a valid answer and never supports continuing or a GO.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /omitir una unidad nunca es una respuesta válida ni completa/,
    'the policy must forbid treating an omission as a valid or complete answer',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /no declares que una omisión está bien/,
    'the policy must forbid the model declaring an omission acceptable',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /nunca recomiendes continuar ni dar GO sobre un expediente con unidades sin listar/,
    'the policy must forbid recommending GO over an expediente with unlisted units',
  );
}

// ---------------------------------------------------------------------------------------------
// 1. An undispositioned VISIBLE unit is appended to unresolved with the exact id/hash/reason the
//    manifest contract expects — and nothing else about it is invented.
// ---------------------------------------------------------------------------------------------
// Paragraph 0 is claimed by the derived citation, paragraph 1 is explicitly excluded, and
// paragraphs 2/3/4 are simply never mentioned by the proposal.
const FORGOTTEN = unitIdByParagraph.slice(2);
const baseProposal = () => ({
  requirements: [requirement()],
  excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
  unresolved: [],
});

const completed = await run(baseProposal());
{
  assert.equal(completed.semanticManifest.requirements.length, 1, 'the requirement the model got right must survive');
  assert.deepEqual(
    completed.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitIdByParagraph[0]],
    'the derived citation is untouched by the coverage completion',
  );
  assert.deepEqual(
    completed.semanticManifest.excluded.map(entry => entry.source_unit_id),
    [unitIdByParagraph[1]],
    'the explicit exclusion is untouched by the coverage completion',
  );

  // Exactly the manifest's own unresolved shape: server-derived hash, semantic origin, and the
  // closed reason the vocabulary already reserved for a unit nobody dispositioned.
  assert.deepEqual(
    [...completed.semanticManifest.unresolved].sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id)),
    FORGOTTEN
      .map(sourceUnitId => ({
        source_unit_id: sourceUnitId,
        unit_hash: unitHashById.get(sourceUnitId),
        origin: 'semantic',
        reason: 'source_unit_not_dispositioned',
      }))
      .sort((left, right) => left.source_unit_id.localeCompare(right.source_unit_id)),
    'every forgotten visible unit must be preserved with its own inventory hash and the closed reason',
  );

  // Nothing was inferred FOR those units: they earned no requirement, no category and no exclusion.
  assert.equal(completed.semanticManifest.requirements.length, 1);
  assert.equal(Object.keys(completed.categoryOverrides).length, 1);
  assert.equal(
    completed.semanticManifest.excluded.some(entry => FORGOTTEN.includes(entry.source_unit_id)),
    false,
    'a forgotten unit must never be turned into an exclusion the model did not state',
  );
  const citedIds = new Set(completed.semanticManifest.requirements.flatMap(entry => [
    entry.front_evidence.source_unit_id,
    ...entry.citations.map(citation => citation.source_unit_id),
  ]));
  assert.equal(FORGOTTEN.some(sourceUnitId => citedIds.has(sourceUnitId)), false,
    'a forgotten unit must never be turned into evidence for an obligation');
}

// ---------------------------------------------------------------------------------------------
// 2. The completion is SAFE: the omission stays visible and keeps the decision paused, both in the
//    manifest itself and in the real analysis packet that consumes it.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(completed.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(completed.semanticManifest.coverage_ledger.unresolved_count, FORGOTTEN.length);
  assert.equal(completed.semanticManifest.discovery_coverage.status, 'partial',
    'a preserved omission must keep discovery coverage partial, never complete');
  assert.equal(completed.semanticManifest.decision_ready, false);
  assert.equal(completed.semanticManifest.recommendation, 'pause');
  assert.equal(completed.semanticManifest.human_review_required, true);

  // The downstream signal, exercised through the real packet builder rather than asserted about.
  // The packet-level flag is an OR over several omission sources, so the assertions below pin both
  // that it is raised AND that the manifest it was raised from still carries the preserved
  // omissions verbatim — the semantic contribution is not inferred from the flag alone.
  const previewInput = buildAgt002PreviewInput({
    snapshotId: SNAPSHOT_ID,
    contextV2: true,
    documentRetrieval: true,
    documents,
    documentGaps: [],
    deepAnalysis: {},
    contextV2Sections: {
      ...buildAgt002OpportunityContextV2({
        opportunity: { id: OPPORTUNITY_ID, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-23T00:00:00.000Z' },
        tender: {
          id: 'tender-coverage', title: 'Proceso COBERTURA-01-2026', entity: 'Entidad',
          source: 'SECOP II', updated_at: '2026-08-23T00:00:00.000Z',
        },
      }),
      company_dossier: buildAgt002CompanyDossier({
        profile: { legal_name: 'Seguridad Nacional', updated_at: '2026-08-23T00:00:00.000Z' },
        documents: [],
      }),
    },
    semanticManifest: completed.semanticManifest,
  });
  assert.equal(
    previewInput.document_evidence.material_omissions,
    true,
    'a preserved omission must reach the analysis packet as a declared material omission',
  );
  assert.deepEqual(
    previewInput.document_evidence.tender_semantic_manifest.unresolved.map(entry => entry.reason),
    FORGOTTEN.map(() => 'source_unit_not_dispositioned'),
    'the packet must carry the preserved omissions verbatim, not a re-derived or cleaned manifest',
  );
  assert.equal(previewInput.document_evidence.tender_semantic_manifest.decision_ready, false);
}

// ---------------------------------------------------------------------------------------------
// 3. The append order is deterministic: visible units in source-packet order, then omitted ones.
//
// The canonical proposal (requirements + excluded + unresolved + categories) is what the run
// hashes into `proposal_hash`, and `unresolved` is an ORDERED list there — so reconstructing that
// hash is a direct, byte-level assertion about the order the completion appended in. Every other
// ordering of the same units must produce a different hash, and does.
// ---------------------------------------------------------------------------------------------
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function proposalHashForUnresolvedOrder(orderedUnitIds, { excludedIds = [unitIdByParagraph[1]] } = {}) {
  return hash(JSON.stringify(stable({
    requirements: [{
      kind: 'obligation',
      label: LABEL,
      front: 'technical',
      front_evidence: { source_unit_id: unitIdByParagraph[0], unit_hash: unitHashById.get(unitIdByParagraph[0]) },
      citations: [{ source_unit_id: unitIdByParagraph[0], unit_hash: unitHashById.get(unitIdByParagraph[0]) }],
    }],
    excluded: excludedIds.map(sourceUnitId => ({ source_unit_id: sourceUnitId, reason: 'descriptive_or_contextual' })),
    unresolved: orderedUnitIds.map(sourceUnitId => ({ source_unit_id: sourceUnitId, reason: 'source_unit_not_dispositioned' })),
    categories: { [tenderSemanticObligationKey(LABEL)]: 'technical' },
  })));
}

function permutationsOf(items) {
  if (items.length <= 1) return [[...items]];
  const result = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const permutation of permutationsOf(rest)) result.push([items[index], ...permutation]);
  }
  return result;
}

{
  assert.equal(
    completed.semanticManifest.proposal_hash,
    proposalHashForUnresolvedOrder(FORGOTTEN),
    'the completion must append the forgotten units in source-packet order',
  );
  // Exactly one ordering reproduces the run's own canonical proposal, and it is the packet order —
  // so the order is a fixed property of the packet, not an accident of iteration.
  for (const permutation of permutationsOf(FORGOTTEN)) {
    const isPacketOrder = permutation.every((sourceUnitId, index) => sourceUnitId === FORGOTTEN[index]);
    assert.equal(
      proposalHashForUnresolvedOrder(permutation) === completed.semanticManifest.proposal_hash,
      isPacketOrder,
      `only the source-packet order may reproduce the canonical proposal hash: ${permutation.join(',')}`,
    );
  }

  // And the whole run is reproducible: same snapshot + same proposal => byte-identical manifest.
  const again = await run(baseProposal());
  assert.equal(again.semanticManifest.proposal_hash, completed.semanticManifest.proposal_hash);
  assert.equal(again.semanticManifest.semantic_manifest_hash, completed.semanticManifest.semantic_manifest_hash);
}

// ---------------------------------------------------------------------------------------------
// 5. An omitted-by-budget unit is completed exactly once, after the visible ones, never duplicated.
// ---------------------------------------------------------------------------------------------
{
  // A source budget that fits exactly the first three paragraphs. The label catalog keeps its own
  // ample budget, so this exercises omission and not the catalog's fail-closed coverage gate.
  const maxSourceChars = PARAGRAPHS.slice(0, 3).reduce((total, paragraph) => total + paragraph.length, 0);
  const client = fakeClient(baseProposal());
  const budgeted = await discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-coverage-completion-budget',
    inventory,
    documents,
    maxSourceChars,
    maxLabelCatalogChars: 40_000,
  });

  assert.deepEqual(
    client.captured.request.input.source_units.map(unit => unit.source_unit_id),
    unitIdByParagraph.slice(0, 3),
    'only the first three paragraphs may fit the source budget',
  );
  assert.deepEqual(
    client.captured.request.input.omitted_source_unit_ids,
    unitIdByParagraph.slice(3),
    'the remaining paragraphs are declared omitted to the model',
  );

  // Paragraph 2 was visible and unlisted; paragraphs 3/4 were never shown at all. All three are
  // completed, under the same closed reason, and each appears exactly once.
  const unresolvedIds = budgeted.semanticManifest.unresolved.map(entry => entry.source_unit_id);
  assert.equal(new Set(unresolvedIds).size, unresolvedIds.length, 'no unit may be completed twice');
  assert.deepEqual(
    [...unresolvedIds].sort(),
    [...unitIdByParagraph.slice(2)].sort(),
    'the unlisted visible unit and both omitted units must each be preserved once',
  );
  assert.equal(
    budgeted.semanticManifest.unresolved.every(entry => entry.reason === 'source_unit_not_dispositioned'),
    true,
  );
  // Visible-then-omitted, each group in packet order — pinned through the canonical proposal hash.
  assert.equal(
    budgeted.semanticManifest.proposal_hash,
    proposalHashForUnresolvedOrder(unitIdByParagraph.slice(2)),
    'the completion must append the unlisted visible unit before the omitted ones',
  );
  assert.equal(budgeted.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(budgeted.semanticManifest.decision_ready, false);

  // An omitted unit is not a visible unit, so naming one is still an inventory violation — there is
  // no path by which a model-supplied entry and the completion could ever both land on it.
  await assertRejection(
    () => run(
      {
        requirements: [requirement()],
        excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
        unresolved: [{ source_unit_id: unitIdByParagraph[3], reason: 'obligation_not_classifiable' }],
      },
      { maxSourceChars, maxLabelCatalogChars: 40_000 },
    ),
    { code: 'v4_discovery_inventory_invariant', message: /source_unit no permitida/ },
  );
}

// ---------------------------------------------------------------------------------------------
// 4. Completing an omission is NOT repairing a claim: every explicit overlap, duplicate and foreign
//    reference is still rejected fail-closed, exactly as under v3.
// ---------------------------------------------------------------------------------------------
{
  // Overlap with a DERIVED citation — the model dispositioned a unit its own label already claims.
  for (const [field, entry] of [
    ['excluded', { source_unit_id: unitIdByParagraph[0], reason: 'duplicate_source_unit' }],
    ['unresolved', { source_unit_id: unitIdByParagraph[0], reason: 'obligation_not_classifiable' }],
  ]) {
    await assertRejection(
      () => run({ ...baseProposal(), [field]: [entry] }),
      { code: 'v4_discovery_uniqueness_invariant', message: /disposición duplicada/ },
    );
  }

  // The same unit dispositioned twice, within one list and across both.
  await assertRejection(
    () => run({
      requirements: [requirement()],
      excluded: [
        { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
        { source_unit_id: unitIdByParagraph[1], reason: 'not_an_obligation' },
      ],
      unresolved: [],
    }),
    { code: 'v4_discovery_uniqueness_invariant', message: /disposición duplicada/ },
  );
  await assertRejection(
    () => run({
      requirements: [requirement()],
      excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
      unresolved: [{ source_unit_id: unitIdByParagraph[1], reason: 'obligation_not_classifiable' }],
    }),
    { code: 'v4_discovery_uniqueness_invariant', message: /disposición duplicada/ },
  );

  // The same obligation proposed twice. Nothing is merged, deduplicated or completed around it.
  await assertRejection(
    () => run({ ...baseProposal(), requirements: [requirement(), requirement()] }),
    { code: 'v4_discovery_uniqueness_invariant', message: /obligación vacía o duplicada/ },
  );

  // A hallucinated id, and an id belonging to another snapshot's inventory.
  const foreignInventory = buildAgt002TenderRequirementInventory({
    snapshotId: '66666666-6666-4666-8666-666666666666',
    documents,
    documentGaps: [],
  });
  const foreignId = foreignInventory.source_units[0].source_unit_id;
  assert.equal(
    inventory.source_units.some(unit => unit.source_unit_id === foreignId), false,
    'fixture must expose a source_unit_id that belongs to another snapshot only',
  );
  for (const strangeId of ['hallucinated-source-unit-id', foreignId]) {
    await assertRejection(
      () => run({ ...baseProposal(), excluded: [{ source_unit_id: strangeId, reason: 'descriptive_or_contextual' }] }),
      { code: 'v4_discovery_inventory_invariant', message: /source_unit no permitida/ },
    );
  }

  // And a label outside this snapshot's literal catalog still has no derivable provenance at all:
  // the coverage completion never becomes a place to park an unanchorable requirement.
  await assertRejection(
    () => run({ ...baseProposal(), requirements: [requirement('experiencia en el ambito de vigilancia para hospitales')] }),
    { code: 'v4_discovery_citation_anchor_invariant', message: /anclada literalmente/ },
  );
}

console.log('tests/tender-semantic-discovery-coverage-completion.test.mjs OK');
