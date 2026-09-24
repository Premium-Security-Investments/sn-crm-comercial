import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { evaluateAgt002Phase01Fixture } from '../agt002-phase01-executable-controls.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'contracts', 'agt002-phase01', 'v1', 'fixtures');
const EXPECTATIONS_PATH = path.join(FIXTURES_DIR, 'expectations.json');

const expectations = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8'));

function dedupSort(codes) {
  return [...new Set(codes)].sort();
}

function reasonsEqual(expectedReasons, actualReasons) {
  const expectedSorted = dedupSort(expectedReasons);
  const actualSorted = dedupSort(actualReasons);
  if (expectedSorted.length !== actualSorted.length) return false;
  return expectedSorted.every((code, index) => code === actualSorted[index]);
}

function emptyCounts() {
  return { total: 0, passed: 0, failed: 0 };
}

function bumpCounts(counts, ok) {
  counts.total += 1;
  if (ok) counts.passed += 1;
  else counts.failed += 1;
}

function sortObjectKeys(source) {
  const sorted = {};
  for (const key of Object.keys(source).sort()) {
    sorted[key] = source[key];
  }
  return sorted;
}

const summary = {
  total: 0,
  passed: 0,
  failed: 0,
  by_control: {},
  by_verdict: {},
  failures: [],
};

for (const entry of expectations) {
  let actualVerdict = 'ERROR';
  let actualReasons = [];
  try {
    const result = evaluateAgt002Phase01Fixture(entry, { fixtureDir: FIXTURES_DIR });
    actualVerdict = result.verdict;
    actualReasons = result.reasons;
  } catch {
    actualVerdict = 'ERROR';
    actualReasons = [];
  }

  const expectedReasons = Array.isArray(entry.expected_reasons) ? entry.expected_reasons : [];
  const ok = actualVerdict === entry.expected_verdict && reasonsEqual(expectedReasons, actualReasons);

  bumpCounts(summary, ok);

  if (!ok) {
    summary.failures.push({
      file: entry.file,
      control: entry.control,
      expected_verdict: entry.expected_verdict,
      actual_verdict: actualVerdict,
      expected_reasons: dedupSort(expectedReasons),
      actual_reasons: dedupSort(actualReasons),
    });
  }

  if (!Object.prototype.hasOwnProperty.call(summary.by_control, entry.control)) {
    summary.by_control[entry.control] = emptyCounts();
  }
  bumpCounts(summary.by_control[entry.control], ok);

  if (!Object.prototype.hasOwnProperty.call(summary.by_verdict, entry.expected_verdict)) {
    summary.by_verdict[entry.expected_verdict] = emptyCounts();
  }
  bumpCounts(summary.by_verdict[entry.expected_verdict], ok);
}

summary.by_control = sortObjectKeys(summary.by_control);
summary.by_verdict = sortObjectKeys(summary.by_verdict);

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

process.exit(summary.failed === 0 ? 0 : 1);
