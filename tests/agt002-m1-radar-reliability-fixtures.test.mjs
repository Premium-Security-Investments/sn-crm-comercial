import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_M1_RADAR_RELIABILITY_VERDICTS,
  AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG,
  validateAgt002M1RadarReliabilityBundle,
} from '../agt002-m1-radar-reliability-contract.js';

// FASE RED 2: fixtures/expectations.json (y el resto de artefactos de fixtures) todavía no
// existen. Los grupos que dependen de ellos fallan por ausencia de archivo/directorio, no por
// sintaxis ni por el import de arriba (que ya resuelve, agt002-m1-radar-reliability-contract.js
// existe desde FASE GREEN 1A). Todos los datos referenciados son 100% sintéticos.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-radar-reliability', 'v1');
const FIXTURES_DIR = path.join(CONTRACT_DIR, 'fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

const REASON_CATALOG_PATH = path.join(CONTRACT_DIR, 'reason-catalog.json');
const MANIFEST_PATH = path.join(CONTRACT_DIR, 'manifest.json');
const RUN_RECEIPT_SCHEMA_PATH = path.join(CONTRACT_DIR, 'run-receipt.schema.json');
const PRESENTATION_TRACE_SCHEMA_PATH = path.join(CONTRACT_DIR, 'presentation-trace.schema.json');
const PROMOTION_BUNDLE_SCHEMA_PATH = path.join(CONTRACT_DIR, 'promotion-bundle.schema.json');
const EVALUATION_CONTEXT_SCHEMA_PATH = path.join(CONTRACT_DIR, 'evaluation-context.schema.json');

const REASON_CATALOG_JSON = JSON.parse(readFileSync(REASON_CATALOG_PATH, 'utf8'));
const MANIFEST_JSON = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const SCHEMAS = Object.freeze({
  'run-receipt.schema.json': JSON.parse(readFileSync(RUN_RECEIPT_SCHEMA_PATH, 'utf8')),
  'presentation-trace.schema.json': JSON.parse(readFileSync(PRESENTATION_TRACE_SCHEMA_PATH, 'utf8')),
  'promotion-bundle.schema.json': JSON.parse(readFileSync(PROMOTION_BUNDLE_SCHEMA_PATH, 'utf8')),
  'evaluation-context.schema.json': JSON.parse(readFileSync(EVALUATION_CONTEXT_SCHEMA_PATH, 'utf8')),
});

const EXPECTATION_ROW_KEYS = Object.freeze(['file', 'expected_verdict', 'expected_promotable', 'expected_reasons']);

const FORBIDDEN_HTTP_RE = /https?:\/\//i;
const FORBIDDEN_EMAIL_RE = /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9-.]+/;
const FORBIDDEN_SECRET_RE = /\b(secret|token|api[_-]?key|password|passwd|bearer)\b/i;
const SYNTHETIC_PREFIX = 'synthetic-';
const FIXTURE_ONLY_LOCATOR_RE = /^fixture:\/\//;

function loadExpectations() {
  assert.ok(existsSync(FIXTURES_DIR), `fixtures directory missing: ${FIXTURES_DIR}`);
  assert.ok(existsSync(EXPECTATIONS_PATH), `fixtures/expectations.json missing: ${EXPECTATIONS_PATH}`);
  return JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
}

function loadFixture(file) {
  const fixturePath = path.join(FIXTURES_DIR, file);
  assert.ok(existsSync(fixturePath), `fixture file missing: ${fixturePath}`);
  const raw = readFileSync(fixturePath, 'utf8');
  return { raw, parsed: JSON.parse(raw) };
}

function walkStrings(node, key, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walkStrings(child, key, visit);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [childKey, value] of Object.entries(node)) walkStrings(value, childKey, visit);
    return;
  }
  if (typeof node === 'string') visit(node, key);
}

function collectObjectSchemaNodes(node, jsonPath, results) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectObjectSchemaNodes(child, `${jsonPath}[${index}]`, results));
    return;
  }
  if (node && typeof node === 'object') {
    if (node.type === 'object') results.push({ node, jsonPath });
    for (const [key, value] of Object.entries(node)) {
      collectObjectSchemaNodes(value, jsonPath ? `${jsonPath}.${key}` : key, results);
    }
  }
}

// Group A
test('contract catalog: reason-catalog.json reasons equal AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG exactly, in order', () => {
  assert.deepEqual(
    REASON_CATALOG_JSON.reasons.map((entry) => entry.reason),
    AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG,
  );
});

