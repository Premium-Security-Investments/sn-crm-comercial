import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  validateAgt002TenderAnalysisEnvelope,
  validateAgt002TenderAnalysisRequest,
} from '../agt002-tender-adapter.js';
import { buildSyntheticAgt002TenderAnalysis } from './fixtures/agt002-synthetic-responder.mjs';

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
console.log('AGT-002 tender analysis consumer contract passed');
