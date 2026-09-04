import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE,
  TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
} from '../tender-semantic-label-catalog.js';
import {
  tenderSemanticObligationKey,
  toAgt002RequirementManifest,
  validateTenderSemanticManifest,
} from '../tender-semantic-manifest.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';

// AGT-002 V3 semantic discovery, policy v8 — intra-batch contradiction retraction.
//
// The real failure this file pins (job bb7876bb-297e-4d0d-baf3-d79a5151a973, Procuraduria canary,
// gpt-5.6-luna low, 13-document snapshot): the bridge answered in ~120 s, the FIRST batch's answer
// was rejected here at semantic_validation under `v4_discovery_uniqueness_invariant`, and — because
// any per-batch failure fails the whole discovery closed — the run died whole. No later batch was
// ever requested, there was no analysis_run, nothing was persisted, and the job ended
// unavailable/invalid_output. Raw output is never stored and there is no wire-level replay, so the
// exact sentence is unrecoverable; both gates that mint that code named the same structural fact,
// which is that the model contradicted ITSELF inside one batch — about one obligation (the same
// catalog label with a different kind/front/category) or about one unit (two dispositions, or a
// disposition over a unit its own label already binds).
//
// The asymmetry is the bug: `mergeBatchProposals` has always resolved the IDENTICAL contradiction
// across batches without burning anything — every conflicting occurrence is retracted and its units
// fall to the coverage completion as visible `unresolved` holes — while the same contradiction one
// request earlier was fatal for the whole expediente. This file pins the fix and its limits:
//
//   1. a batch that contradicts itself about ONE obligation no longer kills the run: every later
//      batch is still requested, every OTHER obligation survives, and the contradicted one is
//      retracted in full — no category/front/kind is ever chosen — with its units completed into
//      `unresolved`/`source_unit_not_dispositioned`;
//   2. a unit carrying two DIFFERENT dispositions is not arbitrated either: `excluded` is never
//      preferred over `unresolved` (nor the reverse), both are retracted, and the unit falls to the
//      same completion;
//   3. a disposition over a unit a proposed label already binds is retracted without ever moving,
//      dropping or re-deriving the server-owned citation;
//   4. EXACT repeats still coalesce — of an obligation (v6) and of a disposition — and nothing else
//      is ever merged;
//   5. retraction can only ever make a run LESS decidable: coverage stays 'partial', decision_ready
//      stays false, and an expediente whose whole frontier was contradicted is still rejected
//      fail-closed at the v5 zero-requirements boundary rather than analysed against nothing;
//   6. every CORRUPTION gate is unchanged and still fails the run closed (foreign id, reason/front/
//      kind outside its closed vocabulary, label outside the batch's literal catalog, smuggled
//      source ids, invalid shape);
//   7. traceability does not degrade: the retraction is reported as safe COUNTS on the discovery
//      ledger — never an id, a label, a reason or a fragment of the expediente.
//
// No provider, network, bridge, DB, environment or UI is touched: every client below is a local fake.

const hash = value => createHash('sha256').update(value).digest('hex');

function requirement(label, overrides = {}) {
  return { kind: 'obligation', label, front: 'technical', category: 'technical', ...overrides };
}

