import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002PreviewInput } from '../agt002-preview-input.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';
import {
  AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  AGT002_INTEGRAL_MANIFEST_PROCESO,
} from '../agt002-manizales-integral-manifest.js';
import {
  AGT002_MANIZALES_CHECKED_IN_MANIFEST,
  selectAgt002ManizalesManifestSource,
} from '../agt002-manizales-manifest-source.js';

// Phase 3 (T3.1): wiring the checked-in versioned Manizales SA-24-2026 integral manifest
// into the AGT002_INTEGRAL_CONTRACT_V3 runtime. The manifest source is engine/runtime
// configuration (never a model-forgeable caller field); when the flag is off or no source
// is injected the behavior is byte-identical to the current requirement-manifest path.
// Nothing here touches production, the network or a real DB.

const MANIZALES_MANIFEST_SOURCE = JSON.parse(
  readFileSync(new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8'),
);

// The four governed runtime requirement ids the CURRENT (source-absent) governed path
// covers — mirror of migration 066 plus the técnico=>technical runtime requirement. They
// are NOT analyzable entries in the checked-in manifest (their runtime citation is an
// excerpt, not a resolved vigente span), so the manifest-driven analyzable set is a strict
// superset in coverage — it governs strictly more requirements — while never smuggling one
// of these non-analyzable ids into the resolved requirement manifest.
const FOUR_GOVERNED_IDS = [
  'financial-working-capital', 'legal-rce-policy', 'legal-collective-life-policy', 'technical-video-surveillance-scope',
];

const analyzableEntries = MANIZALES_MANIFEST_SOURCE.entries.filter(entry => entry.analyzable === true);
const analyzableIds = analyzableEntries.map(entry => entry.requirement_id);

const verifiedRupRegistryRow = {
  entry_id: 'rup', document_class: 'RUP', existence_status: 'verified', human_review_status: 'approved',
  applicability_status: 'applicable', integration_active: true, expiry: '2099-01-01', updated_at: '2026-01-01T00:00:00.000Z',
};

function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({
      profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-08-01T10:00:00.000Z' },
      documents: [],
    }),
  };
}

const retrievalDocuments = [{
  document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
  document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
  extracted_text: 'Requiere póliza vigente de cumplimiento.',
}];
const retrievalDeepAnalysis = {
  matrix: {
    legal: [{
      id: 'req-poliza', front: 'legal', label: 'Póliza vigente',
      evidence: [{ document_id: 'ver-01', document_name: 'Pliego', document_type: 'pliego', excerpt: 'Requiere póliza vigente de cumplimiento.' }],
    }],
    financial: [], technical: [],
  },
};
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';

function v3Context() {
  return {
    documents: retrievalDocuments, deepAnalysis: retrievalDeepAnalysis, snapshotId: SNAPSHOT_ID,
    contextV2Sections: contextV2Sections(),
  };
}

function baseEngineOptions(overrides = {}) {
  return {
    model: 'synthetic-codex-model', policyVersion: 'agt002-integral-v3-policy-1', timeoutMs: 2000,
    maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0,
    idGenerator: () => FIXED_RUN_ID, ...overrides,
  };
}

function fakeClient(handler) {
  const calls = [];
  return { calls, run: async (options) => { calls.push(options); return handler(options, calls.length); } };
}

// The model turn carries ONLY analysis_units (category/evidence_state left null — both are
// server-governed). One abstaining unit per governed requirement, in the exact order the
// engine presents them (manifest analyzable order), so ordering/coverage invariants hold.
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

