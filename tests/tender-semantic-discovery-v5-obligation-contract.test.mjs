import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolveTenderInventorySourceTexts } from '../tender-requirement-inventory.js';
import {
  discoverTenderSemanticManifest,
  TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE,
  TENDER_SEMANTIC_DISCOVERY_POLICY,
  TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
  TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES,
} from '../tender-semantic-discovery.js';
import {
  buildTenderSemanticLabelCatalog,
  buildTenderSemanticLabelOwnerIndex,
} from '../tender-semantic-label-catalog.js';
import { assembleTenderSemanticManifest, toAgt002RequirementManifest } from '../tender-semantic-manifest.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import { buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';

// AGT-002 V4 semantic discovery, policy v5 — the discovery-contract coherence remediation that
// follows the coverage completion (tests/tender-semantic-discovery-coverage-completion.test.mjs)
// and the global-unique label catalog (tests/tender-semantic-discovery-label-catalog.test.mjs).
//
// The blocker this file pins: a live discovery turn SUCCEEDED at the bridge and returned a
// schema-valid proposal with ZERO requirements. Every local gate accepted it (nothing was claimed
// wrongly), the assembled manifest was valid, and the run only died much later inside
// toAgt002RequirementManifest — whose fail-closed "no honest frontier" throw is an untyped Error.
// agt002-preview-engine.js could only wrap that as its own opaque SAFE_UNAVAILABLE, so
// agt002-post-bridge-observability.js — seeing an untagged failure AFTER a received bridge response
// — recorded 'unexpected'/provider_error: a discovery-content outcome blamed on the provider.
//
// The zero requirements were not accidental. The v4 policy told the model to disposition every
// visible unit exactly once WHILE the v4 server-side completion already marked every unmentioned
// analyzable unit unresolved by itself — two instructions competing for one bounded output, with
// the useless one being by far the largest. v5 removes the competition and makes the empty answer
// diagnosable at the discovery boundary. This file pins the whole of that contract:
//
//   1. the policy states the primary task (this expediente's own obligations) and prioritizes
//      `requirements`; it no longer demands exhaustive enumeration anywhere;
//   2. the policy permits leaving a non-requirement unit unlisted and states the server-side
//      completion truthfully — never an exclusion, never analysed, always paused;
//   3. the policy does NOT demand at least one requirement, and the wire schema declares no
//      `minItems`: a fabricated obligation is never the price of a valid answer;
//   4. a canonical proposal with zero requirements — with valid explicit dispositions and the rest
//      auto-completed — is rejected at semantic_validation with the dedicated closed code
//      `v5_discovery_no_requirements`, after exactly ONE provider call;
//   5. the engine maps that tagged rejection to SAFE_INVALID + exactly one `output_rejected`, with
//      no main analysis turn; the post-bridge runner maps it to integral_v3_validation /
//      AGT002_INTEGRAL_V3_INVALID, and the worker classifier maps that to `invalid_output`;
//   6. a proposal with one real requirement still proceeds, and the v4 coverage completion is
//      untouched;
//   7. toAgt002RequirementManifest stays fail-closed on its own: the new boundary states the rule
//      one frontier earlier, it does not move it.
//
// No provider, network, bridge, DB, environment or UI is touched anywhere below, and no raw
// expediente text ever reaches a message, a log or an observability field.

const hash = value => createHash('sha256').update(value).digest('hex');

const SNAPSHOT_ID = '77777777-7777-4777-8777-777777777777';
const OPPORTUNITY_ID = '11111111-2222-4333-8444-777777777777';

const PARAGRAPHS = [
  'El oferente debera acreditar experiencia especifica en vigilancia hospitalaria durante los ultimos cinco anos.',
  'El contratista entregara un informe mensual de operaciones dentro de los primeros cinco dias habiles de cada mes.',
  'El plazo de ejecucion del contrato sera de doce meses contados a partir del acta de inicio del contrato.',
  'Queda prohibido subcontratar el servicio de monitoreo sin autorizacion previa y escrita de la entidad.',
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

// The SAME inventory builder agt002-preview-engine.js uses on the discovery path, so the ids below
// are exactly the ids a real run of this snapshot would produce.
const inventory = buildAgt002TenderRequirementInventory({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] });
assert.equal(inventory.source_units.length, PARAGRAPHS.length, 'fixture must produce one analyzable unit per paragraph');