async function assertRejection(promiseFactory, { code, message }) {
  let caught;
  try {
    await promiseFactory();
    assert.fail('expected a rejection but none occurred');
  } catch (error) {
    caught = error;
  }
  if (message) assert.match(caught.message, message);
  assert.equal(caught.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(caught.code, code, `expected code "${code}", got "${caught.code}" (message: ${caught.message})`);
  assert.ok(TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(caught.code), 'code must be a closed catalog member');
  return caught;
}

// ---------------------------------------------------------------------------------------------
// 0. The canonical handling of a provider answer changed again, so the policy version moved, and the
//    policy tells the model the truth about what a contradiction now costs instead of threatening a
//    rejection that no longer happens. It keeps ASKING for one claim per obligation and one
//    disposition per unit: retraction is a worse outcome for the expediente, never a permission.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v9',
    'v8 changed how a contradictory answer is canonicalized and what the policy states about it, and '
    + 'v9 lowered the per-batch source-char budget (changing the batch plan itself) — the policy '
    + 'version must move with the more recent change too',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /el servidor no elige entre las versiones en conflicto: retira todas sus ocurrencias/,
    'the policy must state that a conflicting obligation is retracted in full, never arbitrated',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /las unidades que la sustentaban quedan sin resolver, con el análisis en pausa/,
    'the policy must state that the units of a retracted obligation stay unresolved and keep the run paused',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Si una unidad recibe disposiciones distintas, el servidor tampoco elige entre ellas: las retira todas y esa unidad queda sin resolver/,
    'the policy must state that conflicting dispositions over one unit are all retracted',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /una disposición adicional sobre ella se retira sin alterar la cita/,
    'the policy must state that a disposition overlapping a derived citation is retracted, never the citation',
  );
  // The threat that no longer describes anything this module does must be gone, or the policy is
  // lying to the model about a rejection it will never issue.
  assert.doesNotMatch(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /con algún campo distinto, se rechaza toda la propuesta/,
    'the policy must no longer claim a conflicting repetition rejects the whole proposal',
  );
  // The unchanged demands survive: nothing here invites a contradiction.
  assert.match(TENDER_SEMANTIC_DISCOVERY_POLICY, /Propón cada obligación semántica una sola vez/);
  assert.match(TENDER_SEMANTIC_DISCOVERY_POLICY, /Ninguna unidad puede recibir más de una disposición/);
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Si repites una obligación con exactamente el mismo "label", "kind", "front" y "category", el servidor la canoniza una sola vez sin contarla dos veces/,
    'the exact-repeat coalescing sentence (v6) is unchanged',
  );
}

// =============================================================================================
// FIXTURE A — three documents of one paragraph each, with a per-batch budget sized to exactly one
// paragraph. The planner is round-major by document, so this yields three batches of one unit each:
// the smallest possible corpus in which "the first batch's answer killed every later batch" is
// observable at all.
// =============================================================================================
const MULTI_PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos anos consecutivos ante la entidad contratante.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros dias habiles de cada mes calendario del contrato suscrito.',
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad contratante responsable del proceso.',
];
const multiDocuments = MULTI_PARAGRAPHS.map((text, index) => ({
  document_id: `doc-${'abc'[index]}`,
  document_version_id: `doc-${'abc'[index]}-v1`,
  content_hash: hash(text),
  extracted_text: text,
}));
const multiInventory = buildTenderRequirementInventory({
  snapshotId: '88888888-8888-4888-8888-888888888008',
  documents: multiDocuments,
  documentGaps: [],
});
assert.equal(multiInventory.source_units.length, 3, 'fixture A must produce exactly one analyzable unit per document');

const multiResolved = resolveTenderInventorySourceTexts({ inventory: multiInventory, documents: multiDocuments });
const multiUnitHashById = new Map(multiInventory.source_units.map(unit => [unit.source_unit_id, unit.unit_hash]));
// None of the fixture text contains a redaction trigger, so the resolved length is exactly what the
// planner measures. One paragraph's worth of budget forces one paragraph per batch.
const multiBudget = Math.max(...[...multiResolved.values()].map(value => value.text.length));

/**
 * Local fake provider. `proposalFor(request, batchIndex, enumLabels)` decides what each batch
 * answers, so a single batch can be made to contradict itself while the others answer cleanly.
 */
function batchScriptedClient(proposalFor) {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      const enumLabels = request.outputSchema.properties.requirements.items.properties.label.enum;
      return {
        content: JSON.stringify(proposalFor(request, request.input.batch.index, enumLabels)),
        usage: { input_tokens: 5, output_tokens: 5, cost_usd: 0 },
      };
    },
  };
}

function runMulti(client, idempotencyKey) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey,
    inventory: multiInventory,
    documents: multiDocuments,
    maxSourceChars: multiBudget,
    maxLabelCatalogChars: 40_000,
  });
}

