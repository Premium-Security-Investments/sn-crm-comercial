import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION } from '../agt002-m1-radar-reliability-contract.js';
import { adaptLegacyRadarResultToM1 } from '../agt002-m1-radar-reliability-adapter.js';

// FASE RED: `agt002-m1-radar-reliability-adapter.js` todavía no existe (ver plan
// docs/superpowers/plans/2026-09-24-agt002-m1-radar-reliability-adapters.md, Tarea 1). Este
// import estático falla con ERR_MODULE_NOT_FOUND y ningún test de este archivo se ejecuta hasta
// FASE GREEN. Todos los datos de fixtures son 100% sintéticos: ids con prefijo `synthetic-` y
// URIs de evidencia con esquema `fixture://`, nunca resueltos a bytes reales. Cero disco fuera de
// este repo, cero red, cero SQL, cero runtime/UI.

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTER_PATH = path.join(REPO_ROOT, 'agt002-m1-radar-reliability-adapter.js');
const VALIDATOR_CLI_PATH = path.join(REPO_ROOT, 'scripts', 'agt002-m1-radar-reliability-validate-adapter-fixtures.mjs');
const CONTRACT_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-radar-reliability', 'v1');
const FIXTURES_DIR = path.join(CONTRACT_DIR, 'adapter-fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

const REQUIRED_FIXTURE_FILES = Object.freeze([
  'complete-promotable.json',
  'partial-run.json',
  'expired-run.json',
  'incomplete-coverage.json',
  'missing-evidence.json',
  'invalid-source-persistence-lineage.json',
  'persistence-presentation-mismatch.json',
  'missing-required-source-hash.json',
]);

const EXPECTATION_ROW_KEYS = Object.freeze([
  'file',
  'expected_adapter_status',
  'expected_verdict',
  'expected_promotable',
  'expected_reasons',
  'expected_missing_fields',
]);

const ADAPTER_STATUSES = Object.freeze(['ADAPTED', 'REJECTED']);
const VERDICTS = Object.freeze(['VALID', 'UNVERIFIED', 'INVALID']);

const LEGACY_TOP_LEVEL_KEYS = Object.freeze([
  'legacy_schema_version', 'run', 'source', 'persistence', 'presentation', 'evidence', 'freshness',
]);
const LEGACY_RUN_KEYS = Object.freeze(['id', 'status', 'started_at', 'finished_at']);
const LEGACY_SOURCE_KEYS = Object.freeze([
  'pages_fetched', 'total_pages', 'exhaustive', 'claims_absence', 'snapshot_sha256', 'record_count',
]);
const LEGACY_PERSISTENCE_KEYS = Object.freeze(['record_count', 'snapshot_sha256', 'committed_at']);
const LEGACY_PRESENTATION_KEYS = Object.freeze(['record_count', 'snapshot_sha256', 'rendered_at']);
const LEGACY_EVIDENCE_ITEM_KEYS = Object.freeze(['id', 'kind', 'uri', 'captured_at', 'sha256']);
const LEGACY_FRESHNESS_KEYS = Object.freeze(['evaluated_at', 'data_as_of', 'max_calendar_days']);

const LEGACY_SCHEMA_VERSION = 'agt002-radar-legacy-synthetic-v1';

const FORBIDDEN_HTTP_RE = /https?:\/\//i;
const FORBIDDEN_EMAIL_RE = /[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9-.]+/;
const FORBIDDEN_SECRET_RE = /\b(secret|token|api[_-]?key|password|passwd|bearer)\b/i;
const SYNTHETIC_PREFIX = 'synthetic-';
const FIXTURE_ONLY_URI_RE = /^fixture:\/\//;

function loadExpectations() {
  assert.ok(existsSync(FIXTURES_DIR), `adapter-fixtures directory missing: ${FIXTURES_DIR}`);
  assert.ok(existsSync(EXPECTATIONS_PATH), `adapter-fixtures/expectations.json missing: ${EXPECTATIONS_PATH}`);
  return JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
}

function loadFixture(file) {
  const fixturePath = path.join(FIXTURES_DIR, file);
  assert.ok(existsSync(fixturePath), `fixture file missing: ${fixturePath}`);
  const raw = readFileSync(fixturePath, 'utf8');
  return { raw, parsed: JSON.parse(raw) };
}

function keysExact(obj, expectedKeys, label) {
  assert.ok(obj && typeof obj === 'object' && !Array.isArray(obj), `${label}: expected an object`);
  assert.deepEqual(
    Object.keys(obj).sort(),
    [...expectedKeys].sort(),
    `${label}: expected exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(Object.keys(obj))}`,
  );
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

// Group A
test('adapter fixtures inventory: exactly the required 8 files, referenced bidirectionally by expectations.json, no duplicate rows', () => {
  assert.ok(existsSync(FIXTURES_DIR), `adapter-fixtures directory missing: ${FIXTURES_DIR}`);

  const filesOnDisk = readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'expectations.json');
  const filesOnDiskSet = new Set(filesOnDisk);

  assert.deepEqual([...filesOnDiskSet].sort(), [...REQUIRED_FIXTURE_FILES].sort());
  assert.equal(filesOnDisk.length, REQUIRED_FIXTURE_FILES.length, 'adapter-fixtures must contain exactly 8 fixture files');

  const EXPECTATIONS = loadExpectations();
  const referencedFiles = EXPECTATIONS.map((entry) => entry.file);
  const referencedSet = new Set(referencedFiles);

  assert.equal(referencedFiles.length, referencedSet.size, 'expectations.json must not reference the same fixture file twice');
  assert.equal(referencedFiles.length, REQUIRED_FIXTURE_FILES.length, 'expectations.json must have exactly 8 rows');

  for (const file of filesOnDiskSet) {
    assert.ok(referencedSet.has(file), `orphan fixture file not referenced by expectations.json: ${file}`);
  }
  for (const file of referencedSet) {
    assert.ok(filesOnDiskSet.has(file), `expectations.json references a fixture file missing on disk: ${file}`);
  }
});

// Group B
test('adapter expectations rows: every row has exactly the closed field set with well-typed values', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    keysExact(entry, EXPECTATION_ROW_KEYS, entry && entry.file);
    assert.ok(typeof entry.file === 'string' && entry.file.length > 0, 'file must be a non-empty string');
    assert.ok(
      ADAPTER_STATUSES.includes(entry.expected_adapter_status),
      `${entry.file}: expected_adapter_status "${entry.expected_adapter_status}" is not one of ${JSON.stringify(ADAPTER_STATUSES)}`,
    );
    assert.ok(
      VERDICTS.includes(entry.expected_verdict),
      `${entry.file}: expected_verdict "${entry.expected_verdict}" is not one of ${JSON.stringify(VERDICTS)}`,
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
    assert.ok(Array.isArray(entry.expected_missing_fields), `${entry.file}: expected_missing_fields must be an array`);
    for (const field of entry.expected_missing_fields) {
      assert.equal(typeof field, 'string', `${entry.file}: expected_missing_fields entries must be strings`);
    }
  }
});