const resolvedTexts = resolveTenderInventorySourceTexts({ inventory, documents });
const packetUnits = [...resolvedTexts.entries()]
  .map(([sourceUnitId, value]) => ({ source_unit_id: sourceUnitId, text: value.text, source_text: value.text, index: value.index }))
  .sort((left, right) => left.index - right.index);
const unitIdByParagraph = PARAGRAPHS.map(paragraph => {
  const unit = packetUnits.find(entry => entry.text === paragraph);
  assert.ok(unit, 'fixture must resolve every paragraph to its own source unit');
  return unit.source_unit_id;
});

const catalog = buildTenderSemanticLabelCatalog({ units: packetUnits, maxCatalogChars: 40_000 });
const ownerIndex = buildTenderSemanticLabelOwnerIndex({
  orderedUnitIds: packetUnits.map(unit => unit.source_unit_id),
  candidatesByUnitId: catalog.candidates_by_unit_id,
});
const LABEL = catalog.candidates.find(candidate => {
  const owners = ownerIndex.get(candidate) ?? [];
  return owners.length === 1 && owners[0] === unitIdByParagraph[0];
});
assert.ok(LABEL, 'fixture must expose a catalog candidate exclusive to the first paragraph');

function countingClient(proposal) {
  const captured = { calls: 0 };
  return {
    captured,
    run: async request => {
      captured.calls += 1;
      captured.request = request;
      return { content: JSON.stringify(proposal), usage: { input_tokens: 11, output_tokens: 13 } };
    },
  };
}

// A canonical, fully well-formed proposal that simply resolved no obligation: two units carry
// valid EXPLICIT dispositions, and the remaining two are left unlisted for the v4 completion to
// pick up. Nothing here is a wrong claim — which is precisely why it needs its own boundary.
function zeroRequirementProposal() {
  return {
    requirements: [],
    excluded: [{ source_unit_id: unitIdByParagraph[0], reason: 'descriptive_or_contextual' }],
    unresolved: [{ source_unit_id: unitIdByParagraph[1], reason: 'obligation_not_classifiable' }],
  };
}

function positiveProposal() {
  return {
    requirements: [{ kind: 'obligation', label: LABEL, front: 'technical', category: 'technical' }],
    excluded: [{ source_unit_id: unitIdByParagraph[1], reason: 'descriptive_or_contextual' }],
    unresolved: [],
  };
}

function run(client) {
  return discoverTenderSemanticManifest({
    client,
    model: 'test-model',
    timeoutMs: 1000,
    idempotencyKey: 'idem-v5-obligation-contract',
    inventory,
    documents,
  });
}

