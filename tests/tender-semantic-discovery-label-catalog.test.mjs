import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildTenderRequirementInventory, resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
  TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT,
  TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR,
  TENDER_SEMANTIC_LABEL_MAX_CHARS,
  TENDER_SEMANTIC_LABEL_MIN_CHARS,
} from '../tender-semantic-label-catalog.js';
import { tenderSemanticObligationKey, TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS } from '../tender-semantic-manifest.js';

// AGT-002 V4, repeated `v4_discovery_citation_anchor_invariant`: the model kept paraphrasing the
// label instead of quoting a cited source_unit verbatim, and every such run burned a provider turn
// before dying at canonicalizeProposal's literal anchor gate. Companion to
// tests/tender-semantic-discovery-citation-anchor-policy.test.mjs, which pins the POLICY TEXT half
// of the contract and proves the anchor gate itself is not relaxed.
//
// This file pins the structural half: `requirements[].label` is a closed JSON Schema enum of
// literal contiguous excerpts of THIS snapshot's own visible (already redacted) source units, so a
// paraphrase is not a schema-valid value at all. Everything below is about that catalog being
// exact by construction, deterministic, bounded, privacy-equivalent and honest about coverage.
//
// Pinning the enum was necessary and provably not sufficient: it constrains `label` and it
// constrained the old `source_unit_ids[]` INDEPENDENTLY, and no JSON Schema can express the only
// thing that mattered — that the excerpt chosen for `label` belongs to the units those ids named.
// Policy v3 therefore removes the relation instead of guarding it: a requirement carries only
// {kind, label, front, category} and the server derives `front_evidence`/`citations` from this very
// catalog (tests/tender-semantic-discovery-derived-citations.test.mjs pins that end to end). The
// catalog is consequently load-bearing twice over — as the wire enum AND as the sole provenance of
// every requirement — which is exactly why its exactness properties are asserted here.

const hash = value => createHash('sha256').update(value).digest('hex');
const document = ({ id, version, text }) => ({
  document_id: id,
  document_version_id: version,
  content_hash: hash(text),
  extracted_text: text,
  document_type: 'pliego',
  name: `${id}.pdf`,
  current: true,
});

// Deliberately broad: an obligation, a plazo, an entregable, a restricción and a condición, so the
// catalog's breadth claim is exercised over the shapes the policy names — not just one sentence.
const PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.',
  'El plazo de ejecucion del contrato sera de doce meses contados a partir del acta de inicio; no se admiten prorrogas automaticas.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros cinco dias habiles de cada mes.',
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad.',
  'Si el proponente es un consorcio, cada integrante debera aportar el certificado de existencia y representacion legal.',
];

const documents = [document({ id: 'pliego', version: 'v1', text: PARAGRAPHS.join('\n\n') })];
const inventory = buildTenderRequirementInventory({ snapshotId: 'snap-label-catalog', documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture must produce one analyzable unit per paragraph');

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });

// Captures the exact request the discoverer would send, without a provider ever being involved.
function capturingClient(proposal) {
  const captured = {};
  return {
    captured,
    run: async request => {
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 3, output_tokens: 4 } };
    },
  };
}

function run(client, overrides = {}) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-label-catalog',
    inventory,
    documents,
    ...overrides,
  });
}

const labelSchemaOf = request => request.outputSchema.properties.requirements.items.properties.label;

// A proposal that disposes of every visible unit the DERIVED citation mapping does not already
// claim, so only the property under test can fail. `derivedOwnerIds` are the units the server binds
// from the proposed labels — the model itself never names a unit inside a requirement.
function proposalWith(requirements, derivedOwnerIds) {
  const cited = new Set(derivedOwnerIds);
  return {
    requirements,
    excluded: inventory.source_units
      .filter(unit => !cited.has(unit.source_unit_id))
      .map(unit => ({ source_unit_id: unit.source_unit_id, reason: 'descriptive_or_contextual' })),
    unresolved: [],
  };
}

// ---------------------------------------------------------------------------------------------
// The model-facing contract materially changed, so the policy version moved with it.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v8',
    'the wire contract this catalog feeds is v8: the label enum is pinned, a requirement carries no '
    + 'model-provided source id (the server derives front_evidence/citations from this same catalog), '
    + 'an undispositioned source unit is completed into unresolved instead of rejecting the turn, the '
    + 'disposition lists themselves are optional, an exact repetition of one catalog label is '
    + 'canonicalized once, the input is now one of possibly several batches (batch index/count) '
    + 'instead of a single request, and a self-contradicting claim is retracted instead of rejecting '
    + 'the whole batch — each a material model-facing change that must bump the policy version',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /enumerado cerrado/,
    'the policy must tell the model that label is a closed enumeration',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /label\.enum/,
    'the policy must point the model at the exact schema location of the candidate catalog',
  );
  // No fuzzy repair, no hidden retry, no fallback: an unusable enum means the requirement is
  // withdrawn and the unit is dispositioned by the EXISTING contract, never invented.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /retira el requisito y dispón esa unidad como exclusión explícita o como unidad sin resolver/,
    'the policy must resolve an unusable candidate by withdrawing the requirement, never by inventing a label',
  );
}

// ---------------------------------------------------------------------------------------------
// Schema enum exactness + literal contiguity + per-unit anchoring.
// ---------------------------------------------------------------------------------------------
const anchorUnit = inventory.source_units
  .find(unit => resolvedTexts.get(unit.source_unit_id)?.text.includes('vigilancia hospitalaria'));