// The reference run: every batch answers coherently with one obligation of its own. It fixes what
// "nothing was lost" means for the contradicting run below.
const coherentClient = batchScriptedClient((request, batchIndex, enumLabels) => ({
  requirements: [requirement(enumLabels[0])],
  excluded: [],
  unresolved: [],
}));
const coherent = await runMulti(coherentClient, 'idem-v8-coherent');
assert.equal(coherentClient.requests.length, 3, 'fixture A must split into exactly three provider requests');
assert.equal(coherent.discoveryLedger.batch_count, 3);
coherentClient.requests.forEach((request, index) => {
  assert.equal(request.input.source_units.length, 1, 'fixture A must send exactly one source unit per batch');
  assert.equal(request.input.batch.index, index);
});
assert.equal(coherent.semanticManifest.requirements.length, 3, 'each coherent batch must contribute its own obligation');

const batchLabels = coherentClient.requests
  .map(request => request.outputSchema.properties.requirements.items.properties.label.enum[0]);
const batchUnitIds = coherentClient.requests
  .map(request => request.input.source_units.map(unit => unit.source_unit_id));
const batchKeys = batchLabels.map(label => tenderSemanticObligationKey(label));
assert.equal(new Set(batchKeys).size, 3, 'fixture A must expose three distinct obligation keys, one per batch');

// ---------------------------------------------------------------------------------------------
// 1. THE REAL FAILURE. Batch 0 states one obligation twice with conflicting categories. Before v8
//    this threw `v4_discovery_uniqueness_invariant` at semantic_validation, batches 1 and 2 were
//    never requested and the whole run died. Now: the run completes, every later batch IS requested,
//    the contradicted obligation is retracted in full, and its unit becomes a visible hole.
// ---------------------------------------------------------------------------------------------
const conflictingClient = batchScriptedClient((request, batchIndex, enumLabels) => (
  batchIndex === 0
    ? {
      requirements: [requirement(enumLabels[0]), requirement(enumLabels[0], { category: 'habilitating' })],
      excluded: [],
      unresolved: [],
    }
    : { requirements: [requirement(enumLabels[0])], excluded: [], unresolved: [] }
));
const contradicted = await runMulti(conflictingClient, 'idem-v8-intra-batch-conflict');

assert.equal(
  conflictingClient.requests.length, 3,
  'a batch that contradicts itself must not prevent every later batch from ever being requested',
);
assert.equal(contradicted.discoveryLedger.status, 'completed');
assert.equal(contradicted.discoveryLedger.batches.length, 3);
assert.ok(
  contradicted.discoveryLedger.batches.every(entry => entry.status === 'completed'),
  'a retracted contradiction is not a batch failure: the batch answered and was canonicalized',
);

// The contradicted obligation is gone — not resolved to either category.
assert.equal(
  contradicted.semanticManifest.requirements.some(entry => entry.obligation_key === batchKeys[0]),
  false,
  'the contradicted obligation must be retracted entirely, never resolved to one of the two categories',
);
assert.deepEqual(
  contradicted.semanticManifest.requirements.map(entry => entry.obligation_key).sort(),
  [batchKeys[1], batchKeys[2]].sort(),
  'every obligation the OTHER batches got right must survive the contradiction in batch 0',
);
assert.deepEqual(
  Object.values(contradicted.categoryOverrides).sort(),
  ['technical', 'technical'],
  'no category override may survive for a retracted obligation',
);

// Its unit falls to the ONE completion pass, with the same closed reason every other hole carries.
const contradictedUnresolved = new Map(
  contradicted.semanticManifest.unresolved.map(entry => [entry.source_unit_id, entry]),
);
for (const sourceUnitId of batchUnitIds[0]) {
  assert.deepEqual(
    contradictedUnresolved.get(sourceUnitId),
    {
      source_unit_id: sourceUnitId,
      unit_hash: multiUnitHashById.get(sourceUnitId),
      origin: 'semantic',
      reason: 'source_unit_not_dispositioned',
    },
    'a unit orphaned by a retracted obligation must be preserved as an explicit, visible hole',
  );
  assert.equal(
    contradicted.semanticManifest.excluded.some(entry => entry.source_unit_id === sourceUnitId), false,
    'a retraction must never turn a unit into an exclusion nobody stated',
  );
}

