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
  TENDER_SEMANTIC_LABEL_CANDIDATES_PER_UNIT,
  TENDER_SEMANTIC_LABEL_CANDIDATES_TOTAL_FLOOR,
  TENDER_SEMANTIC_LABEL_MAX_CHARS,
  TENDER_SEMANTIC_LABEL_MIN_CHARS,
} from '../tender-semantic-label-catalog.js';

// AGT-002 V4, repeated `v4_discovery_citation_anchor_invariant`: the model kept paraphrasing the
// label instead of quoting a cited source_unit verbatim, and every such run burned a provider turn
// before dying at canonicalizeProposal's literal anchor gate. Companion to
// tests/tender-semantic-discovery-citation-anchor-policy.test.mjs, which pins the POLICY TEXT half
// of the contract and proves the anchor gate itself is not relaxed.
//
// This file pins the structural half: `requirements[].label` is now a closed JSON Schema enum of
// literal contiguous excerpts of THIS snapshot's own visible (already redacted) source units, so a
// paraphrase is not a schema-valid value at all. Everything below is about that catalog being
// exact by construction, deterministic, bounded, privacy-equivalent and honest about coverage —
// while canonicalizeProposal stays byte-for-byte the gate it already was, because the enum cannot
// express "this excerpt belongs to a unit this requirement cites".

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

// A proposal that disposes of every visible unit, so only the property under test can fail.
function proposalWith(requirements, citedUnitIds) {
  const cited = new Set(citedUnitIds);
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
    'tender-semantic-discovery.v2',
    'pinning the label enum is a material change to the model-facing contract and must bump the policy version',
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

  const client = capturingClient(proposalWith([{
    kind: 'obligation',
    label: anchorCandidate,
    front: 'technical',
    category: 'technical',
    front_evidence_source_unit_id: anchorUnit.source_unit_id,
    source_unit_ids: [anchorUnit.source_unit_id],
  }], [anchorUnit.source_unit_id]));

  const result = await run(client);
  capturedRequest = client.captured.request;

  // The catalog is genuinely usable end to end: a candidate taken straight from the enum passes
  // canonicalizeProposal's unchanged anchor gate AND assembleTenderSemanticManifest's independent
  // re-anchor against the snapshot's own documents.
  assert.equal(result.semanticManifest.requirements.length, 1, 'a catalog candidate must be accepted verbatim');
  assert.equal(result.semanticManifest.requirements[0].label, anchorCandidate);

  // Output object keys are preserved exactly.
  assert.deepEqual(
    Object.keys(result).sort(),
    ['categoryOverrides', 'semanticManifest', 'usage'],
    'the discoverer must keep returning exactly {semanticManifest, categoryOverrides, usage}',
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
  // untouched anchor gate — the wire schema is never the security boundary.
  await assert.rejects(
    () => run(capturingClient(proposalWith([{
      kind: 'obligation',
      label: paraphrase,
      front: 'technical',
      category: 'technical',
      front_evidence_source_unit_id: anchorUnit.source_unit_id,
      source_unit_ids: [anchorUnit.source_unit_id],
    }], [anchorUnit.source_unit_id]))),
    /anclada literalmente/,
    'the unchanged literal anchor gate must still reject a paraphrase the schema no longer allows',
  );
}

// The enum is global to the request, so it cannot express "this excerpt belongs to a cited unit".
// A REAL catalog candidate of unit X, cited against a different unit Y, must still be rejected.
{
  const otherUnit = inventory.source_units.find(unit => unit.source_unit_id !== anchorUnit.source_unit_id);
  const foreignCandidate = labelSchemaOf(capturedRequest).enum
    .find(candidate => resolvedTexts.get(anchorUnit.source_unit_id).text.includes(candidate)
      && !resolvedTexts.get(otherUnit.source_unit_id).text.includes(candidate));
  assert.ok(foreignCandidate, 'fixture must expose a candidate exclusive to the anchor unit');

  await assert.rejects(
    () => run(capturingClient(proposalWith([{
      kind: 'obligation',
      label: foreignCandidate,
      front: 'technical',
      category: 'technical',
      front_evidence_source_unit_id: otherUnit.source_unit_id,
      source_unit_ids: [otherUnit.source_unit_id],
    }], [otherUnit.source_unit_id]))),
    /anclada literalmente/,
    'a schema-valid catalog excerpt paired with a unit it does not belong to must still be rejected',
  );
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
  }).catch(() => {}); // the empty proposal fails the coverage gate; the captured request is the subject.

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
  }).catch(() => {}); // the empty proposal fails the coverage gate; the captured request is the subject.

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

console.log('tests/tender-semantic-discovery-label-catalog.test.mjs OK');
