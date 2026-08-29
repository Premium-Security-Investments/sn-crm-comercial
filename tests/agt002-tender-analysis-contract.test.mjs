import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  validateAgt002TenderAnalysisEnvelope,
  validateAgt002TenderAnalysisRequest,
  validateAgt002TenderAnalysisEnvelopeV3,
  adaptAgt002TenderAnalysisV3,
} from '../agt002-tender-adapter.js';
import { buildSyntheticAgt002TenderAnalysis } from './fixtures/agt002-synthetic-responder.mjs';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from '../agt002-integral-analysis-v3.js';
import { AGT002_COMPANY_EVIDENCE_CLASS_IDS } from '../agt002-company-evidence-classes.js';
import { AGT002_EVIDENCE_STATE_SAFE_UNKNOWN } from '../agt002-evidence-state-manifest.js';
import { projectAgt002IntegralV3ToV2 } from '../agt002-v3-compatibility.js';

const v1Files = ['manifest.json', 'analysis.request.schema.json', 'analysis.response.schema.json'];
const v1Hash = createHash('sha256').update(v1Files.map(name => readFileSync(new URL(`../contracts/agents/AGT-002/v1/${name}`, import.meta.url))).join('\n')).digest('hex');
assert.equal(v1Hash, 'b42efca7952e917da93c551400efaa71db7c8fa0c69a8c74b6fb4980782ca82e');

const snapshot = {
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
  tender_id: '33333333-3333-4333-8333-333333333333',
  document_hash: 'a'.repeat(64),
  profile_hash: 'b'.repeat(64),
  documents: [{
    document_id: 'doc-001',
    name: 'Pliego de condiciones',
    document_type: 'pliego',
    content: 'Contenido extraído del pliego.',
    content_sha256: 'c'.repeat(64),
    current: true,
  }],
  company_profile: {
    profile_version: 'rup-2026-07',
    fields: [{
      key: 'annual_revenue',
      label: 'Ingresos anuales',
      value: '500000000',
      source: 'RUP',
    }],
  },
};

assert.deepEqual(validateAgt002TenderAnalysisRequest(snapshot), snapshot);
for (const invalidSnapshot of [
  { ...snapshot, unexpected: true },
  { ...snapshot, snapshot_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
  { ...snapshot, document_hash: 'A'.repeat(64) },
  { ...snapshot, documents: [{ ...snapshot.documents[0], content_sha256: 'C'.repeat(64) }] },
  { ...snapshot, documents: [{ ...snapshot.documents[0], document_id: '' }] },
  { ...snapshot, documents: [{ ...snapshot.documents[0], current: 'true' }] },
  { ...snapshot, documents: [{ ...snapshot.documents[0], extra: true }] },
  { ...snapshot, company_profile: { ...snapshot.company_profile, fields: [{ ...snapshot.company_profile.fields[0], source: 42 }] } },
  { ...snapshot, company_profile: { ...snapshot.company_profile, fields: [{ ...snapshot.company_profile.fields[0], extra: true }] } },
  { ...snapshot, company_profile: { ...snapshot.company_profile, profile_version: '' } },
]) {
  assert.throws(() => validateAgt002TenderAnalysisRequest(invalidSnapshot), /snapshot SIIO/i);
}

const envelope = buildSyntheticAgt002TenderAnalysis(snapshot);
assert.equal(validateAgt002TenderAnalysisEnvelope(envelope).agent_id, 'AGT-002');
assert.equal(envelope.human_review_required, true);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, agent_id: 'AGT-999' }), /AGT-002/);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, human_review_required: false }), /revisión humana/i);