assert.ok(anchorUnit, 'fixture must resolve the experience paragraph unambiguously');

let capturedRequest;
{
  const catalog = buildTenderSemanticLabelCatalog({
    units: [...resolvedTexts.entries()].map(([sourceUnitId, value]) => ({
      source_unit_id: sourceUnitId,
      text: value.text,
      source_text: value.text,
    })),
    maxCatalogChars: 40_000,
  });
  const anchorCandidate = catalog.candidates_by_unit_id.get(anchorUnit.source_unit_id)[0];

  // v3: the requirement declares exactly the four fields the model may decide. It names no source
  // unit, so the citations asserted below are derived by the server from this candidate alone.
  const client = capturingClient(proposalWith([{
    kind: 'obligation',
    label: anchorCandidate,
    front: 'technical',
    category: 'technical',
  }], [anchorUnit.source_unit_id]));

  const result = await run(client);
  capturedRequest = client.captured.request;

  // The catalog is genuinely usable end to end: a candidate taken straight from the enum passes
  // canonicalizeProposal's unchanged anchor gate AND assembleTenderSemanticManifest's independent
  // re-anchor against the snapshot's own documents.
  assert.equal(result.semanticManifest.requirements.length, 1, 'a catalog candidate must be accepted verbatim');
  assert.equal(result.semanticManifest.requirements[0].label, anchorCandidate);
  // And the unit the candidate was catalogued from is the unit the server cites for it.
  assert.deepEqual(
    result.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [anchorUnit.source_unit_id],
    'the catalog is the provenance: a candidate of the anchor unit derives its citation to that unit',
  );
  assert.equal(
    result.semanticManifest.requirements[0].front_evidence.source_unit_id,
    anchorUnit.source_unit_id,
    'front evidence is derived from the same catalog ownership, never proposed',
  );

  // Output object keys are preserved exactly.
  assert.deepEqual(
    Object.keys(result).sort(),
    ['categoryOverrides', 'discoveryLedger', 'semanticManifest', 'usage'],
    'the discoverer must keep returning exactly {semanticManifest, categoryOverrides, usage, discoveryLedger}',
  );

  const labelSchema = labelSchemaOf(capturedRequest);
  assert.equal(labelSchema.type, 'string');
  assert.equal(labelSchema.minLength, TENDER_SEMANTIC_LABEL_MIN_CHARS);
  assert.equal(labelSchema.maxLength, TENDER_SEMANTIC_LABEL_MAX_CHARS);
  assert.ok(Array.isArray(labelSchema.enum) && labelSchema.enum.length > 0, 'label must be a non-empty closed enum');
  assert.deepEqual(labelSchema.enum, catalog.candidates, 'the wire enum must be exactly the deterministic catalog');
  assert.equal(new Set(labelSchema.enum).size, labelSchema.enum.length, 'the enum must not repeat a candidate');
}

// Every enum member is a literal contiguous excerpt of at least one visible source unit, within the
// label bounds the local gates already enforce.
{
  const unitTexts = [...resolvedTexts.values()].map(value => value.text);
  for (const candidate of labelSchemaOf(capturedRequest).enum) {
    assert.ok(
      candidate.length >= TENDER_SEMANTIC_LABEL_MIN_CHARS && candidate.length <= TENDER_SEMANTIC_LABEL_MAX_CHARS,
      `candidate out of label bounds: ${JSON.stringify(candidate)}`,
    );
    assert.equal(candidate, candidate.trim(), `candidate must be pre-trimmed: ${JSON.stringify(candidate)}`);
    assert.ok(
      unitTexts.some(text => text.includes(candidate)),
      `candidate is not a literal contiguous excerpt of any source unit: ${JSON.stringify(candidate)}`,
    );
  }
}

// Every candidate credited to a unit is literally anchored in THAT unit's own text, and every
// visible unit of a normal expediente is represented — the catalog never silently makes part of
// the expediente unlabelable.
{
  const catalog = buildTenderSemanticLabelCatalog({
    units: [...resolvedTexts.entries()].map(([sourceUnitId, value]) => ({
      source_unit_id: sourceUnitId,
      text: value.text,
      source_text: value.text,
    })),
    maxCatalogChars: 40_000,
  });
  assert.deepEqual(catalog.units_dropped_by_budget, [], 'no unit may lose its excerpts to the budget here');
  assert.deepEqual(catalog.units_without_eligible_candidates, [], 'every fixture unit can yield a literal excerpt');
  for (const [sourceUnitId, candidates] of catalog.candidates_by_unit_id) {
    const text = resolvedTexts.get(sourceUnitId).text;
    assert.ok(candidates.length > 0, `unit ${sourceUnitId} must have at least one candidate`);
    assert.ok(
      candidates.length <= TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT,
      `unit ${sourceUnitId} exceeded the per-unit candidate bound`,
    );
    for (const candidate of candidates) {
      assert.ok(text.includes(candidate), `candidate not anchored in its own unit ${sourceUnitId}: ${JSON.stringify(candidate)}`);
    }
  }

  // Breadth: the catalog must be able to name each of the obligation shapes the policy lists, not
  // just the first paragraph. Every paragraph contributes a candidate carrying its distinctive term.
  for (const term of ['vigilancia hospitalaria', 'plazo de ejecucion', 'informe mensual', 'prohibido subcontratar', 'consorcio']) {
    assert.ok(
      catalog.candidates.some(candidate => candidate.includes(term)),
      `catalog is not broad enough to name "${term}"`,
    );
  }

  // v4 global uniqueness invariant: the wire enum this catalog feeds may never offer two labels
  // that fold to the same normalized obligation key, over the whole catalog — not merely within
  // one unit's own candidate list (tests/tender-semantic-discovery-uniqueness-policy.test.mjs pins
  // the end-to-end collision fixture; this is the general property over an ordinary expediente).
  const obligationKeys = catalog.candidates.map(candidate => tenderSemanticObligationKey(candidate));
  assert.equal(
    new Set(obligationKeys).size, obligationKeys.length,
    'the catalog must never offer two labels that fold to the same normalized obligation key',
  );
}

