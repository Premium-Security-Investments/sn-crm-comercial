import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rowsPath = fileURLToPath(new URL('./fixtures/phase3a-p3b2/scoped-opportunities.json', import.meta.url));
const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
const now = '2030-02-01T10:00:00.000Z';
const { buildAgt003PrioritiesData } = await import('../agt003-priorities-service.js');

const data = buildAgt003PrioritiesData(rows, { now });
assert.deepEqual(Object.keys(data), ['generated_at', 'source', 'policy', 'totals', 'priorities']);
assert.equal(data.generated_at, now);
assert.deepEqual(data.source, { id: 'CRM-F1', label: 'CRM comercial', as_of: '2030-02-01T09:59:00.000Z' });
assert.deepEqual(data.policy, { version: 'gate0-v1.0', read_only: true, human_review_required: true });
assert.deepEqual(data.totals, { source_rows: 2, visible_active: 1, prioritized: 1, high: 1, medium: 0, low: 0 });
assert.equal(data.priorities[0].id, 'syn-opportunity-critical');
assert.equal(data.priorities[0].score, 110);
assert.deepEqual(data.priorities[0].signal_codes, ['missing_next_action', 'stalled_critical', 'critical_stage', 'close_overdue', 'high_value']);
assert.equal(Object.hasOwn(data.priorities[0], 'internal_only'), false, 'non-contract fields must not leak');

const responseSchema = JSON.parse(readFileSync(fileURLToPath(new URL('../contracts/agents/AGT-003/v1/priorities.response.schema.json', import.meta.url)), 'utf8'));
const priorityKeys = Object.keys(responseSchema.properties.data.properties.priorities.items.properties);
assert.deepEqual(Object.keys(data.priorities[0]), priorityKeys, 'priority projection must exactly match the canonical contract');

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true, 'every output object/array must be frozen');
  for (const item of Object.values(value)) assertDeepFrozen(item);
}
assertDeepFrozen(data);
rows[0].company_name = 'MUTATED';
assert.equal(data.priorities[0].company_name, 'SYNTHETIC_ENTITY', 'output must not observe later input mutation');

const malformedData = buildAgt003PrioritiesData([{
  ...rows[0],
  id: 'syn-opportunity-malformed-dates',
  stage_code: 'prospecto',
  stage_name: 'SYNTHETIC_STAGE',
  next_action_at: 'not-a-date',
  expected_close_date: 'also-not-a-date',
}], { now });
assert.equal(malformedData.priorities[0].next_action_at, null, 'invalid next-action text must not escape the closed response schema');
assert.equal(malformedData.priorities[0].expected_close_date, null, 'invalid close-date text must not escape the closed response schema');
assert.ok(malformedData.priorities[0].signal_codes.includes('invalid_next_action'));
assert.ok(malformedData.priorities[0].signal_codes.includes('invalid_expected_close'));

for (const hostileRows of [
  Object.assign(Object.create(null), { 0: rows[0], length: 1 }),
  new Proxy([rows[0]], {}),
  [new Proxy({ ...rows[0] }, {})],
  [Object.assign(Object.create(null), rows[0])],
  [Object.defineProperty({ ...rows[0] }, 'id', { enumerable: true, get: () => 'syn-hostile' })],
  [Object.assign({ ...rows[0] }, { [Symbol('hidden')]: 'value' })],
]) {
  assert.throws(() => buildAgt003PrioritiesData(hostileRows, { now }), /AGT-003 priorities denied/);
}
assert.throws(() => buildAgt003PrioritiesData(rows, { now: 'not-a-date' }), /AGT-003 priorities denied/);
assert.throws(() => buildAgt003PrioritiesData([{ ...rows[0], company_name: undefined }], { now }), /AGT-003 priorities denied/, 'missing required contract fields must fail closed');
assert.throws(() => buildAgt003PrioritiesData([{ ...rows[0], offer_value: Infinity }], { now }), /AGT-003 priorities denied/, 'non-finite contract numbers must fail closed');

const originalArrayIncludes = Array.prototype.includes;
Array.prototype.includes = () => false;
try {
  assert.throws(() => buildAgt003PrioritiesData(rows, { now }), /AGT-003 priorities denied/, 'prototype pollution must fail closed before scoring');
} finally {
  Array.prototype.includes = originalArrayIncludes;
}

console.log('P3B.2 AGT-003 shared priorities service checks passed');
