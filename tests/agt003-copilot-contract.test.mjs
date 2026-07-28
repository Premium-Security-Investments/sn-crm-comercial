import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AGT003_COPILOT_CAPABILITY,
  AGT003_COPILOT_CONTRACT_VERSION,
  validateAgt003CopilotRequest,
  validateAgt003CopilotResponse,
} from '../agt003-copilot-contract.js';

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
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${location}: pattern`);
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
const requestSchema = load('opportunity-copilot.request.schema.json');
const responseSchema = load('opportunity-copilot.response.schema.json');
const validRequest = load('fixtures/valid-opportunity-copilot-request.json');
const validResponse = load('fixtures/valid-opportunity-copilot-response.json');

assert.equal(AGT003_COPILOT_CAPABILITY, 'agt003.opportunity-copilot.preview');
assert.equal(AGT003_COPILOT_CONTRACT_VERSION, '2.0-draft.1');
assert.equal(manifest.immutable, false);
assert.equal(manifest.capabilities[0].id, AGT003_COPILOT_CAPABILITY);
assertClosedObjects(requestSchema);
assertClosedObjects(responseSchema);
assert.deepEqual(validateSchema(requestSchema, validRequest), []);
assert.deepEqual(validateSchema(responseSchema, validResponse), []);
assert.deepEqual(validateAgt003CopilotRequest(validRequest), validRequest);
assert.deepEqual(validateAgt003CopilotResponse(validResponse, { request: validRequest }), validResponse);

const widenedAuthority = structuredClone(validRequest);
widenedAuthority.authority.external_send_allowed = true;
assert.ok(validateSchema(requestSchema, widenedAuthority).length > 0);
assert.throws(() => validateAgt003CopilotRequest(widenedAuthority), /authority|autoridad/i);

const unexpected = { ...validResponse, send_now: true };
assert.ok(validateSchema(responseSchema, unexpected).length > 0);
assert.throws(() => validateAgt003CopilotResponse(unexpected, { request: validRequest }), /inesperad|cerrad/i);

const inventedEvidence = structuredClone(validResponse);
inventedEvidence.brief.facts[0].evidence_refs = ['evidence:invented'];
assert.throws(() => validateAgt003CopilotResponse(inventedEvidence, { request: validRequest }), /evidence_id|evidencia/i);

const inventedAsset = structuredClone(validResponse);
inventedAsset.brief.recommended_asset_ids = ['asset-invented'];
assert.throws(() => validateAgt003CopilotResponse(inventedAsset, { request: validRequest }), /activo|asset/i);

const mismatchedIdentity = structuredClone(validResponse);
mismatchedIdentity.snapshot_id = 'snapshot-other';
assert.throws(() => validateAgt003CopilotResponse(mismatchedIdentity, { request: validRequest }), /snapshot/i);

const noReview = structuredClone(validResponse);
noReview.brief.human_review_required = false;
assert.ok(validateSchema(responseSchema, noReview).length > 0);
assert.throws(() => validateAgt003CopilotResponse(noReview, { request: validRequest }), /revisión humana/i);

const v1Before = readFileSync(path.join(root, 'contracts/agents/AGT-003/v1/manifest.json'), 'utf8');
assert.match(v1Before, /"immutable": true/);

console.log('AGT-003 opportunity copilot v2-draft contract passed');
