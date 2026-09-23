import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  validateAgt002Phase01Schema,
  buildAgt002Phase01Context,
  evaluateAgt002Phase01Fixture,
} from '../agt002-phase01-executable-controls.js';

// Loading throws (named exports buildAgt002Phase01Context /
// evaluateAgt002Phase01Fixture not found) until Task 7 Step 3 adds them to
// agt002-phase01-executable-controls.js — this is the intended external RED
// for Step 1. Reading the paths below also throws (ENOENT) until Task 7
// Step 3 authors contracts/agt002-phase01/v1/fixture-context.schema.json,
// contracts/agt002-phase01/v1/fixtures/contexts.json,
// contracts/agt002-phase01/v1/fixtures/expectations.json and the 31 fixture
// files under contracts/agt002-phase01/v1/fixtures/. None of those artifacts,
// nor scripts/agt002-phase01-validate-fixtures.mjs, nor the module changes
// are created by this step.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1');
const FIXTURES_DIR = path.join(CONTRACTS_DIR, 'fixtures');

const FIXTURE_CONTEXT_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'fixture-context.schema.json');
const CONTEXTS_PATH = path.join(FIXTURES_DIR, 'contexts.json');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

const GATE_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'gate.schema.json');
const AUTHORITY_REGISTRY_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'authority-registry.schema.json');
const VALID_LINK_CLAIM_SCHEMA_PATH = path.join(CONTRACTS_DIR, 'valid-link-claim.schema.json');

const FIXTURE_CONTEXT_SCHEMA = JSON.parse(readFileSync(FIXTURE_CONTEXT_SCHEMA_PATH, 'utf8'));
const CONTEXTS = JSON.parse(readFileSync(CONTEXTS_PATH, 'utf8'));
const EXPECTATIONS = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));

const GATE_SCHEMA = JSON.parse(readFileSync(GATE_SCHEMA_PATH, 'utf8'));
const AUTHORITY_REGISTRY_SCHEMA = JSON.parse(readFileSync(AUTHORITY_REGISTRY_SCHEMA_PATH, 'utf8'));
const VALID_LINK_CLAIM_SCHEMA = JSON.parse(readFileSync(VALID_LINK_CLAIM_SCHEMA_PATH, 'utf8'));

const CONTROL_SCHEMAS = Object.freeze({
  gate: GATE_SCHEMA,
  authority_registry: AUTHORITY_REGISTRY_SCHEMA,
  valid_link: VALID_LINK_CLAIM_SCHEMA,
});

const AGT002_PHASE01_CONTROLS = Object.freeze(['gate', 'authority_registry', 'valid_link']);
const AGT002_PHASE01_FIXTURE_VERDICTS = Object.freeze(['VALID', 'INVALID', 'UNVERIFIED']);

// Group 1
test('fixtures inventory: expectations.json references exactly the fixture files on disk, in both directions', () => {
  const filesOnDisk = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'contexts.json' && name !== 'expectations.json');
  const filesOnDiskSet = new Set(filesOnDisk);

  const referencedFiles = EXPECTATIONS.map((entry) => entry.file);
  const referencedSet = new Set(referencedFiles);

  assert.equal(
    referencedFiles.length,
    referencedSet.size,
    'expectations.json must not reference the same fixture file twice',
  );

  for (const file of filesOnDiskSet) {
    assert.ok(referencedSet.has(file), `orphan fixture file not referenced by expectations.json: ${file}`);
  }
  for (const file of referencedSet) {
    assert.ok(filesOnDiskSet.has(file), `expectations.json references a fixture file missing on disk: ${file}`);
  }
});

// Group 2
test('fixtures shape: every fixture validates against its control schema, unless declared schema_negative', () => {
  for (const entry of EXPECTATIONS) {
    const schema = CONTROL_SCHEMAS[entry.control];
    assert.ok(schema, `${entry.file}: unknown control "${entry.control}"`);

    const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, entry.file), 'utf8'));
    const { ok, errors } = validateAgt002Phase01Schema(schema, fixture);

    if (entry.schema_negative === true) {
      assert.equal(ok, false, `${entry.file}: declared schema_negative but validated cleanly against its schema`);
      const codes = errors.map((error) => error.code);
      for (const expectedReason of entry.expected_reasons) {
        assert.ok(
          codes.includes(expectedReason),
          `${entry.file}: expected schema error code "${expectedReason}", got ${JSON.stringify(codes)}`,
        );
      }
    } else {
      assert.equal(ok, true, `${entry.file}: ${JSON.stringify(errors)}`);
    }
  }
});

