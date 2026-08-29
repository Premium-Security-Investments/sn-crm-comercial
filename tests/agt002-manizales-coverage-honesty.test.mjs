import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';
import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';

// Phase 4 (coverage honesty): a server-owned, top-level `manifest_scope` lets the UI tell the
// 20 analyzable requirements, the 25 atomized entries, the 15 pre-GO sections of 68 registered,
// and the closed 15/15 + 20/20 ledger accounting apart — never presenting analyzed/expected as
// total manifest coverage. Nothing here touches production, the network or a real DB.

const MANIZALES_MANIFEST_SOURCE = JSON.parse(
  readFileSync(new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8'),
);

const analyzableIds = MANIZALES_MANIFEST_SOURCE.entries
  .filter(entry => entry.analyzable === true)
  .map(entry => entry.requirement_id);

// ---------------------------------------------------------------------------
// The pure helper derives the exact governed scope from the checked-in manifest.
// ---------------------------------------------------------------------------
test('deriveAgt002ManizalesManifestScope derives the exact closed governed scope', () => {
  const scope = deriveAgt002ManizalesManifestScope(MANIZALES_MANIFEST_SOURCE);

  assert.deepEqual(Object.keys(scope).sort(), [
    'analyzable_requirement_ids', 'atomized_entry_count', 'dispositions', 'pre_go_relevant',
    'proposal_ledger_accounted', 'proposal_sections', 'registry_sections', 'section_ledger_accounted',
  ]);

  assert.equal(scope.registry_sections, 68);
  assert.equal(scope.pre_go_relevant, 15);
  assert.equal(scope.proposal_sections, 10);
  assert.equal(scope.atomized_entry_count, 25);
  assert.equal(scope.section_ledger_accounted, 15);
  assert.equal(scope.proposal_ledger_accounted, 20);

  // Exact ordered 20 analyzable manifest ids, unique, in deterministic manifest order.
  assert.deepEqual(scope.analyzable_requirement_ids, analyzableIds);
  assert.equal(scope.analyzable_requirement_ids.length, 20);
  assert.equal(new Set(scope.analyzable_requirement_ids).size, 20);

  // Flat disposition aggregate: section ledger (10 analyzed + 5 unresolved) plus proposal
  // ledger (20 analyzed). Never a nested per-ledger breakdown.
  assert.deepEqual(scope.dispositions, { analyzed_candidate: 30, excluded_with_reason: 0, unresolved_visible: 5 });
  assert.deepEqual(Object.keys(scope.dispositions).sort(), ['analyzed_candidate', 'excluded_with_reason', 'unresolved_visible']);

  // Disposition arithmetic closes against the two ledgers (15 + 20 = 35).
  const dispositionTotal = scope.dispositions.analyzed_candidate + scope.dispositions.excluded_with_reason + scope.dispositions.unresolved_visible;
  assert.equal(dispositionTotal, scope.section_ledger_accounted + scope.proposal_ledger_accounted);

  // proposal_sections (10 distinct source sections) is never confused with the 20 atomized
  // proposal-ledger items.
  assert.notEqual(scope.proposal_sections, scope.proposal_ledger_accounted);
});

test('deriveAgt002ManizalesManifestScope fails closed on a non-pilot / malformed source', () => {
  assert.throws(() => deriveAgt002ManizalesManifestScope({ ...MANIZALES_MANIFEST_SOURCE, opportunity_id: '00000000-0000-4000-8000-000000000000' }), /manifiesto integral|Manizales|piloto/i);
  assert.throws(() => deriveAgt002ManizalesManifestScope({ artifact_type: 'not-the-manifest' }), /manifiesto integral|Manizales|piloto/i);
});

// ---------------------------------------------------------------------------
// integral_analysis.coverage keeps its closed shape: the scope never leaks into it.
// ---------------------------------------------------------------------------
const verifiedRupRegistryRow = {
  entry_id: 'rup', document_class: 'RUP', existence_status: 'verified', human_review_status: 'approved',
  applicability_status: 'applicable', integration_active: true, expiry: '2099-01-01', updated_at: '2026-01-01T00:00:00.000Z',
};
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const FIXED_RUN_ID = '99999999-9999-4999-8999-999999999999';
const retrievalDocuments = [{
  document_id: 'doc-01', document_version_id: 'ver-01', opportunity_id: 'opp-1', snapshot_id: null,
  document_type: 'pliego', name: 'Pliego', version: 1, content_hash: 'a'.repeat(64), current: true,
  extracted_text: 'Requiere póliza vigente de cumplimiento.',
}];
const retrievalDeepAnalysis = { matrix: { legal: [], financial: [], technical: [] } };

function contextV2Sections() {
  return {
    ...buildAgt002OpportunityContextV2({
      opportunity: { id: 'opp-1', updated_at: '2026-08-01T10:00:00.000Z' },
      tender: { id: 'tender-1', title: 'Vigilancia', entity: 'Entidad', updated_at: '2026-08-01T10:00:00.000Z' },
    }),
    company_dossier: buildAgt002CompanyDossier({ profile: { legal_name: 'Seguridad Nacional Ltda.', updated_at: '2026-08-01T10:00:00.000Z' }, documents: [] }),
  };
}
function v3Context() {
  return { documents: retrievalDocuments, deepAnalysis: retrievalDeepAnalysis, snapshotId: SNAPSHOT_ID, contextV2Sections: contextV2Sections() };
}
function fakeClient(handler) {
  const calls = [];
  return { calls, run: async (options) => { calls.push(options); return handler(options, calls.length); } };
}
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
function manifestEngine() {
  const client = fakeClient((options) => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  const engine = createAgt002PreviewEngine({
    client, model: 'synthetic-codex-model', policyVersion: 'agt002-integral-v3-policy-1', timeoutMs: 2000,
    maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0, idGenerator: () => FIXED_RUN_ID,
    contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    manizalesManifestSource: MANIZALES_MANIFEST_SOURCE,
  });
  return engine;
}

test('integral_analysis.coverage keeps its closed shape — manifest_scope never leaks into it', async () => {
  const result = await manifestEngine().analyze(v3Context());
  assert.deepEqual(Object.keys(result.integral_analysis.coverage).sort(), [
    'analyzed_requirement_ids', 'company_evidence_class_ids', 'company_evidence_manifest_version',
    'expected_requirement_ids', 'legal_corpus_version_id', 'manifest_version', 'material_omissions', 'omission_reasons',
  ]);
  assert.equal(Object.hasOwn(result.integral_analysis.coverage, 'manifest_scope'), false);
  assert.equal(Object.hasOwn(result.integral_analysis, 'manifest_scope'), false);
  // The scope lives beside integral_analysis, deep-equal to the pure derivation.
  assert.deepEqual(result.manifest_scope, deriveAgt002ManizalesManifestScope(MANIZALES_MANIFEST_SOURCE));
});

// ---------------------------------------------------------------------------
// Static: the optional top-level type lands on TenderDocumentAnalysis, not the V3 analysis.
// ---------------------------------------------------------------------------
test('the optional manifest_scope type is on TenderDocumentAnalysis, never on TenderIntegralAnalysisV3', () => {
  const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
  assert.match(types, /export type TenderManifestScope = \{/);
  for (const field of ['registry_sections', 'pre_go_relevant', 'proposal_sections', 'analyzable_requirement_ids', 'atomized_entry_count', 'dispositions', 'section_ledger_accounted', 'proposal_ledger_accounted']) {
    assert.match(types, new RegExp(field), `TenderManifestScope must carry ${field}`);
  }

  const docAnalysis = types.slice(types.indexOf('export type TenderDocumentAnalysis'));
  assert.match(docAnalysis, /manifest_scope\?:\s*TenderManifestScope\s*\|\s*null/, 'TenderDocumentAnalysis must carry the optional manifest_scope');

  const v3TypeMatch = types.match(/^export type TenderIntegralAnalysisV3 = \{[\s\S]*?^\};$/m);
  assert.ok(v3TypeMatch, 'TenderIntegralAnalysisV3 declaration must be found');
  assert.doesNotMatch(v3TypeMatch[0], /manifest_scope/, 'TenderIntegralAnalysisV3 must never carry manifest_scope');
});

// ---------------------------------------------------------------------------
// Static: the UI reads analysis.manifest_scope and renders the honest figures separately,
// never labelling analyzed/expected as a generic total "Cobertura".
// ---------------------------------------------------------------------------
test('the V3 view renders the honest manifest_scope figures separately', () => {
  const view = readFileSync(new URL('../src/tenders/components/TenderIntegralAnalysisV3View.tsx', import.meta.url), 'utf8');

  assert.match(view, /analysis\?\.manifest_scope/, 'must read analysis.manifest_scope off the real prop');

  // Requisitos analizables 20 / 25
  assert.match(view, /Requisitos analizables/);
  assert.match(view, /analyzable_requirement_ids\.length/);
  assert.match(view, /atomized_entry_count/);

  // Secciones pre-GO del manifiesto: 15 (68 registradas)
  assert.match(view, /Secciones pre-GO del manifiesto/);
  assert.match(view, /registry_sections/);
  assert.match(view, /pre_go_relevant/);

  // Secciones 15/15 · Propuestas 20/20
  assert.match(view, /section_ledger_accounted/);
  assert.match(view, /proposal_ledger_accounted/);

  // Disposition breakdown.
  assert.match(view, /analyzed_candidate/);
  assert.match(view, /excluded_with_reason/);
  assert.match(view, /unresolved_visible/);

  // The generic "Cobertura" (analyzed/expected) ratio is only used when no manifest_scope is
  // present — never as the total for a manifest-driven run.
  assert.match(view, /scope\s*\?[\s\S]*Requisitos analizables[\s\S]*:[\s\S]*Cobertura[\s\S]*coverageRatio/, 'Cobertura must fall back only when manifest_scope is absent');
});
