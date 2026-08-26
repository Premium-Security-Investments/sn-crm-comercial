import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AGT003_PREFLIGHT_CAPABILITY,
  AGT003_PREFLIGHT_CONTRACT_VERSION,
  PREFLIGHT_ISSUE_CODES,
  validateAgt003PreflightRequest,
  validateAgt003PreflightResponse,
} from '../agt003-preflight-contract.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const contractDir = path.join(root, 'contracts/agents/AGT-003/v2-draft');
const load = relative => JSON.parse(readFileSync(path.join(contractDir, relative), 'utf8'));

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateSchema(schema, value, location = '$') {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => typeMatches(value, type))) return [`${location}: type`];
  if ('const' in schema && value !== schema.const) errors.push(`${location}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${location}: enum`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${location}: minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${location}: maxLength`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${location}: date-time`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${location}: minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${location}: maxItems`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) errors.push(`${location}: uniqueItems`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateSchema(schema.items, item, `${location}[${index}]`)));
  } else if (value && typeof value === 'object') {
    for (const required of schema.required || []) if (!Object.hasOwn(value, required)) errors.push(`${location}: missing ${required}`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validateSchema(schema.properties[key], item, `${location}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${location}: unexpected ${key}`);
    }
  }
  return errors;
}

function assertClosedObjects(schema, location = '$') {
  if (schema.type === 'object') {
    assert.equal(schema.additionalProperties, false, `${location} must reject extra fields`);
    for (const [key, child] of Object.entries(schema.properties || {})) assertClosedObjects(child, `${location}.${key}`);
  }
  if (schema.items) assertClosedObjects(schema.items, `${location}[]`);
}

const manifest = load('manifest.json');
const requestSchema = load('opportunity-preflight.request.schema.json');
const responseSchema = load('opportunity-preflight.response.schema.json');
const validRequest = load('fixtures/valid-opportunity-preflight-request.json');
const validResponse = load('fixtures/valid-opportunity-preflight-response.json');

assert.equal(AGT003_PREFLIGHT_CAPABILITY, 'agt003.opportunity-preflight.preview');
assert.equal(AGT003_PREFLIGHT_CONTRACT_VERSION, 'agt003-preflight-v1');
assert.deepEqual(PREFLIGHT_ISSUE_CODES, [
  'next_action',
  'close_date',
  'decision_maker',
  'stalled_conversation',
  'pending_terms',
  'escalation_needed',
  'other',
]);
assert.equal(manifest.immutable, false);
assert.ok(manifest.capabilities.some(capability => capability.id === AGT003_PREFLIGHT_CAPABILITY));
assert.ok(manifest.fixtures.some(fixture => fixture.path === 'fixtures/valid-opportunity-preflight-request.json'));
assert.ok(manifest.fixtures.some(fixture => fixture.path === 'fixtures/valid-opportunity-preflight-response.json'));

assertClosedObjects(requestSchema);
assertClosedObjects(responseSchema);
assert.deepEqual(validateSchema(requestSchema, validRequest), []);
assert.deepEqual(validateSchema(responseSchema, validResponse), []);
assert.deepEqual(validateAgt003PreflightRequest(validRequest), validRequest);
assert.deepEqual(validateAgt003PreflightResponse(validResponse, { request: validRequest }), validResponse);

const widenedRequest = structuredClone(validRequest);
widenedRequest.authority.send_email = true;
assert.ok(validateSchema(requestSchema, widenedRequest).length > 0);
assert.throws(() => validateAgt003PreflightRequest(widenedRequest), /cerrad|inesperad/i);

const unexpectedResponse = { ...validResponse, send_now: true };
assert.ok(validateSchema(responseSchema, unexpectedResponse).length > 0);
assert.throws(() => validateAgt003PreflightResponse(unexpectedResponse, { request: validRequest }), /cerrad|inesperad/i);

const unknownIssue = structuredClone(validResponse);
unknownIssue.actions[0].issue_code = 'free_text_issue';
assert.ok(validateSchema(responseSchema, unknownIssue).length > 0);
assert.throws(() => validateAgt003PreflightResponse(unknownIssue, { request: validRequest }), /issue_code/i);

const inventedEvidence = structuredClone(validResponse);
inventedEvidence.actions[0].evidence_refs = ['evidence:invented'];
assert.throws(() => validateAgt003PreflightResponse(inventedEvidence, { request: validRequest }), /evidence_id|evidencia/i);

const mismatchedSnapshot = structuredClone(validResponse);
mismatchedSnapshot.snapshot_id = 'snapshot-other';
assert.throws(() => validateAgt003PreflightResponse(mismatchedSnapshot, { request: validRequest }), /snapshot/i);

const v1Manifest = readFileSync(path.join(root, 'contracts/agents/AGT-003/v1/manifest.json'), 'utf8');
assert.match(v1Manifest, /"immutable": true/);

console.log('AGT-003 opportunity preflight v1 contract passed');
