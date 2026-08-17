import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createAgt002PreviewEngine } from '../agt002-preview-engine.js';
import { buildAgt002OpportunityContextV2 } from '../agt002-opportunity-context-v2.js';
import { buildAgt002CompanyDossier } from '../agt002-company-dossier.js';
import { deriveAgt002ManizalesManifestScope } from '../agt002-manizales-manifest-wiring.js';
import {
  validateAgt002ManifestScope,
  validateAgt002TenderAnalysisEnvelopeV3,
  adaptAgt002TenderAnalysisV3,
} from '../agt002-tender-adapter.js';
import { registerAgt002PreviewAnalysis } from '../agt002-preview-persistence.js';
import { projectAgt002IntegralV3ToV2 } from '../agt002-v3-compatibility.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';

// Phase 4 (server-owned manifest_scope): the engine derives and appends the governed scope
// after validating model output; the adapter and persistence each independently re-validate it
// and deep-compare it to a separately supplied, server-owned expected scope. A provider-supplied
// scope, a forged scope, or a missing scope for a manifest-driven run all fail closed. Nothing
// here touches production, the network or a real DB.

const MANIZALES_MANIFEST_SOURCE = JSON.parse(
  readFileSync(new URL('../data/agt002/manizales-sa-24-2026.integral-manifest.v1.json', import.meta.url), 'utf8'),
);
const EXPECTED_SCOPE = deriveAgt002ManizalesManifestScope(MANIZALES_MANIFEST_SOURCE);
const analyzableIds = MANIZALES_MANIFEST_SOURCE.entries.filter(entry => entry.analyzable === true).map(entry => entry.requirement_id);