// Group 3
test('fixtures evaluation: evaluateAgt002Phase01Fixture matches expected_verdict and expected_reasons ⊆ reasons for every row', () => {
  for (const entry of EXPECTATIONS) {
    const result = evaluateAgt002Phase01Fixture(entry, { fixtureDir: FIXTURES_DIR });
    assert.equal(
      result.verdict,
      entry.expected_verdict,
      `${entry.file}: expected verdict ${entry.expected_verdict}, got ${result.verdict} (${JSON.stringify(result.reasons)})`,
    );
    for (const expectedReason of entry.expected_reasons) {
      assert.ok(
        result.reasons.includes(expectedReason),
        `${entry.file}: expected reason "${expectedReason}" missing from ${JSON.stringify(result.reasons)}`,
      );
    }
  }
});

// Group 4
test('fixtures coverage: expectations.json has at least one VALID, one INVALID and one UNVERIFIED row per control', () => {
  for (const control of AGT002_PHASE01_CONTROLS) {
    for (const verdict of AGT002_PHASE01_FIXTURE_VERDICTS) {
      const hasRow = EXPECTATIONS.some((entry) => entry.control === control && entry.expected_verdict === verdict);
      assert.ok(hasRow, `no expectations.json row with control "${control}" and expected_verdict "${verdict}"`);
    }
  }
});

// Group 5
test('fixture contexts: contexts.json validates against fixture-context.schema.json and every context cited by expectations.json exists', () => {
  const { ok, errors } = validateAgt002Phase01Schema(FIXTURE_CONTEXT_SCHEMA, CONTEXTS);
  assert.equal(ok, true, JSON.stringify(errors));

  const contextNames = new Set(Object.keys(CONTEXTS));
  for (const entry of EXPECTATIONS) {
    assert.ok(
      contextNames.has(entry.context),
      `${entry.file}: expectations.json cites unknown context "${entry.context}"`,
    );
  }

  for (const [name, descriptor] of Object.entries(CONTEXTS)) {
    const built = buildAgt002Phase01Context(descriptor);
    assert.ok(built && typeof built === 'object', `buildAgt002Phase01Context(${name}) did not return a context object`);
  }
});

// Group 6
test('fixture contexts: authority_registry_schema_ref (not the boolean authority_registry_schema_available) points every registry-dependent context at the pinned schema path', () => {
  const EXPECTED_SCHEMA_REF = 'contracts/agt002-phase01/v1/authority-registry.schema.json';
  const SCHEMA_ABSENT_CONTEXT = 'authority-registry-schema-absent';

  assert.ok(
    !JSON.stringify(FIXTURE_CONTEXT_SCHEMA).includes('authority_registry_schema_available'),
    'fixture-context.schema.json must not declare authority_registry_schema_available',
  );
  assert.ok(
    !JSON.stringify(CONTEXTS).includes('authority_registry_schema_available'),
    'contexts.json must not reference authority_registry_schema_available',
  );

  const schemaAbsentDescriptor = CONTEXTS[SCHEMA_ABSENT_CONTEXT];
  assert.ok(schemaAbsentDescriptor, `contexts.json must define ${SCHEMA_ABSENT_CONTEXT}`);
  assert.equal(
    Object.prototype.hasOwnProperty.call(schemaAbsentDescriptor, 'authority_registry_schema_ref'),
    false,
    `${SCHEMA_ABSENT_CONTEXT} must not carry authority_registry_schema_ref`,
  );

  const needsSchemaRefByContext = new Map();
  for (const entry of EXPECTATIONS) {
    if (entry.control !== 'gate' && entry.control !== 'authority_registry') continue;
    if (entry.context === SCHEMA_ABSENT_CONTEXT) continue;
    const descriptor = CONTEXTS[entry.context];
    const hasRegistry = Boolean(descriptor.authority_registry_ref || descriptor.authority_registry);
    const needsSchemaRef = entry.control === 'authority_registry' || hasRegistry;
    if (needsSchemaRef) needsSchemaRefByContext.set(entry.context, descriptor);
  }

  for (const [name, descriptor] of needsSchemaRefByContext) {
    assert.equal(
      descriptor.authority_registry_schema_ref,
      EXPECTED_SCHEMA_REF,
      `${name}: expected authority_registry_schema_ref "${EXPECTED_SCHEMA_REF}"`,
    );
  }
});
