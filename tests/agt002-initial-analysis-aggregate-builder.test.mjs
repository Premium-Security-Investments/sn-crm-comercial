import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInitialAggregate, buildInitialMemberOutputSchema, buildInitialSynthesisModelSchema,
  computeInitialAnalysisCoreHash, INITIAL_MODEL_ANALYSIS_KEYS,
} from '../agt002-initial-analysis-aggregate-builder.js';
import { toClaudeProviderOutputSchema, AGT002_CLAUDE_MAX_SCHEMA_BYTES } from '../agt002-claude-client.js';
import { validatePreGoAnalysisV2 } from '../agt002-pre-go-analysis-v2.js';
import { buildInitialScopeAV2, analysisFromBaseline, packageForDocuments } from './fixtures/agt002-pre-go-analysis-v2.mjs';

const DOCUMENTS = Array.from({ length: 3 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  classification: index === 2 ? 'corporate' : 'official',
  contentHash: String(index + 1).repeat(64), extractionHash: String(index + 4).repeat(64),
}));
const IDENTITY = {
  analysisRunId: '50000000-0000-4000-8000-000000000001', authorizationId: '60000000-0000-4000-8000-000000000001',
  packageHash: 'c'.repeat(64), g1Scope: 'A', policyVersion: 'policy-v1',
  opportunityId: '10000000-0000-4000-8000-000000000001', tenderId: '10000000-0000-4000-8000-000000000002',
};
const EXECUTOR = { executorVersion: 'test-executor', modelProfileId: 'sonnet' };
const NOW = new Date('2026-10-05T12:00:00Z');

function inputs(mutateAnalysis = () => {}) {
  const baseline = buildInitialScopeAV2();
  const analysis = analysisFromBaseline(baseline, DOCUMENTS.map(document => document.id));
  mutateAnalysis(analysis);
  return {
    analysis, identity: IDENTITY, executor: EXECUTOR, now: NOW,
    pkg: packageForDocuments(DOCUMENTS, { packageHash: IDENTITY.packageHash, createdAt: baseline.meta.cutoff_at }),
  };
}
const codes = result => result.errors.map(error => error.code);

test('the model schema asks for analysis only and fits the provider after adaptation', () => {
  const schema = buildInitialSynthesisModelSchema({ documentIds: DOCUMENTS.map(document => document.id) });
  assert.deepEqual(Object.keys(schema.properties).sort(), [...INITIAL_MODEL_ANALYSIS_KEYS].sort());
  for (const serverOwned of ['meta', 'evidence_package', 'checks', 'company_fit', 'human_decision', 'presentation_readiness']) {
    assert.equal(serverOwned in schema.properties, false, `${serverOwned} belongs to the server`);
  }
  assert.deepEqual(schema.$defs.sourceRef.required, ['document_id', 'locator']);
  assert.deepEqual(schema.$defs.sourceRef.properties.document_id.enum, DOCUMENTS.map(document => document.id));
  for (const forbidden of ['created_at', 'created_by', 'decision_ref']) {
    assert.equal(forbidden in schema.$defs.claim.properties, false);
    assert.equal(schema.$defs.claim.required.includes(forbidden), false);
  }
  assert.deepEqual(schema.$defs.recommendation.properties.kind.enum, ['HOLD_RECOMMENDED', 'NO_GO_RECOMMENDED', 'INSUFFICIENT_INFORMATION']);

  const adapted = toClaudeProviderOutputSchema(schema);
  assert.equal('allOf' in adapted, false);
  assert.ok(Buffer.byteLength(JSON.stringify(adapted)) < AGT002_CLAUDE_MAX_SCHEMA_BYTES);
});

test('model schemas refuse an empty document set', () => {
  assert.throws(() => buildInitialSynthesisModelSchema({ documentIds: [] }), error => error.diagnostic.reason === 'synthesis_schema_requires_documents');
  assert.throws(() => buildInitialMemberOutputSchema({ memberIds: [] }), error => error.diagnostic.reason === 'member_schema_requires_members');
});

test('a model analysis plus the frozen package builds a valid v2 aggregate', () => {
  const envelope = buildInitialAggregate(inputs());
  const validation = validatePreGoAnalysisV2(envelope);
  assert.deepEqual(validation.errors, []);
  assert.equal(envelope.meta.schema_version, 'pre_go_analysis.v2');
  assert.equal(envelope.meta.aggregate_stage, 'ANALYSIS_PUBLISHED');
  assert.equal(envelope.human_decision, null);
});