// ---------------------------------------------------------------------------
// Shared engine harness (mirrors the Phase 3 wiring test).
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
function engineWith({ client, ...overrides } = {}) {
  return createAgt002PreviewEngine({
    client, model: 'synthetic-codex-model', policyVersion: 'agt002-integral-v3-policy-1', timeoutMs: 2000,
    maxConcurrent: 2, dailyMaxRuns: 5, countDailyRuns: async () => 0, idGenerator: () => FIXED_RUN_ID,
    contextV2: true, documentRetrieval: true, integralContractV3: true,
    companyEvidenceClassesProvider: () => [verifiedRupRegistryRow],
    manizalesManifestSource: MANIZALES_MANIFEST_SOURCE, ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Engine: derives + appends the exact server-owned top-level scope after model validation.
// ---------------------------------------------------------------------------
test('the engine assembles the exact server-derived top-level manifest_scope', async () => {
  const client = fakeClient((options) => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) } }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  const engine = engineWith({ client });
  const result = await engine.analyze(v3Context());

  assert.deepEqual(result.manifest_scope, EXPECTED_SCOPE);
  assert.deepEqual(result.manifest_scope.analyzable_requirement_ids, analyzableIds);
  assert.equal(Object.hasOwn(result.integral_analysis, 'manifest_scope'), false);
  assert.equal(Object.hasOwn(result.integral_analysis.coverage, 'manifest_scope'), false);

  // The engine exposes the governed expected scope so internal persistence call sites can
  // deep-compare against it (never sourced from a request body).
  assert.deepEqual(engine.manifestScope, EXPECTED_SCOPE);
});

test('a non-manifest engine exposes no manifest scope and appends none', async () => {
  const client = fakeClient(() => ({ content: JSON.stringify({
    recommendation: 'pause', summary: 'Falta confirmar la póliza.', strengths: [],
    weaknesses: [{ id: 'f-1', text: 'Falta póliza vigente.', critical: true, evidence_refs: ['document:doc-01'] }],
    blockers: [], questions: [], unverified: [], next_action: 'Solicitar póliza vigente.', human_review_required: true,
  }), usage: { input_tokens: 1, output_tokens: 1 } }));
  const engine = createAgt002PreviewEngine({
    client, model: 'm', policyVersion: 'p', timeoutMs: 2000, maxConcurrent: 2, dailyMaxRuns: 5,
    countDailyRuns: async () => 0, idGenerator: () => FIXED_RUN_ID,
  });
  assert.equal(engine.manifestScope, null);
  const result = await engine.analyze({ opportunity: { id: 'opp-1', company_name: 'ACME', title: 'Vigilancia' }, documents: retrievalDocuments, deepAnalysis: {}, snapshotId: SNAPSHOT_ID });
  assert.equal(Object.hasOwn(result, 'manifest_scope'), false);
});

test('a model payload attempting a top-level manifest_scope is rejected, never copied', async () => {
  const client = fakeClient((options) => ({
    content: JSON.stringify({ integral_analysis: { analysis_units: buildV3AbstainedUnits(options.input) }, manifest_scope: EXPECTED_SCOPE }),
    usage: { input_tokens: 7, output_tokens: 7 },
  }));
  await assert.rejects(() => engineWith({ client }).analyze(v3Context()), /válida/i);
});

// ---------------------------------------------------------------------------
// Adapter: closed-key variant, expected-scope deep equality for manifest-driven runs.
// ---------------------------------------------------------------------------
function buildV3ValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: null,
    allowlist: { tender_document: ['TD-1'], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [] },
    materialOmissionsObserved: false,
    evidenceStateManifest: [{ requirement_id: 'REQ-1', evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'no_governed_evidence_class_link', provenance: null }],
  };
}
function buildV3Envelope(overrides = {}) {
  const integral_analysis = {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1', expected_requirement_ids: ['REQ-1'], analyzed_requirement_ids: ['REQ-1'],
      material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(), legal_corpus_version_id: null,
    },
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'REQ-1', category: 'discard', sequence: 1,
      title: 'Requisito sintético', assessment_mode: 'assessed',
      conclusion: { status: 'human_validation_required', summary: 'Sin evidencia gobernada disponible; requiere validación humana.', confidence: 'medium' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN,
      evidence_refs: [{ ref: 'TD-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [], commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
      actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    }],
  };
  return {
    schema_version: '3.0.0', agent_id: 'AGT-002', run_id: '44444444-4444-4444-8444-444444444444',
    policy_version: 'agt002-integral-v3-policy-1', snapshot_id: SNAPSHOT_ID, context_version_id: null,
    status: 'completed', method: 'agent_ai', integral_analysis,
    evidence_coverage: { material_omissions: false, omitted_count: 0 }, legal_corpus_version_id: null,
    human_review_required: true, v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    usage: { provider: 'codex_app_server', model: 'synthetic-v3', input_tokens: 1, output_tokens: 1, rate_limit: null },
    ...overrides,
  };
}

test('validateAgt002ManifestScope validates the closed shape and disposition arithmetic', () => {
  assert.deepEqual(validateAgt002ManifestScope(EXPECTED_SCOPE), EXPECTED_SCOPE);
  // Missing key.
  const { registry_sections: _drop, ...missing } = EXPECTED_SCOPE;
  assert.throws(() => validateAgt002ManifestScope(missing), /manifest_scope|alcance/i);
  // Extra key.
  assert.throws(() => validateAgt002ManifestScope({ ...EXPECTED_SCOPE, extra: 1 }), /manifest_scope|alcance/i);
  // Negative / non-integer field.
  assert.throws(() => validateAgt002ManifestScope({ ...EXPECTED_SCOPE, registry_sections: -1 }), /manifest_scope|alcance/i);
  // Duplicate id breaks uniqueness.
  assert.throws(() => validateAgt002ManifestScope({ ...EXPECTED_SCOPE, analyzable_requirement_ids: [EXPECTED_SCOPE.analyzable_requirement_ids[0], EXPECTED_SCOPE.analyzable_requirement_ids[0]] }), /manifest_scope|alcance/i);
  // Disposition arithmetic must close against the ledgers (30+0+5 = 15+20).
  assert.throws(() => validateAgt002ManifestScope({ ...EXPECTED_SCOPE, dispositions: { analyzed_candidate: 31, excluded_with_reason: 0, unresolved_visible: 5 } }), /manifest_scope|alcance|conteo|disposic/i);
});