// ---------------------------------------------------------------------------------------------
// Determinism and stability.
// ---------------------------------------------------------------------------------------------
{
  const units = [...resolvedTexts.entries()].map(([sourceUnitId, value]) => ({
    source_unit_id: sourceUnitId,
    text: value.text,
    source_text: value.text,
  }));
  const first = buildTenderSemanticLabelCatalog({ units, maxCatalogChars: 40_000 });
  const second = buildTenderSemanticLabelCatalog({ units: [...units], maxCatalogChars: 40_000 });
  assert.deepEqual(second.candidates, first.candidates, 'the catalog must be byte-identical across builds');

  // Same snapshot, second discovery call: the whole request (input + schema) must be identical, so
  // a re-run is not a different question and the enum cannot drift under a retry.
  const clientA = capturingClient(proposalWith([], []));
  const clientB = capturingClient(proposalWith([], []));
  await run(clientA).catch(() => {});
  await run(clientB).catch(() => {});
  assert.equal(
    JSON.stringify(clientA.captured.request.outputSchema),
    JSON.stringify(clientB.captured.request.outputSchema),
    'two discovery calls over the same snapshot must send a byte-identical output schema',
  );
  assert.equal(
    JSON.stringify(clientA.captured.request.input),
    JSON.stringify(clientB.captured.request.input),
    'two discovery calls over the same snapshot must send byte-identical input',
  );
}

// ---------------------------------------------------------------------------------------------
// A paraphrase is unrepresentable at the schema level, and the local gate still rejects it anyway.
// ---------------------------------------------------------------------------------------------
{
  const paraphrase = 'experiencia en el ambito de vigilancia para hospitales';
  assert.ok(
    !labelSchemaOf(capturedRequest).enum.includes(paraphrase),
    'a paraphrase must not be a schema-valid label value',
  );

  // A non-compliant provider that ignores the enum must STILL be rejected locally, by the
  // untouched anchor gate — the wire schema is never the security boundary. Under v3 there is no
  // model-provided citation left to fall back on, so a non-member label has no derivable
  // provenance at all and the requirement is withdrawn rather than credited to an invented source.
  await assert.rejects(
    () => run(capturingClient(proposalWith([{
      kind: 'obligation',
      label: paraphrase,
      front: 'technical',
      category: 'technical',
    }], [anchorUnit.source_unit_id]))),
    /anclada literalmente/,
    'the unchanged literal anchor gate must still reject a paraphrase the schema no longer allows',
  );
}

// The enum is global to the request, so it still cannot express "this excerpt belongs to unit X".
// Under v3 that is no longer a relation the model can get wrong: it names no unit, and the catalog
// itself decides. A candidate exclusive to the anchor unit is bound to THAT unit, and under v8 a
// proposal that disposes of the derived owner elsewhere is retracted rather than reconciled OR
// rejected — the citation is never moved.
{
  const otherUnitIds = inventory.source_units
    .map(unit => unit.source_unit_id)
    .filter(sourceUnitId => sourceUnitId !== anchorUnit.source_unit_id);
  const exclusiveCandidate = labelSchemaOf(capturedRequest).enum
    .find(candidate => resolvedTexts.get(anchorUnit.source_unit_id).text.includes(candidate)
      && otherUnitIds.every(sourceUnitId => !resolvedTexts.get(sourceUnitId).text.includes(candidate)));
  assert.ok(exclusiveCandidate, 'fixture must expose a candidate exclusive to the anchor unit');

  const requirement = { kind: 'obligation', label: exclusiveCandidate, front: 'technical', category: 'technical' };

  const bound = await run(capturingClient(proposalWith([requirement], [anchorUnit.source_unit_id])));
  assert.deepEqual(
    bound.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [anchorUnit.source_unit_id],
    'an exclusive candidate must derive exactly one citation, to the only unit that states it',
  );

  // The same proposal, with the anchor unit dispositioned as if some other unit owned the label:
  // v8 retracts the contradictory disposition instead of rejecting the whole proposal, and the
  // server still does not move the citation.
  const contradicted = await run(capturingClient(proposalWith([requirement], [otherUnitIds[0]])));
  assert.deepEqual(
    contradicted.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [anchorUnit.source_unit_id],
    'a unit the catalog binds to a label keeps that citation even when the model also dispositions it',
  );
  assert.equal(
    contradicted.semanticManifest.excluded.some(item => item.source_unit_id === anchorUnit.source_unit_id), false,
    'the contradictory disposition over the anchor unit must leave no trace',
  );
  assert.equal(contradicted.discoveryLedger.batches[0].retracted_disposition_units, 1);
}