// Group C
test('legacy fixtures: frozen input shape exactly (top-level and nested keys), no extra fields', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    const { parsed } = loadFixture(entry.file);

    keysExact(parsed, LEGACY_TOP_LEVEL_KEYS, entry.file);
    assert.equal(parsed.legacy_schema_version, LEGACY_SCHEMA_VERSION, `${entry.file}: legacy_schema_version`);
    keysExact(parsed.run, LEGACY_RUN_KEYS, `${entry.file}: run`);

    const expectedSourceKeys = entry.file === 'missing-required-source-hash.json'
      ? LEGACY_SOURCE_KEYS.filter((key) => key !== 'snapshot_sha256')
      : LEGACY_SOURCE_KEYS;
    keysExact(parsed.source, expectedSourceKeys, `${entry.file}: source`);

    keysExact(parsed.persistence, LEGACY_PERSISTENCE_KEYS, `${entry.file}: persistence`);
    keysExact(parsed.presentation, LEGACY_PRESENTATION_KEYS, `${entry.file}: presentation`);

    assert.ok(Array.isArray(parsed.evidence), `${entry.file}: evidence must be an array`);
    for (const item of parsed.evidence) keysExact(item, LEGACY_EVIDENCE_ITEM_KEYS, `${entry.file}: evidence[]`);

    keysExact(parsed.freshness, LEGACY_FRESHNESS_KEYS, `${entry.file}: freshness`);
  }
});

