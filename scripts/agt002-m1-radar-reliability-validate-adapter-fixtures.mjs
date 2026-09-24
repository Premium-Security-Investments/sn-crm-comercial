// Offline, deterministic validator: replays contracts/agt002-radar-reliability/v1/adapter-fixtures
// through adaptLegacyRadarResultToM1 and checks each row against expectations.json.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { adaptLegacyRadarResultToM1 } from '../agt002-m1-radar-reliability-adapter.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(SCRIPT_DIR, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-radar-reliability', 'v1', 'adapter-fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
}

function emitSummary(total, passed, failed) {
  process.stdout.write(`${JSON.stringify({
    validator: 'agt002-m1-radar-reliability-adapter-fixtures',
    total,
    passed,
    failed,
  })}\n`);
}

let expectations;
try {
  if (!existsSync(EXPECTATIONS_PATH)) throw new Error(`expectations.json missing: ${EXPECTATIONS_PATH}`);
  expectations = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));
  if (!Array.isArray(expectations)) throw new Error('expectations.json must contain an array');
} catch {
  emitSummary(1, 0, 1);
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const entry of expectations) {
  try {
    const fixturePath = path.join(FIXTURES_DIR, entry.file);
    if (!existsSync(fixturePath)) throw new Error(`fixture missing: ${fixturePath}`);
    const legacy = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const result = adaptLegacyRadarResultToM1(legacy);

    const rowPassed = result.status === entry.expected_adapter_status
      && result.verdict === entry.expected_verdict
      && result.promotable === entry.expected_promotable
      && arraysEqual(result.reasons, entry.expected_reasons)
      && arraysEqual(result.missing_fields, entry.expected_missing_fields);

    if (rowPassed) passed += 1;
    else failed += 1;
  } catch {
    failed += 1;
  }
}

emitSummary(expectations.length, passed, failed);
process.exit(failed === 0 ? 0 : 1);