// ---------------------------------------------------------------------------------------------
// Long / noisy input: bounded catalog, and privacy-equivalence to what the request already sends.
// ---------------------------------------------------------------------------------------------
{
  const noisyParagraphs = [];
  for (let index = 0; index < 120; index += 1) {
    noisyParagraphs.push([
      `Clausula ${index}: el contratista debera mantener la poliza de cumplimiento vigente durante toda la ejecucion`,
      'del contrato y presentar los soportes correspondientes ante el supervisor designado por la entidad contratante,',
      'so pena de las sanciones contractuales previstas en el presente pliego de condiciones y sus anexos tecnicos.',
    ].join(' '));
  }
  // Contact/identifier noise the redactor rewrites before anything reaches the provider.
  noisyParagraphs.push('Las comunicaciones se dirigiran a supervision@entidad.gov.co o al telefono 601 555 1234, con copia a la cedula 1.020.345.678 del supervisor.');

  const noisyDocuments = [document({ id: 'pliego-ruidoso', version: 'v1', text: noisyParagraphs.join('\n\n') })];
  const noisyInventory = buildTenderRequirementInventory({ snapshotId: 'snap-label-catalog-noisy', documents: noisyDocuments, documentGaps: [] });
  const noisyClient = capturingClient({ requirements: [], excluded: [], unresolved: [] });
  await discoverTenderSemanticManifest({
    client: noisyClient,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-label-catalog-noisy',
    inventory: noisyInventory,
    documents: noisyDocuments,
    // v5 rejects this empty proposal at the discovery boundary (`v5_discovery_no_requirements`)
    // AFTER the provider call; the catch keeps the captured request — the actual subject here — as
    // what the assertions read, exactly as it did when v4 completed the same proposal instead.
  }).catch(() => {});

  const request = noisyClient.captured.request;
  const enumValues = labelSchemaOf(request).enum;
  const catalogChars = enumValues.reduce((total, candidate) => total + candidate.length, 0);
  const unitCount = request.input.source_units.length;
  assert.ok(unitCount > 100, 'the noisy fixture must be large enough for the global bounds to bite');

  // The catalog is capped at the SOURCE budget, so the whole request is bounded at roughly twice
  // what the source packet alone was already allowed to cost — it cannot grow with the tender.
  assert.ok(catalogChars <= 40_000, `catalog exceeded its character budget: ${catalogChars}`);
  assert.ok(
    enumValues.length <= Math.max(unitCount, TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR),
    `catalog exceeded its global count bound: ${enumValues.length}`,
  );
  assert.ok(
    enumValues.length < unitCount * TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT,
    'a large expediente must actually be bounded, not merely bounded in principle',
  );
  for (const candidate of enumValues) {
    assert.ok(candidate.length <= TENDER_SEMANTIC_LABEL_MAX_CHARS, 'no candidate may exceed the label bound');
  }

  // Privacy equivalence: every candidate already appears verbatim in the redacted text the request
  // carries, and the redaction placeholders themselves never leak into a candidate — a span that
  // straddles one is dropped rather than repaired, so the manifest re-anchor cannot fail on it.
  const visibleTexts = request.input.source_units.map(unit => unit.text);
  for (const candidate of enumValues) {
    assert.ok(
      visibleTexts.some(text => text.includes(candidate)),
      `candidate is not already present in the request payload: ${JSON.stringify(candidate)}`,
    );
    assert.doesNotMatch(candidate, /\[REDACTED_/, 'a candidate must never carry a redaction placeholder');
  }
  // The raw values the redactor removed are absent from both the packet and the catalog.
  for (const secret of ['supervision@entidad.gov.co', '1.020.345.678']) {
    assert.ok(!visibleTexts.some(text => text.includes(secret)), `redacted value leaked into the packet: ${secret}`);
    assert.ok(!enumValues.some(candidate => candidate.includes(secret)), `redacted value leaked into the catalog: ${secret}`);
  }

  // The provider never receives the unredacted text the catalog was cross-checked against.
  for (const unit of request.input.source_units) {
    assert.ok(!Object.hasOwn(unit, 'source_text'), 'the unredacted source text must never be sent to the provider');
  }

  // v4 global uniqueness invariant at scale: 120 near-identical clauses (differing only by their
  // "Clausula {index}:" lead-in) are exactly the shape that used to produce many cross-unit
  // obligation-key collisions once the lead-in falls outside a shorter candidate window. The wire
  // enum must still never offer two labels folding to the same key.
  const obligationKeys = enumValues.map(candidate => tenderSemanticObligationKey(candidate));
  assert.equal(
    new Set(obligationKeys).size, obligationKeys.length,
    'a large expediente must not let the enum offer two labels folding to the same obligation key',
  );
}

// ---------------------------------------------------------------------------------------------
// Fail closed, never degrade: a budget too small to cover every visible unit stops the run BEFORE
// any provider turn is spent, rather than shipping a schema that makes part of the expediente
// unlabelable.
// ---------------------------------------------------------------------------------------------
{
  let called = false;
  const client = { run: async () => { called = true; return { content: '{}', usage: { input_tokens: 1, output_tokens: 1 } }; } };
  await assert.rejects(
    () => run(client, { maxLabelCatalogChars: 10 }),
    /catálogo de etiquetas literales no cubre/,
    'an under-budgeted catalog must fail closed',
  );
  assert.equal(called, false, 'the fail-closed catalog check must run before the provider is called');
}

// A unit that cannot yield any literal excerpt is reported as such — it is not a budget failure and
// not an invitation to invent: it simply could never have carried a label under the unchanged gates.
{
  const catalog = buildTenderSemanticLabelCatalog({
    units: [{ source_unit_id: 'unit:empty', text: '1.', source_text: '1.' }],
    maxCatalogChars: 1_000,
  });
  assert.deepEqual(catalog.candidates, []);
  assert.deepEqual(catalog.units_without_eligible_candidates, ['unit:empty']);
  assert.deepEqual(catalog.units_dropped_by_budget, []);
}

// An expediente where no unit yields any literal excerpt fails closed instead of asking for a
// proposal nothing could ever anchor.
{
  const emptyDocuments = [document({ id: 'pliego-vacio', version: 'v1', text: '1.\n\n2.\n\n3.' })];
  const emptyInventory = buildTenderRequirementInventory({ snapshotId: 'snap-label-catalog-empty', documents: emptyDocuments, documentGaps: [] });
  let called = false;
  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client: { run: async () => { called = true; return { content: '{}', usage: { input_tokens: 1, output_tokens: 1 } }; } },
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-label-catalog-empty',
      inventory: emptyInventory,
      documents: emptyDocuments,
    }),
    /catálogo de fragmentos literales/,
    'an expediente with no anchorable excerpt must fail closed',
  );
  assert.equal(called, false, 'the empty-catalog check must run before the provider is called');
}