// Group D
test('adapter output: status, verdict, promotable, reasons (exact order) and missing_fields (exact order) match expectations exactly', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    const { parsed } = loadFixture(entry.file);
    const result = adaptLegacyRadarResultToM1(parsed);

    assert.equal(result.status, entry.expected_adapter_status, `${entry.file}: status`);
    assert.equal(result.verdict, entry.expected_verdict, `${entry.file}: verdict`);
    assert.equal(result.promotable, entry.expected_promotable, `${entry.file}: promotable`);
    assert.deepEqual(result.reasons, entry.expected_reasons, `${entry.file}: reasons must match in exact order`);
    assert.deepEqual(result.missing_fields, entry.expected_missing_fields, `${entry.file}: missing_fields must match in exact order`);

    if (entry.expected_adapter_status === 'REJECTED') {
      assert.equal(result.bundle, null, `${entry.file}: bundle must be null when REJECTED`);
    } else {
      assert.ok(result.bundle && typeof result.bundle === 'object', `${entry.file}: bundle must be an object when ADAPTED`);
    }
  }
});

// Group E
test('adapter fixtures are synthetic-only: run/evidence ids start with synthetic-, uris are fixture:// only, no http(s)/emails/token-secret strings', () => {
  const EXPECTATIONS = loadExpectations();

  for (const entry of EXPECTATIONS) {
    const { raw, parsed } = loadFixture(entry.file);

    walkStrings(parsed, null, (value, key) => {
      if (key === 'id') {
        assert.ok(value.startsWith(SYNTHETIC_PREFIX), `${entry.file}: id "${value}" must start with "${SYNTHETIC_PREFIX}"`);
      }
      if (key === 'uri') {
        assert.equal(
          FIXTURE_ONLY_URI_RE.test(value),
          true,
          `${entry.file}: uri "${value}" must use the fixture:// scheme only`,
        );
      }
    });

    assert.equal(FORBIDDEN_HTTP_RE.test(raw), false, `${entry.file}: must not contain an http(s):// URL`);
    assert.equal(FORBIDDEN_EMAIL_RE.test(raw), false, `${entry.file}: must not contain an email address`);
    assert.equal(FORBIDDEN_SECRET_RE.test(raw), false, `${entry.file}: must not contain token/secret-looking strings`);
  }
});

// Group F
test('adapter happy path: every mapped leaf is a literal copy from the legacy input, schema_version is the fixed constant', () => {
  const { parsed: legacy } = loadFixture('complete-promotable.json');
  const result = adaptLegacyRadarResultToM1(legacy);

  assert.equal(result.status, 'ADAPTED');
  const bundle = result.bundle;
  assert.ok(bundle, 'bundle must be present for the complete-promotable happy path');

  assert.equal(bundle.schema_version, AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION);
  assert.equal(bundle.run_id, legacy.run.id);

  assert.equal(bundle.scan.status, legacy.run.status);
  assert.equal(bundle.scan.started_at_utc, legacy.run.started_at);
  assert.equal(bundle.scan.completed_at_utc, legacy.run.finished_at);
  assert.equal(bundle.scan.source_snapshot_hash, legacy.source.snapshot_sha256);
  assert.equal(bundle.scan.item_count, legacy.source.record_count);
  assert.equal(bundle.scan.pagination.pages_fetched, legacy.source.pages_fetched);
  assert.equal(bundle.scan.pagination.total_pages_declared, legacy.source.total_pages);
  assert.equal(bundle.scan.pagination.exhaustive, legacy.source.exhaustive);
  assert.equal(bundle.scan.pagination.claims_absence, legacy.source.claims_absence);

  assert.equal(bundle.persistence.persisted_count, legacy.persistence.record_count);
  assert.equal(bundle.persistence.persisted_snapshot_hash, legacy.persistence.snapshot_sha256);
  assert.equal(bundle.persistence.persisted_at_utc, legacy.persistence.committed_at);

  assert.equal(bundle.ui_projection.rendered_count, legacy.presentation.record_count);
  assert.equal(bundle.ui_projection.rendered_snapshot_hash, legacy.presentation.snapshot_sha256);
  assert.equal(bundle.ui_projection.rendered_at_utc, legacy.presentation.rendered_at);

  assert.equal(bundle.evidence.length, legacy.evidence.length);
  legacy.evidence.forEach((legacyItem, index) => {
    const mapped = bundle.evidence[index];
    assert.equal(mapped.evidence_id, legacyItem.id);
    assert.equal(mapped.kind, legacyItem.kind);
    assert.equal(mapped.locator, legacyItem.uri);
    assert.equal(mapped.captured_at_utc, legacyItem.captured_at);
    assert.equal(mapped.content_sha256, legacyItem.sha256);
  });

  assert.equal(bundle.freshness.now_utc, legacy.freshness.evaluated_at);
  assert.equal(bundle.freshness.data_as_of_utc, legacy.freshness.data_as_of);
  assert.equal(bundle.freshness.max_staleness_calendar_days, legacy.freshness.max_calendar_days);
});