const requestSchema = JSON.parse(readFileSync(new URL('../contracts/agents/AGT-002/v2-draft/analysis-run.request.schema.json', import.meta.url), 'utf8'));
const responseSchema = JSON.parse(readFileSync(new URL('../contracts/agents/AGT-002/v2-draft/analysis-run.response.schema.json', import.meta.url), 'utf8'));
const requestFields = ['snapshot_id', 'opportunity_id', 'tender_id', 'document_hash', 'profile_hash', 'documents', 'company_profile'];
const responseFields = ['schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'status', 'method', 'recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required', 'usage'];
const documentFields = ['document_id', 'name', 'document_type', 'content', 'content_sha256', 'current'];
const companyProfileFields = ['profile_version', 'fields'];
const companyFieldFields = ['key', 'label', 'value', 'source'];
const uppercaseUuid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

for (const field of ['run_id', 'snapshot_id']) {
  const pattern = responseSchema.properties[field].pattern;
  assert.ok(pattern, `response schema must define a lowercase UUID pattern for ${field}`);
  assert.equal(new RegExp(pattern).test(uppercaseUuid), false, `response schema must reject uppercase ${field}`);
  assert.throws(
    () => validateAgt002TenderAnalysisEnvelope({ ...envelope, [field]: uppercaseUuid }),
    /Run y snapshot deben ser UUID/,
    `runtime envelope validator must reject uppercase ${field}`,
  );
}

function assertClosedObjects(schema, location = '$') {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${location} must reject extra fields`);
    for (const [name, child] of Object.entries(schema.properties || {})) assertClosedObjects(child, `${location}.${name}`);
  }
  if (schema.items) assertClosedObjects(schema.items, `${location}.items`);
}

assert.deepEqual(requestSchema.required, requestFields);
assert.deepEqual(Object.keys(requestSchema.properties), requestFields);
for (const field of ['snapshot_id', 'opportunity_id', 'tender_id']) {
  assert.equal(requestSchema.properties[field].pattern, '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
}
assert.deepEqual(requestSchema.properties.documents.items.required, documentFields);
assert.deepEqual(Object.keys(requestSchema.properties.documents.items.properties), documentFields);
assert.equal(requestSchema.properties.documents.items.properties.content_sha256.pattern, '^[a-f0-9]{64}$');
assert.deepEqual(requestSchema.properties.company_profile.required, companyProfileFields);
assert.deepEqual(Object.keys(requestSchema.properties.company_profile.properties), companyProfileFields);
assert.deepEqual(requestSchema.properties.company_profile.properties.fields.items.required, companyFieldFields);
assert.deepEqual(Object.keys(requestSchema.properties.company_profile.properties.fields.items.properties), companyFieldFields);
assert.equal(requestSchema.properties.company_profile.properties.fields.items.properties.source.type[0], 'string');
assert.equal(requestSchema.properties.company_profile.properties.fields.items.properties.source.type[1], 'null');
assert.deepEqual(responseSchema.required, responseFields);
assert.deepEqual(Object.keys(responseSchema.properties), responseFields);
assert.equal(responseSchema.properties.schema_version.const, '2.0-draft');
assert.equal(responseSchema.properties.agent_id.const, 'AGT-002');
assert.equal(responseSchema.properties.status.const, 'completed');
assert.equal(responseSchema.properties.method.const, 'agent_ai');
assert.equal(responseSchema.properties.human_review_required.const, true);
for (const field of ['strengths', 'weaknesses', 'blockers', 'questions', 'unverified']) {
  assert.deepEqual(responseSchema.properties[field].items.required, ['id', 'text', 'critical', 'evidence_refs']);
}
assertClosedObjects(requestSchema);
assertClosedObjects(responseSchema);

function validEnvelopeFixture() {
  return buildSyntheticAgt002TenderAnalysis(snapshot);
}

function testAcceptsPreviewSchemaVersion() {
  const envelope = { ...validEnvelopeFixture(), schema_version: '2.0-preview.1' };
  const result = validateAgt002TenderAnalysisEnvelope(envelope);
  assert.equal(result.schema_version, '2.0-preview.1');
}

function testStillRejectsUnknownSchemaVersion() {
  const envelope = { ...validEnvelopeFixture(), schema_version: '1.0-legacy' };
  assert.throws(() => validateAgt002TenderAnalysisEnvelope(envelope), /versión de esquema/i);
}

testAcceptsPreviewSchemaVersion();
testStillRejectsUnknownSchemaVersion();

// ---------------------------------------------------------------------------
// Task 5: v3 envelope validation + adapter, rejecting v2/v3 hybrids in either direction.
// ---------------------------------------------------------------------------

function buildV3IntegralAnalysisValidationContext() {
  return {
    requirementManifestVersion: 'agt002-deep-analysis-v1',
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceManifestVersion: 'agt002-company-evidence-classes-v1',
    companyEvidenceClassIds: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
    legalCorpusVersionId: null,
    allowlist: { tender_document: ['TD-1'], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [] },
    materialOmissionsObserved: false,
    // No governed evidence-class link is curated for REQ-1 in this fixture, so the
    // governed map (agt002-evidence-state-manifest.js's default) is the safe-unknown
    // state — matched below in buildV3Envelope's evidence_state.
    evidenceStateManifest: [
      { requirement_id: 'REQ-1', evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN, rule_id: 'no_governed_evidence_class_link', provenance: null },
    ],
  };
}

function buildV3Envelope() {
  const integral_analysis = {
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    coverage: {
      manifest_version: 'agt002-deep-analysis-v1',
      expected_requirement_ids: ['REQ-1'],
      analyzed_requirement_ids: ['REQ-1'],
      material_omissions: false,
      omission_reasons: [],
      company_evidence_manifest_version: 'agt002-company-evidence-classes-v1',
      company_evidence_class_ids: [...AGT002_COMPANY_EVIDENCE_CLASS_IDS].sort(),
      legal_corpus_version_id: null,
    },
    analysis_units: [{
      unit_id: 'UNIT-1', unit_kind: 'tender_requirement', requirement_id: 'REQ-1', category: 'discard', sequence: 1,
      title: 'Requisito sintético', assessment_mode: 'assessed',
      // REQ-1 has no governed evidence-class link (safe-unknown evidence_state,
      // compliance "unknown"), so conclusion.status must honestly be
      // "human_validation_required" (P0: a material conclusion can never coexist with
      // compliance "unknown") with confidence "medium" (P1: never "high").
      conclusion: { status: 'human_validation_required', summary: 'Sin evidencia gobernada disponible; requiere validación humana.', confidence: 'medium' },
      blocking: { effect: 'non_blocking', curability: 'not_applicable', reason: 'Sin efecto.' },
      evidence_state: AGT002_EVIDENCE_STATE_SAFE_UNKNOWN,
      evidence_refs: [{ ref: 'TD-1', source_type: 'tender_document', purpose: 'requirement_basis' }],
      missing_evidence: [],
      commercial_impact: { level: 'low', summary: 'Sin impacto.', dimension: 'eligibility' },
      legal_assessment: { status: 'not_applicable', basis_refs: [], summary: 'No aplica.', human_legal_review_required: false },
      actions: [],
      milestone: { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'Sin hito.' },
      escalation: { required: false, level: 'none', reason: 'Sin condición crítica.' },
      closure: { status: 'human_confirmation_required', condition: 'Persona confirma.', evidence_required: ['tender_document'] },
      human_validation: { required: true, status: 'pending', reason: 'Confirmar.' },
    }],
  };
  return {
    schema_version: '3.0.0',
    agent_id: 'AGT-002',
    run_id: '44444444-4444-4444-8444-444444444444',
    policy_version: 'agt002-integral-v3-policy-1',
    snapshot_id: snapshot.snapshot_id,
    context_version_id: null,
    status: 'completed',
    method: 'agent_ai',
    integral_analysis,
    evidence_coverage: { material_omissions: false, omitted_count: 0 },
    legal_corpus_version_id: null,
    human_review_required: true,
    // v2_projection is never hand-typed: it must be exactly the deterministic projection
    // the real engine/adapter would derive from integral_analysis, or the same-version
    // consumer's recompute-and-reject-mismatch defense (agt002-tender-adapter.js) rejects
    // it outright — matching design section 4.2's engine-assembled envelope shape.
    v2_projection: projectAgt002IntegralV3ToV2(integral_analysis),
    // Real engine usage shape (agt002-preview-engine.js runOnceV3): the codex_app_server
    // provider returns a rate_limit snapshot, never a cost figure.
    usage: { provider: 'synthetic', model: 'synthetic-v3', input_tokens: 1, output_tokens: 1, rate_limit: null },
  };
}

{
  const ctx = buildV3IntegralAnalysisValidationContext();
  const v3Envelope = buildV3Envelope();
  const validated = validateAgt002TenderAnalysisEnvelopeV3(v3Envelope, ctx);
  assert.equal(validated.schema_version, '3.0.0');

  // v2/v3 reject each other's shape (no hybrid accepted by either validator).
  assert.throws(() => validateAgt002TenderAnalysisEnvelope(v3Envelope), /cerrado|esquema/i);
  assert.throws(() => validateAgt002TenderAnalysisEnvelopeV3(envelope, ctx), /cerrado|esquema/i);
  assert.throws(() => validateAgt002TenderAnalysisEnvelopeV3({ ...v3Envelope, schema_version: '2.0-preview.1' }, ctx), /esquema/i);

  // The v3 adapter derives the v2-compatible tender-domain result from the governed envelope.
  const adapted = adaptAgt002TenderAnalysisV3(v3Envelope, ctx);
  assert.equal(adapted.producer, 'AGT-002');
  assert.equal(adapted.run_id, v3Envelope.run_id);
  assert.equal(adapted.human_review_required, true);
  assert.ok(Array.isArray(adapted.strengths));
  // With no governed evidence-class link curated for REQ-1, evidence_state is the safe-
  // unknown abstention state, so the unit counts as unverified and the deterministic v2
  // projection downgrades to advance_conditionally rather than a plain advance.
  assert.equal(adapted.recommendation, 'advance_conditionally');
}

// D: the optional, server-owned run-binding company evidence identity is accepted and
// re-validated (never trusted verbatim) — orthogonal to manifest_scope/governance_provenance,
// never an extra/invalid key.
{
  const ctx = buildV3IntegralAnalysisValidationContext();
  const evidenceIdentity = Object.freeze({
    source_snapshot_hash: 'a'.repeat(64),
    preview_artifact_hash: 'b'.repeat(64),
    source_manifest_version: 'v0.3.1-approved-20260829',
  });
  const withIdentity = { ...buildV3Envelope(), company_evidence_identity: evidenceIdentity };
  const validated = validateAgt002TenderAnalysisEnvelopeV3(withIdentity, ctx);
  assert.deepEqual(validated.company_evidence_identity, evidenceIdentity);

  // An invalid identity (bad hash) must fail closed even though the rest of the envelope is valid.
  assert.throws(
    () => validateAgt002TenderAnalysisEnvelopeV3({ ...withIdentity, company_evidence_identity: { ...evidenceIdentity, source_snapshot_hash: 'not-a-hash' } }, ctx),
    /hash/i,
  );

  // An identity with an extra key must fail closed, never silently accepted verbatim.
  assert.throws(
    () => validateAgt002TenderAnalysisEnvelopeV3({ ...withIdentity, company_evidence_identity: { ...evidenceIdentity, extra: 'no-permitido' } }, ctx),
    /identidad de evidencia empresarial/i,
  );

  // An unrelated extra top-level key must still be rejected — this optional key is exactly
  // `company_evidence_identity`, never a generic escape hatch.
  assert.throws(
    () => validateAgt002TenderAnalysisEnvelopeV3({ ...buildV3Envelope(), unexpected_extra_field: true }, ctx),
    /cerrado/i,
  );
}

console.log('AGT-002 tender analysis consumer contract passed');