// ---------------------------------------------------------------------------------------------
// Provider wire-compatibility: no candidate literal-enum member may carry an ASCII double quote
// (U+0022). Real canaries (Codex/Luna) proved a schema enum containing that exact character is
// rejected outright, and the same catalog passes once every U+0022-bearing candidate is excluded.
// The quote is never stripped or rephrased out of a span: a candidate that cannot avoid it is
// simply left uncataloged, exactly like a control-character or redaction-placeholder span already
// is — this is a provider wire-compatibility gate, not a new content judgement.
// ---------------------------------------------------------------------------------------------

// A source unit that carries a quoted fragment AND a viable unquoted excerpt must still
// contribute to the catalog via the unquoted excerpt, and none of its excerpts may carry the
// quote character.
{
  const quotedUnitId = 'unit:quoted-with-alternative';
  const text = 'El oferente debera entregar el "certificado de calidad" junto con la propuesta economica y tecnica antes del cierre del proceso de contratacion publica.';
  const catalog = buildTenderSemanticLabelCatalog({
    units: [{ source_unit_id: quotedUnitId, text, source_text: text }],
    maxCatalogChars: 1_000,
  });
  assert.deepEqual(
    catalog.units_without_eligible_candidates, [],
    'a quoted paragraph that also offers a viable unquoted excerpt must not be reported as ineligible',
  );
  assert.deepEqual(catalog.units_dropped_by_budget, []);
  assert.ok(catalog.candidates.length > 0, 'the viable unquoted excerpt must still reach the catalog');
  for (const candidate of catalog.candidates) {
    assert.ok(!candidate.includes('"'), `candidate must never carry an ASCII double quote: ${JSON.stringify(candidate)}`);
  }
}

// Same property, exercised through the full discovery pipeline: a document mixing the existing
// fixture paragraphs with a quoted-but-alternative-bearing one must never place a U+0022 in the
// wire enum, while the enum still stays non-empty.
{
  const quotedParagraph = 'El oferente debera entregar el "certificado de calidad" junto con la propuesta economica y tecnica antes del cierre del proceso de contratacion publica.';
  const quotedDocuments = [document({ id: 'pliego-con-comillas', version: 'v1', text: [...PARAGRAPHS, quotedParagraph].join('\n\n') })];
  const quotedInventory = buildTenderRequirementInventory({ snapshotId: 'snap-label-catalog-quoted', documents: quotedDocuments, documentGaps: [] });
  const quotedClient = capturingClient({ requirements: [], excluded: [], unresolved: [] });
  await discoverTenderSemanticManifest({
    client: quotedClient,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-label-catalog-quoted',
    inventory: quotedInventory,
    documents: quotedDocuments,
    // As above: under v5 the empty proposal is rejected at the discovery boundary; the captured
    // request is the subject either way.
  }).catch(() => {});

  const enumValues = labelSchemaOf(quotedClient.captured.request).enum;
  assert.ok(enumValues.length > 0, 'the quoted-but-alternative-bearing document must still yield a non-empty enum');
  for (const candidate of enumValues) {
    assert.ok(!candidate.includes('"'), `wire enum must never carry an ASCII double quote: ${JSON.stringify(candidate)}`);
  }
}

// A source whose only content is an unusable quoted fragment, with no viable alternative
// anywhere in that unit, fails closed: the builder reports it as ineligible rather than
// stripping or rephrasing the quote out of it.
{
  const catalog = buildTenderSemanticLabelCatalog({
    units: [{ source_unit_id: 'unit:quoted-only', text: 'El "software" falla.', source_text: 'El "software" falla.' }],
    maxCatalogChars: 1_000,
  });
  assert.deepEqual(catalog.candidates, []);
  assert.deepEqual(catalog.units_without_eligible_candidates, ['unit:quoted-only']);
  assert.deepEqual(catalog.units_dropped_by_budget, []);
}

// An expediente where NO unit offers any viable alternative to its quoted fragment fails closed
// at full discovery, before any provider turn, instead of shipping a schema built by stripping or
// rephrasing the quote out of an otherwise-unusable excerpt.
{
  const quoteOnlyDocuments = [document({
    id: 'pliego-solo-comillas',
    version: 'v1',
    text: ['El "software" falla.', 'La "garantia" vence.', 'Un "defecto" persiste.'].join('\n\n'),
  })];
  const quoteOnlyInventory = buildTenderRequirementInventory({ snapshotId: 'snap-label-catalog-quote-only', documents: quoteOnlyDocuments, documentGaps: [] });
  let called = false;
  await assert.rejects(
    () => discoverTenderSemanticManifest({
      client: { run: async () => { called = true; return { content: '{}', usage: { input_tokens: 1, output_tokens: 1 } }; } },
      model: 'test-model',
      timeoutMs: 1000,
      idempotencyKey: 'idem-label-catalog-quote-only',
      inventory: quoteOnlyInventory,
      documents: quoteOnlyDocuments,
    }),
    /catálogo de fragmentos literales/,
    'an expediente whose only content is an unusable quoted fragment must fail closed instead of stripping the quote',
  );
  assert.equal(called, false, 'the fail-closed catalog check must run before the provider is called');
}