// Retraction can only make the run LESS decidable, never more.
assert.equal(contradicted.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
assert.equal(contradicted.semanticManifest.discovery_coverage.status, 'partial');
assert.equal(contradicted.semanticManifest.decision_ready, false);
assert.equal(contradicted.semanticManifest.recommendation, 'pause');
assert.equal(contradicted.semanticManifest.human_review_required, true);
assert.ok(
  contradicted.semanticManifest.unresolved.length > coherent.semanticManifest.unresolved.length,
  'a contradicted expediente must end with MORE visible holes than the coherent one, never fewer',
);
assert.ok(
  contradicted.semanticManifest.requirements.length < coherent.semanticManifest.requirements.length,
  'a retracted obligation must not be replaced by anything',
);
validateTenderSemanticManifest(contradicted.semanticManifest, { inventory: multiInventory, documents: multiDocuments });

// The surviving obligations are byte-identical to the ones the coherent run produced: nothing was
// re-derived, re-numbered or re-anchored around the retraction.
const coherentById = new Map(coherent.semanticManifest.requirements.map(entry => [entry.requirement_id, entry]));
for (const entry of contradicted.semanticManifest.requirements) {
  assert.deepEqual(entry, coherentById.get(entry.requirement_id), 'a surviving requirement must be untouched by the retraction');
}

// 7. Traceability: safe COUNTS, and nothing else.
assert.deepEqual(
  contradicted.discoveryLedger.retractions,
  { conflicting_obligation_keys: 1, retracted_requirement_occurrences: 2 },
  'the ledger must account for the retraction in counts a diagnostic consumer can read',
);
assert.deepEqual(
  coherent.discoveryLedger.retractions,
  { conflicting_obligation_keys: 0, retracted_requirement_occurrences: 0 },
  'a coherent run must report zero retractions, never an absent accounting',
);
assert.ok(
  contradicted.discoveryLedger.batches.every(entry => entry.retracted_disposition_units === 0),
  'no disposition was retracted in this run, and the per-batch count must say so',
);
{
  const serialized = JSON.stringify(contradicted.discoveryLedger);
  for (const secret of [...MULTI_PARAGRAPHS, ...batchLabels, 'habilitating', 'technical', 'source_unit_not_dispositioned']) {
    assert.ok(
      !serialized.includes(secret),
      'the ledger must never carry source text, a label, a category or a disposition reason',
    );
  }
}

// Determinism: the same contradiction re-run produces the same manifest, bit for bit.
{
  const repeat = await runMulti(
    batchScriptedClient((request, batchIndex, enumLabels) => (
      batchIndex === 0
        ? {
          requirements: [requirement(enumLabels[0]), requirement(enumLabels[0], { category: 'habilitating' })],
          excluded: [],
          unresolved: [],
        }
        : { requirements: [requirement(enumLabels[0])], excluded: [], unresolved: [] }
    )),
    'idem-v8-intra-batch-conflict',
  );
  assert.equal(
    repeat.semanticManifest.semantic_manifest_hash,
    contradicted.semanticManifest.semantic_manifest_hash,
    'retraction must be deterministic: the same answer must re-derive the same manifest',
  );
}

// ---------------------------------------------------------------------------------------------
// 1b. A contradiction is retracted GLOBALLY, not per batch: an obligation this expediente also
//     stated coherently somewhere else is still retracted, because the module has two irreconcilable
//     claims about it and never picks. Two documents share one clause verbatim, so the same catalog
//     label reaches two different batches' enums.
// ---------------------------------------------------------------------------------------------
{
  const SHARED_CLAUSE = 'El contratista entregara un informe mensual de operaciones detallado para su verificacion';
  const sharedParagraphs = [
    `Documento tecnico primero de la entidad contratante. ${SHARED_CLAUSE}.`,
    `Documento tecnico segundo de la entidad contratante. ${SHARED_CLAUSE}.`,
  ];
  const sharedDocuments = sharedParagraphs.map((text, index) => ({
    document_id: `doc-shared-${index}`,
    document_version_id: `doc-shared-${index}-v1`,
    content_hash: hash(text),
    extracted_text: text,
  }));
  const sharedInventory = buildTenderRequirementInventory({
    snapshotId: '88888888-8888-4888-8888-888888888009',
    documents: sharedDocuments,
    documentGaps: [],
  });
  assert.equal(sharedInventory.source_units.length, 2, 'fixture must produce one analyzable unit per document');
  const sharedResolved = resolveTenderInventorySourceTexts({ inventory: sharedInventory, documents: sharedDocuments });
  const sharedBudget = Math.max(...[...sharedResolved.values()].map(value => value.text.length));

  const sharedClient = batchScriptedClient((request, batchIndex, enumLabels) => {
    assert.ok(
      enumLabels.includes(SHARED_CLAUSE),
      'fixture must offer the shared clause in EVERY batch\'s own literal catalog',
    );
    return batchIndex === 0
      ? {
        requirements: [
          requirement(SHARED_CLAUSE),
          requirement(SHARED_CLAUSE, { front: 'legal' }),
        ],
        excluded: [],
        unresolved: [],
      }
      : { requirements: [requirement(SHARED_CLAUSE)], excluded: [], unresolved: [] };
  });

  await assertRejection(
    () => discoverTenderSemanticManifest({
      client: sharedClient,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-v8-cross-batch-propagation',
      inventory: sharedInventory,
      documents: sharedDocuments,
      maxSourceChars: sharedBudget,
      maxLabelCatalogChars: 40_000,
    }),
    { code: TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE, message: /no identificó ninguna obligación propia/ },
  );
  assert.equal(sharedClient.requests.length, 2, 'both batches must still be requested before the merged frontier is judged');
}

// =============================================================================================
// FIXTURE B — one document, five distinct paragraphs, default budget: a single batch, which is
// where every disposition case is stated most directly.
// =============================================================================================
const SNAPSHOT_ID = '88888888-8888-4888-8888-888888888010';
const OPPORTUNITY_ID = '11111111-2222-4333-8444-888888888010';
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

const inventory = buildAgt002TenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture B must produce one analyzable unit per paragraph');
const unitHashById = new Map(inventory.source_units.map(unit => [unit.source_unit_id, unit.unit_hash]));
const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitIdByParagraph = PARAGRAPHS.map(paragraph => {
  const unit = packetUnits.find(entry => entry.text === paragraph);
  assert.ok(unit, 'fixture B must resolve every paragraph to its own source unit');
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
  assert.ok(found, `fixture B must expose a candidate exclusive to ${sourceUnitId}`);
  return found;
}
const LABEL = candidateExclusiveTo(unitIdByParagraph[0]);

function singleBatchClient(proposal) {
  const requests = [];
  return {
    requests,
    run: async request => {
      requests.push(request);
      return { content: JSON.stringify(proposal), usage: { input_tokens: 2, output_tokens: 3, cost_usd: 0 } };
    },
  };
}

function runWithClient(proposal) {
  const client = singleBatchClient(proposal);
  return {
    client,
    result: discoverTenderSemanticManifest({
      client,
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-v8-dispositions',
      inventory,
      documents,
    }),
  };
}

function run(proposal) {
  return runWithClient(proposal).result;
}

/** The unresolved entry the completion pass owes a unit nobody validly dispositioned. */
function completionHole(sourceUnitId) {
  return {
    source_unit_id: sourceUnitId,
    unit_hash: unitHashById.get(sourceUnitId),
    origin: 'semantic',
    reason: 'source_unit_not_dispositioned',
  };
}

// The coherent reference for fixture B: one obligation on paragraph 0, one explicit exclusion on
// paragraph 1, everything else unlisted.
const baseline = await run({
  requirements: [requirement(LABEL)],
  excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
  unresolved: [],
});
assert.equal(baseline.semanticManifest.requirements.length, 1);
assert.deepEqual(baseline.semanticManifest.excluded.map(entry => entry.source_unit_id), [unitIdByParagraph[1]]);
assert.equal(baseline.discoveryLedger.batches.length, 1, 'fixture B must be a single batch');
assert.equal(baseline.discoveryLedger.batches[0].retracted_disposition_units, 0);

// ---------------------------------------------------------------------------------------------
// 2. A unit carrying two DIFFERENT dispositions is not arbitrated: both are retracted and the unit
//    falls to the completion. `excluded` never wins over `unresolved`, in either order, and the
//    model's own reason is never adopted for it.
// ---------------------------------------------------------------------------------------------
for (const [caseName, dispositions] of [
  ['twice in excluded', {
    excluded: [
      { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
      { source_unit_id: unitIdByParagraph[1], reason: 'not_an_obligation' },
    ],
    unresolved: [],
  }],
  ['twice in unresolved', {
    excluded: [],
    unresolved: [
      { source_unit_id: unitIdByParagraph[1], reason: 'obligation_not_classifiable' },
      { source_unit_id: unitIdByParagraph[1], reason: 'front_not_derivable' },
    ],
  }],
  ['once in each list', {
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitIdByParagraph[1], reason: 'obligation_not_classifiable' }],
  }],
  ['once in each list, reversed order', {
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'not_an_obligation' }],
    unresolved: [{ source_unit_id: unitIdByParagraph[1], reason: 'front_not_supported' }],
  }],
]) {
  const pending = runWithClient({ requirements: [requirement(LABEL)], ...dispositions });
  const result = await pending.result;

  assert.equal(pending.client.requests.length, 1, `${caseName}: a contradiction must be resolved locally, with no retry`);
  assert.equal(
    result.semanticManifest.excluded.some(entry => entry.source_unit_id === unitIdByParagraph[1]), false,
    `${caseName}: a contradicted unit must never be filed as an exclusion`,
  );
  assert.deepEqual(
    result.semanticManifest.unresolved.find(entry => entry.source_unit_id === unitIdByParagraph[1]),
    completionHole(unitIdByParagraph[1]),
    `${caseName}: a contradicted unit must fall to the completion with the closed reason, never with either claimed reason`,
  );
  // The obligation the model got right is untouched by the disposition contradiction.
  assert.deepEqual(
    result.semanticManifest.requirements,
    baseline.semanticManifest.requirements,
    `${caseName}: a disposition contradiction must not disturb an unrelated obligation`,
  );
  assert.equal(result.semanticManifest.decision_ready, false);
  assert.equal(result.semanticManifest.coverage_ledger.every_source_unit_disposed, true);
  assert.equal(
    result.discoveryLedger.batches[0].retracted_disposition_units, 1,
    `${caseName}: the ledger must count exactly one unit whose dispositions were retracted`,
  );
  assert.deepEqual(
    result.discoveryLedger.retractions,
    { conflicting_obligation_keys: 0, retracted_requirement_occurrences: 0 },
    `${caseName}: a disposition retraction is not an obligation retraction`,
  );
  validateTenderSemanticManifest(result.semanticManifest, { inventory, documents });
}