test('identity comes from the server: nothing the model writes can override it', () => {
  const hostile = inputs(analysis => {
    analysis.meta = { analysis_run_id: 'model-invented', package_hash: 'f'.repeat(64) };
    analysis.evidence_package = { package_hash: 'f'.repeat(64) };
    analysis.checks = [];
    analysis.company_fit = { status: 'FIT' };
    analysis.human_decision = { decision: 'CONTINUE' };
  });
  const envelope = buildInitialAggregate(hostile);
  assert.equal(envelope.meta.analysis_run_id, IDENTITY.analysisRunId);
  assert.equal(envelope.meta.g1_authorization_id, IDENTITY.authorizationId);
  assert.equal(envelope.meta.package_hash, IDENTITY.packageHash);
  assert.equal(envelope.evidence_package.package_hash, IDENTITY.packageHash);
  assert.equal(envelope.checks.length, 22);
  assert.equal(envelope.company_fit.status, 'NOT_AUTHORIZED');
  assert.equal(envelope.human_decision, null);
  assert.deepEqual(validatePreGoAnalysisV2(envelope).errors, []);
});

test('source refs are expanded from the package members, never from the model', () => {
  const envelope = buildInitialAggregate(inputs());
  const refs = envelope.claims.flatMap(claim => claim.source_refs);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const document = DOCUMENTS.find(item => item.id === ref.document_id);
    assert.ok(document, 'a cited document belongs to the package');
    assert.equal(ref.source_hash, document.extractionHash);
    assert.equal(ref.retrieved_at, envelope.meta.cutoff_at);
    assert.equal(ref.source_id, document.id);
    const official = document.classification === 'official';
    assert.equal(ref.source_type, official ? 'OFFICIAL_PROCESS_DOCUMENT' : 'COMPANY_EVIDENCE');
    assert.equal(ref.officiality_status, official ? 'VERIFIED_OFFICIAL' : 'INTERNAL_SUPPORT');
  }
  for (const claim of envelope.claims) {
    assert.equal(claim.created_by, 'AGT-002');
    assert.equal(claim.decision_ref, null);
    assert.equal(claim.created_at, '2026-10-05T12:00:00.000Z');
  }
});

test('a citation outside the package is not papered over: the v2 validator rejects it', () => {
  const envelope = buildInitialAggregate(inputs(analysis => {
    analysis.claims[0].source_refs[0].document_id = '00000000-0000-4000-8000-00000000dead';
  }));
  assert.ok(codes(validatePreGoAnalysisV2(envelope)).includes('source_ref.member_not_found'));
});

test('the evidence package mirrors the frozen package and never overstates what was evaluated', () => {
  const { evidence_package: pkg, meta } = buildInitialAggregate(inputs());
  assert.equal(pkg.member_count, 3);
  assert.equal(pkg.mandatory_member_count, 3);
  assert.equal(pkg.snapshot_id, null);
  assert.equal(pkg.inventory_cutoff_at, meta.cutoff_at);
  assert.deepEqual(pkg.member_refs.map(member => member.document_id), DOCUMENTS.map(document => document.id));
  assert.ok(pkg.member_refs.every(member => member.vitality === 'UNCLASSIFIED' && member.review_depth === 'FULL'));
});

test('the 22-check catalog is registered as not started: the first analysis claims no executed check', () => {
  const { checks } = buildInitialAggregate(inputs());
  assert.equal(checks.length, 22);
  assert.ok(checks.every(check => check.execution_status === 'NOT_STARTED' && check.result === 'INDETERMINATE' && check.executed_at === null));
});

test('fails closed, with a closed reason, for an unsupported scope or an inconsistent package', () => {
  const base = inputs();
  assert.throws(() => buildInitialAggregate({ ...base, identity: { ...IDENTITY, g1Scope: 'A_PLUS_B' } }), error => error.diagnostic.reason === 'scope_not_supported');
  assert.throws(() => buildInitialAggregate({ ...base, pkg: undefined }), error => error.diagnostic.reason === 'package_unavailable');
  assert.throws(() => buildInitialAggregate({
    ...base, pkg: { ...base.pkg, version: { ...base.pkg.version, member_count: 9 } },
  }), error => error.diagnostic.reason === 'package_member_count_mismatch');
  assert.throws(() => buildInitialAggregate({ ...base, analysis: null }), error => error.diagnostic.reason === 'analysis_not_object');
});

test('analysis_core_hash is deterministic, order-independent and sensitive to the analysis', () => {
  const { analysis } = inputs();
  const hash = computeInitialAnalysisCoreHash(analysis);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(analysis).reverse());
  assert.equal(computeInitialAnalysisCoreHash(reordered), hash);
  const changed = structuredClone(analysis);
  changed.claims[0].display_text += ' (editado)';
  assert.notEqual(computeInitialAnalysisCoreHash(changed), hash);
  assert.equal(buildInitialAggregate(inputs()).meta.analysis_core_hash, hash);
});
