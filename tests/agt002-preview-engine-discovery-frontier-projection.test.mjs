// RED (TDD) — AGT-002 V4/V5 discovered frontier: the MODEL-FACING projection of the two
// per-source-unit audit ledgers.
//
// WHY THIS FILE EXISTS (the exact blocker it closes)
//   The live V5 structural diagnostic reported requirements=16 and unresolved=11329 for one real
//   expediente, and buildAgt002PreviewInput succeeded. The job then logged only the discovery-bridge
//   success and the engine threw BEFORE the integral analysis turn was ever issued. In runOnceV3 the
//   assembled `modelInput` still embedded document_evidence.tender_requirement_inventory (11k source
//   units) and document_evidence.tender_semantic_manifest (11k unresolved entries), while
//   budgetAgt002V3PromptRequest only ever reduces the raw `selected_chunks` text and the
//   omitted-chunk list — it never touches governed content. So the deterministic budget failed closed
//   (AGT002_V3_PROMPT_BUDGET_EXCEEDED) before the provider call, and, being untagged, that rejection
//   reached the post-bridge classifier as 'unexpected'/provider_error: the provider was blamed for a
//   refusal the server made on its own, without calling it.
//
// WHAT IS PINNED HERE
//   1. A deterministic, privacy-safe model-facing projection used ONLY for discovered frontiers:
//      the two full ledgers are replaced by one small immutable `semantic_frontier_summary` of
//      server-derived structural facts. No source_unit id, unit hash, label, document id or raw text.
//   2. Prompt budgeting runs AFTER that projection, and the durable envelope's `evidence_coverage`
//      still persists the COMPLETE original inventory + semantic manifest, every unresolved unit
//      included — so nothing auditable is lost.
//   3. Legacy, non-V3 and exact-Manizales requests are untouched: complete inventory, no summary key.
//   4. A prompt-budget rejection taken after the discovery turn is now attributed to the closed
//      pre-provider ENVELOPE stage, so post-bridge maps it to envelope_build / AGT002_ENVELOPE_INVALID
//      (worker: invalid_output) instead of provider_error/unexpected.
//
// No real provider, bridge, network, Supabase or secret is used anywhere below. Every fixture is
// synthetic; the live diagnostic is referenced only as the motivation for the shape of the fixture.
//
// Run: node tests/agt002-preview-engine-discovery-frontier-projection.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  AGT002_INTEGRAL_V3_POLICY,
  AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY,
  buildAgt002SemanticFrontierSummary,
  createAgt002PreviewEngine,
  projectAgt002DiscoveredModelInput,
} from '../agt002-preview-engine.js';
import { buildAgt002PreviewInput, buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import { buildTenderSemanticManifest } from '../tender-semantic-manifest.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_OUTPUT_REJECTION_STAGES } from '../agt002-analysis-observability.js';
import {
  AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE,
  AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
  budgetAgt002V3PromptRequest,
  estimateAgt002V3RequestTokens,
} from '../agt002-v3-prompt-budget.js';
import { runAgt002PostBridgeAnalysis } from '../agt002-post-bridge-observability.js';
import { classifyAgt002ReanalysisWorkerError } from '../agt002-reanalysis-worker.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

const MODEL = 'synthetic-codex-model';
const SNAPSHOT_ID = '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a';
const OPPORTUNITY_ID = '4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';

// ---------------------------------------------------------------------------------------------
// A large synthetic expediente, shaped like the one that produced the live blocker: a few real
// obligations and THOUSANDS of clauses the deterministic stage cannot resolve (a deontic marker
// with no derivable subject), each of which becomes its own inventory source unit and its own
// `unresolved` manifest entry. Nothing here is a real tender: the clause text is generated.
// ---------------------------------------------------------------------------------------------
const UNRESOLVED_CLAUSE_COUNT = 2000;
const REQUIREMENT_LABELS = ['Residencia de datos', 'Nivel de apalancamiento'];

const PLIEGO_LINES = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  ...Array.from(
    { length: UNRESOLVED_CLAUSE_COUNT },
    (_value, index) => `Anotacion ${String(index + 1).padStart(5, '0')} el interesado debera observar el reglamento aplicable sin excepcion alguna.`,
  ),
];
// Joined with SINGLE newlines on purpose: the inventory segments one source unit per line (so the
// ledgers really do carry thousands of entries), while document chunking splits on BLANK lines, so
// the retrieval packet stays an ordinary handful of windows — exactly the asymmetry that made the
// ledgers, not the evidence, the thing that blew the budget.
const PLIEGO_TEXT = PLIEGO_LINES.join('\n');

const bigDocuments = [{
  document_id: 'sintetico-pliego',
  document_version_id: 'sintetico-pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: OPPORTUNITY_ID, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-24T00:00:00.000Z' },
      tender: {
        id: 'tender-sintetico', title: 'Proceso sintético', entity: 'Entidad sintética',
        source: 'SECOP II', updated_at: '2026-08-24T00:00:00.000Z',
      },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Sintética Ltda.', updated_at: '2026-08-24T00:00:00.000Z' },
      documents: [],
    }),
  };
}