// ---------------------------------------------------------------------------------------------
// 1. The policy states the primary task and prioritizes obligations — and no longer asks for the
//    exhaustive enumeration the server already performs.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(
    TENDER_SEMANTIC_DISCOVERY_POLICY_VERSION,
    'tender-semantic-discovery.v8',
    'the model-facing task and the disposition duty both changed in v5, v6 changed how a repeated '
    + 'obligation is canonicalized, v7 replaced the single request with a multi-batch input, and v8 '
    + 'retracts a self-contradicting claim instead of rejecting the whole batch, so the policy '
    + 'version must move with each',
  );

  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Tu tarea principal es identificar las obligaciones propias de ESTE expediente/,
    'the policy must state that identifying this expediente\'s own obligations is the primary task',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /La lista "requirements" es la parte prioritaria de tu respuesta/,
    'the policy must state that requirements is the priority of the answer',
  );
  // Source-grounded and unique to THIS process: no import from another tender or from priors.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /expresamente presentes en las unidades fuente recibidas, y no traigas ninguna de otro proceso ni de tu conocimiento previo/,
    'the policy must keep every obligation grounded in this expediente\'s own received units',
  );

  // The competing instruction is gone, in every form it took.
  for (const forbidden of [
    /Dispón todas las source_units exactamente una vez/,
    /No omitas unidades/,
    /Dispón allí exactamente las unidades restantes, todas ellas/,
    /Cada unidad recibe exactamente una disposición/,
    /Clasifica todo lo que el texto recibido te permita clasificar/,
  ]) {
    assert.doesNotMatch(
      TENDER_SEMANTIC_DISCOVERY_POLICY,
      forbidden,
      `the policy must no longer ask the model to enumerate every unit: ${forbidden}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Unlisted units are permitted, and their only consequence is the server-side unresolved
//    completion — never an exclusion, never "analysed", always paused.
// ---------------------------------------------------------------------------------------------
{
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Las listas "excluded" y "unresolved" son opcionales y secundarias/,
    'the policy must state the two disposition lists are optional and secondary',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /no debes rellenarlas por cobertura/,
    'the policy must forbid padding the disposition lists for coverage',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Puedes dejar sin listar cualquier unidad que no sustente un requisito/,
    'the policy must explicitly permit leaving a non-requirement unit unlisted',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /el servidor la conservará por su cuenta como unidad sin resolver con la razón "source_unit_not_dispositioned"/,
    'the policy must state the deterministic server-side completion by its closed reason',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Una omisión nunca se convierte en exclusión ni se da por analizada/,
    'the policy must state that an omission never becomes an exclusion nor counts as analysed',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /mantiene el análisis en pausa, sin disponibilidad para decidir/,
    'the policy must state that a preserved omission keeps the decision paused',
  );

  // The uniqueness/overlap rules are NOT relaxed by any of this: they are still stated, as bounds.
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /Ninguna unidad puede recibir más de una disposición/,
    'the policy must keep the at-most-one-disposition bound',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /No incluyas en "excluded" ni en "unresolved" ninguna unidad cuyo texto contenga literalmente un fragmento que hayas elegido como "label"/,
    'the policy must keep the derived-citation overlap rule',
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Nothing anywhere demands a non-empty `requirements`: not the policy, not the wire schema.
//    A forced non-empty list would force a fabricated obligation, which is the failure this whole
//    frontier exists to prevent.
// ---------------------------------------------------------------------------------------------
{
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /No inventes requisitos para llenar la lista/,
    'the policy must forbid inventing a requirement to fill the list',
  );
  assert.match(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /devuelve "requirements" vacío: es una respuesta permitida por el esquema/,
    'the policy must state that an honestly empty requirements list is a permitted answer',
  );
  assert.doesNotMatch(
    TENDER_SEMANTIC_DISCOVERY_POLICY,
    /al menos un requisito|al menos una obligación|debes proponer un requisito/i,
    'the policy must never demand at least one requirement',
  );

  const client = countingClient(positiveProposal());
  await run(client);
  const requirementsSchema = client.captured.request.outputSchema.properties.requirements;
  assert.equal(
    Object.hasOwn(requirementsSchema, 'minItems'), false,
    'the wire schema must not force a non-empty requirements list',
  );
  assert.ok(
    !JSON.stringify(client.captured.request.outputSchema).includes('minItems'),
    'no minItems may appear anywhere in the discovery output schema',
  );
  // The rest of the wire contract is untouched: literal label enum, and server-owned source ids
  // confined to the two disposition lists.
  assert.deepEqual(
    [...requirementsSchema.items.properties.label.enum].sort(),
    [...catalog.candidates].sort(),
    'the label enum must still be exactly this snapshot\'s literal catalog',
  );
  assert.deepEqual(
    Object.keys(requirementsSchema.items.properties).sort(),
    ['category', 'front', 'kind', 'label'],
    'a wire requirement must still declare exactly the four model-decided fields',
  );
}

// ---------------------------------------------------------------------------------------------
// 4. The zero-requirement proposal is rejected at the discovery boundary, with its own closed
//    code, after exactly one provider call — and the message carries no expediente content.
// ---------------------------------------------------------------------------------------------
{
  assert.equal(TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE, 'v5_discovery_no_requirements');
  assert.ok(
    TENDER_SEMANTIC_DISCOVERY_VALIDATION_CODES.includes(TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE),
    'the new boundary code must be a member of the closed catalog',
  );

  const client = countingClient(zeroRequirementProposal());
  let caught;
  try {
    await run(client);
    assert.fail('a proposal that resolved no obligation must not produce a manifest');
  } catch (error) {
    caught = error;
  }

  assert.equal(
    caught.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION,
    'the empty proposal is a post-response semantic rejection, never an untagged failure',
  );
  assert.equal(caught.code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE);
  assert.match(caught.message, /no identificó ninguna obligación propia de este proceso/);
  assert.equal(client.captured.calls, 1, 'the provider must be called exactly once: no retry, no second turn');

  // Privacy: the safe Spanish message never embeds a label, a source_unit id or source text.
  for (const secret of [...PARAGRAPHS, LABEL, ...unitIdByParagraph]) {
    assert.ok(!caught.message.includes(secret), 'the rejection message must never carry expediente content or ids');
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Engine + post-bridge + worker: the tagged rejection becomes a diagnosable output_rejected,
//    never the opaque SAFE_UNAVAILABLE / provider_error the live run produced.
// ---------------------------------------------------------------------------------------------
function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

function engineWithRealDiscovery(client) {
  return createAgt002PreviewEngine({
    client,
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    // The REAL discovery module, driven by the engine's own client — so the single provider call
    // below is the discovery turn itself, and a second call would be the main analysis turn.
    semanticDiscoveryProvider: discoverTenderSemanticManifest,
    observability: spyObservability(),
  });
}

{
  const client = countingClient(zeroRequirementProposal());
  const observability = spyObservability();
  const engine = createAgt002PreviewEngine({
    client,
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-preview-policy-v1',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider: discoverTenderSemanticManifest,
    observability,
  });

  await assert.rejects(
    () => engine.analyze({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [] }),
    (error) => {
      assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.',
        'the empty frontier must surface as SAFE_INVALID, never the engine\'s opaque SAFE_UNAVAILABLE');
      assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
      assert.equal(error.code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE,
        'the engine must trust the v5 code through its closed pattern instead of collapsing it to the fallback');
      return true;
    },
  );

  assert.equal(client.captured.calls, 1, 'exactly one provider call: the discovery turn, and NO main analysis turn');
  assert.equal(observability.records.length, 1, 'exactly one output_rejected event');
  const { eventType, fields } = observability.records[0];
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.SEMANTIC_VALIDATION);
  assert.equal(fields.validation_code, TENDER_SEMANTIC_DISCOVERY_NO_REQUIREMENTS_CODE);
  const serialized = JSON.stringify(observability.records);
  for (const secret of [...PARAGRAPHS, LABEL]) {
    assert.ok(!serialized.includes(secret), 'no expediente content may reach the observability event');
  }
}

// The same rejection, carried through the REAL post-bridge runner: stage integral_v3_validation and
// the closed AGT002_INTEGRAL_V3_INVALID code, which the worker classifier maps to invalid_output —
// never 'unexpected'/provider_error, which is what the live run recorded.
function fakeDatabase() {
  const calls = [];
  let attemptSeq = 0;
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'psi_append_agt002_analysis_attempt') {
        attemptSeq += 1;
        return { data: { id: `attempt-event-${attemptSeq}`, ...params }, error: null };
      }
      if (name === 'psi_release_agt002_preview_claim') return { data: true, error: null };
      if (name === 'psi_record_agt002_canonical_analysis_run') {
        return { data: null, error: { message: 'persistence must never be reached for an empty frontier' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

{
  const client = countingClient(zeroRequirementProposal());
  const engine = engineWithRealDiscovery(client);
  const observability = spyObservability();
  const database = fakeDatabase();

  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: '00000000-0000-4000-8000-000000000073',
    snapshotId: SNAPSHOT_ID,
    contextVersionId: '00000000-0000-4000-8000-000000000075',
    attemptKey: 'reanalysis:v5-obligation-contract',
    correlationId: '00000000-0000-4000-8000-000000000071',
    claimId: 'claim-v5',
    idempotencyKey: 'b'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine,
    observability,
    analysisContext: { snapshotId: SNAPSHOT_ID, documents, documentGaps: [] },
    // The live shape: the bridge was invoked AND answered. Under the old behaviour this is exactly
    // what forced classifyEnginePhase into 'unexpected'.
    bridgeTelemetry: { invocationStarted: true, responseReceived: true },
    integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(result.error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.equal(client.captured.calls, 1, 'no retry and no analysis turn anywhere on the post-bridge path');

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'integral_v3_validation');
  assert.notEqual(fields.stage, 'unexpected', 'the live misclassification must not survive this fix');
  assert.equal(fields.error_code, 'AGT002_INTEGRAL_V3_INVALID');
  assert.notEqual(fields.error_code, 'AGT002_PROVIDER_ERROR', 'an empty frontier is never the provider\'s failure');
  assert.equal(
    database.calls.some(call => call.name === 'psi_record_agt002_canonical_analysis_run'), false,
    'an empty frontier must never reach persistence',
  );

  // The queue-facing half: the closed post-bridge code maps to invalid_output, not provider_error.
  assert.equal(classifyAgt002ReanalysisWorkerError({ code: result.error_code }), 'invalid_output');

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const secret of [...PARAGRAPHS, LABEL]) {
    assert.ok(!serialized.includes(secret), 'no expediente content may reach the durable row or observability');
  }
}

// ---------------------------------------------------------------------------------------------
// 6. A proposal with one real requirement still proceeds, and the v4 coverage completion is
//    untouched: the two unlisted units are still preserved as unresolved holes.
// ---------------------------------------------------------------------------------------------
{
  const client = countingClient(positiveProposal());
  const discovered = await run(client);

  assert.equal(client.captured.calls, 1);
  assert.equal(discovered.semanticManifest.requirements.length, 1, 'the single real obligation must survive');
  assert.deepEqual(
    discovered.semanticManifest.requirements[0].citations.map(citation => citation.source_unit_id),
    [unitIdByParagraph[0]],
    'the derived citation is unchanged by the v5 boundary',
  );
  assert.deepEqual(
    discovered.semanticManifest.excluded.map(entry => entry.source_unit_id),
    [unitIdByParagraph[1]],
  );
  assert.deepEqual(
    discovered.semanticManifest.unresolved.map(entry => [entry.source_unit_id, entry.reason]),
    unitIdByParagraph.slice(2).map(sourceUnitId => [sourceUnitId, 'source_unit_not_dispositioned']),
    'the v4 completion still preserves every unlisted unit, in source-packet order',
  );
  assert.equal(discovered.semanticManifest.discovery_coverage.status, 'partial');
  assert.equal(discovered.semanticManifest.decision_ready, false);
  assert.equal(discovered.semanticManifest.recommendation, 'pause');
}

// ---------------------------------------------------------------------------------------------
// 7. The projection frontier stays fail-closed on its own. The v5 boundary states the rule one
//    turn earlier so the failure is attributable; it does not move the rule, and it is not the
//    only thing standing between an empty manifest and the analysis turn.
// ---------------------------------------------------------------------------------------------
{
  // Exactly the manifest the v4 completion produces for a proposal that resolved nothing: every
  // analyzable unit preserved as a hole, no requirement, no exclusion invented.
  const emptyManifest = assembleTenderSemanticManifest({
    inventory,
    documents,
    origin: 'model_proposal',
    proposalHash: hash('propuesta-sin-obligaciones'),
    requirements: [],
    excluded: [],
    unresolved: inventory.source_units.map(unit => ({
      source_unit_id: unit.source_unit_id,
      reason: 'source_unit_not_dispositioned',
    })),
  });
  assert.equal(emptyManifest.requirements.length, 0, 'sanity: the fixture manifest really resolves no requirement');

  assert.throws(
    () => toAgt002RequirementManifest({ semanticManifest: emptyManifest, inventory, documents }),
    /no resolvió ningún requisito propio de este proceso/,
    'toAgt002RequirementManifest must keep refusing to project an empty frontier',
  );
}

console.log('tests/tender-semantic-discovery-v5-obligation-contract.test.mjs OK');