// ---------------------------------------------------------------------------------------------
// v4 global obligation-key uniqueness (real `v4_discovery_uniqueness_invariant`): the per-unit
// dedup inside unitLabelCandidates only ever bounded ONE unit's own candidate list. Two different
// units stating the identical obligation in a literally different form — here, only the case of
// the first letter — used to each contribute their own form to the enum, because neither unit's
// own dedup pass ever saw the other's text. `buildTenderSemanticLabelCatalog` now also dedups
// GLOBALLY, at the point candidates are chosen for the enum, so at most one literal form per
// normalized obligation key ever reaches the catalog, across every visible unit.
// ---------------------------------------------------------------------------------------------

// Cross-unit case-equivalent labels collapse to exactly one catalog member, chosen by the same
// deterministic round-major (round, then unit, in caller order) traversal that already orders
// `candidates`: the first unit's literal form wins, the second unit's is discarded outright, and
// ownership stays exact-containment-only — the discarded unit is never credited with a label its
// own text does not literally contain.
{
  // Deliberately only THREE words: `unitLabelCandidates`'s word-window granularities (16, 8) only
  // ever produce a sub-span when the unit has more words than the window's own stride, so a
  // 3-word unit yields exactly ONE candidate — the whole text — and no accidental shorter shared
  // sub-span can blur what this test is isolating.
  const unitAId = 'unit:collision-a';
  const unitBId = 'unit:collision-b';
  const textA = 'Vigilancia hospitalaria permanente.';
  const textB = 'vigilancia hospitalaria permanente';
  const winner = 'Vigilancia hospitalaria permanente';
  const discarded = 'vigilancia hospitalaria permanente';
  assert.equal(
    tenderSemanticObligationKey(winner), tenderSemanticObligationKey(discarded),
    'fixture sanity: the two forms must fold to the same obligation key',
  );

  const catalog = buildTenderSemanticLabelCatalog({
    units: [
      { source_unit_id: unitAId, text: textA, source_text: textA },
      { source_unit_id: unitBId, text: textB, source_text: textB },
    ],
    maxCatalogChars: 1_000,
  });

  assert.deepEqual(catalog.candidates, [winner], 'exactly one literal form of the colliding obligation may reach the enum');
  assert.deepEqual(catalog.candidates_by_unit_id.get(unitAId), [winner], 'the winning unit keeps owning its own literal form');
  assert.deepEqual(
    catalog.candidates_by_unit_id.get(unitBId), [],
    'the losing unit must not be credited with its own discarded form, nor with the winner it does not literally contain (different case)',
  );
  assert.deepEqual(catalog.units_without_eligible_candidates, []);
  assert.deepEqual(catalog.units_dropped_by_budget, [], 'a global obligation-key collision must never be counted as a budget drop');
  assert.deepEqual(
    catalog.units_dropped_by_semantic_collision, [unitBId],
    'a unit whose only candidate was discarded purely by the global collision must be reported under that separate cause',
  );

  const ownerIndex = buildTenderSemanticLabelOwnerIndex({
    orderedUnitIds: [unitAId, unitBId],
    candidatesByUnitId: catalog.candidates_by_unit_id,
  });
  assert.deepEqual(
    [...ownerIndex.get(winner)], [unitAId],
    'the colliding unit must not be falsely added as an owner of the surviving label',
  );
  assert.equal(ownerIndex.has(discarded), false, 'the discarded colliding form must never appear in the owner index at all');
}

// First deterministic representative wins: reversing which unit comes first in the caller-supplied
// order reverses which literal form survives, proving the winner is decided by traversal order —
// never by string content, sort order or which unit happens to be "first" some other way.
{
  const winner = 'Vigilancia hospitalaria permanente';
  const discarded = 'vigilancia hospitalaria permanente';
  const reversed = buildTenderSemanticLabelCatalog({
    units: [
      { source_unit_id: 'unit:collision-b', text: discarded, source_text: discarded },
      { source_unit_id: 'unit:collision-a', text: winner, source_text: winner },
    ],
    maxCatalogChars: 1_000,
  });
  assert.deepEqual(
    reversed.candidates, [discarded],
    'the first unit in the given traversal order wins the shared obligation key, regardless of which literal form it carries',
  );
}

