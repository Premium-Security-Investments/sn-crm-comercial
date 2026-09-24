import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_SCHEMA_VERSIONS,
  AGT002_PHASE01_GATE_STATUSES,
  AGT002_PHASE01_GATE_OUTCOMES,
  AGT002_PHASE01_GATE_TYPES,
  validateAgt002Phase01Schema,
} from '../agt002-phase01-executable-controls.js';

const SCHEMA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'contracts',
  'agt002-phase01',
  'v1',
  'gate.schema.json',
);

// Loading throws (ERR_MODULE_NOT_FOUND-equivalent ENOENT) until Task 2 Step 3
// authors the schema file — this is the intended external RED for Step 1.
const gateSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const GATE_PROPERTY_KEYS = [
  'gate_id', 'schema_version', 'type', 'authority', 'objective', 'environment', 'synthetic',
  'scope', 'preconditions', 'evidence', 'expires_at_utc', 'consumption_policy', 'rollback',
  'issued_at_utc', 'status', 'outcome', 'consumption', 'revocation', 'artifact_set_hash', 'active_case',
];

function collectSchemaNodesMissingClosure(schema, nodePath, offenders) {
  if (schema === null || typeof schema !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(schema, 'properties')) {
    if (schema.additionalProperties !== false) {
      offenders.push(nodePath || '/');
    }
    for (const [key, child] of Object.entries(schema.properties)) {
      collectSchemaNodesMissingClosure(child, `${nodePath}/properties/${key}`, offenders);
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'items')) {
    collectSchemaNodesMissingClosure(schema.items, `${nodePath}/items`, offenders);
  }
}

function buildMinimalWellFormedGate() {
  return {
    gate_id: 'GATE_TEST_0001',
    schema_version: AGT002_PHASE01_SCHEMA_VERSIONS.gate,
    type: 'PHASE_AUDIT',
    authority: {
      principal: {
        principal_id: 'f1c70000-0000-0000-0000-000000000001',
        principal_kind: 'synthetic',
        durable_ref: {
          source: 'fixture_registry',
          locator: 'fixture://principal/f1c70000-0000-0000-0000-000000000001',
          verifiable: true,
        },
        display_label: 'Fixture Principal',
      },
      grant_id: 'GRANT-TEST-0001',
      delegation: null,
    },
    objective: 'Verify gate schema against a minimal well-formed fixture object',
    environment: 'isolated_fixture',
    synthetic: true,
    scope: {
      resource_kind: 'fixture_resource',
      resource_ids: ['f1c70000-0000-0000-0000-000000000002'],
      actions: ['read'],
    },
    preconditions: [
      {
        precondition_id: 'PRE-0001',
        statement: 'Fixture precondition statement',
        verdict: 'VALID',
        evidence_ids: ['EVID-0001'],
      },
    ],
    evidence: [
      {
        evidence_id: 'EVID-0001',
        kind: 'fixture_record',
        locator: 'fixture://evidence/0001',
        durable: true,
        content_hash: 'a'.repeat(64),
        captured_at_utc: '2026-09-23T00:00:00Z',
      },
    ],
    expires_at_utc: '2027-09-23T00:00:00Z',
    consumption_policy: {
      max_consumptions: 1,
      receipt_required: true,
      idempotency_key: 'idempotency-key-0001',
    },
    rollback: {
      supported: false,
      procedure: 'Compensate via fixture rollback procedure',
      locator: 'fixture://rollback/0001',
    },
    issued_at_utc: '2026-09-23T00:00:00Z',
    status: 'DRAFT',
    outcome: null,
    consumption: null,
    revocation: null,
    artifact_set_hash: 'a'.repeat(64),
    active_case: null,
  };
}

test('gate schema: pinned $id, $schema and schema_version const', () => {
  assert.equal(
    gateSchema.$id,
    'https://seguridadnacional.internal/contracts/agt002-phase01/v1/gate.schema.json',
  );
  assert.equal(gateSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(gateSchema.properties.schema_version.const, AGT002_PHASE01_SCHEMA_VERSIONS.gate);
});

test('gate schema: exactly the 20 normative fields, all required', () => {
  assert.equal(Object.keys(gateSchema.properties).length, 20);
  assert.deepEqual(Object.keys(gateSchema.properties).sort(), [...GATE_PROPERTY_KEYS].sort());
  assert.equal(gateSchema.required.length, 20);
  assert.deepEqual([...gateSchema.required].sort(), [...GATE_PROPERTY_KEYS].sort());
});

test('gate schema: pinned enums for status, outcome, type, environment', () => {
  assert.deepEqual(gateSchema.properties.status.enum, [...AGT002_PHASE01_GATE_STATUSES]);
  assert.deepEqual(gateSchema.properties.outcome.type, ['string', 'null']);
  assert.deepEqual(gateSchema.properties.outcome.enum, [...AGT002_PHASE01_GATE_OUTCOMES, null]);
  assert.deepEqual(gateSchema.properties.type.enum, [...AGT002_PHASE01_GATE_TYPES]);
  assert.deepEqual(gateSchema.properties.environment.enum, ['production', 'isolated_fixture']);
});

test('gate schema: structural closure — every node with properties is additionalProperties:false', () => {
  const offenders = [];
  collectSchemaNodesMissingClosure(gateSchema, '', offenders);
  assert.deepEqual(offenders, []);
});

test('gate schema: authority.delegation admits null and enforces delegate_of depth 1', () => {
  const delegation = gateSchema.properties.authority.properties.delegation;
  assert.ok(Array.isArray(delegation.type));
  assert.ok(delegation.type.includes('null'));
  assert.ok(delegation.type.includes('object'));
  assert.ok(delegation.properties, 'delegation schema must declare properties to validate the object shape');
  assert.equal(delegation.properties.delegate_of.type, 'null');
  assert.ok(delegation.required.includes('delegate_of'));
});

test('gate schema: consumption_policy pins max_consumptions and receipt_required', () => {
  const consumptionPolicy = gateSchema.properties.consumption_policy;
  assert.equal(consumptionPolicy.properties.max_consumptions.const, 1);
  assert.equal(consumptionPolicy.properties.receipt_required.const, true);
});

test('gate schema: active_case is strictly null', () => {
  assert.deepEqual(gateSchema.properties.active_case, { type: 'null' });
});

test('gate schema: validates a minimal well-formed gate and fails without artifact_set_hash', () => {
  const gate = buildMinimalWellFormedGate();
  const result = validateAgt002Phase01Schema(gateSchema, gate);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);

  const { artifact_set_hash: _omitted, ...withoutArtifactSetHash } = gate;
  const invalidResult = validateAgt002Phase01Schema(gateSchema, withoutArtifactSetHash);
  assert.equal(invalidResult.ok, false);
  assert.ok(invalidResult.errors.some((e) => e.code === 'schema.missing_required'));
});