const bigInventory = buildAgt002TenderRequirementInventory({
  snapshotId: SNAPSHOT_ID, documents: bigDocuments, documentGaps: [],
});
const bigManifest = buildTenderSemanticManifest({ inventory: bigInventory, documents: bigDocuments });

// Sanity on the fixture itself, so a later assertion can never pass against a degenerate manifest.
assert.equal(bigManifest.requirements.length, REQUIREMENT_LABELS.length, 'the fixture must resolve at least one real requirement');
assert.deepEqual([...bigManifest.requirements.map(entry => entry.label)].sort(), [...REQUIREMENT_LABELS].sort());
assert.ok(bigManifest.unresolved.length >= 2000, 'the fixture must carry thousands of unresolved source units, like the live expediente');
assert.equal(bigManifest.coverage_ledger.unresolved_count, UNRESOLVED_CLAUSE_COUNT);
assert.equal(bigManifest.coverage_ledger.total_source_units, bigInventory.source_units.length);
assert.equal(bigManifest.discovery_coverage.status, 'partial');
assert.equal(bigManifest.decision_ready, false);

const bigPreviewArgs = {
  snapshotId: SNAPSHOT_ID,
  contextV2: true,
  documentRetrieval: true,
  integralContractV3: true,
  companyEvidenceClasses: { classes: [] },
  contextV2Sections: contextV2Sections(),
  documents: bigDocuments,
  documentGaps: [],
  deepAnalysis: {},
};

/** Exactly the packet the engine assembles for this snapshot once discovery has produced a frontier. */
const bigPreviewInput = buildAgt002PreviewInput({ ...bigPreviewArgs, semanticManifest: bigManifest });

