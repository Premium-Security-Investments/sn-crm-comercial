import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateAgt002TenderAnalysisEnvelope, buildSyntheticAgt002TenderAnalysis } from '../agt002-tender-adapter.js';

const v1Files = ['manifest.json', 'analysis.request.schema.json', 'analysis.response.schema.json'];
const v1Hash = createHash('sha256').update(v1Files.map(name => readFileSync(new URL(`../contracts/agents/AGT-002/v1/${name}`, import.meta.url))).join('\n')).digest('hex');
assert.equal(v1Hash, 'b42efca7952e917da93c551400efaa71db7c8fa0c69a8c74b6fb4980782ca82e');

const snapshot = {
  snapshot_id: '11111111-1111-4111-8111-111111111111',
  opportunity_id: '22222222-2222-4222-8222-222222222222',
  tender_id: '33333333-3333-4333-8333-333333333333',
  document_hash: 'a'.repeat(64),
  profile_hash: 'b'.repeat(64),
  documents: [],
  company_profile: {},
};
const envelope = buildSyntheticAgt002TenderAnalysis(snapshot);
assert.equal(validateAgt002TenderAnalysisEnvelope(envelope).agent_id, 'AGT-002');
assert.equal(envelope.human_review_required, true);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, agent_id: 'AGT-999' }), /AGT-002/);
assert.throws(() => validateAgt002TenderAnalysisEnvelope({ ...envelope, human_review_required: false }), /revisión humana/i);

const requestSchema = JSON.parse(readFileSync(new URL('../contracts/agents/AGT-002/v2-draft/analysis-run.request.schema.json', import.meta.url), 'utf8'));
const responseSchema = JSON.parse(readFileSync(new URL('../contracts/agents/AGT-002/v2-draft/analysis-run.response.schema.json', import.meta.url), 'utf8'));
const requestFields = ['snapshot_id', 'opportunity_id', 'tender_id', 'document_hash', 'profile_hash', 'documents', 'company_profile'];
const responseFields = ['schema_version', 'agent_id', 'run_id', 'policy_version', 'snapshot_id', 'status', 'method', 'recommendation', 'summary', 'strengths', 'weaknesses', 'blockers', 'questions', 'unverified', 'next_action', 'human_review_required', 'usage'];

function assertClosedObjects(schema, location = '$') {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${location} must reject extra fields`);
    for (const [name, child] of Object.entries(schema.properties || {})) assertClosedObjects(child, `${location}.${name}`);
  }
  if (schema.items) assertClosedObjects(schema.items, `${location}.items`);
}

assert.deepEqual(requestSchema.required, requestFields);
assert.deepEqual(Object.keys(requestSchema.properties), requestFields);
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
console.log('AGT-002 tender analysis consumer contract passed');
