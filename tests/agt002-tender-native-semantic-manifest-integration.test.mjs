// AGT-002 / AGT-002-002 — integration contract: the preview packet's runtime frontier is THIS
// tender's own semantic manifest, not the fixed historical four.
//
// The shipped contract this file pins (no feature flag is involved anywhere — a V3 production run
// always derives its frontier from its own expediente):
//
//   - `buildAgt002PreviewInput` accepts a server-owned `semanticManifest`. It is re-validated
//     against the inventory the packet itself carries and projected into the EXISTING closed
//     runtime shapes: `document_evidence.requirement_manifest` and the retrieval requirements.
//   - The tender defines its own cardinality; the historical four survive only as
//     `document_evidence.supplemental_signal_ids`, never as frontier or coverage.
//   - Two different snapshots never share a requirement id or a citation.
//   - The exact Manizales governed package still outranks a supplied manifest, byte-for-byte;
//     a near-match identity never receives it, and an unrelated tender analyses its own snapshot.
//   - A manifest with no closed input to be validated against (no contextV2 + documentRetrieval),
//     an invalid/tampered manifest, or one belonging to another snapshot, all fail loudly — the
//     run never falls back to `deepAnalysis.matrix`.
//   - The engine takes the discovery turn itself: with an injected `semanticDiscoveryProvider`
//     and no governed package, the V3 request it assembles carries only dynamic requirement ids.
//   - The historical four are not a bootstrap dependency: a tender whose expediente carries no
//     fixed `deepAnalysis.matrix` at all still reaches discovery, analyses its own snapshot and
//     completes.
//   - Analyzed coverage is what V3 actually dispositioned: only the source units cited by
//     requirements that carry a real analysis unit, plus the server-validated exclusions, are
//     ever reported as analysed — never the whole inventory wholesale.
//
// The structural derivation (`buildTenderSemanticManifest`) is used here as the fixture producer:
// this file is about the preview/engine projection, not about how obligations are discovered
// (tests/tender-semantic-manifest.test.mjs owns that).
//
// Node/Vercel parity is via shared root modules only (server/index.js and api/[...path].js are
// byte-identical), so it is asserted structurally here rather than by re-testing two entrypoints.
//
// Run: node tests/agt002-tender-native-semantic-manifest-integration.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAgt002PreviewInput, buildAgt002TenderRequirementInventory } from '../agt002-preview-input.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import {
  buildTenderSemanticManifest,
  toAgt002RequirementManifest,
  toAgt002RetrievalRequirements,
  resolveTenderSemanticDecisionFrontier,
  TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS,
} from '../tender-semantic-manifest.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import {
  AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  selectAgt002ManizalesManifestSource,
} from '../agt002-manizales-manifest-source.js';
import { AGT002_PREVIEW_DEFAULT_REASONING_EFFORT } from '../agt002-preview-reasoning-effort.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));

const HISTORICAL_FOUR = [...TENDER_HISTORICAL_FIXED_REQUIREMENT_IDS].sort();

const SNAPSHOT_ID = '77777777-7777-4777-8777-777777777777';
const OPPORTUNITY_ID = 'e5940854-1c50-4fbb-bea2-f18908993b29'; // Rama Judicial Bogotá — first real tender.
const PROCESS = 'DSAJBO-SAMC-006-2026';

// A real, tender-specific snapshot: three obligations, none of them one of the historical four.
const PLIEGO_TEXT = [
  'REQUISITOS FINANCIEROS',
  'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  'REQUISITOS TÉCNICOS',
  'Capacitación en accesibilidad: el contratista deberá certificar capacitación en accesibilidad para todo el personal operativo.',
  'Residencia de datos: los datos deberán permanecer almacenados en centros de datos ubicados en territorio colombiano.',
].join('\n');

const documents = [{
  document_id: 'bogota-pliego',
  document_version_id: 'bogota-pliego-v1',
  opportunity_id: OPPORTUNITY_ID,
  snapshot_id: null,
  document_type: 'pliego',
  name: 'Pliego.pdf',
  version: 1,
  content_hash: hash(PLIEGO_TEXT),
  current: true,
  extracted_text: PLIEGO_TEXT,
}];

// The fixed historical matrix. It is a supplemental signal for this run and nothing more.
const historicalDeepAnalysis = {
  deep_analysis: {
    matrix: {
      legal: [
        { id: 'legal-rce-policy', label: 'Póliza de responsabilidad civil extracontractual (RCE)', evidence: [{ document_id: 'bogota-pliego' }] },
        { id: 'legal-collective-life-policy', label: 'Póliza de seguro de vida colectivo', evidence: [{ document_id: 'bogota-pliego' }] },
      ],
      financial: [
        { id: 'financial-working-capital', label: 'Capital de trabajo', evidence: [{ document_id: 'bogota-pliego' }] },
      ],
      technical: [
        { id: 'technical-video-surveillance-scope', label: 'Alcance de videovigilancia/CCTV', evidence: [{ document_id: 'bogota-pliego' }] },
      ],
    },
  },
};

function contextV2Sections({ opportunityId = OPPORTUNITY_ID, process = PROCESS } = {}) {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: opportunityId, owner_id: 'owner', owner_name: 'Ana', updated_at: '2026-08-23T00:00:00.000Z' },
      tender: {
        id: 'tender-bogota', title: `Proceso ${process}`, entity: 'Rama Judicial',
        source: 'SECOP II', updated_at: '2026-08-23T00:00:00.000Z',
      },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional', updated_at: '2026-08-23T00:00:00.000Z' },
      documents: [],
    }),
  };
}

const baseArgs = {
  snapshotId: SNAPSHOT_ID,
  contextV2: true,
  documentRetrieval: true,
  contextV2Sections: contextV2Sections(),
  documents,
  documentGaps: [],
  deepAnalysis: historicalDeepAnalysis,
};

/** The manifest a server-owned discovery stage produces for a snapshot, plus its projections. */
function semanticFixture({ snapshotId, documents: docs, documentGaps = [] }) {
  const inventory = buildAgt002TenderRequirementInventory({ snapshotId, documents: docs, documentGaps });
  const manifest = buildTenderSemanticManifest({ inventory, documents: docs });
  return { inventory, manifest };
}

const { inventory, manifest: semanticManifest } = semanticFixture({ snapshotId: SNAPSHOT_ID, documents });
const expectedRequirementManifest = toAgt002RequirementManifest({ semanticManifest, inventory });
const expectedRetrieval = toAgt002RetrievalRequirements(semanticManifest);
const expectedIds = expectedRequirementManifest.requirement_manifest.map(entry => entry.requirement_id).sort();