// ---------------------------------------------------------------------------------------------
// 3. A disposition over a unit a proposed label already binds is retracted — and the server-derived
//    citation is never moved, dropped or re-derived to accommodate it.
// ---------------------------------------------------------------------------------------------
for (const [field, overlap] of [
  ['excluded', { source_unit_id: unitIdByParagraph[0], reason: 'duplicate_source_unit' }],
  ['unresolved', { source_unit_id: unitIdByParagraph[0], reason: 'obligation_not_classifiable' }],
]) {
  // Paragraph 0 is the unit LABEL binds; paragraph 1 carries an ordinary, valid exclusion that must
  // survive untouched beside the retraction.
  const proposal = {
    requirements: [requirement(LABEL)],
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
    unresolved: [],
  };
  proposal[field] = [...proposal[field], overlap];
  const overlapping = await run(proposal);

  assert.deepEqual(
    overlapping.semanticManifest.requirements,
    baseline.semanticManifest.requirements,
    `${field}: the derived citation must be exactly the one the coherent proposal produced`,
  );
  assert.deepEqual(
    overlapping.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitIdByParagraph[0]],
    `${field}: the cited unit stays cited; the contradictory disposition is what is retracted`,
  );
  assert.equal(
    overlapping.semanticManifest.unresolved.some(entry2 => entry2.source_unit_id === unitIdByParagraph[0]), false,
    `${field}: a unit covered by a surviving citation is not a hole`,
  );
  assert.equal(
    overlapping.semanticManifest.excluded.some(entry2 => entry2.source_unit_id === unitIdByParagraph[0]), false,
    `${field}: the retracted disposition must leave no trace`,
  );
  // The unrelated, valid exclusion of paragraph 1 is untouched.
  assert.deepEqual(
    overlapping.semanticManifest.excluded.map(entry2 => entry2.source_unit_id),
    [unitIdByParagraph[1]],
    `${field}: retracting one unit's dispositions must not disturb another unit's valid one`,
  );
  assert.equal(overlapping.discoveryLedger.batches[0].retracted_disposition_units, 1);
  assert.equal(
    overlapping.semanticManifest.proposal_hash, baseline.semanticManifest.proposal_hash,
    `${field}: a fully retracted contradiction must leave the canonical proposal byte-identical`,
  );
}