// Group G
test('adapter missing required field: missing source.snapshot_sha256 rejects with bundle:null and the exact missing path', () => {
  const { parsed: legacy } = loadFixture('missing-required-source-hash.json');
  assert.ok(!('snapshot_sha256' in legacy.source), 'fixture must omit source.snapshot_sha256');

  const result = adaptLegacyRadarResultToM1(legacy);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.bundle, null);
  assert.equal(result.verdict, 'INVALID');
  assert.equal(result.promotable, false);
  assert.deepEqual(result.reasons, ['adapter.legacy.missing_required_field']);
  assert.deepEqual(result.missing_fields, ['source.snapshot_sha256']);
});

// Group H
test('adapter source is static-clean: no server/API/SQL/Supabase/fetch/network/Date.now/new Date/process.env, imports only the existing contract module', () => {
  assert.ok(existsSync(ADAPTER_PATH), `adapter module missing on disk: ${ADAPTER_PATH}`);
  const source = readFileSync(ADAPTER_PATH, 'utf8');

  const importSpecifiers = [...source.matchAll(/^\s*import\s+.*?\sfrom\s+['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.ok(importSpecifiers.length > 0, 'adapter module must import the contract module');
  for (const specifier of importSpecifiers) {
    assert.equal(
      specifier,
      './agt002-m1-radar-reliability-contract.js',
      `adapter module must import only ./agt002-m1-radar-reliability-contract.js, found "${specifier}"`,
    );
  }

  const FORBIDDEN_PATTERNS = [
    [/\bserver\b/i, 'server'],
    [/\bapi\b/i, 'api'],
    [/\bsql\b/i, 'sql'],
    [/\bsupabase\b/i, 'supabase'],
    [/\bfetch\s*\(/i, 'fetch('],
    [/\bnetwork\b/i, 'network'],
    [/Date\.now\s*\(/, 'Date.now('],
    [/new\s+Date\s*\(/, 'new Date('],
    [/process\.env/, 'process.env'],
    [/\brequire\s*\(/, 'require('],
  ];
  for (const [re, label] of FORBIDDEN_PATTERNS) {
    assert.equal(re.test(source), false, `adapter module must not reference "${label}"`);
  }
});

// Group I
test('validator CLI: running the adapter-fixtures validator offline exits 0 with an empty stderr and prints exactly one JSON summary object', () => {
  const run = spawnSync(process.execPath, [VALIDATOR_CLI_PATH], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });

  assert.equal(run.status, 0, `validator CLI must exit 0. stderr: ${run.stderr}`);
  assert.equal(run.stderr, '', `validator CLI must produce empty stderr, got: ${run.stderr}`);

  const stdoutLines = run.stdout.split('\n').filter((line) => line.trim().length > 0);
  assert.equal(stdoutLines.length, 1, `validator CLI stdout must contain exactly one JSON object line, got: ${JSON.stringify(run.stdout)}`);

  const summary = JSON.parse(stdoutLines[0]);
  assert.deepEqual(summary, {
    validator: 'agt002-m1-radar-reliability-adapter-fixtures',
    total: 8,
    passed: 8,
    failed: 0,
  });
});