// One abstaining unit per governed requirement, in the exact order the engine presents them, so
// the v3 ordering/coverage invariants hold. Same helper shape the manifest wiring/scope tests use.
const buildV3AbstainedUnits = input => input.document_evidence.requirement_manifest.map((entry, index) => ({
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

/** A model turn that abstains on every governed requirement the engine actually assembled. */
const abstainingClient = () => ({
  run: async (options) => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }),
});

/** Exactly the shape the production discovery stage returns for the snapshot it was handed. */
const structuralDiscovery = async (options) => {
  const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
  return {
    semanticManifest: discovered,
    categoryOverrides: Object.fromEntries(discovered.requirements.map(requirement => [
      requirement.requirement_id,
      requirement.front === 'financial' ? 'habilitating' : 'technical',
    ])),
    usage: { input_tokens: 11, output_tokens: 5 },
  };
};

const createTestEngine = ({ client, semanticDiscoveryProvider }) => createAgt002PreviewEngine({
  client,
  model: 'synthetic-codex-model',
  policyVersion: 'agt002-integral-v3-policy-test',
  policyText: 'POLÍTICA V3 SINTÉTICA',
  timeoutMs: 2000,
  maxConcurrent: 2,
  dailyMaxRuns: 5,
  countDailyRuns: async () => 0,
  idGenerator: () => '99999999-9999-4999-8999-999999999999',
  contextV2: true,
  documentRetrieval: true,
  integralContractV3: true,
  companyEvidenceClassesProvider: () => [],
  semanticDiscoveryProvider,
});

// ===========================================================================
// 1. One shared semantic stage; Node and Vercel are byte-identical.
// ===========================================================================
{
  const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const apiSource = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
  assert.equal(serverSource, apiSource, 'Node/Vercel parity is byte-level, never a duplicated implementation');

  const previewInputSource = readFileSync(new URL('../agt002-preview-input.js', import.meta.url), 'utf8');
  assert.match(previewInputSource, /from '\.\/tender-semantic-manifest\.js'/,
    'the semantic stage must live in one shared module both runtimes import');
  assert.doesNotMatch(serverSource, /function buildTenderSemanticManifest/,
    'no entrypoint may re-implement the semantic stage locally');
}

// ===========================================================================
// 2. The frontier is THIS tender's semantic manifest — never
//    resolveAgt002DeepAnalysisMatrix(deepAnalysis).
// ===========================================================================
{
  const input = buildAgt002PreviewInput({ ...baseArgs, semanticManifest });
  const evidence = input.document_evidence;

  // The packet carries the exact manifest it reasoned from, bound to this expediente identity.
  assert.deepEqual(evidence.tender_semantic_manifest, semanticManifest,
    'the packet must carry the validated manifest verbatim, not a re-derived one');
  assert.equal(evidence.tender_semantic_manifest.snapshot_id, SNAPSHOT_ID);
  assert.equal(evidence.tender_semantic_manifest.inventory_hash, evidence.tender_requirement_inventory.inventory_hash,
    'the semantic manifest and the inventory must bind to the same expediente identity');
  assert.equal(evidence.tender_semantic_manifest.snapshot_hash, evidence.tender_requirement_inventory.snapshot_hash,
    'manifest and inventory must also agree on the snapshot hash they describe');

  // The runtime frontier IS the projected manifest, in the existing closed unit shape.
  assert.equal(evidence.requirement_manifest_version, '1.0');
  assert.deepEqual(evidence.requirement_manifest, expectedRequirementManifest.requirement_manifest);
  assert.equal(evidence.requirement_manifest.length, 3, 'the tender defines its own cardinality; it is not forced to four');
  for (const entry of evidence.requirement_manifest) {
    assert.match(entry.requirement_id, /^sreq:[0-9a-f]{32}$/, 'a frontier id must be derived from this snapshot, never a fixed catalog id');
  }

  // None of the fixed four may be the frontier, in any surface of the packet.
  for (const historicalId of HISTORICAL_FOUR) {
    assert.equal(evidence.requirement_manifest.some(entry => entry.requirement_id === historicalId), false,
      `${historicalId} must not be a runtime requirement for this tender`);
    assert.equal(evidence.coverage_manifest.by_requirement.some(item => item.requirement_id === historicalId), false,
      `${historicalId} must not drive retrieval for this tender`);
  }
  // ...they survive ONLY as declared supplemental signals.
  assert.deepEqual([...evidence.supplemental_signal_ids].sort(), HISTORICAL_FOUR,
    'the fixed extractors remain visible as supplemental signals, never as the frontier');

  // Retrieval requirements are derived from the source-declared subjects, so the tender's own
  // clauses are actually findable.
  assert.deepEqual(evidence.coverage_manifest.by_requirement.map(item => item.requirement_id).sort(), expectedIds);
  const retrievalTermsById = new Map(expectedRetrieval.map(item => [item.requirement_id, item.terms]));
  for (const item of evidence.coverage_manifest.by_requirement) {
    assert.ok(retrievalTermsById.has(item.requirement_id));
    assert.equal(item.status, 'covered', 'a source-derived requirement must actually retrieve its own clause');
  }

  // Obligations outside the historical four reach the model-facing packet with real,
  // source-derived labels and fronts — never a paragraph hash.
  const accessibility = evidence.requirement_manifest.find(entry => /accesibilidad/i.test(entry.label));
  assert.ok(accessibility, 'the accessibility-training obligation must reach the requirement manifest');
  assert.equal(accessibility.label, 'Capacitación en accesibilidad');
  assert.equal(accessibility.front, 'technical');
  assert.ok(accessibility.sources.length >= 1);
  assert.equal(accessibility.sources[0].document_id, 'bogota-pliego');
  assert.equal(accessibility.sources[0].content_hash, hash(PLIEGO_TEXT));

  const residency = evidence.requirement_manifest.find(entry => /residencia de datos/i.test(entry.label));
  assert.ok(residency, 'the data-residency obligation must reach the requirement manifest');
  assert.equal(residency.front, 'technical');

  // "apalancamiento 51%-60%" is apalancamiento — never relabeled as Capital de trabajo.
  const leverage = evidence.requirement_manifest.find(entry => /apalancamiento/i.test(entry.label));
  assert.ok(leverage, 'the leverage obligation must reach the requirement manifest');
  assert.equal(leverage.front, 'financial');
  assert.equal(evidence.requirement_manifest.some(entry => /capital de trabajo/i.test(entry.label)), false,
    'this tender never says "Capital de trabajo"; the packet must not invent it');

  // No fake paragraph-hash label anywhere in the model-facing frontier.
  for (const entry of evidence.requirement_manifest) {
    assert.doesNotMatch(entry.label, /^Requisito documental [0-9a-f]{12}$/);
  }

  // Without a manifest the legacy matrix path is untouched — this is the defect being corrected,
  // and it must stay reachable for a caller that supplies no manifest at all.
  const legacy = buildAgt002PreviewInput({ ...baseArgs });
  assert.deepEqual(legacy.document_evidence.requirement_manifest.map(entry => entry.requirement_id).sort(), HISTORICAL_FOUR);
  assert.equal(Object.hasOwn(legacy.document_evidence, 'tender_semantic_manifest'), false,
    'a packet with no semantic frontier must never advertise a semantic manifest');
}

// ===========================================================================
// 3. Two different tenders analysed through the same builder never share
//    requirement identity or citations.
// ===========================================================================
{
  const otherText = [
    'REQUISITOS TÉCNICOS',
    'Servicio canino: el contratista deberá disponer de un binomio canino certificado para la sede principal.',
  ].join('\n');
  const otherDocuments = [{
    ...documents[0],
    document_id: 'pereira-pliego',
    document_version_id: 'pereira-pliego-v1',
    opportunity_id: 'opp-pereira',
    content_hash: hash(otherText),
    extracted_text: otherText,
  }];
  const otherSnapshot = '88888888-8888-4888-8888-888888888888';
  const otherFixture = semanticFixture({ snapshotId: otherSnapshot, documents: otherDocuments });

  const other = buildAgt002PreviewInput({
    ...baseArgs,
    snapshotId: otherSnapshot,
    documents: otherDocuments,
    contextV2Sections: contextV2Sections({ opportunityId: 'opp-pereira', process: 'PEREIRA-01-2026' }),
    semanticManifest: otherFixture.manifest,
  });
  const mine = buildAgt002PreviewInput({ ...baseArgs, semanticManifest });

  const otherIds = other.document_evidence.requirement_manifest.map(entry => entry.requirement_id);
  const myIds = mine.document_evidence.requirement_manifest.map(entry => entry.requirement_id);
  assert.equal(otherIds.length, 1, 'the second tender declares its own cardinality too');
  assert.deepEqual(otherIds.filter(id => myIds.includes(id)), [], 'no requirement id may cross tenders');
  assert.notEqual(
    other.document_evidence.tender_semantic_manifest.semantic_manifest_hash,
    mine.document_evidence.tender_semantic_manifest.semantic_manifest_hash,
  );
  // Zero cross-tender citations at the source-unit level.
  const citationsOf = input => input.document_evidence.tender_semantic_manifest.requirements
    .flatMap(requirement => requirement.citations.map(citation => citation.source_unit_id));
  assert.deepEqual(citationsOf(other).filter(id => citationsOf(mine).includes(id)), []);

  // A manifest is bound to exactly one expediente: the other tender's manifest can never be
  // projected onto this snapshot, even though both are individually valid.
  assert.throws(
    () => buildAgt002PreviewInput({ ...baseArgs, semanticManifest: otherFixture.manifest }),
    /manifiesto semántico|inventario|snapshot/i,
    'a manifest from another tender must never become this tender\'s frontier',
  );
}

// ===========================================================================
// 4. Exact Manizales identity still selects its governed package and outranks a
//    supplied manifest; a near-match never receives it, and an unrelated tender
//    analyses its OWN snapshot.
// ===========================================================================
{
  const analyzableIds = AGT002_MANIZALES_CHECKED_IN_MANIFEST.entries
    .filter(entry => entry.analyzable === true)
    .map(entry => entry.requirement_id);

  assert.equal(
    selectAgt002ManizalesManifestSource({
      integralContractV3: true,
      opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
      process: AGT002_INTEGRAL_MANIFEST_PROCESO,
    }),
    AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  );

  const manizalesArgs = {
    ...baseArgs,
    integralContractV3: true,
    companyEvidenceClasses: { classes: [] },
    contextV2Sections: contextV2Sections({
      opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
      process: AGT002_INTEGRAL_MANIFEST_PROCESO,
    }),
    manizalesManifestSource: AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  };
  const governedOnly = buildAgt002PreviewInput({ ...manizalesArgs });
  const governedWithManifest = buildAgt002PreviewInput({ ...manizalesArgs, semanticManifest });

  assert.deepEqual(governedWithManifest, governedOnly,
    'a governed, human-reviewed package outranks a supplied manifest byte-for-byte');
  assert.deepEqual(
    governedWithManifest.document_evidence.requirement_manifest.map(entry => entry.requirement_id),
    analyzableIds,
    'the exact Manizales pilot keeps its governed package as the frontier',
  );
  assert.equal(Object.hasOwn(governedWithManifest.document_evidence, 'tender_semantic_manifest'), false,
    'the pilot packet never advertises a semantic manifest it did not analyse');

  // Near-match identities never receive the governed package.
  const nearMatches = [
    { opportunityId: `${AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID.slice(0, -1)}f`, process: AGT002_INTEGRAL_MANIFEST_PROCESO },
    { opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, process: 'SA-24-2027' },
    { opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID, process: 'sa-24-2026' },
    { opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID.toUpperCase(), process: AGT002_INTEGRAL_MANIFEST_PROCESO },
  ];
  for (const nearMatch of nearMatches) {
    let selected = null;
    try {
      selected = selectAgt002ManizalesManifestSource({ integralContractV3: true, ...nearMatch });
    } catch (error) {
      assert.equal(error?.code, 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH',
        `a near-match must fail closed with the pilot-scope code, not a generic error: ${JSON.stringify(nearMatch)}`);
      continue;
    }
    assert.equal(selected, null, `a near-match identity must never receive the governed package: ${JSON.stringify(nearMatch)}`);
  }

  // A fully unrelated tender resolves to null and analyses its OWN snapshot — the single
  // canonical analysis stays unblocked and carries zero Manizales identity.
  assert.equal(selectAgt002ManizalesManifestSource({ integralContractV3: true, opportunityId: OPPORTUNITY_ID, process: PROCESS }), null);
  const unrelated = buildAgt002PreviewInput({
    ...baseArgs,
    integralContractV3: true,
    companyEvidenceClasses: { classes: [] },
    manizalesManifestSource: null,
    semanticManifest,
  });
  assert.deepEqual(unrelated.document_evidence.requirement_manifest.map(entry => entry.requirement_id).sort(), expectedIds);
  for (const analyzableId of analyzableIds) {
    assert.equal(unrelated.document_evidence.requirement_manifest.some(entry => entry.requirement_id === analyzableId), false,
      `a non-Manizales tender must never inherit Manizales requirement ${analyzableId}`);
  }
  const serialized = JSON.stringify(unrelated);
  assert.equal(serialized.includes(AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID), false, 'no Manizales opportunity identity may leak');
  assert.equal(serialized.includes(AGT002_INTEGRAL_MANIFEST_PROCESO), false, 'no Manizales proceso identity may leak');
}

// ===========================================================================
// 5. Fail closed. A manifest is only accepted where it can actually be checked,
//    and an unusable one pauses the run instead of falling back to the four.
// ===========================================================================
{
  // No bounded, hash-verified corpus means no inventory to re-validate against.
  for (const [label, overrides] of [
    ['neither context v2 nor retrieval', { contextV2: false, documentRetrieval: false }],
    ['context v2 without retrieval', { contextV2: true, documentRetrieval: false }],
  ]) {
    assert.throws(
      () => buildAgt002PreviewInput({ ...baseArgs, ...overrides, semanticManifest }),
      /manifiesto semántico/i,
      `a manifest with ${label} has no closed input to be validated against; it must fail loudly`,
    );
  }

  // Structurally invalid manifests are never coerced into a frontier.
  for (const invalid of [{}, { semantic_manifest_version: 'tender_semantic_manifest.v1' }, [], 'manifiesto']) {
    assert.throws(
      () => buildAgt002PreviewInput({ ...baseArgs, semanticManifest: invalid }),
      /manifiesto semántico/i,
    );
  }

  // Every tamper along the way is caught against the inventory the packet itself carries.
  const tampered = [
    ['label rewritten to the historical subject', value => { value.requirements[0].label = 'Capital de trabajo'; }],
    ['citation hash forged', value => { value.requirements[0].citations[0].unit_hash = hash('otra unidad'); }],
    ['citation pointed at a foreign unit', value => { value.requirements[0].citations[0].source_unit_id = 'unit:deadbeefdeadbeefdeadbeefdeadbeef'; }],
    ['a requirement silently dropped', value => { value.requirements.pop(); }],
    ['manifest hash rewritten', value => { value.semantic_manifest_hash = hash('otro manifiesto'); }],
    ['coverage ledger inflated', value => { value.coverage_ledger.cited_count += 1; }],
    ['decision presented as ready', value => { value.decision_ready = true; value.recommendation = 'go'; }],
  ];
  for (const [label, mutate] of tampered) {
    const forged = clone(semanticManifest);
    mutate(forged);
    assert.throws(
      () => buildAgt002PreviewInput({ ...baseArgs, semanticManifest: forged }),
      /manifiesto semántico|requisito|obligaci|etiqueta|cita|unidad|inventario|cobertura|hash|identidad|pausa/i,
      `a tampered manifest (${label}) must never become the frontier`,
    );
  }

  // A manifest belonging to another snapshot of the very same documents is still another
  // expediente's manifest.
  assert.throws(
    () => buildAgt002PreviewInput({
      ...baseArgs,
      snapshotId: '99999999-9999-4999-8999-999999999999',
      semanticManifest,
    }),
    /manifiesto semántico|inventario|snapshot/i,
    'a cross-snapshot manifest must never become the frontier',
  );

  // Zero derivable obligations pauses the run; it never falls back to deepAnalysis.matrix.
  const unclassifiableText = 'El presente documento describe el objeto contractual y su alcance general.';
  const unclassifiableDocuments = [{
    ...documents[0],
    document_version_id: 'bogota-pliego-v2',
    content_hash: hash(unclassifiableText),
    extracted_text: unclassifiableText,
  }];
  const unclassifiable = semanticFixture({ snapshotId: SNAPSHOT_ID, documents: unclassifiableDocuments });
  assert.equal(unclassifiable.manifest.requirements.length, 0);
  assert.throws(
    () => buildAgt002PreviewInput({
      ...baseArgs,
      documents: unclassifiableDocuments,
      semanticManifest: unclassifiable.manifest,
    }),
    /requisito|pausa/i,
    'zero derivable obligations must pause the run, never fall back to the historical four',
  );

  // A visibly unresolved obligation is a material omission of the packet, not a silent gap.
  const ambiguousText = [
    'REQUISITOS FINANCIEROS',
    'El proponente deberá acreditar suficiencia patrimonial conforme a la ley.',
    'Nivel de apalancamiento: el proponente deberá acreditar un nivel de apalancamiento entre el 51% y el 60%.',
  ].join('\n');
  const ambiguousDocuments = [{
    ...documents[0],
    document_version_id: 'bogota-pliego-v3',
    content_hash: hash(ambiguousText),
    extracted_text: ambiguousText,
  }];
  const ambiguousFixture = semanticFixture({ snapshotId: SNAPSHOT_ID, documents: ambiguousDocuments });
  const ambiguous = buildAgt002PreviewInput({
    ...baseArgs,
    documents: ambiguousDocuments,
    semanticManifest: ambiguousFixture.manifest,
  });
  const ambiguousManifest = ambiguous.document_evidence.tender_semantic_manifest;
  assert.equal(ambiguousManifest.requirements.length, 1, 'only the derivable obligation becomes a requirement');
  assert.equal(ambiguousManifest.unresolved.length, 1, 'the ambiguous clause stays visible, never invented');
  assert.equal(ambiguousManifest.unresolved[0].reason, 'subject_not_derivable');
  assert.equal(ambiguousManifest.decision_ready, false);
  assert.equal(ambiguousManifest.recommendation, 'pause');
  assert.equal(ambiguous.document_evidence.material_omissions, true);
}

// ===========================================================================
// 6. Engine integration: the discovery turn is the engine's own, and the V3
//    request it assembles carries only this snapshot's dynamic requirement ids.
// ===========================================================================
{
  const clientCalls = [];
  const client = {
    run: async (options) => {
      clientCalls.push(options);
      // Invalid content: this case is about the request the engine assembled, not the envelope.
      return { content: 'no-json', usage: { input_tokens: 3, output_tokens: 3 } };
    },
  };

  const discoveryCalls = [];
  const semanticDiscoveryProvider = async (options) => {
    discoveryCalls.push(options);
    // Exactly the shape the production discovery stage returns: the snapshot's own manifest plus
    // the per-run governed categories for the requirements it just discovered.
    const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
    const categoryOverrides = Object.fromEntries(discovered.requirements.map(requirement => [
      requirement.requirement_id,
      requirement.front === 'financial' ? 'habilitating' : 'technical',
    ]));
    return { semanticManifest: discovered, categoryOverrides, usage: { input_tokens: 11, output_tokens: 5 } };
  };

  const engine = createAgt002PreviewEngine({
    client,
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-integral-v3-policy-test',
    policyText: 'POLÍTICA V3 SINTÉTICA',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    idGenerator: () => '99999999-9999-4999-8999-999999999999',
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider,
  });

  await assert.rejects(
    () => engine.analyze({
      snapshotId: SNAPSHOT_ID,
      documents,
      documentGaps: [],
      deepAnalysis: historicalDeepAnalysis,
      contextV2Sections: contextV2Sections(),
    }),
    /no produjo una respuesta válida/i,
    'invalid model content is still rejected; only the assembled request is under test here',
  );

  assert.equal(discoveryCalls.length, 1, 'the frontier is discovered exactly once per run');
  assert.equal(discoveryCalls[0].inventory.snapshot_id, SNAPSHOT_ID,
    'discovery must run against the very inventory the evidence packet is built from');
  assert.equal(discoveryCalls[0].inventory.inventory_hash, inventory.inventory_hash);

  assert.equal(clientCalls.length, 1, 'the analysis turn is taken once, after discovery');
  const requestEvidence = clientCalls[0].input.document_evidence;
  assert.deepEqual(
    requestEvidence.requirement_manifest.map(entry => entry.requirement_id).sort(),
    expectedIds,
    'the V3 request the engine assembled must carry exactly this snapshot\'s discovered requirements',
  );
  for (const entry of requestEvidence.requirement_manifest) {
    assert.match(entry.requirement_id, /^sreq:[0-9a-f]{32}$/);
    assert.ok(['habilitating', 'technical'].includes(entry.category),
      'the per-run discovered categories must govern the requirements the model sees');
  }
  for (const historicalId of HISTORICAL_FOUR) {
    assert.equal(requestEvidence.requirement_manifest.some(entry => entry.requirement_id === historicalId), false,
      `${historicalId} must never reach the V3 request as a requirement`);
    assert.equal(requestEvidence.coverage_manifest.by_requirement.some(item => item.requirement_id === historicalId), false,
      `${historicalId} must never drive retrieval in the V3 request`);
  }
  assert.deepEqual([...requestEvidence.supplemental_signal_ids].sort(), HISTORICAL_FOUR,
    'the historical extractors reach the model only as declared supplemental signals');
  // The two per-source-unit audit ledgers are no longer sent to the provider on a discovered
  // frontier: they are replaced by the server-derived semantic_frontier_summary (see
  // projectAgt002DiscoveredModelInput in agt002-preview-engine.js, and
  // tests/agt002-preview-engine-discovery-frontier-projection.test.mjs, which owns that contract).
  // What the engine analysed is still exactly the manifest this test derived independently — the
  // summary's arithmetic proves it, and section 7 below proves the FULL manifest still reaches the
  // durable envelope.
  assert.equal(requestEvidence.tender_semantic_manifest, undefined,
    'a discovered frontier no longer ships the full semantic manifest to the provider');
  assert.equal(requestEvidence.tender_requirement_inventory, undefined,
    'a discovered frontier no longer ships the full source-unit inventory to the provider');
  // Independently rebuilt packet: its material_omissions is the same server-derived flag the
  // summary must report, without this assertion reading it back off the request under test.
  const independentEvidence = buildAgt002PreviewInput({ ...baseArgs, semanticManifest }).document_evidence;
  assert.deepEqual(requestEvidence.semantic_frontier_summary, {
    inventory_version: inventory.inventory_version,
    semantic_manifest_version: semanticManifest.semantic_manifest_version,
    total_source_units: semanticManifest.coverage_ledger.total_source_units,
    analyzable_source_units: inventory.coverage_ledger.analyzable_count,
    requirement_count: semanticManifest.discovery_coverage.requirement_count,
    excluded_count: semanticManifest.coverage_ledger.excluded_count,
    unresolved_count: semanticManifest.coverage_ledger.unresolved_count,
    discovery_coverage_status: semanticManifest.discovery_coverage.status,
    analyzed_coverage_status: semanticManifest.analyzed_coverage.status,
    decision_ready: semanticManifest.decision_ready,
    material_omissions: independentEvidence.material_omissions,
  }, 'the summary must report the arithmetic of the very manifest this test derived independently');
}

// ===========================================================================
// 7. The V3 envelope must PERSIST the frontier it reasoned from. `evidence_coverage`
//    is the only part of the envelope that reaches the durable run, so a dynamically
//    discovered `tender_semantic_manifest` (and the supplemental signals declared
//    beside it) must survive there — not just its projected `requirement_manifest`.
//    Dropping it makes the persisted decision unauditable: the projection alone can
//    never be re-derived from, or re-verified against, this snapshot's own clauses.
// ===========================================================================
{
  const client = {
    run: async (options) => ({
      content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
      usage: { input_tokens: 7, output_tokens: 7 },
    }),
  };
  const semanticDiscoveryProvider = async (options) => {
    const discovered = buildTenderSemanticManifest({ inventory: options.inventory, documents: options.documents });
    return {
      semanticManifest: discovered,
      categoryOverrides: Object.fromEntries(discovered.requirements.map(requirement => [
        requirement.requirement_id,
        requirement.front === 'financial' ? 'habilitating' : 'technical',
      ])),
      usage: { input_tokens: 11, output_tokens: 5 },
    };
  };
  const engine = createAgt002PreviewEngine({
    client,
    model: 'synthetic-codex-model',
    policyVersion: 'agt002-integral-v3-policy-test',
    policyText: 'POLÍTICA V3 SINTÉTICA',
    timeoutMs: 2000,
    maxConcurrent: 2,
    dailyMaxRuns: 5,
    countDailyRuns: async () => 0,
    idGenerator: () => '99999999-9999-4999-8999-999999999999',
    contextV2: true,
    documentRetrieval: true,
    integralContractV3: true,
    companyEvidenceClassesProvider: () => [],
    semanticDiscoveryProvider,
  });

  const result = await engine.analyze({
    snapshotId: SNAPSHOT_ID,
    documents,
    documentGaps: [],
    deepAnalysis: historicalDeepAnalysis,
    contextV2Sections: contextV2Sections(),
  });
  const coverage = result.evidence_coverage;

  // Sanity: the projection and the inventory already survive into the persisted coverage.
  assert.deepEqual(coverage.requirement_manifest, expectedRequirementManifest.requirement_manifest);
  assert.equal(coverage.tender_requirement_inventory.inventory_hash, inventory.inventory_hash);

  // The manifest the run actually reasoned from must survive with them: same expediente identity,
  // same origin/provenance and the very same obligations it was analysed against — nothing about
  // WHAT was discovered may drift on the way to the durable run.
  const persistedManifest = coverage.tender_semantic_manifest;
  assert.ok(persistedManifest, 'the persisted coverage must keep the semantic manifest the run analysed, not only its projection');
  for (const key of ['semantic_manifest_version', 'snapshot_id', 'snapshot_hash', 'inventory_hash', 'origin', 'proposal_hash']) {
    assert.deepEqual(persistedManifest[key], semanticManifest[key],
      `the persisted manifest must keep the ${key} of the manifest the run analysed`);
  }
  for (const key of ['requirements', 'excluded', 'unresolved', 'coverage_ledger', 'discovery_coverage']) {
    assert.deepEqual(persistedManifest[key], semanticManifest[key],
      `the persisted manifest must keep the discovered ${key} verbatim`);
  }
  assert.equal(persistedManifest.inventory_hash, coverage.tender_requirement_inventory.inventory_hash,
    'the persisted manifest and inventory must bind to the same expediente identity');

  // ...but it is FINALIZED, not the pre-analysis manifest: V3 dispositioned every requirement and
  // every source unit of this complete fixture, so the persisted record says so instead of
  // claiming "analysis pending" forever. Readiness here is still only readiness for a human.
  assert.notEqual(persistedManifest.semantic_manifest_hash, semanticManifest.semantic_manifest_hash,
    'finalizing the manifest must re-derive its own content hash');
  assert.deepEqual(persistedManifest.analyzed_coverage, {
    status: 'complete',
    total_source_units: semanticManifest.coverage_ledger.total_source_units,
    dispositioned_source_units: semanticManifest.coverage_ledger.total_source_units,
    requirement_count: semanticManifest.requirements.length,
  }, 'the persisted manifest must record the V3 coverage the run actually achieved');
  assert.equal(persistedManifest.decision_ready, true,
    'discovery and V3 coverage are both complete for this fixture, so the persisted manifest is decision ready');
  assert.equal(persistedManifest.recommendation, 'ready_for_human_review');
  assert.equal(persistedManifest.human_review_required, true,
    'readiness is never authorization: a human still decides');

  assert.deepEqual([...coverage.supplemental_signal_ids].sort(), HISTORICAL_FOUR,
    'the declared supplemental signals must stay visible in the persisted coverage');
}

// ===========================================================================
// 8. The historical four are not a BOOTSTRAP dependency either. A real tender
//    whose expediente carries no fixed deep-analysis matrix at all (`deepAnalysis: {}`)
//    must still reach the discovery turn, analyse its OWN snapshot and complete.
//    The engine assembles a pre-discovery packet before it ever calls discovery, so
//    a run that can only be built from `deepAnalysis.matrix` means the four fixed
//    families still gate every non-pilot tender — precisely the defect being closed.
// ===========================================================================
{
  // Control: the projection layer is already matrix-free. A manifest-driven packet needs no
  // historical family to exist, and declares none when the expediente carries none.
  const matrixFree = buildAgt002PreviewInput({ ...baseArgs, deepAnalysis: {}, semanticManifest });
  assert.deepEqual(
    matrixFree.document_evidence.requirement_manifest.map(entry => entry.requirement_id).sort(),
    expectedIds,
    'with no matrix at all the frontier is still exactly this snapshot\'s own obligations',
  );
  assert.deepEqual(matrixFree.document_evidence.supplemental_signal_ids, [],
    'a tender with no historical matrix declares no supplemental signal, and needs none');

  const discoveryCalls = [];
  const engine = createTestEngine({
    client: abstainingClient(),
    semanticDiscoveryProvider: async (options) => {
      discoveryCalls.push(options);
      return structuralDiscovery(options);
    },
  });

  let result;
  try {
    result = await engine.analyze({
      snapshotId: SNAPSHOT_ID,
      documents,
      documentGaps: [],
      // No matrix, no historical families: this expediente never had a fixed deep analysis.
      deepAnalysis: {},
      contextV2Sections: contextV2Sections(),
    });
  } catch (error) {
    assert.fail(
      `a tender with no fixed deep-analysis matrix must still reach discovery and complete a V3 run; the four historical families are not a bootstrap dependency: ${error?.message}`,
    );
  }

  assert.equal(discoveryCalls.length, 1, 'discovery must run even though there is no matrix to bootstrap from');
  assert.equal(discoveryCalls[0].inventory.inventory_hash, inventory.inventory_hash,
    'discovery must still run against the very inventory the evidence packet is built from');
  assert.equal(result.status, 'completed');

  const coverage = result.evidence_coverage;
  assert.deepEqual(
    coverage.requirement_manifest.map(entry => entry.requirement_id).sort(),
    expectedIds,
    'the completed run analysed this snapshot\'s own discovered requirements',
  );
  assert.equal(coverage.tender_semantic_manifest.snapshot_id, SNAPSHOT_ID);
  assert.deepEqual(coverage.supplemental_signal_ids, [],
    'no matrix means no supplemental signals — never a synthesized historical four');
  for (const historicalId of HISTORICAL_FOUR) {
    assert.equal(JSON.stringify(result).includes(historicalId), false,
      `${historicalId} must not appear anywhere in a run whose expediente never declared it`);
  }
}

// ===========================================================================
// 9. Analyzed coverage is what V3 ACTUALLY dispositioned, unit by unit. The
//    finalized `analyzedSourceUnitIds` may only comprise the source units cited by
//    requirements that really carry a V3 analysis_unit, plus the server-validated
//    exclusions — never every inventory unit wholesale. Marking the whole inventory
//    analyzed reports coverage the run never achieved, which is exactly the claim a
//    human reviewer would rely on.
//
//    The V3 validator rightly refuses a result that is missing a required analysis
//    unit, so the rule itself is pinned on the pure derivation the engine must use
//    (never by weakening that validation), and the wiring is pinned end-to-end below
//    through a visibly unreadable source unit — one V3 demonstrably never analysed.
// ===========================================================================
{
  const engineModule = await import('../agt002-preview-engine.js');
  const deriveAgt002AnalyzedSourceUnitIds = engineModule.deriveAgt002AnalyzedSourceUnitIds;
  assert.equal(typeof deriveAgt002AnalyzedSourceUnitIds, 'function',
    'the engine must expose the pure derivation of the source units a V3 result actually analysed');

  const allInventoryIds = inventory.source_units.map(unit => unit.source_unit_id).sort();
  const unitsCitedBy = requirements => [...new Set(requirements.flatMap(requirement => [
    requirement.front_evidence.source_unit_id,
    ...requirement.citations.map(citation => citation.source_unit_id),
  ]))];
  const analysisUnitsFor = requirements => ({
    analysis_units: requirements.map((requirement, index) => ({
      unit_id: `UNIT-${index + 1}`, unit_kind: 'tender_requirement', requirement_id: requirement.requirement_id,
    })),
  });

  // (a) One requirement never reached a V3 analysis unit: the units only IT cites were not
  //     analysed, so they can never be reported as analysed.
  const analyzedRequirements = semanticManifest.requirements.slice(0, 2);
  const unanalyzedRequirement = semanticManifest.requirements[2];
  assert.ok(unanalyzedRequirement, 'sanity: this fixture has more than two obligations');

  const partial = deriveAgt002AnalyzedSourceUnitIds({
    semanticManifest,
    integralAnalysis: analysisUnitsFor(analyzedRequirements),
  });
  const expectedPartial = [...new Set([
    ...unitsCitedBy(analyzedRequirements),
    ...semanticManifest.excluded.map(entry => entry.source_unit_id),
  ])].sort();
  assert.deepEqual(partial, expectedPartial,
    'only the units cited by analysed requirements — plus the server-validated exclusions — are analysed');
  for (const citation of unanalyzedRequirement.citations) {
    assert.equal(partial.includes(citation.source_unit_id), false,
      'a source unit cited only by a requirement V3 never analysed is not analysed');
  }
  assert.notDeepEqual(partial, allInventoryIds, 'the whole inventory must never be marked analysed wholesale');

  const finalizedPartial = resolveTenderSemanticDecisionFrontier({
    semanticManifest,
    inventory,
    analyzedRequirementIds: analyzedRequirements.map(requirement => requirement.requirement_id),
    analyzedSourceUnitIds: partial,
  });
  assert.equal(finalizedPartial.analyzed_coverage.dispositioned_source_units, partial.length);
  assert.ok(partial.length < allInventoryIds.length, 'a partially analysed expediente reports less than its whole inventory');
  assert.equal(finalizedPartial.analyzed_coverage.status, 'partial');
  assert.equal(finalizedPartial.decision_ready, false);
  assert.equal(finalizedPartial.recommendation, 'pause');

  // (b) ...and the rule must not under-report either: a complete run still covers every unit.
  assert.deepEqual(
    deriveAgt002AnalyzedSourceUnitIds({ semanticManifest, integralAnalysis: analysisUnitsFor(semanticManifest.requirements) }),
    allInventoryIds,
    'a V3 result that analysed every requirement of a complete expediente still covers every source unit',
  );

  // (c) End to end: a document the expediente could not read is a source unit V3 demonstrably
  //     never analysed, so the persisted coverage must not count it.
  const gap = { document_id: 'bogota-adenda', reason: 'download_failed' };
  const gapFixture = semanticFixture({ snapshotId: SNAPSHOT_ID, documents, documentGaps: [gap] });
  const gapUnit = gapFixture.inventory.source_units.find(unit => unit.document_id === gap.document_id);
  assert.equal(gapUnit.disposition, 'unresolved_visible', 'sanity: the missing addendum is a visible, unreadable unit');
  const gapTotal = gapFixture.inventory.source_units.length;

  const engine = createTestEngine({ client: abstainingClient(), semanticDiscoveryProvider: structuralDiscovery });
  const result = await engine.analyze({
    snapshotId: SNAPSHOT_ID,
    documents,
    documentGaps: [gap],
    deepAnalysis: historicalDeepAnalysis,
    contextV2Sections: contextV2Sections(),
  });
  const persisted = result.evidence_coverage.tender_semantic_manifest;

  assert.equal(persisted.analyzed_coverage.total_source_units, gapTotal);
  assert.equal(persisted.analyzed_coverage.dispositioned_source_units, gapTotal - 1,
    'the unreadable unit was never analysed by V3; the persisted coverage must not claim it was');
  assert.equal(persisted.analyzed_coverage.status, 'partial');
  assert.equal(persisted.decision_ready, false);
  assert.equal(persisted.recommendation, 'pause');
}

// ===========================================================================
// 10. Task 6A2 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md,
//     "Task 6: Engine orchestration") — public engine routing/wiring, RED. On
//     a non-pilot semantic-discovery V3 run, supplying `analysisCheckpointHooks`
//     to `analyze()` must route the analysis turn through an injected
//     `batchedV3Orchestrator` constructor dependency instead of the engine's
//     own single-turn `runOnceV3` call: the discovery turn still runs exactly
//     as it does today, but the orchestrator — not the engine — owns every
//     batch's provider call from there. Neither `batchedV3Orchestrator` nor
//     `analysisCheckpointHooks` exist yet, so this section is expected to fail
//     on the routing assertions below (an ordinary missing-wiring assertion
//     failure), never on a load/type error.
//
// RED command: node tests/agt002-tender-native-semantic-manifest-integration.test.mjs
// ===========================================================================
{
  // The real-shaped Task-2 checkpoint hooks (see
  // createAgt002AnalysisCheckpointAdapter in agt002-analysis-checkpoints.js): a per-run object
  // this section only proves the ENGINE forwards unchanged — the orchestrator itself, exercised
  // separately by tests/agt002-batched-v3-orchestration.test.mjs, is the only thing that ever
  // calls these.
  const checkpointHooksSentinel = Object.freeze({
    loadCheckpoint: async ({ stage, batchIndex, expectedRequestHash, validate }) => {
      void stage; void batchIndex; void expectedRequestHash; void validate;
      return { hit: false };
    },
    storeCheckpoint: async ({ stage, batchIndex, requestHash, stageContractVersion, output, outputSha256, usage, providerIdempotencyKey }) => {
      void stage; void batchIndex; void requestHash; void stageContractVersion;
      void output; void outputSha256; void usage; void providerIdempotencyKey;
    },
  });

  // 10a. The routing itself: discovery runs, then the analysis turn is handed to the injected
  // orchestrator with exactly the arguments a durable batched run needs, and its returned
  // envelope reaches the caller unchanged.
  {
    const BATCHED_COMPLETED_ENVELOPE_SENTINEL = Object.freeze({ status: 'completed', sentinel: 'agt002-batched-v3-envelope' });

    const runCalls = [];
    const client = {
      run: async (options) => {
        runCalls.push(options);
        return {
          content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
          usage: { input_tokens: 7, output_tokens: 7 },
        };
      },
    };
    const beforeProviderCallCalls = [];
    const beforeProviderCall = async () => { beforeProviderCallCalls.push(true); };
    const orchestratorCalls = [];
    const batchedV3Orchestrator = async (options) => {
      orchestratorCalls.push(options);
      return BATCHED_COMPLETED_ENVELOPE_SENTINEL;
    };

    // Same non-pilot semantic-discovery V3 wiring as createTestEngine, plus the two constructor
    // dependencies this section is about.
    const engine = createAgt002PreviewEngine({
      client,
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-integral-v3-policy-test',
      policyText: 'POLÍTICA V3 SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      contextV2: true,
      documentRetrieval: true,
      integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      semanticDiscoveryProvider: structuralDiscovery,
      beforeProviderCall,
      batchedV3Orchestrator,
    });

    const signal = { sentinel: 'agt002-6a2-signal' };
    const result = await engine.analyze(
      { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
      { idempotencyKey: 'durable-key', signal, analysisCheckpointHooks: checkpointHooksSentinel },
    );

    assert.equal(orchestratorCalls.length, 1,
      'a discovered frontier with analysisCheckpointHooks must route its analysis turn through the injected batchedV3Orchestrator exactly once');
    const call = orchestratorCalls[0];

    assert.deepEqual(
      call.previewInput?.document_evidence?.requirement_manifest.map(entry => entry.requirement_id).sort(),
      expectedIds,
      'the orchestrator must receive the discovered previewInput, assembled from this snapshot\'s own frontier',
    );
    assert.ok(call.validationContext, 'the orchestrator must receive the discovered validationContext');
    assert.deepEqual(call.priorUsage, { input_tokens: 11, output_tokens: 5 },
      'the discovery turn\'s usage must reach the orchestrator as priorUsage, exactly as it reaches runOnceV3 today');
    assert.equal(call.model, 'synthetic-codex-model');
    assert.equal(call.policy, 'POLÍTICA V3 SINTÉTICA', 'the orchestrator must receive the same policy text client.run is given today');
    assert.equal(call.timeoutMs, 2000);
    assert.equal(call.signal, signal);
    assert.equal(call.effort, AGT002_PREVIEW_DEFAULT_REASONING_EFFORT);
    assert.equal(call.checkpointHooks, checkpointHooksSentinel,
      'the exact per-run checkpoint hooks passed to analyze() must reach the orchestrator unchanged, never rewrapped');
    assert.equal(call.beforeProviderCall, beforeProviderCall,
      'a configured beforeProviderCall boundary hook must reach the orchestrator too, exactly as it reaches runOnceV3 today');
    assert.equal(call.idempotencyKey, 'durable-key', 'the base run idempotency key must reach the orchestrator unsuffixed');

    assert.equal(result, BATCHED_COMPLETED_ENVELOPE_SENTINEL,
      'the engine must return the orchestrator\'s completed envelope unchanged, not a re-wrapped or re-derived one');
    assert.equal(runCalls.length, 0,
      'once analysisCheckpointHooks route the run to the orchestrator, the engine must never call the analysis client directly — the injected orchestrator owns every batch\'s provider call');
  }

  // 10b. Negative: a legacy/non-V3 engine keeps its existing one-turn behavior even when a
  // caller supplies analysisCheckpointHooks — there is no discovered frontier to batch.
  {
    const orchestratorCalls = [];
    const client = { run: async () => ({ content: 'no-json', usage: { input_tokens: 3, output_tokens: 3 } }) };
    const legacyEngine = createAgt002PreviewEngine({
      client,
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-legacy-policy-test',
      policyText: 'POLÍTICA LEGACY SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      // integralContractV3 stays false (default): the legacy/v2 one-turn path.
      batchedV3Orchestrator: async (options) => { orchestratorCalls.push(options); return {}; },
    });

    await assert.rejects(
      () => legacyEngine.analyze(
        { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
        { idempotencyKey: 'durable-key', analysisCheckpointHooks: checkpointHooksSentinel },
      ),
      /no produjo una respuesta válida/i,
      'a legacy/non-V3 engine must still take its existing one-turn runOnce path; analysisCheckpointHooks must never switch it to batching',
    );
    assert.equal(orchestratorCalls.length, 0, 'the legacy/non-V3 path must never invoke an injected batchedV3Orchestrator');
  }

  // 10c. Negative: the exact Manizales/fixed-manifest package already takes no discovery turn
  // at all (usesSemanticDiscovery is false whenever manifestWiring is set — see its definition
  // in agt002-preview-engine.js). Building a full checked-in Manizales fixture here would just
  // duplicate section 4's fixture wholesale for no extra routing coverage, so this pins the
  // routing guard itself at the source level — the durable-batching route must be conditioned on
  // usesSemanticDiscovery, which already excludes both the Manizales pilot and any non-V3 engine
  // — and leans on section 4 above (and 10b above) for the actual one-turn behavioral proof.
  {
    const engineSource = readFileSync(new URL('../agt002-preview-engine.js', import.meta.url), 'utf8');
    assert.match(
      engineSource,
      /usesSemanticDiscovery\s*&&\s*(?:\w+\s*&&\s*)*analysisCheckpointHooks|analysisCheckpointHooks\s*&&\s*(?:\w+\s*&&\s*)*usesSemanticDiscovery/,
      'the durable-batching route must be gated on usesSemanticDiscovery, so a supplied analysisCheckpointHooks can never switch the exact Manizales package or a legacy/non-V3 engine to batching',
    );
  }

  // 10d. Task 6A4: a CONSTRUCTOR-level `checkpointHooks` binding — the exact option
  // `createAgt002PreviewRuntime` has forwarded to `createAgt002PreviewEngine` since Task 2 (see
  // agt002-preview-runtime.js) — must itself be enough to route a discovered-frontier run's
  // analysis turn through the injected `batchedV3Orchestrator`, even when the specific `analyze()`
  // call supplies no per-run `analysisCheckpointHooks` at all.
  {
    const boundHooks = Object.freeze({
      loadCheckpoint: async () => ({ hit: false }),
      storeCheckpoint: async () => {},
    });
    const BATCHED_COMPLETED_ENVELOPE_SENTINEL = Object.freeze({ status: 'completed', sentinel: 'agt002-6a4-bound-hooks-envelope' });
    const runCalls = [];
    const client = {
      run: async (options) => {
        runCalls.push(options);
        return {
          content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
          usage: { input_tokens: 7, output_tokens: 7 },
        };
      },
    };
    const orchestratorCalls = [];
    const batchedV3Orchestrator = async (options) => {
      orchestratorCalls.push(options);
      return BATCHED_COMPLETED_ENVELOPE_SENTINEL;
    };

    const engine = createAgt002PreviewEngine({
      client,
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-integral-v3-policy-test',
      policyText: 'POLÍTICA V3 SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      contextV2: true,
      documentRetrieval: true,
      integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      semanticDiscoveryProvider: structuralDiscovery,
      batchedV3Orchestrator,
      checkpointHooks: boundHooks,
    });

    const result = await engine.analyze(
      { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
      { idempotencyKey: 'durable-key' },
    );

    assert.equal(orchestratorCalls.length, 1,
      'a constructor-level checkpointHooks binding must route a discovered-frontier analysis turn through the injected batchedV3Orchestrator with no per-run hooks supplied');
    assert.equal(orchestratorCalls[0].checkpointHooks, boundHooks,
      'the orchestrator must receive the constructor-bound checkpointHooks unchanged when no per-run override is supplied');
    assert.equal(result, BATCHED_COMPLETED_ENVELOPE_SENTINEL,
      'the engine must return the orchestrator\'s completed envelope unchanged');
    assert.equal(runCalls.length, 0,
      'a constructor-bound checkpointHooks binding must route to the orchestrator exactly like a per-run one — the engine must never call the analysis client directly');
  }

  // 10e. A valid per-run `analysisCheckpointHooks` overrides the constructor-level binding, for
  // that invocation only.
  {
    const boundHooks = Object.freeze({
      loadCheckpoint: async () => ({ hit: false }),
      storeCheckpoint: async () => {},
    });
    const client = {
      run: async (options) => ({
        content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
        usage: { input_tokens: 7, output_tokens: 7 },
      }),
    };
    const orchestratorCalls = [];
    const batchedV3Orchestrator = async (options) => {
      orchestratorCalls.push(options);
      return { status: 'completed' };
    };

    const engine = createAgt002PreviewEngine({
      client,
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-integral-v3-policy-test',
      policyText: 'POLÍTICA V3 SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      contextV2: true,
      documentRetrieval: true,
      integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      semanticDiscoveryProvider: structuralDiscovery,
      batchedV3Orchestrator,
      checkpointHooks: boundHooks,
    });

    await engine.analyze(
      { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
      { idempotencyKey: 'durable-key', analysisCheckpointHooks: checkpointHooksSentinel },
    );

    assert.equal(orchestratorCalls.length, 1);
    assert.equal(orchestratorCalls[0].checkpointHooks, checkpointHooksSentinel,
      'a valid per-run analysisCheckpointHooks must override the constructor-level checkpointHooks binding for that invocation');
    assert.notEqual(orchestratorCalls[0].checkpointHooks, boundHooks,
      'the overridden invocation must never fall back to the constructor-bound hooks');
  }

  // 10f. Fail closed. A malformed constructor-level checkpointHooks must be rejected at engine
  // construction — before any run is attempted, exactly like every other malformed constructor
  // dependency this engine validates. A malformed per-run analysisCheckpointHooks must keep
  // failing before semantic discovery, the analysis client, or the orchestrator are ever reached.
  {
    for (const malformed of [{}, { loadCheckpoint: async () => ({}) }, { loadCheckpoint: 'nope', storeCheckpoint: async () => {} }, null, 'hooks']) {
      assert.throws(
        () => createAgt002PreviewEngine({
          client: { run: async () => ({ content: 'no-json', usage: { input_tokens: 1, output_tokens: 1 } }) },
          model: 'synthetic-codex-model',
          policyVersion: 'agt002-integral-v3-policy-test',
          policyText: 'POLÍTICA V3 SINTÉTICA',
          timeoutMs: 2000,
          maxConcurrent: 2,
          dailyMaxRuns: 5,
          countDailyRuns: async () => 0,
          idGenerator: () => '99999999-9999-4999-8999-999999999999',
          contextV2: true,
          documentRetrieval: true,
          integralContractV3: true,
          companyEvidenceClassesProvider: () => [],
          semanticDiscoveryProvider: structuralDiscovery,
          checkpointHooks: malformed,
        }),
        /AGT-002 Preview/,
        `a malformed constructor-level checkpointHooks (${JSON.stringify(malformed)}) must fail closed at construction, never at run time`,
      );
    }

    const discoveryCalls = [];
    const runCalls = [];
    const orchestratorCalls = [];
    const engine = createAgt002PreviewEngine({
      client: { run: async (options) => { runCalls.push(options); return { content: 'no-json', usage: { input_tokens: 1, output_tokens: 1 } }; } },
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-integral-v3-policy-test',
      policyText: 'POLÍTICA V3 SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      contextV2: true,
      documentRetrieval: true,
      integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      semanticDiscoveryProvider: async (options) => { discoveryCalls.push(options); return structuralDiscovery(options); },
      batchedV3Orchestrator: async (options) => { orchestratorCalls.push(options); return { status: 'completed' }; },
    });

    for (const malformedPerRun of [{}, { loadCheckpoint: async () => ({}) }, null, 'hooks']) {
      assert.throws(
        () => engine.analyze(
          { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
          { idempotencyKey: 'durable-key', analysisCheckpointHooks: malformedPerRun },
        ),
        /analysisCheckpointHooks/,
        `a malformed per-run analysisCheckpointHooks (${JSON.stringify(malformedPerRun)}) must fail before semantic discovery, the client, or the orchestrator are ever reached`,
      );
    }
    assert.equal(discoveryCalls.length, 0, 'a malformed per-run analysisCheckpointHooks must fail before the discovery turn is ever attempted');
    assert.equal(runCalls.length, 0, 'a malformed per-run analysisCheckpointHooks must fail before the analysis client is ever called');
    assert.equal(orchestratorCalls.length, 0, 'a malformed per-run analysisCheckpointHooks must fail before the orchestrator is ever reached');
  }

  // 10g. Task 6B3 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md, "Task 6: Engine
  // orchestration") — observability plumbing, RED. The engine must hand the injected
  // batchedV3Orchestrator a `recordProgress` function that maps every internal progress event to
  // exactly one `observability.record('analysis_batch_progress', fields)` call, with `fields`
  // restricted to a snake_case allowlist (never a raw internal event, prompt, response, or other
  // payload). This mapping does not exist yet — the engine passes no `recordProgress` to the
  // orchestrator at all — so this section is expected to fail on the assertions below (an
  // ordinary missing-wiring assertion failure), never on a load/type error.
  {
    const observabilityCalls = [];
    const observability = {
      record: (eventType, fields) => { observabilityCalls.push({ eventType, fields }); },
    };

    const REQUEST_HASH = 'a'.repeat(64);
    let capturedRecordProgress = null;
    const batchedV3Orchestrator = async (options) => {
      capturedRecordProgress = options.recordProgress;
      if (typeof capturedRecordProgress === 'function') {
        const base = { batchIndex: 0, batchCount: 1, requestHash: REQUEST_HASH, durationMs: 150, inputTokens: 40, outputTokens: 20, providerRequestId: 'req-6b3', checkpointReused: false };
        capturedRecordProgress({ type: 'batch_attempt_retry', ...base, attempt: 1, retryCount: 1 });
        capturedRecordProgress({ type: 'batch_completed', ...base, attempt: 2, retryCount: 1, checkpointReused: true });
        capturedRecordProgress({ type: 'batch_merged', ...base, attempt: 2, retryCount: 1 });
        capturedRecordProgress({ type: 'batch_finalized', ...base, attempt: 2, retryCount: 1 });
      }
      return { status: 'completed' };
    };

    const boundHooks = Object.freeze({
      loadCheckpoint: async () => ({ hit: false }),
      storeCheckpoint: async () => {},
    });

    const engine = createAgt002PreviewEngine({
      client: {
        run: async (options) => ({
          content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
          usage: { input_tokens: 7, output_tokens: 7 },
        }),
      },
      model: 'synthetic-codex-model',
      policyVersion: 'agt002-integral-v3-policy-test',
      policyText: 'POLÍTICA V3 SINTÉTICA',
      timeoutMs: 2000,
      maxConcurrent: 2,
      dailyMaxRuns: 5,
      countDailyRuns: async () => 0,
      idGenerator: () => '99999999-9999-4999-8999-999999999999',
      contextV2: true,
      documentRetrieval: true,
      integralContractV3: true,
      companyEvidenceClassesProvider: () => [],
      semanticDiscoveryProvider: structuralDiscovery,
      batchedV3Orchestrator,
      checkpointHooks: boundHooks,
      observability,
    });

    // No per-run analysisCheckpointHooks: the constructor-level checkpointHooks binding alone
    // must be enough to route through the orchestrator (see 10d above).
    await engine.analyze(
      { snapshotId: SNAPSHOT_ID, documents, documentGaps: [], deepAnalysis: historicalDeepAnalysis, contextV2Sections: contextV2Sections() },
      { idempotencyKey: 'durable-key' },
    );

    assert.equal(typeof capturedRecordProgress, 'function',
      'the injected batchedV3Orchestrator must receive a recordProgress function from the engine, even with no per-run analysisCheckpointHooks supplied');
    assert.equal(observabilityCalls.length, 4,
      'the engine must forward exactly one observability.record call per internal recordProgress call');

    const allowedKeys = ['stage', 'snapshot_id', 'batch_index', 'batch_count', 'attempt', 'retry_count', 'duration_ms', 'input_tokens', 'output_tokens', 'request_hash', 'provider_request_id', 'checkpoint_reused', 'outcome'];
    const forbiddenKeys = ['prompt', 'response', 'source', 'content', 'output', 'error', 'event', 'rawEvent'];
    for (const call of observabilityCalls) {
      assert.equal(call.eventType, 'analysis_batch_progress',
        'every batch-progress observability call must use the exact event type analysis_batch_progress');
      assert.equal(call.fields.stage, 'integral_analysis_batch');
      assert.equal(call.fields.snapshot_id, SNAPSHOT_ID, 'snapshot_id must come from the run context, not the internal event');
      assert.equal(call.fields.batch_index, 0);
      assert.equal(call.fields.batch_count, 1);
      assert.equal(call.fields.duration_ms, 150);
      assert.equal(call.fields.input_tokens, 40);
      assert.equal(call.fields.output_tokens, 20);
      assert.equal(call.fields.request_hash, REQUEST_HASH);
      assert.equal(call.fields.provider_request_id, 'req-6b3');
      assert.equal(typeof call.fields.checkpoint_reused, 'boolean');
      assert.equal(typeof call.fields.attempt, 'number');
      assert.equal(typeof call.fields.retry_count, 'number');

      for (const key of Object.keys(call.fields)) {
        assert.ok(allowedKeys.includes(key),
          `observability fields must be restricted to the snake_case allowlist; unexpected key "${key}"`);
        assert.ok(call.fields[key] === null || typeof call.fields[key] !== 'object',
          `observability fields must be flat primitives, never a nested raw payload (key "${key}")`);
      }
      for (const forbidden of forbiddenKeys) {
        assert.ok(!(forbidden in call.fields), `observability fields must never carry a raw payload key "${forbidden}"`);
      }
    }

    assert.deepEqual(observabilityCalls.map(call => call.fields.outcome),
      ['retry_scheduled', 'completed', 'merged', 'finalized'],
      'each internal progress event type must map to its own closed, allowlisted outcome string');
  }
}

console.log('AGT-002 tender-native semantic manifest preview integration passed');
