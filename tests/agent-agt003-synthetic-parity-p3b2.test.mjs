import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = path.join(repoRoot, 'contracts/agents/siio-adapter/v1/manifest.json');
const expectedManifest = {
  producer_repo: 'Premium-Security-Investments/agente-it',
  producer_merge_sha: '988becc75f0e866688281db61dd3ec21e9ede17e',
  adapter_path: 'supabase/functions/_shared/siio_adapter.ts',
  sha256: 'b7dde69ae3b5df4437584e9bea7df225d420a1166fa02c268452f95969525caf',
  producer_owner: 'Plataforma Agentes',
  status: 'inactive_synthetic',
  origin: 'synthetic://siio.local',
  route: '/synthetic/siio/agt003/priorities',
  capability: 'agt003.priorities.read',
  contract_version: '1.0.0',
  request_schema_sha256: '8ee87729790a1bac067d704016fa9f9a1e2c46c423e4599b38871adcfa18ef58',
  response_schema_sha256: '7a2cbff1d9f4f0ae8ff8e82652535e22d1e6a981c569b89fac32f1add1e7603e',
};
assert.ok(existsSync(manifestPath), 'P3B.2 must add the canonical P3A.2 adapter pin');
assert.equal(readFileSync(manifestPath, 'utf8'), `${JSON.stringify(expectedManifest, null, 2)}\n`, 'adapter manifest must be byte-for-byte canonical');

const requestSchemaPath = path.join(repoRoot, 'contracts/agents/AGT-003/v1/priorities.request.schema.json');
const responseSchemaPath = path.join(repoRoot, 'contracts/agents/AGT-003/v1/priorities.response.schema.json');
for (const [file, expected] of [[requestSchemaPath, expectedManifest.request_schema_sha256], [responseSchemaPath, expectedManifest.response_schema_sha256]]) {
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), expected, `${path.basename(file)} hash must remain pinned`);
}

const rows = JSON.parse(readFileSync(path.join(repoRoot, 'tests/fixtures/phase3a-p3b2/scoped-opportunities.json'), 'utf8'));
const { buildAgt003PrioritiesData } = await import('../agt003-priorities-service.js');
const { buildSyntheticAgt003PrioritiesResponse } = await import('../agent-agt003-synthetic-responder.js');
const now = '2030-02-01T10:00:00.000Z';
const decision = Object.freeze({
  allowed: true,
  agent_id: 'AGT-003',
  capability: 'agt003.priorities.read',
  correlation_id: 'syn-correlation-001',
  resolved_scope_digest: 'sha256:syn-resolved-scope-001',
  policy_version: 'gate0-v1.0',
});
const request = Object.freeze({ contract_version: '1.0.0', capability_id: 'agt003.priorities.read', correlation_id: 'syn-correlation-001', query: Object.freeze({}) });
const metadata = Object.freeze({
  run_id: 'syn-run-001',
  record_set_id: 'syn-record-set-001',
  cutoff_at: '2030-02-01T09:59:00.000Z',
  resolved_scope_digest: 'sha256:syn-resolved-scope-001',
  evidence: Object.freeze([Object.freeze({ evidence_id: 'syn-evidence-001', evidence_type: 'record_set', record_id: 'syn-record-set-001', captured_at: now })]),
});