// -----------------------------------------------------------------------------
// T3.1.1 — Flag off / source absent preserves the current path byte-for-byte.
// -----------------------------------------------------------------------------
{
  // buildAgt002PreviewInput: legacy (no contextV2/documentRetrieval). A supplied
  // manizalesManifestSource is inert and the output is byte-identical.
  const legacyArgs = {
    opportunity: { id: 'opp-1', company_name: 'ACME', title: 'Vigilancia' },
    documents: retrievalDocuments, deepAnalysis: {}, snapshotId: SNAPSHOT_ID,
  };
  const legacyWithout = buildAgt002PreviewInput({ ...legacyArgs });
  const legacyWith = buildAgt002PreviewInput({ ...legacyArgs, manizalesManifestSource: MANIZALES_MANIFEST_SOURCE });
  assert.deepEqual(legacyWith, legacyWithout, 'a manizalesManifestSource must not alter the legacy (non-retrieval) input');

  // V3 requirement-manifest path with NO source injected: the requirement manifest is the
  // current deepAnalysis-derived one (here the single 'req-poliza' requirement), and
  // passing manizalesManifestSource=null leaves it byte-identical.
  const v3InputArgs = {
    ...v3Context(), contextV2: true, documentRetrieval: true, companyEvidenceClasses: { classes: [] },
  };
  const sourceAbsent = buildAgt002PreviewInput({ ...v3InputArgs });
  const sourceNull = buildAgt002PreviewInput({ ...v3InputArgs, manizalesManifestSource: null });
  assert.deepEqual(sourceNull, sourceAbsent, 'manizalesManifestSource=null must be byte-identical to the current path');
  assert.deepEqual(
    sourceAbsent.document_evidence.requirement_manifest.map(entry => entry.requirement_id),
    ['req-poliza'],
    'source-absent path keeps the current deepAnalysis-derived requirement manifest',
  );

  // Engine flag off (v3 off): a manizalesManifestSource in engine config is fully ignored.
  const flagOffOutput = () => ({ content: JSON.stringify({
    recommendation: 'pause', summary: 'Falta confirmar la póliza.', strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [], questions: [], unverified: [], next_action: 'Solicitar póliza vigente.', human_review_required: true,
  }), usage: { input_tokens: 1, output_tokens: 1 } });
  const flagOffContext = {
    opportunity: { id: 'opp-1', company_name: 'ACME', title: 'Vigilancia' },
    documents: retrievalDocuments, deepAnalysis: {}, snapshotId: SNAPSHOT_ID,
  };
  const engineWithout = createAgt002PreviewEngine({ client: fakeClient(flagOffOutput), ...baseEngineOptions() });
  const engineWith = createAgt002PreviewEngine({
    client: fakeClient(flagOffOutput), ...baseEngineOptions(), manizalesManifestSource: MANIZALES_MANIFEST_SOURCE,
  });
  const resultWithout = await engineWithout.analyze(flagOffContext);
  const resultWith = await engineWith.analyze(flagOffContext);
  assert.deepEqual(resultWith, resultWithout, 'flag-off engine must ignore manizalesManifestSource byte-for-byte');
  assert.equal(resultWithout.schema_version, '2.0-preview.1');
}

