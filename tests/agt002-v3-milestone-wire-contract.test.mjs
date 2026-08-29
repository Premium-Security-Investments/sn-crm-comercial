import test from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAgt002IntegralAnalysisV3OutputJsonSchema } from '../agt002-preview-contract.js';
import { AGT002_INTEGRAL_MILESTONE_STATUSES } from '../agt002-integral-analysis-v3.js';

// AGT-002 milestone wire-contract hotfix (production incident: a Codex turn declared
// milestone.status "verified" with at/source_ref left null — schema-valid, but rejected
// downstream by validateMilestone with v3_milestone_invariant, so no canonical run persisted).
//
// Root cause: the model-facing milestone wire schema (buildAgt002IntegralAnalysisV3OutputJsonSchema)
// exposed status/at/source_ref as three independently-typed fields, so the provider's structured
// output could satisfy the schema while violating validateMilestone's cross-field invariant
// (agt002-integral-analysis-v3.js): status "verified" requires non-null at/source_ref; status
// "not_identified" requires both null. This test proves the wire schema now makes the invalid
// combinations structurally unrepresentable, without touching the semantic validator itself.

// Minimal matcher for the closed JSON Schema subset this codebase's wire schemas actually use
// (type/enum/const/properties/additionalProperties/required/anyOf). Not a general-purpose
// validator — just enough to decide whether a candidate milestone object is representable by a
// given wire-schema node, the same question the real provider's structured-output decoder answers.
function matchesSchema(schema, value) {
  if (schema.type === 'null') return value === null;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(branch => matchesSchema(branch, value));
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false;
    if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return false;
    return true;
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const knownKeys = Object.keys(schema.properties || {});
    if (schema.additionalProperties === false && Object.keys(value).some(key => !knownKeys.includes(key))) return false;
    for (const key of (schema.required || [])) {
      if (!Object.hasOwn(value, key)) return false;
    }
    for (const key of knownKeys) {
      if (Object.hasOwn(value, key) && !matchesSchema(schema.properties[key], value[key])) return false;
    }
    return true;
  }
  return true;
}

function governedValidationContext() {
  return {
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceClassIds: [],
    allowlist: {
      tender_document: ['TD-1'], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [],
    },
  };
}

function milestoneSchemaOf(validationContext) {
  const schema = buildAgt002IntegralAnalysisV3OutputJsonSchema(validationContext);
  return schema.properties.integral_analysis.properties.analysis_units.items.properties.milestone;
}

const invalidVerified = { status: 'verified', type: 'submission_deadline', at: null, source_ref: null, summary: 'Fecha límite.' };
const invalidNotIdentified = { status: 'not_identified', type: 'none', at: '2026-01-01T00:00:00.000Z', source_ref: 'TD-1', summary: 'x' };
const invalidVerifiedNonDateAt = { status: 'verified', type: 'submission_deadline', at: 'tbd', source_ref: 'TD-1', summary: 'x' };
const invalidUnverifiedNonDateAt = { status: 'unverified', type: 'other', at: 'tbd', source_ref: null, summary: 'x' };
const validVerified = { status: 'verified', type: 'submission_deadline', at: '2026-01-01T00:00:00.000Z', source_ref: 'TD-1', summary: 'x' };
const validNotIdentified = { status: 'not_identified', type: 'none', at: null, source_ref: null, summary: 'x' };
const validUnverified = { status: 'unverified', type: 'other', at: null, source_ref: null, summary: 'x' };
const validUnverifiedWithDateAt = { status: 'unverified', type: 'other', at: '2026-01-01T00:00:00.000Z', source_ref: null, summary: 'x' };

test('milestone wire schema is a discriminated union, not a flat independently-typed object', () => {
  const milestoneSchema = milestoneSchemaOf(governedValidationContext());
  assert.ok(Array.isArray(milestoneSchema.anyOf), 'milestone schema must expose closed status-discriminated branches');
});

test('milestone wire schema rejects the exact production v3_milestone_invariant combinations', () => {
  const milestoneSchema = milestoneSchemaOf(governedValidationContext());
  assert.equal(matchesSchema(milestoneSchema, invalidVerified), false, 'status "verified" with null at/source_ref must be structurally unrepresentable');
  assert.equal(matchesSchema(milestoneSchema, invalidNotIdentified), false, 'status "not_identified" with non-null at/source_ref must be structurally unrepresentable');
  assert.equal(matchesSchema(milestoneSchema, validVerified), true, 'a properly-sourced verified milestone must remain representable');
  assert.equal(matchesSchema(milestoneSchema, validNotIdentified), true, 'a null not_identified milestone must remain representable');
  assert.equal(matchesSchema(milestoneSchema, validUnverified), true, 'unverified must preserve its existing unconstrained at/source_ref semantics');
});