// Group B
test('contract schemas: draft 2020-12, repo:// $id, and every type:"object" node closes additionalProperties:false', () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    assert.equal(schema['$schema'], 'https://json-schema.org/draft/2020-12/schema', `${name}: unexpected $schema`);
    assert.equal(typeof schema['$id'], 'string', `${name}: missing $id`);
    assert.ok(schema['$id'].startsWith('repo://'), `${name}: $id must start with repo://, got "${schema['$id']}"`);

    const objectNodes = [];
    collectObjectSchemaNodes(schema, '$', objectNodes);
    assert.ok(objectNodes.length > 0, `${name}: no type:"object" nodes found`);
    for (const { node, jsonPath } of objectNodes) {
      assert.equal(
        node.additionalProperties,
        false,
        `${name} ${jsonPath}: type:"object" node must declare additionalProperties:false`,
      );
    }
  }
});

// Group C
test('contract manifest: inventories exactly reason-catalog.json plus the four schemas, and never itself', () => {
  const expectedNames = new Set(['reason-catalog.json', ...Object.keys(SCHEMAS)]);
  const manifestNames = MANIFEST_JSON.artifacts.map((artifact) => artifact.name);

  assert.deepEqual([...new Set(manifestNames)].sort(), [...expectedNames].sort());
  assert.equal(manifestNames.length, expectedNames.size, 'manifest.json must not list any artifact twice');
  assert.ok(!manifestNames.includes('manifest.json'), 'manifest.json must not inventory itself');
});

// Group D
test('fixtures inventory: expectations.json references exactly the fixture files on disk, in both directions', () => {
  const EXPECTATIONS = loadExpectations();

  const filesOnDisk = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'expectations.json');
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

// Group E
test('fixtures rows: every expectations.json row has exactly the closed field set with well-typed values', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      [...EXPECTATION_ROW_KEYS].sort(),
      `${entry && entry.file}: expectations.json row must have exactly ${JSON.stringify(EXPECTATION_ROW_KEYS)}`,
    );
    assert.ok(typeof entry.file === 'string' && entry.file.length > 0, 'file must be a non-empty string');
    assert.ok(
      AGT002_M1_RADAR_RELIABILITY_VERDICTS.includes(entry.expected_verdict),
      `${entry.file}: expected_verdict "${entry.expected_verdict}" is not one of ${JSON.stringify(AGT002_M1_RADAR_RELIABILITY_VERDICTS)}`,
    );
    assert.equal(typeof entry.expected_promotable, 'boolean', `${entry.file}: expected_promotable must be boolean`);
    assert.equal(
      entry.expected_promotable,
      entry.expected_verdict === 'VALID',
      `${entry.file}: expected_promotable must equal (expected_verdict === 'VALID')`,
    );
    assert.ok(Array.isArray(entry.expected_reasons), `${entry.file}: expected_reasons must be an array`);
    for (const reason of entry.expected_reasons) {
      assert.equal(typeof reason, 'string', `${entry.file}: expected_reasons entries must be strings`);
    }
  }
});

// Group F
test('fixtures evaluation: validateAgt002M1RadarReliabilityBundle matches expected_verdict, expected_promotable and expected_reasons exactly for every row', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    const { parsed: bundle } = loadFixture(entry.file);
    const result = validateAgt002M1RadarReliabilityBundle(bundle);

    assert.equal(
      result.verdict,
      entry.expected_verdict,
      `${entry.file}: expected verdict ${entry.expected_verdict}, got ${result.verdict} (${JSON.stringify(result.reasons)})`,
    );
    assert.equal(
      result.promotable,
      entry.expected_promotable,
      `${entry.file}: expected promotable ${entry.expected_promotable}, got ${result.promotable}`,
    );

    const actualReasons = [...new Set(result.reasons)].sort();
    const expectedReasons = [...new Set(entry.expected_reasons)].sort();
    assert.deepEqual(
      actualReasons,
      expectedReasons,
      `${entry.file}: expected reasons ${JSON.stringify(expectedReasons)}, got ${JSON.stringify(actualReasons)}`,
    );
  }
});

// Group G
test('fixtures reasons: every expected and every emitted reason belongs to the closed JS catalog', () => {
  const EXPECTATIONS = loadExpectations();

  const catalogSet = new Set(AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG);
  for (const entry of EXPECTATIONS) {
    for (const reason of entry.expected_reasons) {
      assert.ok(catalogSet.has(reason), `${entry.file}: expected reason "${reason}" is outside the closed catalog`);
    }
    const { parsed: bundle } = loadFixture(entry.file);
    const result = validateAgt002M1RadarReliabilityBundle(bundle);
    for (const reason of result.reasons) {
      assert.ok(catalogSet.has(reason), `${entry.file}: emitted reason "${reason}" is outside the closed catalog`);
    }
  }
});