test('the adapter accepts an exact scope with a governed expected scope and rejects missing/forged', () => {
  const ctx = buildV3ValidationContext();
  const envelope = buildV3Envelope({ manifest_scope: EXPECTED_SCOPE });

  // Accept exact scope under a governed expected scope.
  const validated = validateAgt002TenderAnalysisEnvelopeV3(envelope, ctx, EXPECTED_SCOPE);
  assert.deepEqual(validated.manifest_scope, EXPECTED_SCOPE);
  const adapted = adaptAgt002TenderAnalysisV3(envelope, ctx, EXPECTED_SCOPE);
  assert.equal(adapted.producer, 'AGT-002');

  // A scope on the envelope but no governed expected scope: the closed key set rejects it.
  assert.throws(() => validateAgt002TenderAnalysisEnvelopeV3(envelope, ctx), /cerrado/i);

  // Missing scope under manifest-driven (expected supplied) validation.
  assert.throws(() => validateAgt002TenderAnalysisEnvelopeV3(buildV3Envelope(), ctx, EXPECTED_SCOPE), /cerrado|alcance|manifest_scope/i);

  // Forged scope: internally well-formed but not equal to the governed expected scope.
  const forged = buildV3Envelope({ manifest_scope: { ...EXPECTED_SCOPE, registry_sections: 999 } });
  assert.throws(() => validateAgt002TenderAnalysisEnvelopeV3(forged, ctx, EXPECTED_SCOPE), /alcance|manifest_scope|coincide/i);
});

// ---------------------------------------------------------------------------
// Persistence: writes the exact scope into p_result, rejects malformed/forged before RPC.
// ---------------------------------------------------------------------------
const persistIds = {
  opportunity: '22222222-2222-4222-8222-222222222222',
  tender: '33333333-3333-4333-8333-333333333333',
  snapshot: SNAPSHOT_ID,
  run: '66666666-6666-4666-8666-666666666666',
  contextVersion: '77777777-7777-4777-8777-777777777777',
};
function fakeDatabase() {
  const rpcCalls = [];
  return {
    rpcCalls,
    async rpc(name, params) {
      rpcCalls.push({ name, params });
      if (!['psi_record_tender_analysis_run', 'psi_record_agt002_canonical_analysis_run'].includes(name)) throw new Error(`unexpected RPC ${name}`);
      return { data: { id: persistIds.run, snapshot_id: params.p_snapshot_id, producer: 'AGT-002', method: 'agent_ai', status: 'completed', canonical: true, critical_open_count: params.p_critical_open_count }, error: null };
    },
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null, error: null }; } }; },
  };
}
function persistEvidenceCoverage() {
  return {
    snapshot_id: persistIds.snapshot,
    budget: { max_chunks: 2, max_chars: 1000, max_tokens: 300, chunks_used: 1, chars_used: 40, tokens_used: 8, chunks_remaining: 1, chars_remaining: 960, tokens_remaining: 292 },
    coverage_manifest: { total_requirements: 1, covered_requirements: 1, uncovered_requirements: 0, by_requirement: [{ requirement_id: 'req-1', status: 'covered', selected_evidence_refs: ['chunk:1'], omission_reasons: [] }] },
    selected_chunks: [{ chunk_id: 'chunk:1', evidence_ref: 'chunk:1', document_id: 'doc-01', name: 'Pliego', document_type: 'pliego', version: 1, page: 1, section: 'Objeto', precedence: 'base', superseded_by_addendum: false, requirement_ids: ['req-1'] }],
    omitted_chunks: [], citation_allowlist: ['chunk:1'], material_omissions: false,
    requirement_manifest_version: '1.0',
    requirement_manifest: [{ requirement_id: 'req-1', front: 'legal', label: 'Póliza de cumplimiento', sources: [{ document_id: 'doc-01', document_version_id: 'ver-01', content_hash: 'a'.repeat(64) }], unresolved_sources: [] }],
  };
}
function persistIntegralAnalysis() {
  return {
    contract_version: 'agt002-integral-analysis-v3',
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1', expected_requirement_ids: ['req-1'], analyzed_requirement_ids: ['req-1'],
      material_omissions: false, omission_reasons: [], company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [], legal_corpus_version_id: null,
    },
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'req-1', category: 'habilitating', sequence: 1,
      title: 'Póliza vigente', assessment_mode: 'assessed',
      conclusion: { status: 'supported_with_evidence', summary: 'Evidencia sustenta la póliza.', confidence: 'high' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: { presence: 'present', review: 'reviewed', validity: 'valid', applicability: 'applicable', compliance: 'supported_pending_human_review' },
      evidence_refs: [{ ref: 'chunk:1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [], commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
      actions: [], milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    }],
  };
}
function persistEnvelope(overrides = {}) {
  const integral_analysis = persistIntegralAnalysis();
  return {
    schema_version: '3.0.0', agent_id: 'AGT-002', run_id: persistIds.run,
    policy_version: 'agt002-integral-v3-policy-1', snapshot_id: persistIds.snapshot, context_version_id: persistIds.contextVersion,
    status: 'completed', method: 'agent_ai', integral_analysis, evidence_coverage: persistEvidenceCoverage(),
    legal_corpus_version_id: null, human_review_required: true, v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    usage: { provider: 'codex_app_server', model: 'synthetic-codex-model', input_tokens: 5, output_tokens: 5, rate_limit: null },
    manifest_scope: EXPECTED_SCOPE, ...overrides,
  };
}
function persistContext(overrides = {}) {
  return { opportunity_id: persistIds.opportunity, tender_id: persistIds.tender, snapshot_id: persistIds.snapshot, canonicalOnly: true, context_version_id: persistIds.contextVersion, expectedManifestScope: EXPECTED_SCOPE, ...overrides };
}