// -----------------------------------------------------------------------------
// T3.1.2 — Flag on + injected valid source: engine derives the V3 context from the
// manifest's analyzable entries in deterministic order.
// -----------------------------------------------------------------------------
{
  assert.equal(MANIZALES_MANIFEST_SOURCE.opportunity_id, AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID);
  assert.equal(MANIZALES_MANIFEST_SOURCE.proceso, AGT002_INTEGRAL_MANIFEST_PROCESO);

  const client = fakeClient((options) => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  const engine = createAgt002PreviewEngine({
    client, ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    manizalesManifestSource: MANIZALES_MANIFEST_SOURCE,
  });
  const result = await engine.analyze(v3Context());

  const modelInput = client.calls[0].input;
  const requirementManifest = modelInput.document_evidence.requirement_manifest;

  const manifestOnlyInput = buildAgt002PreviewInput({
    ...v3Context(),
    deepAnalysis: { matrix: { legal: [], financial: [], technical: [] } },
    contextV2: true,
    documentRetrieval: true,
    companyEvidenceClasses: { classes: [] },
    manizalesManifestSource: MANIZALES_MANIFEST_SOURCE,
  });
  assert.deepEqual(
    manifestOnlyInput.document_evidence.requirement_manifest.map(entry => entry.requirement_id),
    analyzableIds,
    'the injected manifest must replace, not merely augment, an empty legacy deep-analysis matrix',
  );

  // requirement_manifest ids == analyzable entries in deterministic manifest order.
  assert.deepEqual(requirementManifest.map(entry => entry.requirement_id), analyzableIds);
  assert.equal(requirementManifest.length, 20);

  // Strict superset in coverage over the current path: strictly more requirements, and
  // none of the four (non-analyzable) governed runtime ids leak into the resolved manifest.
  assert.ok(requirementManifest.length > FOUR_GOVERNED_IDS.length, 'manifest-driven set governs strictly more requirements');
  for (const governedId of FOUR_GOVERNED_IDS) {
    assert.equal(requirementManifest.some(entry => entry.requirement_id === governedId), false,
      `non-analyzable governed runtime id must not leak into the resolved manifest: ${governedId}`);
  }
  assert.equal(requirementManifest.some(entry => entry.requirement_id === 'req-poliza'), false);

  // Each unit uses the existing requirement-manifest unit shape with citation-derived
  // resolved sources (document id/version/hash) and NEVER any raw/open source text.
  assert.equal(modelInput.document_evidence.requirement_manifest_version, '1.0');
  for (const entry of requirementManifest) {
    assert.deepEqual(Object.keys(entry).sort(), ['category', 'evidence_state_governed', 'front', 'label', 'requirement_id', 'sources', 'unresolved_sources']);
    assert.ok(['legal', 'financial', 'technical'].includes(entry.front));
    assert.ok(entry.sources.length >= 1);
    for (const source of entry.sources) {
      assert.deepEqual(Object.keys(source).sort(), ['content_hash', 'document_id', 'document_version_id']);
      assert.match(source.content_hash, /^[0-9a-f]{64}$/);
      assert.equal(Object.hasOwn(source, 'text'), false);
      assert.equal(Object.hasOwn(source, 'excerpt'), false);
      assert.equal(Object.hasOwn(source, 'quote'), false);
    }
  }
  // No open source text (source_text_by_document_id / citation quotes) is copied out.
  assert.equal(Object.hasOwn(modelInput, 'source_text_by_document_id'), false);
  assert.equal(Object.hasOwn(modelInput.document_evidence, 'source_text_by_document_id'), false);
  assert.doesNotMatch(JSON.stringify(modelInput.document_evidence.requirement_manifest), /"(text|excerpt|quote)"\s*:/);

  // Category override derives from each manifest entry's governed category.
  const categoryByRequirementId = new Map(analyzableEntries.map(entry => [entry.requirement_id, entry.category]));
  for (const entry of requirementManifest) {
    assert.equal(entry.category, categoryByRequirementId.get(entry.requirement_id),
      `governed category for ${entry.requirement_id} must derive from the manifest entry`);
  }
  // Legal-front proposals carry an explicit closed runtime category (front 'legal' has no
  // deterministic map), and técnico=>technical is preserved.
  const legalFront = requirementManifest.find(entry => entry.front === 'legal');
  assert.ok(legalFront && legalFront.category === 'habilitating', 'legal-front proposal must carry an explicit closed category');
  const technicalFront = requirementManifest.find(entry => entry.front === 'technical');
  assert.ok(technicalFront && technicalFront.category === 'technical', 'técnico=>technical mapping preserved');

  // Evidence link derives from evidence_class_id; a null evidence class maps to the safe
  // unknown state with compliance unknown.
  const rupEntry = requirementManifest.find(entry => entry.requirement_id === 'proposal:2.3:indices-capacidad-organizacional');
  assert.equal(rupEntry.evidence_state_governed.presence, 'present', 'a verified linked evidence class projects a real presence axis');
  const nullClassRequirementId = analyzableEntries.find(entry => entry.evidence_class_id === null).requirement_id;
  const nullClassEntry = requirementManifest.find(entry => entry.requirement_id === nullClassRequirementId);
  assert.deepEqual(nullClassEntry.evidence_state_governed, AGT002_EVIDENCE_STATE_SAFE_UNKNOWN);
  assert.equal(nullClassEntry.evidence_state_governed.compliance, 'unknown');

  // Engine owns/injects run/snapshot/context/coverage/corpus/usage — the provider cannot forge them.
  assert.equal(result.schema_version, '3.0.0');
  assert.equal(result.run_id, FIXED_RUN_ID);
  assert.equal(result.snapshot_id, SNAPSHOT_ID);
  assert.equal(result.status, 'completed');
  assert.equal(result.method, 'agent_ai');
  assert.equal(result.human_review_required, true);
  assert.equal(result.usage.provider, 'codex_app_server');
  assert.ok(result.evidence_coverage, 'engine assembles evidence_coverage');
  assert.deepEqual(result.evidence_coverage.requirement_manifest.map(entry => entry.requirement_id), analyzableIds);
  assert.equal(result.legal_corpus_version_id, null);
  assert.equal(Object.hasOwn(result, 'governance_provenance'), false, 'manifest-driven run carries no legacy governance_provenance block');

  // The assembled integral analysis reproduces the governed category per unit and stays
  // fully abstained/pending (no compliance assertion, no human_approved).
  assert.deepEqual(result.integral_analysis.coverage.expected_requirement_ids, analyzableIds);
  assert.deepEqual(result.integral_analysis.coverage.analyzed_requirement_ids, analyzableIds);
  for (const unit of result.integral_analysis.analysis_units) {
    assert.equal(unit.evidence_state.compliance, 'unknown');
    assert.equal(unit.human_validation.status, 'pending');
    assert.equal(unit.category, categoryByRequirementId.get(unit.requirement_id));
  }
}

// -----------------------------------------------------------------------------
// T3.1.3 — Flag on + wrong opportunity/proceso or malformed source: fail closed.
// -----------------------------------------------------------------------------
{
  const wrongOpportunity = { ...MANIZALES_MANIFEST_SOURCE, opportunity_id: '00000000-0000-4000-8000-000000000000' };
  const wrongProceso = { ...MANIZALES_MANIFEST_SOURCE, proceso: 'SA-99-2099' };
  const malformed = { artifact_type: 'not-the-manifest' };

  for (const [label, badSource] of [['wrong opportunity', wrongOpportunity], ['wrong proceso', wrongProceso], ['malformed', malformed]]) {
    assert.throws(
      () => createAgt002PreviewEngine({
        client: fakeClient(() => ({ content: '{}', usage: { input_tokens: 1, output_tokens: 1 } })),
        ...baseEngineOptions(), contextV2: true, documentRetrieval: true, integralContractV3: true,
        companyEvidenceClassesProvider: () => [], manizalesManifestSource: badSource,
      }),
      /manifiesto integral|Manizales|piloto/i,
      `engine must fail closed under active V3 for a ${label} source (no generic fallback)`,
    );
  }
}

// Server-owned source selection is inert with V3 off, exact for Manizales and fail-closed
// for every non-pilot opportunity while the pilot flag is active.
assert.equal(selectAgt002ManizalesManifestSource({ integralContractV3: false, opportunityId: 'other' }), null);
assert.equal(
  selectAgt002ManizalesManifestSource({
    integralContractV3: true,
    opportunityId: AGT002_INTEGRAL_MANIFEST_OPPORTUNITY_ID,
  }),
  AGT002_MANIZALES_CHECKED_IN_MANIFEST,
);
assert.throws(
  () => selectAgt002ManizalesManifestSource({ integralContractV3: true, opportunityId: '00000000-0000-4000-8000-000000000000' }),
  error => error?.code === 'AGT002_MANIZALES_PILOT_SCOPE_MISMATCH',
);

console.log('agt002-manizales-v3-manifest-wiring: OK');