// Group H
test('fixtures are synthetic-only: run_id/evidence_id use the synthetic- prefix, locators are fixture:// only, no http(s)/emails/token-secret strings', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    const { raw, parsed } = loadFixture(entry.file);

    walkStrings(parsed, null, (value, key) => {
      if (key === 'run_id' || key === 'evidence_id') {
        assert.ok(
          value.startsWith(SYNTHETIC_PREFIX),
          `${entry.file}: ${key} "${value}" must start with "${SYNTHETIC_PREFIX}"`,
        );
      }
      if (key === 'locator') {
        assert.equal(
          FIXTURE_ONLY_LOCATOR_RE.test(value),
          true,
          `${entry.file}: locator "${value}" must use the fixture:// scheme only`,
        );
      }
    });

    assert.equal(FORBIDDEN_HTTP_RE.test(raw), false, `${entry.file}: must not contain an http(s):// URL`);
    assert.equal(FORBIDDEN_EMAIL_RE.test(raw), false, `${entry.file}: must not contain an email address`);
    assert.equal(FORBIDDEN_SECRET_RE.test(raw), false, `${entry.file}: must not contain token/secret-looking strings`);
  }
});

// Group I
test('fixtures coverage: expectations.json covers every minimum future scenario', () => {
  const EXPECTATIONS = loadExpectations();

  const evaluated = EXPECTATIONS.map((entry) => ({
    entry,
    result: validateAgt002M1RadarReliabilityBundle(loadFixture(entry.file).parsed),
  }));

  const includesAny = (reasons, candidates) => candidates.some((reason) => reasons.includes(reason));

  const validPromotedCount = evaluated.filter(
    ({ entry }) => entry.expected_verdict === 'VALID' && entry.expected_promotable === true && entry.expected_reasons.length === 0,
  ).length;
  assert.ok(
    validPromotedCount >= 2,
    'expectations.json must include at least two distinct VALID/promotable/[] fixtures: '
      + 'one covering the plain "valid promoted" happy path and one covering "exhaustive zero absence valid"',
  );

  const REQUIRED_SCENARIOS = [
    { label: 'partial unverified', verdict: 'UNVERIFIED', reasons: ['coverage.partial'] },
    { label: 'nonterminal unverified', verdict: 'UNVERIFIED', reasons: ['scan.status.not_terminal'] },
    { label: 'stale invalid', verdict: 'INVALID', reasons: ['freshness.stale'] },
    { label: 'no evidence unverified', verdict: 'UNVERIFIED', reasons: ['evidence.absent'] },
    { label: 'failed terminal invalid', verdict: 'INVALID', reasons: ['scan.status.failed'] },
    { label: 'partial claims absence invalid', verdict: 'INVALID', reasons: ['coverage.first_page_claims_absence'] },
    { label: 'mixed hash invalid', verdict: 'INVALID', reasons: ['schema.invalid_hash'] },
    { label: 'persistence/UI mismatch invalid', verdict: 'INVALID', reasons: ['traceability.persistence_ui_mismatch'] },
    {
      label: 'invalid timestamp',
      verdict: 'INVALID',
      reasons: ['temporal.timestamp_format_invalid', 'temporal.timestamp_invalid', 'temporal.order_invalid'],
    },
    { label: 'invalid extra property', verdict: 'INVALID', reasons: ['schema.additional_property'] },
    { label: 'invalid locator', verdict: 'INVALID', reasons: ['evidence.invalid_locator'] },
    { label: 'duplicate evidence id', verdict: 'INVALID', reasons: ['evidence.duplicate_id'] },
    { label: 'count mismatch invalid', verdict: 'INVALID', reasons: ['traceability.source_persistence_mismatch'] },
  ];

  for (const scenario of REQUIRED_SCENARIOS) {
    const hasRow = evaluated.some(
      ({ entry, result }) => entry.expected_verdict === scenario.verdict
        && includesAny(entry.expected_reasons, scenario.reasons)
        && includesAny(result.reasons, scenario.reasons),
    );
    assert.ok(hasRow, `expectations.json must include a "${scenario.label}" scenario row`);
  }
});