test('persistence writes the exact scope into p_result under a governed expected scope', async () => {
  const database = fakeDatabase();
  const registered = await registerAgt002PreviewAnalysis(database, persistContext({ envelope: persistEnvelope() }));
  assert.equal(registered.status, 'completed');
  const call = database.rpcCalls[0];
  assert.equal(call.name, 'psi_record_agt002_canonical_analysis_run');
  assert.deepEqual(call.params.p_result.manifest_scope, EXPECTED_SCOPE);
  assert.deepEqual(registered.result.manifest_scope, EXPECTED_SCOPE);
});

test('persistence rejects a forged scope before any RPC', async () => {
  const database = fakeDatabase();
  const forged = persistEnvelope({ manifest_scope: { ...EXPECTED_SCOPE, registry_sections: 999 } });
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, persistContext({ envelope: forged })), /alcance|manifest_scope|coincide/i);
  assert.equal(database.rpcCalls.length, 0, 'no RPC before rejecting a forged scope');
});

test('persistence rejects a malformed scope before any RPC', async () => {
  const database = fakeDatabase();
  const malformed = persistEnvelope({ manifest_scope: { ...EXPECTED_SCOPE, extra: 1 } });
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, persistContext({ envelope: malformed })), /alcance|manifest_scope/i);
  assert.equal(database.rpcCalls.length, 0, 'no RPC before rejecting a malformed scope');
});

test('persistence rejects a scope-bearing envelope with no governed expected scope', async () => {
  const database = fakeDatabase();
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, persistContext({ envelope: persistEnvelope(), expectedManifestScope: undefined })), /alcance|manifest_scope|esperado/i);
  assert.equal(database.rpcCalls.length, 0);
});

test('persistence rejects a missing scope when a governed expected scope is supplied', async () => {
  const database = fakeDatabase();
  const withoutScope = persistEnvelope();
  delete withoutScope.manifest_scope;
  await assert.rejects(() => registerAgt002PreviewAnalysis(database, persistContext({ envelope: withoutScope })), /alcance|manifest_scope|falta/i);
  assert.equal(database.rpcCalls.length, 0);
});