// ---------------------------------------------------------------------------------------------
// 4. EXACT repeats still coalesce and nothing else does — of a disposition here, of an obligation in
//    tests/tender-semantic-discovery-v6-repeat-coalescing.test.mjs.
// ---------------------------------------------------------------------------------------------
{
  const repeatedDisposition = await run({
    requirements: [requirement(LABEL)],
    excluded: [
      { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
      { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
      { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
    ],
    unresolved: [],
  });
  assert.deepEqual(
    repeatedDisposition.semanticManifest.excluded,
    baseline.semanticManifest.excluded,
    'an identical restatement of one disposition is one claim: it stays, exactly once, as stated',
  );
  assert.equal(
    repeatedDisposition.discoveryLedger.batches[0].retracted_disposition_units, 0,
    'coalescing an exact repeat is not a retraction',
  );
  assert.equal(
    repeatedDisposition.semanticManifest.proposal_hash, baseline.semanticManifest.proposal_hash,
    'a restated disposition must leave no trace in what is persisted',
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Retraction never buys a decision. An expediente whose ONLY obligation is contradicted resolves
//    no frontier at all, and is still rejected fail-closed at the v5 zero-requirements boundary
//    rather than analysed against nothing.
// ---------------------------------------------------------------------------------------------
await assertRejection(
  () => run({
    requirements: [requirement(LABEL), requirement(LABEL, { kind: 'restriction' })],
    excluded: [],
    unresolved: [],
  }),
  { code: TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE, message: /no identificó ninguna obligación propia/ },
);

// ---------------------------------------------------------------------------------------------
// 6. Every CORRUPTION gate is unchanged: retraction covers self-contradiction only, never an answer
//    this module cannot represent at all.
// ---------------------------------------------------------------------------------------------
{
  const foreignInventory = buildAgt002TenderRequirementInventory({
    snapshotId: '99999999-9999-4999-8999-999999999999',
    documents,
    documentGaps: [],
  });
  const foreignId = foreignInventory.source_units[0].source_unit_id;
  assert.equal(
    inventory.source_units.some(unit => unit.source_unit_id === foreignId), false,
    'fixture must expose a source_unit_id that belongs to another snapshot only',
  );

  // A foreign/hallucinated id, even when it is the SECOND disposition of a unit the retraction would
  // otherwise have covered: the shape gates run before any relation is resolved.
  for (const strangeId of ['hallucinated-source-unit-id', foreignId]) {
    await assertRejection(
      () => run({
        requirements: [requirement(LABEL)],
        excluded: [{ source_unit_id: strangeId, reason: 'descriptive_or_contextual' }],
        unresolved: [],
      }),
      { code: 'v4_discovery_inventory_invariant', message: /source_unit no permitida/ },
    );
  }

  // A reason outside the closed vocabulary, on a unit that is ALSO dispositioned elsewhere.
  await assertRejection(
    () => run({
      requirements: [requirement(LABEL)],
      excluded: [
        { source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' },
        { source_unit_id: unitIdByParagraph[1], reason: 'inventada' },
      ],
      unresolved: [],
    }),
    { code: 'v4_discovery_shape_invariant', message: /razón no permitida/ },
  );

  // Unexpected keys in a disposition, and a requirement smuggling a source id.
  await assertRejection(
    () => run({
      requirements: [requirement(LABEL)],
      excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual', nota: 'x' }],
      unresolved: [],
    }),
    { code: 'v4_discovery_shape_invariant', message: /claves inválidas/ },
  );
  await assertRejection(
    () => run({
      requirements: [
        requirement(LABEL),
        { ...requirement(LABEL, { category: 'habilitating' }), source_unit_ids: [unitIdByParagraph[0]] },
      ],
      excluded: [],
      unresolved: [],
    }),
    { code: 'v4_discovery_shape_invariant', message: /claves inválidas/ },
  );

  // A front/kind/category outside its closed vocabulary is never "just another conflicting claim".
  await assertRejection(
    () => run({
      requirements: [requirement(LABEL), requirement(LABEL, { front: 'ambiental' })],
      excluded: [],
      unresolved: [],
    }),
    { code: 'v4_discovery_shape_invariant', message: /vocabulario permitido/ },
  );

  // A label outside this batch's own literal catalog still has no derivable provenance at all.
  await assertRejection(
    () => run({
      requirements: [requirement(LABEL), requirement(`${LABEL} y sus anexos`, { category: 'habilitating' })],
      excluded: [],
      unresolved: [],
    }),
    { code: 'v4_discovery_citation_anchor_invariant', message: /anclada literalmente/ },
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Privacy: no rejection message this file can provoke ever carries a label, a source_unit id or a
//    fragment of the expediente, and the retraction path emits no message at all.
// ---------------------------------------------------------------------------------------------
{
  const caught = await assertRejection(
    () => run({
      requirements: [requirement(LABEL), requirement(`${LABEL} y sus anexos`)],
      excluded: [],
      unresolved: [],
    }),
    { code: 'v4_discovery_citation_anchor_invariant' },
  );
  for (const secret of [LABEL, ...PARAGRAPHS, ...unitIdByParagraph]) {
    assert.ok(!caught.message.includes(secret), 'a rejection message must never expose a label, an id or source text');
  }
}

// ---------------------------------------------------------------------------------------------
// 8. The persisted projection still holds: a retracted obligation reaches neither the analysis turn
//    nor the category overrides.
// ---------------------------------------------------------------------------------------------
{
  const retractedOnly = await run({
    requirements: [
      requirement(LABEL),
      requirement(candidateExclusiveTo(unitIdByParagraph[2])),
      requirement(candidateExclusiveTo(unitIdByParagraph[2]), { category: 'financial_execution' }),
    ],
    excluded: [],
    unresolved: [],
  });
  assert.equal(
    retractedOnly.semanticManifest.requirements.length, 1,
    'only the coherent obligation survives; the contradicted one is retracted',
  );
  assert.equal(retractedOnly.semanticManifest.requirements[0].label, LABEL);
  assert.equal(Object.keys(retractedOnly.categoryOverrides).length, 1);
  assert.equal(
    Object.values(retractedOnly.categoryOverrides).includes('financial_execution'), false,
    'a retracted obligation must contribute no category override',
  );
  assert.deepEqual(
    retractedOnly.semanticManifest.unresolved.find(entry => entry.source_unit_id === unitIdByParagraph[2]),
    completionHole(unitIdByParagraph[2]),
    'the contradicted obligation\'s unit falls to the completion pass',
  );

  const projection = toAgt002RequirementManifest({
    semanticManifest: retractedOnly.semanticManifest, inventory, documents,
  });
  assert.equal(
    projection.requirement_manifest.length, 1,
    'the projection persisted for the analysis turn carries only the surviving obligation',
  );
  assert.deepEqual(
    projection.requirement_manifest.map(entry => entry.requirement_id),
    retractedOnly.semanticManifest.requirements.map(entry => entry.requirement_id),
  );
}

console.log('tests/tender-semantic-discovery-v8-contradiction-retraction.test.mjs OK');
