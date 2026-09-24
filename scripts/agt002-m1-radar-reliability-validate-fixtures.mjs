// AGT-002 M1: valida contracts/agt002-radar-reliability/v1/fixtures/ contra expectations.json.
// Solo artefactos locales, sin red/DB, sin dependencias externas.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION,
  AGT002_M1_RADAR_RELIABILITY_VERDICTS,
  AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG,
  validateAgt002M1RadarReliabilityBundle,
} from '../agt002-m1-radar-reliability-contract.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-radar-reliability', 'v1');
const FIXTURES_DIR = path.join(CONTRACT_DIR, 'fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

const EXPECTATION_ROW_KEYS = ['file', 'expected_verdict', 'expected_promotable', 'expected_reasons'];
const REASON_CATALOG_SET = new Set(AGT002_M1_RADAR_RELIABILITY_REASON_CATALOG);

function abort(message) {
  process.stderr.write(`agt002-m1-radar-reliability-validate-fixtures: ${message}\n`);
  process.exit(1);
}

if (!existsSync(FIXTURES_DIR)) abort(`fixtures directory missing: ${FIXTURES_DIR}`);
if (!existsSync(EXPECTATIONS_PATH)) abort(`expectations.json missing: ${EXPECTATIONS_PATH}`);

let expectations;
try {
  expectations = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
} catch (error) {
  abort(`expectations.json is not valid JSON: ${error.message}`);
}
if (!Array.isArray(expectations)) abort('expectations.json must be a JSON array');

const filesOnDisk = readdirSync(FIXTURES_DIR)
  .filter((name) => name.endsWith('.json'))
  .filter((name) => name !== 'expectations.json');
const filesOnDiskSet = new Set(filesOnDisk);

const referencedCounts = new Map();
for (const entry of expectations) {
  const file = entry && typeof entry === 'object' ? entry.file : undefined;
  if (typeof file !== 'string' || file.length === 0) continue;
  referencedCounts.set(file, (referencedCounts.get(file) || 0) + 1);
}

const allFiles = [...new Set([...filesOnDiskSet, ...referencedCounts.keys()])].sort();
const results = [];

for (const file of allFiles) {
  const errors = [];
  const onDisk = filesOnDiskSet.has(file);
  const referencedCount = referencedCounts.get(file) || 0;

  if (!onDisk) errors.push('referenced by expectations.json but missing on disk');
  if (referencedCount === 0) errors.push('orphan fixture: not referenced by expectations.json');
  if (referencedCount > 1) errors.push(`referenced ${referencedCount} times in expectations.json, must be exactly once`);

  let verdict = null;
  let promotable = null;
  let reasons = null;
  let expectedVerdict = null;
  let expectedPromotable = null;
  let expectedReasons = null;

  if (onDisk && referencedCount === 1) {
    const entry = expectations.find((row) => row && row.file === file);
    const rowKeys = Object.keys(entry).sort();
    const expectedKeys = [...EXPECTATION_ROW_KEYS].sort();

    if (JSON.stringify(rowKeys) !== JSON.stringify(expectedKeys)) {
      errors.push(`expectations row must have exactly the keys ${JSON.stringify(EXPECTATION_ROW_KEYS)}`);
    } else {
      expectedVerdict = entry.expected_verdict;
      expectedPromotable = entry.expected_promotable;
      expectedReasons = entry.expected_reasons;

      if (!AGT002_M1_RADAR_RELIABILITY_VERDICTS.includes(expectedVerdict)) {
        errors.push(`expected_verdict "${expectedVerdict}" is not one of ${JSON.stringify(AGT002_M1_RADAR_RELIABILITY_VERDICTS)}`);
      }
      if (typeof expectedPromotable !== 'boolean') {
        errors.push('expected_promotable must be boolean');
      } else if (expectedPromotable !== (expectedVerdict === 'VALID')) {
        errors.push('expected_promotable must equal (expected_verdict === "VALID")');
      }
      if (!Array.isArray(expectedReasons) || expectedReasons.some((reason) => typeof reason !== 'string')) {
        errors.push('expected_reasons must be an array of strings');
      } else {
        for (const reason of expectedReasons) {
          if (!REASON_CATALOG_SET.has(reason)) {
            errors.push(`expected reason "${reason}" is outside the closed catalog`);
          }
        }
      }

      if (errors.length === 0) {
        let bundle;
        try {
          bundle = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
        } catch (error) {
          errors.push(`fixture is not valid JSON: ${error.message}`);
        }

        if (errors.length === 0) {
          const result = validateAgt002M1RadarReliabilityBundle(bundle);
          verdict = result.verdict;
          promotable = result.promotable;
          reasons = [...result.reasons];

          for (const reason of reasons) {
            if (!REASON_CATALOG_SET.has(reason)) {
              errors.push(`emitted reason "${reason}" is outside the closed catalog`);
            }
          }
          if (verdict !== expectedVerdict) {
            errors.push(`verdict mismatch: expected ${expectedVerdict}, got ${verdict}`);
          }
          if (promotable !== expectedPromotable) {
            errors.push(`promotable mismatch: expected ${expectedPromotable}, got ${promotable}`);
          }
          if (JSON.stringify(reasons) !== JSON.stringify(expectedReasons)) {
            errors.push(`reasons mismatch: expected ${JSON.stringify(expectedReasons)}, got ${JSON.stringify(reasons)}`);
          }
        }
      }
    }
  }

  results.push({
    file,
    status: errors.length === 0 ? 'pass' : 'fail',
    verdict,
    promotable,
    reasons,
    expected_verdict: expectedVerdict,
    expected_promotable: expectedPromotable,
    expected_reasons: expectedReasons,
    errors,
  });
}

const total = results.length;
const failed = results.filter((result) => result.status === 'fail').length;
const passed = total - failed;

const report = {
  schema_version: AGT002_M1_RADAR_RELIABILITY_SCHEMA_VERSION,
  total,
  passed,
  failed,
  results,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(failed === 0 ? 0 : 1);