const direct = buildAgt003PrioritiesData(rows, { now });
const synthetic = buildSyntheticAgt003PrioritiesResponse({ decision, request, rows, metadata, now });
assert.deepEqual(synthetic.data, direct, 'direct and synthetic paths must be exactly equal for one snapshot and clock');
assert.deepEqual(Object.keys(synthetic), ['contract_version', 'capability_id', 'correlation_id', 'run_id', 'policy_version', 'source', 'cutoff_at', 'evidence', 'data']);
assert.deepEqual(synthetic.source, { system: 'SIIO', dataset: 'v_psi_sales_opportunity_enriched', record_set_id: 'syn-record-set-001', persisted: false });
const reordered = buildSyntheticAgt003PrioritiesResponse({
  now,
  metadata: { evidence: metadata.evidence, resolved_scope_digest: metadata.resolved_scope_digest, cutoff_at: metadata.cutoff_at, record_set_id: metadata.record_set_id, run_id: metadata.run_id },
  rows,
  request: { query: {}, correlation_id: request.correlation_id, capability_id: request.capability_id, contract_version: request.contract_version },
  decision: { policy_version: decision.policy_version, resolved_scope_digest: decision.resolved_scope_digest, correlation_id: decision.correlation_id, capability: decision.capability, agent_id: decision.agent_id, allowed: decision.allowed },
});
assert.deepEqual(reordered, synthetic, 'closed objects must not depend on JSON key order');

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function validate(schema, value, location = '$') {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => typeMatches(value, type))) return [`${location}: type`];
  if ('const' in schema && value !== schema.const) errors.push(`${location}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location}: enum`);
  if (schema.oneOf && schema.oneOf.filter(item => validate(item, value, location).length === 0).length !== 1) errors.push(`${location}: oneOf`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location}: maxLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: pattern`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${location}: date-time`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${location}: minimum`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location}: maxItems`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(schema.items, item, `${location}[${index}]`)));
  } else if (value && typeof value === 'object') {
    for (const required of schema.required || []) if (!Object.hasOwn(value, required)) errors.push(`${location}: missing ${required}`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(schema.properties[key], item, `${location}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${location}: unexpected ${key}`);
    }
  }
  return errors;
}
const responseSchema = JSON.parse(readFileSync(responseSchemaPath, 'utf8'));
assert.deepEqual(validate(responseSchema, synthetic), [], 'synthetic response must validate against AGT-003 v1 schema');

function denied(overrides) {
  assert.throws(() => buildSyntheticAgt003PrioritiesResponse({ decision, request, rows, metadata, now, ...overrides }), /Synthetic AGT-003 response denied/);
}
denied({ decision: { ...decision, allowed: false } });
denied({ decision: { ...decision, agent_id: 'AGT-002' } });
denied({ request: { ...request, capability_id: 'agt003.priorities.write' } });
denied({ request: { ...request, correlation_id: 'syn-correlation-other' } });
denied({ metadata: { ...metadata, resolved_scope_digest: 'sha256:syn-widened-scope' } });
denied({ metadata: { ...metadata, evidence: [] } });
denied({ metadata: { ...metadata, policy_version: 'gate0-v1.1' } });
denied({ request: new Proxy({ ...request }, {}) });
denied({ metadata: Object.defineProperty({ ...metadata }, 'run_id', { enumerable: true, get: () => 'syn-run-hostile' }) });

for (const relative of ['agt003-priorities-service.js', 'agent-agt003-synthetic-responder.js']) {
  const source = readFileSync(path.join(repoRoot, relative), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|setTimeout|setInterval)\s*\(|(?:from|require\s*\()\s*['"](?:node:)?(?:http|https|net|tls|fs|child_process)|supabase|express|jwt|jwks|oidc/i, `${relative}: external I/O/runtime is forbidden`);
}
for (const relative of ['server/index.js', 'api/[...path].js']) {
  const source = readFileSync(path.join(repoRoot, relative), 'utf8');
  const start = source.indexOf("app.get('/api/vigia/priorities'");
  const end = source.indexOf("app.all('/api/vigia/priorities'", start);
  const handler = source.slice(start, end);
  assert.ok(handler.includes('buildAgt003PrioritiesData(scopedRows)'), `${relative}: human handler must use the shared service`);
  assert.equal(handler.includes('prioritizeVigiaOpportunities('), false, `${relative}: human handler must not assemble a second scoring path`);
  assert.ok(source.includes("app.all('/api/vigia/priorities'"), `${relative}: 405 guard must remain`);
  assert.equal(source.includes('/api/internal'), false, `${relative}: no internal endpoint may be added`);
}

console.log('P3B.2 synthetic AGT-003 parity and pin checks passed');