// Case is not the only way two units can state one obligation in literally different forms.
// `tenderSemanticObligationKey` folds accents away and treats EVERY non-alphanumeric character as a
// separator, so a comma or an accent is exactly as invisible to it as a capital letter — and the
// enum must not offer both forms merely because their bytes differ. Each unit below is deliberately
// four words long, so `unitLabelCandidates` yields exactly that unit's own whole text (the 16/8-word
// windows cannot produce a shorter span) and the only thing under test is the cross-unit fold.
for (const [variant, textA, winner, textB] of [
  ['punctuation', 'Poliza de cumplimiento, vigente.', 'Poliza de cumplimiento, vigente', 'Poliza de cumplimiento vigente'],
  ['accents', 'Garantía única de cumplimiento.', 'Garantía única de cumplimiento', 'Garantia unica de cumplimiento'],
]) {
  const unitAId = `unit:${variant}-a`;
  const unitBId = `unit:${variant}-b`;
  const discarded = textB;
  assert.notEqual(winner, discarded, `fixture sanity (${variant}): the two literal forms must actually differ`);
  assert.equal(
    tenderSemanticObligationKey(winner), tenderSemanticObligationKey(discarded),
    `fixture sanity (${variant}): the two forms must fold to the same obligation key`,
  );

  const catalog = buildTenderSemanticLabelCatalog({
    units: [
      { source_unit_id: unitAId, text: textA, source_text: textA },
      { source_unit_id: unitBId, text: textB, source_text: textB },
    ],
    maxCatalogChars: 1_000,
  });

  assert.deepEqual(
    catalog.candidates, [winner],
    `exactly one literal form may reach the enum when the forms differ only by ${variant}`,
  );
  assert.deepEqual(catalog.candidates_by_unit_id.get(unitAId), [winner]);
  assert.deepEqual(
    catalog.candidates_by_unit_id.get(unitBId), [],
    `the losing unit keeps neither its discarded form nor the winner its text does not literally contain (${variant})`,
  );
  assert.deepEqual(catalog.units_dropped_by_budget, [], `a ${variant} collision must never be counted as a budget drop`);
  assert.deepEqual(catalog.units_dropped_by_semantic_collision, [unitBId]);

  const ownerIndex = buildTenderSemanticLabelOwnerIndex({
    orderedUnitIds: [unitAId, unitBId],
    candidatesByUnitId: catalog.candidates_by_unit_id,
  });
  assert.deepEqual(
    [...ownerIndex.get(winner)], [unitAId],
    `the ${variant}-colliding unit must not be falsely added as an owner of the surviving label`,
  );
  assert.equal(ownerIndex.has(discarded), false, `the discarded ${variant} form must never appear in the owner index`);
}

// The historical-fixed-id guard predates the global dedup and is unchanged by it: a span whose
// literal value OR whose derived obligation key is one of the four historical fixed requirement ids
// is dropped inside `unitLabelCandidates`, BEFORE any candidate is considered for the enum. So such
// a form can never become the first representative that claims an obligation key globally, and the
// units it came from are reported as ineligible — never as a semantic collision and never as a
// budget drop.
{
  const historicalId = 'legal-rce-policy';
  assert.ok(
    TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS.includes(historicalId),
    'fixture sanity: the guarded id must be one of the historical fixed requirement ids',
  );
  // Two literally different forms of the SAME historical id: under the v4 global dedup these are
  // exactly the shape that would otherwise have one form claim the key and the other be discarded
  // as a collision. Neither may reach the catalog at all.
  const historicalUnits = [
    { source_unit_id: 'unit:historical-a', text: 'Legal RCE policy', source_text: 'Legal RCE policy' },
    { source_unit_id: 'unit:historical-b', text: 'legal rce policy.', source_text: 'legal rce policy.' },
  ];
  for (const unit of historicalUnits) {
    assert.equal(
      tenderSemanticObligationKey(unit.text), historicalId,
      `fixture sanity: ${unit.source_unit_id} must fold to the historical fixed id`,
    );
  }
  const ordinaryId = 'unit:ordinary-beside-historical';
  const ordinaryText = 'El contratista entregara un informe mensual de operaciones cada mes.';

  const catalog = buildTenderSemanticLabelCatalog({
    units: [...historicalUnits, { source_unit_id: ordinaryId, text: ordinaryText, source_text: ordinaryText }],
    maxCatalogChars: 1_000,
  });

  assert.ok(catalog.candidates.length > 0, 'the ordinary unit beside them must still contribute to the catalog');
  for (const candidate of catalog.candidates) {
    assert.ok(
      !TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS.includes(candidate)
      && !TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS.includes(tenderSemanticObligationKey(candidate)),
      `a historical fixed id must never reach the catalog: ${JSON.stringify(candidate)}`,
    );
    assert.ok(ordinaryText.includes(candidate), 'every surviving candidate must come from the ordinary unit');
  }
  for (const unit of historicalUnits) {
    assert.deepEqual(
      catalog.candidates_by_unit_id.get(unit.source_unit_id), [],
      `${unit.source_unit_id} must own nothing: its only literal form is a guarded historical id`,
    );
  }
  assert.deepEqual(
    catalog.units_without_eligible_candidates,
    historicalUnits.map(unit => unit.source_unit_id),
    'a unit whose only form is a guarded historical id is ineligible, exactly as before v4',
  );
  assert.deepEqual(
    catalog.units_dropped_by_semantic_collision, [],
    'a guarded historical form is dropped before the global dedup, so it is never a semantic collision',
  );
  assert.deepEqual(catalog.units_dropped_by_budget, []);

  const ownerIndex = buildTenderSemanticLabelOwnerIndex({
    orderedUnitIds: [...historicalUnits.map(unit => unit.source_unit_id), ordinaryId],
    candidatesByUnitId: catalog.candidates_by_unit_id,
  });
  for (const [candidate, owners] of ownerIndex) {
    assert.notEqual(
      tenderSemanticObligationKey(candidate), historicalId,
      `no owner-index entry may carry a guarded historical obligation key: ${JSON.stringify(candidate)}`,
    );
    assert.deepEqual([...owners], [ordinaryId], 'only the ordinary unit may own anything in this fixture');
  }
}