test('milestone wire schema rejects a schema-valid-but-non-date "at" for verified and unverified', () => {
  const milestoneSchema = milestoneSchemaOf(governedValidationContext());
  assert.equal(matchesSchema(milestoneSchema, invalidVerifiedNonDateAt), false, 'verified.at must be a real date-time, not an arbitrary string like "tbd"');
  assert.equal(matchesSchema(milestoneSchema, invalidUnverifiedNonDateAt), false, 'unverified.at, when non-null, must also be a real date-time');
  assert.equal(matchesSchema(milestoneSchema, validUnverifiedWithDateAt), true, 'unverified.at must still accept a valid ISO date-time value');
});

test('milestone schema constrains "at" with the documented OpenAI date-time format, not a bespoke pattern', () => {
  const milestoneSchema = milestoneSchemaOf(governedValidationContext());
  const branchesByStatus = new Map(milestoneSchema.anyOf.map(branch => [branch.properties.status.const, branch]));

  const verifiedAt = branchesByStatus.get('verified').properties.at;
  assert.equal(verifiedAt.type, 'string');
  assert.equal(verifiedAt.format, 'date-time');
  assert.ok(!Object.hasOwn(verifiedAt, 'pattern'), 'must rely on the documented format keyword, not a bespoke regex');

  const unverifiedAt = branchesByStatus.get('unverified').properties.at;
  const unverifiedNonNullAt = unverifiedAt.anyOf.find(branch => branch.type === 'string');
  assert.equal(unverifiedNonNullAt.format, 'date-time');
  assert.ok(!Object.hasOwn(unverifiedNonNullAt, 'pattern'));

  assert.equal(branchesByStatus.get('not_identified').properties.at.type, 'null');
});

test('milestone wire schema drops the verified branch entirely when no allowlisted source_ref exists', () => {
  const milestoneSchema = milestoneSchemaOf({
    requirementManifest: [{ requirement_id: 'REQ-1', category: 'discard' }],
    companyEvidenceClassIds: [],
    allowlist: { tender_document: [], company_evidence: [], legal_corpus: [], human_evidence: [], objective_validation: [] },
  });
  assert.equal(matchesSchema(milestoneSchema, validVerified), false, 'verified must be impossible to produce when the allowlist has no valid source_ref');
  assert.equal(matchesSchema(milestoneSchema, validNotIdentified), true);
  assert.equal(matchesSchema(milestoneSchema, validUnverified), true);
});

test('every milestone branch stays Codex Structured Outputs compatible', () => {
  const milestoneSchema = milestoneSchemaOf(governedValidationContext());
  const seenStatuses = [];
  const seenFormats = new Set();
  for (const branch of milestoneSchema.anyOf) {
    assert.equal(branch.type, 'object');
    assert.equal(branch.additionalProperties, false, 'every branch must stay closed');
    assert.deepEqual([...branch.required].sort(), Object.keys(branch.properties).sort(), 'every branch must require every property it declares');
    // Regression: the real Codex App Server rejects a bare `const` keyword with invalid_json_schema.
    if (Object.hasOwn(branch.properties.status, 'const')) {
      assert.equal(branch.properties.status.type, 'string', 'a const node must also declare its type');
    }
    seenStatuses.push(branch.properties.status.const);
    for (const propertySchema of Object.values(branch.properties)) {
      const candidates = Array.isArray(propertySchema.anyOf) ? propertySchema.anyOf : [propertySchema];
      for (const candidate of candidates) {
        if (Object.hasOwn(candidate, 'format')) seenFormats.add(candidate.format);
      }
    }
  }
  assert.deepEqual(seenStatuses.slice().sort(), [...AGT002_INTEGRAL_MILESTONE_STATUSES].sort());
  // OpenAI Structured Outputs documents `format` as a supported string keyword with `date-time`
  // explicitly listed; this residual hotfix must introduce exactly that documented value and
  // nothing else (no bespoke/undocumented format string).
  assert.deepEqual([...seenFormats], ['date-time']);
});

console.log('agt002-v3-milestone-wire-contract.test.mjs OK');