// A small expediente, used where the ledger size is irrelevant (the legacy control below and the
// budget-verdict scenarios in sections 6/7).
const SMALL_TEXT = [
  'REQUISITOS TÉCNICOS',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');
const smallDocuments = [{
  document_id: 'pequeno-pliego', document_version_id: 'pequeno-pliego-v1', opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null, document_type: 'pliego', name: 'Pliego.pdf', version: 1,
  content_hash: hash(SMALL_TEXT), current: true, extracted_text: SMALL_TEXT,
}];

// =============================================================================================
// 1. The pure projection: what it removes, what it keeps, and what it may never carry.
// =============================================================================================
{
  const before = clone(bigPreviewInput);
  const projected = projectAgt002DiscoveredModelInput(bigPreviewInput);

  // (1a) The original packet is never mutated — this is exactly what makes it safe for
  // buildEvidenceCoverage(previewInput, …) to keep persisting the complete ledgers afterwards.
  assert.deepEqual(bigPreviewInput, before, 'projecting must never mutate the original preview input');
  assert.ok(bigPreviewInput.document_evidence.tender_requirement_inventory, 'the original packet keeps its inventory');
  assert.ok(bigPreviewInput.document_evidence.tender_semantic_manifest, 'the original packet keeps its semantic manifest');
  assert.notEqual(projected, bigPreviewInput, 'the projection is a new object, never the packet itself');
  assert.notEqual(projected.document_evidence, bigPreviewInput.document_evidence);

  const evidence = projected.document_evidence;

  // (1b) The two full audit ledgers are gone from the model-facing copy.
  assert.equal(Object.hasOwn(evidence, 'tender_requirement_inventory'), false, 'the full inventory must not reach the provider');
  assert.equal(Object.hasOwn(evidence, 'tender_semantic_manifest'), false, 'the full semantic manifest must not reach the provider');

  // (1c) …replaced by exactly one small, immutable, server-derived summary with exact counts.
  const summary = evidence[AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY];
  assert.equal(AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY, 'semantic_frontier_summary');
  assert.ok(Object.isFrozen(summary), 'the summary is a fact about the run, never an editable slot');
  assert.deepEqual(Object.keys(summary).sort(), [
    'analyzable_source_units', 'analyzed_coverage_status', 'decision_ready', 'discovery_coverage_status',
    'excluded_count', 'inventory_version', 'material_omissions', 'requirement_count',
    'semantic_manifest_version', 'total_source_units', 'unresolved_count',
  ], 'the summary carries exactly the closed set of server-derived structural fields');
  assert.deepEqual(summary, {
    inventory_version: bigInventory.inventory_version,
    semantic_manifest_version: bigManifest.semantic_manifest_version,
    total_source_units: bigManifest.coverage_ledger.total_source_units,
    analyzable_source_units: bigInventory.coverage_ledger.analyzable_count,
    requirement_count: REQUIREMENT_LABELS.length,
    excluded_count: bigManifest.coverage_ledger.excluded_count,
    unresolved_count: UNRESOLVED_CLAUSE_COUNT,
    discovery_coverage_status: 'partial',
    analyzed_coverage_status: 'incomplete',
    decision_ready: false,
    material_omissions: bigPreviewInput.document_evidence.material_omissions,
  });
  assert.equal(summary.material_omissions, true, 'thousands of unresolved units are a declared material omission of this packet');

  // (1d) Privacy: no source_unit id, no unit/inventory/snapshot hash, no label, no document id and
  // no clause text may appear anywhere in the summary.
  const serializedSummary = JSON.stringify(summary);
  assert.equal(/[0-9a-f]{64}/.test(serializedSummary), false, 'no sha256 hash may appear in the summary');
  assert.equal(serializedSummary.includes('unit:'), false, 'no source_unit id may appear in the summary');
  assert.equal(serializedSummary.includes('sreq:'), false, 'no requirement id may appear in the summary');
  for (const label of REQUIREMENT_LABELS) {
    assert.equal(serializedSummary.includes(label), false, `the summary must never carry the obligation label ${label}`);
  }
  for (const leak of ['sintetico-pliego', 'Anotacion', 'reglamento aplicable', 'REQUISITOS']) {
    assert.equal(serializedSummary.includes(leak), false, `the summary must never carry ${leak}`);
  }
  for (const unit of bigInventory.source_units.slice(0, 25)) {
    assert.equal(serializedSummary.includes(unit.source_unit_id), false);
    assert.equal(serializedSummary.includes(unit.unit_hash), false);
    assert.equal(serializedSummary.includes(unit.document_id), false);
  }

  // (1e) Everything governed survives untouched: the requirement manifest (complete), the evidence
  // classes, the selected evidence, the allowlist, the coverage manifest, material_omissions and
  // the declared supplemental signals. Nothing but the two ledgers changed.
  const original = bigPreviewInput.document_evidence;
  const untouchedKeys = Object.keys(original)
    .filter(key => key !== 'tender_requirement_inventory' && key !== 'tender_semantic_manifest');
  for (const key of untouchedKeys) {
    assert.deepEqual(evidence[key], original[key], `${key} must reach the provider unchanged by the projection`);
  }
  assert.deepEqual(
    Object.keys(evidence).sort(),
    [...untouchedKeys, AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY].sort(),
    'the projection removes exactly two keys and adds exactly one',
  );
  for (const key of Object.keys(bigPreviewInput).filter(key => key !== 'document_evidence')) {
    assert.deepEqual(projected[key], bigPreviewInput[key], `${key} outside document_evidence must be untouched`);
  }
  assert.equal(evidence.requirement_manifest.length, REQUIREMENT_LABELS.length, 'the requirement manifest stays complete');
}

// =============================================================================================
// 2. A packet with NO discovered frontier is returned unchanged, by reference: this is what makes
//    the legacy / non-V3 / exact-Manizales request byte-identical even if the projection is reached.
// =============================================================================================
{
  // A legacy packet carries no document_evidence at all.
  const legacyShaped = { snapshot_id: SNAPSHOT_ID, opportunity: { id: OPPORTUNITY_ID } };
  assert.equal(buildAgt002SemanticFrontierSummary(undefined), null);
  assert.equal(buildAgt002SemanticFrontierSummary(legacyShaped.document_evidence), null);
  assert.equal(projectAgt002DiscoveredModelInput(legacyShaped), legacyShaped,
    'a packet with no document_evidence is returned by reference, unchanged');

  // An exact-Manizales / fixed-matrix packet carries an inventory but declares NO semantic frontier.
  const noFrontier = {
    snapshot_id: SNAPSHOT_ID,
    document_evidence: { tender_requirement_inventory: bigInventory, material_omissions: false },
  };
  assert.equal(buildAgt002SemanticFrontierSummary(noFrontier.document_evidence), null, 'no frontier, no summary');
  assert.equal(projectAgt002DiscoveredModelInput(noFrontier), noFrontier,
    'a packet that declares no semantic frontier is returned by reference, unchanged');
}

// =============================================================================================
// 3. THE BLOCKER: before the projection the assembled shape cannot fit the configured budget, even
//    after the budget's own maximal reduction — because the ledgers are governed content it may
//    never touch. After the projection the same run fits.
// =============================================================================================
{
  const requestOf = input => ({ model: MODEL, policy: AGT002_INTEGRAL_V3_POLICY, input, outputSchema: {} });

  // A deliberately conservative lower bound: the real request also carries the V3 output schema,
  // which only makes it larger. Even without it, the pre-projection shape is far over budget.
  const beforeTokens = estimateAgt002V3RequestTokens(requestOf(bigPreviewInput));
  assert.ok(
    beforeTokens > AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    `the pre-projection shape must exceed the configured budget (${beforeTokens} > ${AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS})`,
  );
  assert.throws(
    () => budgetAgt002V3PromptRequest({ ...requestOf(bigPreviewInput), maxInputTokens: AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS }),
    error => {
      assert.equal(error.code, AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE);
      return true;
    },
    'the budget cannot rescue the pre-projection shape: the ledgers are governed content it never reduces',
  );

  const projected = projectAgt002DiscoveredModelInput(bigPreviewInput);
  const budgeted = budgetAgt002V3PromptRequest({
    ...requestOf(projected), maxInputTokens: AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
  });
  assert.ok(
    estimateAgt002V3RequestTokens(requestOf(budgeted.input)) <= AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'after the projection the same run fits the configured budget',
  );
  assert.equal(budgeted.input.document_evidence.requirement_manifest.length, REQUIREMENT_LABELS.length,
    'budgeting after the projection still never touches the governed requirement manifest');
}

// =============================================================================================
// 4. End to end through the REAL engine: the discovered run reaches the mock client exactly once,
//    within budget; the request carries no audit ledger and the exact summary; and the durable
//    envelope still persists the COMPLETE original inventory and manifest, unresolved units included.
// =============================================================================================
function buildV3AbstainedUnits(input) {
  return input.document_evidence.requirement_manifest.map((entry, index) => ({
    unit_id: `UNIT-${index + 1}`, unit_kind: 'tender_requirement', requirement_id: entry.requirement_id,
    category: null, sequence: index + 1, title: entry.label.slice(0, 200), assessment_mode: 'abstained',
    conclusion: { status: 'human_validation_required', summary: 'Pendiente de validación humana.', confidence: 'unavailable' },
    blocking: { effect: 'undetermined', curability: 'undetermined', reason: 'Sin determinación automática; requiere revisión humana.' },
    evidence_state: null, evidence_refs: [], missing_evidence: [],
    commercial_impact: { level: 'unknown', summary: 'Impacto no determinado.', dimension: 'unknown' },
    legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica fundamento jurídico.', human_legal_review_required: false },
    actions: [],
    milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
    escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
    closure: { status: 'human_confirmation_required', condition: 'Persona autorizada valida.', evidence_required: [] },
    human_validation: { required: true, status: 'pending', reason: 'Validación humana pendiente.' },
  }));
}

function fakeClient(handler) {
  const calls = [];
  return { calls, run: async (options) => { calls.push(options); return handler(options, calls.length); } };
}

/** Exactly the shape the production discovery stage returns for the snapshot it was handed. */
function structuralDiscovery(options) {
  const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
  return {
    semanticManifest: discovered,
    categoryOverrides: Object.fromEntries(discovered.requirements.map(requirement => [
      requirement.requirement_id,
      requirement.front === 'financial' ? 'habilitating' : 'technical',
    ])),
    usage: { input_tokens: 11, output_tokens: 5 },
  };
}

function discoveryEngine(client, overrides = {}) {
  return createAgt002PreviewEngine({
    client,
    model: MODEL,
    policyVersion: 'agt002-integral-v3-policy-test',
    policyText: AGT002_INTEGRAL_V3_POLICY,
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID,
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider: async options => structuralDiscovery(options),
    promptBudget: true,
    ...overrides,
  });
}

{
  const client = fakeClient(options => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  const engine = discoveryEngine(client);

  const result = await engine.analyze({
    snapshotId: SNAPSHOT_ID, documents: bigDocuments, documentGaps: [],
    deepAnalysis: {}, contextV2Sections: contextV2Sections(),
  });

  // (4a) The analysis turn was actually taken — exactly once — and fits the configured budget.
  assert.equal(client.calls.length, 1, 'the discovered run must reach the provider exactly once');
  const sent = client.calls[0];
  assert.ok(
    estimateAgt002V3RequestTokens({ model: sent.model, policy: sent.policy, input: sent.input, outputSchema: sent.outputSchema })
      <= AGT002_V3_PROMPT_DEFAULT_MAX_INPUT_TOKENS,
    'the request actually sent to the provider must fit the configured budget',
  );

  // (4b) The request carries no audit ledger, the exact summary, and a COMPLETE requirement manifest.
  const requestEvidence = sent.input.document_evidence;
  assert.equal(Object.hasOwn(requestEvidence, 'tender_requirement_inventory'), false);
  assert.equal(Object.hasOwn(requestEvidence, 'tender_semantic_manifest'), false);
  assert.deepEqual(requestEvidence[AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY], {
    inventory_version: bigInventory.inventory_version,
    semantic_manifest_version: bigManifest.semantic_manifest_version,
    total_source_units: bigManifest.coverage_ledger.total_source_units,
    analyzable_source_units: bigInventory.coverage_ledger.analyzable_count,
    requirement_count: REQUIREMENT_LABELS.length,
    excluded_count: bigManifest.coverage_ledger.excluded_count,
    unresolved_count: UNRESOLVED_CLAUSE_COUNT,
    discovery_coverage_status: 'partial',
    analyzed_coverage_status: 'incomplete',
    decision_ready: false,
    material_omissions: true,
  });
  assert.deepEqual(
    requestEvidence.requirement_manifest.map(entry => entry.requirement_id).sort(),
    bigPreviewInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id).sort(),
    'every discovered requirement still reaches the model',
  );
  for (const entry of requestEvidence.requirement_manifest) {
    assert.match(entry.requirement_id, /^sreq:[0-9a-f]{32}$/);
    assert.ok(['habilitating', 'technical'].includes(entry.category), 'the governed category still travels with each requirement');
    assert.ok(entry.evidence_state_governed && typeof entry.evidence_state_governed === 'object',
      'the governed evidence_state still travels with each requirement');
  }
  // The unresolved ledger really is absent from the wire, not merely renamed.
  const serializedRequest = JSON.stringify(sent.input);
  for (const entry of bigManifest.unresolved.slice(0, 25)) {
    assert.equal(serializedRequest.includes(entry.source_unit_id), false, 'no unresolved source_unit id may reach the provider');
    assert.equal(serializedRequest.includes(entry.unit_hash), false, 'no unresolved unit hash may reach the provider');
  }

  // (4c) NO AUDIT / PROVENANCE LOSS: the durable envelope keeps the complete original ledgers.
  const coverage = result.evidence_coverage;
  assert.equal(result.status, 'completed');
  assert.deepEqual(coverage.tender_requirement_inventory, bigInventory,
    'the durable coverage must persist the complete original inventory, verbatim');
  assert.equal(coverage.tender_requirement_inventory.source_units.length, bigInventory.source_units.length);
  const persistedManifest = coverage.tender_semantic_manifest;
  assert.equal(persistedManifest.unresolved.length, UNRESOLVED_CLAUSE_COUNT,
    'every unresolved source unit must survive into the durable coverage');
  assert.deepEqual(persistedManifest.unresolved, bigManifest.unresolved, 'unresolved units are persisted verbatim');
  assert.deepEqual(persistedManifest.requirements, bigManifest.requirements);
  assert.deepEqual(persistedManifest.excluded, bigManifest.excluded);
  assert.deepEqual(persistedManifest.coverage_ledger, bigManifest.coverage_ledger);
  assert.deepEqual(persistedManifest.discovery_coverage, bigManifest.discovery_coverage);
  for (const key of ['semantic_manifest_version', 'snapshot_id', 'snapshot_hash', 'inventory_hash', 'origin', 'proposal_hash']) {
    assert.deepEqual(persistedManifest[key], bigManifest[key]);
  }
  // Readiness is still arithmetic: thousands of unresolved units keep the run paused.
  assert.equal(persistedManifest.decision_ready, false);
  assert.equal(persistedManifest.recommendation, 'pause');
  assert.equal(persistedManifest.human_review_required, true);
  assert.equal(result.human_review_required, true);
  // The summary is a model-facing projection ONLY: it must never appear in the durable envelope.
  assert.equal(JSON.stringify(result).includes(AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY), false,
    'the model-facing summary must never leak into the durable envelope');
}

// =============================================================================================
// 5. Legacy (non-V3) and exact-Manizales requests are untouched: complete inventory where the
//    packet has one, and no summary key anywhere.
// =============================================================================================
{
  // --- Legacy: no contextV2, no retrieval, no V3. The packet the client receives is the packet
  // buildAgt002PreviewInput produces, unchanged.
  const legacyContext = {
    opportunity: { id: OPPORTUNITY_ID, company_name: 'ACME', title: 'Vigilancia' },
    documents: smallDocuments, deepAnalysis: {}, snapshotId: SNAPSHOT_ID,
  };
  const legacyClient = fakeClient(() => ({
    content: JSON.stringify({
      recommendation: 'pause', summary: 'Falta confirmar la póliza.', strengths: [],
      weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:pequeno-pliego'] }],
      blockers: [], questions: [], unverified: [], next_action: 'Solicitar póliza vigente.', human_review_required: true,
    }),
    usage: { input_tokens: 1, output_tokens: 1 },
  }));
  const legacyEngine = createAgt002PreviewEngine({
    client: legacyClient, model: MODEL, policyVersion: 'agt002-preview-policy-v2', timeoutMs: 2000,
    maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0, idGenerator: () => FIXED_RUN_ID,
  });
  await legacyEngine.analyze(legacyContext);
  assert.equal(legacyClient.calls.length, 1);
  assert.deepEqual(
    legacyClient.calls[0].input,
    buildAgt002PreviewInput(legacyContext),
    'the legacy request is byte-identical to the packet the builder produces: nothing was projected',
  );
  assert.equal(JSON.stringify(legacyClient.calls[0].input).includes(AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY), false,
    'a legacy request must never carry the discovered-frontier summary');

  // --- Exact Manizales: the governed pilot package outranks discovery, so even with a discovery
  // provider injected the frontier is already decided, no discovery turn is taken, and the request
  // keeps the complete tender_requirement_inventory with no summary key.
  const manizalesSource = JSON.parse(
    readFileSync(new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8'),
  );
  const manizalesDocuments = [{
    document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
    document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
    extracted_text: 'Requiere póliza vigente de cumplimiento.',
  }];
  const manizalesDeepAnalysis = {
    matrix: {
      legal: [{
        id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
        evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
      }],
      financial: [], technical: [],
    },
  };
  const manizalesContext = {
    documents: manizalesDocuments, deepAnalysis: manizalesDeepAnalysis,
    snapshotId: SNAPSHOT_ID, contextV2Sections: contextV2Sections(),
  };

  let discoveryCalls = 0;
  const manizalesClient = fakeClient(() => ({ content: 'no-json', usage: { input_tokens: 3, output_tokens: 3 } }));
  const manizalesEngine = createAgt002PreviewEngine({
    client: manizalesClient, model: MODEL, policyVersion: 'agt002-integral-v3-policy-test',
    policyText: AGT002_INTEGRAL_V3_POLICY, timeoutMs: 2000, maxConcurrent: 2, dailyMaxRuns: 5,
    countDailyRuns: async () => 0, idGenerator: () => FIXED_RUN_ID,
    contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    manizalesManifestSource: manizalesSource,
    semanticDiscoveryProvider: async () => { discoveryCalls += 1; throw new Error('the governed pilot package must never take a discovery turn'); },
  });

  await assert.rejects(() => manizalesEngine.analyze(manizalesContext), /no produjo una respuesta válida/i,
    'invalid content is still rejected; only the assembled request is under test here');
  assert.equal(discoveryCalls, 0, 'the governed pilot package still outranks discovery');
  assert.equal(manizalesClient.calls.length, 1);

  const manizalesRequestEvidence = manizalesClient.calls[0].input.document_evidence;
  assert.equal(Object.hasOwn(manizalesRequestEvidence, AGT002_SEMANTIC_FRONTIER_SUMMARY_KEY), false,
    'the exact-Manizales request must never carry the discovered-frontier summary');
  assert.equal(manizalesRequestEvidence.tender_semantic_manifest, undefined,
    'the exact-Manizales packet never declared a semantic frontier, before or after this change');
  assert.ok(manizalesRequestEvidence.tender_requirement_inventory, 'the exact-Manizales request keeps its complete inventory');

  // Byte-level: every key of the request's document_evidence equals the independently built packet's,
  // except `requirement_manifest`, which the (pre-existing) governed-fields step augments with the
  // server-owned category/evidence_state_governed exactly as it did before this change.
  const independent = buildAgt002PreviewInput({
    ...manizalesContext, contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClasses: { classes: [] }, manizalesManifestSource: manizalesSource,
  }).document_evidence;
  assert.deepEqual(Object.keys(manizalesRequestEvidence).sort(), Object.keys(independent).sort(),
    'no key added to or removed from the exact-Manizales request');
  for (const key of Object.keys(independent).filter(key => key !== 'requirement_manifest')) {
    assert.deepEqual(manizalesRequestEvidence[key], independent[key], `${key} is unchanged in the exact-Manizales request`);
  }
  assert.deepEqual(
    manizalesRequestEvidence.requirement_manifest.map(entry => entry.requirement_id),
    independent.requirement_manifest.map(entry => entry.requirement_id),
  );
}

// =============================================================================================
// 6. Observability of a prompt-budget rejection taken AFTER the discovery turn: the closed
//    pre-provider ENVELOPE stage, never an untagged failure the post-bridge classifier has to
//    blame on the provider.
// =============================================================================================
function spyObservability() {
  const records = [];
  return { records, record: (eventType, fields) => { records.push({ eventType, fields }); return { event: eventType, ...fields }; } };
}

{
  const observability = spyObservability();
  const client = fakeClient((_options, call) => {
    if (call > 1) throw new Error('the analysis turn must never be taken once the budget failed closed');
    return { content: '{}', usage: { input_tokens: 4, output_tokens: 4 } };
  });
  const engine = createAgt002PreviewEngine({
    client, model: MODEL, policyVersion: 'agt002-integral-v3-policy-test', policyText: AGT002_INTEGRAL_V3_POLICY,
    timeoutMs: 2000, maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID, contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [], observability,
    // The discovery turn genuinely calls the bridge and it genuinely answers — the live shape.
    semanticDiscoveryProvider: async options => {
      await options.client.run({
        model: options.model, policy: 'discovery', input: { snapshot_id: options.inventory.snapshot_id },
        outputSchema: {}, timeoutMs: options.timeoutMs, idempotencyKey: options.idempotencyKey, signal: options.signal,
      });
      return structuralDiscovery(options);
    },
    // An impossibly small budget: the analysis request cannot fit, so it fails closed after discovery.
    promptBudget: true, promptMaxInputTokens: 1,
  });

  await assert.rejects(
    () => engine.analyze({
      snapshotId: SNAPSHOT_ID, documents: smallDocuments, documentGaps: [],
      deepAnalysis: {}, contextV2Sections: contextV2Sections(),
    }),
    error => {
      assert.equal(error.message, 'AGT-002 Preview no produjo una respuesta válida.',
        'the public message contract stays exactly the fixed SAFE_INVALID string');
      assert.equal(error.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE,
        'a pre-provider budget rejection must carry a closed, already-recognized stage');
      assert.equal(error.code, AGT002_V3_PROMPT_BUDGET_EXCEEDED_CODE,
        'the closed upstream code survives as private metadata');
      return true;
    },
  );

  assert.equal(client.calls.length, 1, 'exactly one provider call: the discovery turn, and ZERO integral turns');
  assert.equal(observability.records.length, 1, 'exactly one output_rejected event');
  const { eventType, fields } = observability.records[0];
  assert.equal(eventType, 'output_rejected');
  assert.equal(fields.stage, AGT002_OUTPUT_REJECTION_STAGES.ENVELOPE);
  assert.equal(fields.validation_code, 'v3_prompt_budget_exceeded');
  const serializedRecords = JSON.stringify(observability.records);
  for (const leak of ['Residencia de datos', 'REQUISITOS', 'pequeno-pliego']) {
    assert.equal(serializedRecords.includes(leak), false, 'no expediente content may reach the observability event');
  }
}

// =============================================================================================
// 7. The same rejection carried through the REAL post-bridge runner and the worker classifier:
//    envelope_build / AGT002_ENVELOPE_INVALID / invalid_output — never provider_error or unexpected.
// =============================================================================================
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
        return { data: null, error: { message: 'persistence must never be reached when the budget failed closed' } };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

{
  const telemetry = { invocationStarted: false, responseReceived: false };
  const clientCalls = [];
  const client = {
    run: async (options) => {
      telemetry.invocationStarted = true;
      clientCalls.push(options);
      if (clientCalls.length > 1) throw new Error('the analysis turn must never be taken once the budget failed closed');
      const response = { content: '{}', usage: { input_tokens: 4, output_tokens: 4 } };
      telemetry.responseReceived = true;
      return response;
    },
  };
  const engine = createAgt002PreviewEngine({
    client, model: MODEL, policyVersion: 'agt002-integral-v3-policy-test', policyText: AGT002_INTEGRAL_V3_POLICY,
    timeoutMs: 2000, maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID, contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [], observability: spyObservability(),
    semanticDiscoveryProvider: async options => {
      await options.client.run({
        model: options.model, policy: 'discovery', input: { snapshot_id: options.inventory.snapshot_id },
        outputSchema: {}, timeoutMs: options.timeoutMs, idempotencyKey: options.idempotencyKey, signal: options.signal,
      });
      return structuralDiscovery(options);
    },
    promptBudget: true, promptMaxInputTokens: 1,
  });

  const observability = spyObservability();
  const database = fakeDatabase();
  const result = await runAgt002PostBridgeAnalysis(database, {
    opportunityId: OPPORTUNITY_ID,
    tenderId: '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c',
    snapshotId: SNAPSHOT_ID,
    contextVersionId: '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d',
    attemptKey: 'reanalysis:discovery-budget-rejection',
    correlationId: '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e',
    claimId: 'claim-budget',
    idempotencyKey: 'c'.repeat(64),
    canonicalOnly: true,
    requireTenderRequirementInventory: false,
  }, {
    engine,
    observability,
    analysisContext: {
      snapshotId: SNAPSHOT_ID, documents: smallDocuments, documentGaps: [],
      deepAnalysis: {}, contextV2Sections: contextV2Sections(),
    },
    // The live shape this fix is about: the bridge WAS invoked and it DID answer (the discovery
    // turn), which is exactly what used to force the classifier into 'unexpected'.
    bridgeTelemetry: telemetry,
    integralContractV3: true,
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.analysis_run_id, null);
  assert.equal(result.error_code, 'AGT002_ENVELOPE_INVALID',
    'a server-side pre-provider budget refusal is an envelope/assembly failure, never a provider failure');
  assert.equal(clientCalls.length, 1, 'one discovery call, zero integral calls');
  assert.equal(telemetry.responseReceived, true, 'precondition: the discovery bridge really did answer');

  const { fields } = observability.records[0];
  assert.equal(fields.stage, 'envelope_build');
  assert.notEqual(fields.stage, 'unexpected', 'the live misclassification must not survive this fix');
  assert.notEqual(fields.error_code, 'AGT002_PROVIDER_ERROR', 'the provider was never asked; it cannot be blamed');
  assert.equal(fields.error_code, 'AGT002_ENVELOPE_INVALID');
  assert.equal(
    database.calls.some(call => call.name === 'psi_record_agt002_canonical_analysis_run'), false,
    'a budget refusal must never reach persistence',
  );

  // The queue-facing half: the closed post-bridge code maps to invalid_output, not provider_error.
  assert.equal(classifyAgt002ReanalysisWorkerError({ code: result.error_code }), 'invalid_output');

  const serialized = JSON.stringify({ result, calls: database.calls, records: observability.records });
  for (const leak of ['Residencia de datos', 'REQUISITOS', 'pequeno-pliego']) {
    assert.equal(serialized.includes(leak), false, 'no expediente content may reach the durable row or observability');
  }
}

// =============================================================================================
// 8. Per-run analysisCheckpointHooks must reach the discovery turn's OWN options, not only the
//    orchestrator's args: a caller who opted a run into durable batching gets a discovery stage
//    that can be checkpointed like every other stage, not one left outside the hooks' reach.
// =============================================================================================
{
  const hooks = {
    loadCheckpoint: async () => ({ hit: false }),
    storeCheckpoint: async () => ({ status: 'created', checkpointId: 'sentinel-checkpoint' }),
  };

  let discoveryOptions;
  const semanticDiscoveryProvider = async options => {
    discoveryOptions = options;
    return structuralDiscovery(options);
  };

  let orchestratorArgs;
  const batchedV3Orchestrator = async args => {
    orchestratorArgs = args;
    return { status: 'completed', analysis_run_id: FIXED_RUN_ID };
  };

  const client = fakeClient(() => {
    throw new Error('the provider client analysis turn must never be called directly: the orchestrator stub owns it');
  });

  const engine = discoveryEngine(client, { semanticDiscoveryProvider, batchedV3Orchestrator });

  await engine.analyze({
    snapshotId: SNAPSHOT_ID, documents: smallDocuments, documentGaps: [],
    deepAnalysis: {}, contextV2Sections: contextV2Sections(),
  }, { analysisCheckpointHooks: hooks });

  assert.equal(client.calls.length, 0,
    'the provider client analysis turn is never called directly: the orchestrator stub owns it');
  assert.ok(discoveryOptions, 'the discovery provider must have been invoked');
  assert.equal(discoveryOptions.checkpointHooks, hooks,
    'the discovery options must carry the exact per-run checkpoint hooks object');
  assert.ok(orchestratorArgs, 'the orchestrator must have been invoked');
  assert.equal(orchestratorArgs.checkpointHooks, hooks,
    'the orchestrator args must carry the exact same per-run checkpoint hooks object');
}

// =============================================================================================
// 9. Constructor-bound checkpointHooks (Task 6A4) reach the discovery turn's own options exactly
//    like the orchestrator's args, and a distinct per-run analysisCheckpointHooks always overrides
//    the bound hooks in BOTH places — never a silent merge, never a fallback to the binding.
// =============================================================================================
{
  const boundHooks = {
    loadCheckpoint: async () => ({ hit: false }),
    storeCheckpoint: async () => ({ status: 'created', checkpointId: 'sentinel-checkpoint-bound' }),
  };
  const overrideHooks = {
    loadCheckpoint: async () => ({ hit: false }),
    storeCheckpoint: async () => ({ status: 'created', checkpointId: 'sentinel-checkpoint-override' }),
  };

  let discoveryOptions;
  const semanticDiscoveryProvider = async options => {
    discoveryOptions = options;
    return structuralDiscovery(options);
  };

  let orchestratorArgs;
  const batchedV3Orchestrator = async args => {
    orchestratorArgs = args;
    return { status: 'completed', analysis_run_id: FIXED_RUN_ID };
  };

  const client = fakeClient(() => {
    throw new Error('the provider client analysis turn must never be called directly: the orchestrator stub owns it');
  });

  const engine = discoveryEngine(client, {
    semanticDiscoveryProvider, batchedV3Orchestrator, checkpointHooks: boundHooks,
  });

  // (9a) No per-run hooks supplied: both the discovery options and the orchestrator args fall
  // back to the constructor-bound hooks.
  await engine.analyze({
    snapshotId: SNAPSHOT_ID, documents: smallDocuments, documentGaps: [],
    deepAnalysis: {}, contextV2Sections: contextV2Sections(),
  });
  assert.equal(discoveryOptions.checkpointHooks, boundHooks,
    'with no per-run hooks, the discovery options must carry the constructor-bound checkpoint hooks');
  assert.equal(orchestratorArgs.checkpointHooks, boundHooks,
    'with no per-run hooks, the orchestrator args must carry the constructor-bound checkpoint hooks');

  // (9b) A distinct, valid per-run analysisCheckpointHooks overrides the binding everywhere.
  discoveryOptions = undefined;
  orchestratorArgs = undefined;
  await engine.analyze({
    snapshotId: SNAPSHOT_ID, documents: smallDocuments, documentGaps: [],
    deepAnalysis: {}, contextV2Sections: contextV2Sections(),
  }, { analysisCheckpointHooks: overrideHooks });
  assert.equal(discoveryOptions.checkpointHooks, overrideHooks,
    'a per-run override must reach the discovery options');
  assert.notEqual(discoveryOptions.checkpointHooks, boundHooks,
    'a per-run override must replace, never merge with, the constructor-bound hooks in the discovery options');
  assert.equal(orchestratorArgs.checkpointHooks, overrideHooks,
    'a per-run override must reach the orchestrator args');
  assert.notEqual(orchestratorArgs.checkpointHooks, boundHooks,
    'a per-run override must replace, never merge with, the constructor-bound hooks in the orchestrator args');
}

console.log('tests/agt002-preview-engine-discovery-frontier-projection.test.mjs OK');