// ---------------------------------------------------------------------------------------------
// AGT-002 V7 regression: global count-cap starvation. The round-major allocation used to add a
// SECOND (extra-granularity) candidate for units that already own one before it ever revisited a
// unit whose FIRST candidate lost the global obligation-key collision. Once the global count cap
// (`max(unitCount, TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR)`) is exhausted by those extra
// candidates before the traversal circles back, a unit with a perfectly good, non-colliding SECOND
// candidate is reported as a BUDGET loss (`units_dropped_by_budget`) even though it is really a
// coverage-ordering bug: raising `maxCatalogChars` cannot fix it, because the binding constraint is
// the COUNT cap, not characters. Real preflight symptom: 18 batches of ~600 visible units each,
// batch index 10 failing closed with `units_dropped_by_budget.length === 2`. Fixed synthetic
// analogue below: 620 units (over the 600 floor, so the floor is the binding cap), two independent
// obligation-key collisions whose losers each own a genuine, non-colliding second candidate.
// ---------------------------------------------------------------------------------------------
{
  const FILLER_COUNT = 616;
  const fillerUnit = index => {
    const text = `El proveedor numero ${index} debera entregar el documento tecnico especial identificado con el codigo ALFA${index} antes del vencimiento del plazo estipulado en el pliego de condiciones correspondiente.`;
    return { source_unit_id: `unit:filler-${index}`, text, source_text: text };
  };
  const fillers = Array.from({ length: FILLER_COUNT }, (_, index) => fillerUnit(index));

  // Two independent obligation-key collisions. Each loser's ROUND-0 candidate (its whole text)
  // collides with its winner's, but each loser also owns a genuinely distinct, non-colliding
  // candidate at round 1 (a word-window sub-span of its own text) — exactly the "genuinely
  // recoverable, not a real budget loss" case this bug must not misclassify.
  const collisionPair = (name, winnerText, loserText) => {
    assert.notEqual(winnerText, loserText, `fixture sanity (${name}): literal forms must differ`);
    assert.equal(
      tenderSemanticObligationKey(winnerText), tenderSemanticObligationKey(loserText),
      `fixture sanity (${name}): forms must fold to the same obligation key`,
    );
    return [
      { source_unit_id: `unit:${name}-winner`, text: winnerText, source_text: winnerText },
      { source_unit_id: `unit:${name}-loser`, text: loserText, source_text: loserText },
    ];
  };
  const [pair1Winner, pair1Loser] = collisionPair(
    'pair1',
    'Vigilancia hospitalaria permanente las veinticuatro horas del dia en todas las sedes asignadas por la entidad contratante durante todo el periodo contractual vigente.',
    'vigilancia hospitalaria permanente las veinticuatro horas del dia en todas las sedes asignadas por la entidad contratante durante todo el periodo contractual vigente',
  );
  const [pair2Winner, pair2Loser] = collisionPair(
    'pair2',
    'Mantenimiento preventivo mensual de todos los equipos biomedicos instalados en la sede principal del hospital durante la vigencia del contrato suscrito.',
    'mantenimiento preventivo mensual de todos los equipos biomedicos instalados en la sede principal del hospital durante la vigencia del contrato suscrito',
  );

  const units = [...fillers, pair1Winner, pair1Loser, pair2Winner, pair2Loser];
  const totalCap = Math.max(units.length, TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR);
  assert.equal(
    totalCap, units.length,
    'fixture sanity: the count-cap floor must be the binding constraint, at exactly the unit count',
  );

  // A generous character budget in isolation: this pins that raising `maxCatalogChars` alone cannot
  // fix the bug, since the binding constraint is the COUNT cap, not characters.
  const catalog = buildTenderSemanticLabelCatalog({ units, maxCatalogChars: 300_000 });

  assert.deepEqual(
    catalog.units_dropped_by_budget, [],
    'a unit with a genuinely non-colliding own candidate must not be starved by extra-granularity '
    + 'candidates the allocation added for already-covered units first',
  );
  assert.deepEqual(
    catalog.units_dropped_by_semantic_collision, [],
    'both collision losers own a real, non-colliding alternative candidate, so neither is a true semantic-collision loss',
  );
  for (const loserId of [pair1Loser.source_unit_id, pair2Loser.source_unit_id]) {
    const owned = catalog.candidates_by_unit_id.get(loserId);
    assert.ok(owned && owned.length > 0, `${loserId} must keep owning its own non-colliding alternative candidate`);
  }

  const obligationKeys = catalog.candidates.map(candidate => tenderSemanticObligationKey(candidate));
  assert.equal(
    new Set(obligationKeys).size, obligationKeys.length,
    'coverage-first allocation must not reintroduce a global obligation-key collision',
  );
}

// Existing per-unit candidate behavior is untouched by the global dedup: a unit whose several own
// candidates fold to DISTINCT obligation keys keeps every one of them, none discarded.
{
  const unitId = 'unit:no-collision';
  const text = 'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.';
  const catalog = buildTenderSemanticLabelCatalog({ units: [{ source_unit_id: unitId, text, source_text: text }], maxCatalogChars: 1_000 });
  assert.ok(catalog.candidates.length > 1, 'a single ordinary unit must still contribute more than one non-colliding candidate');
  assert.deepEqual(
    [...catalog.candidates_by_unit_id.get(unitId)].sort(),
    [...catalog.candidates].sort(),
    'every one of this unit\'s own candidates must survive when none of them collide',
  );
  assert.deepEqual(catalog.units_dropped_by_semantic_collision, []);
  assert.deepEqual(catalog.units_dropped_by_budget, []);
}

console.log('tests/tender-semantic-discovery-label-catalog.test.mjs OK');
