import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  AGT002_PHASE01_VERDICTS,
  AGT002_PHASE01_GATE_STATUSES,
  AGT002_PHASE01_GATE_OUTCOMES,
  AGT002_PHASE01_GATE_TYPES,
  AGT002_PHASE01_ALLOWED_TRANSITIONS,
  AGT002_PHASE01_SCHEMA_VERSIONS,
  AGT002_PHASE01_REASON_CODES,
  AGT002_PHASE01_SYNTHETIC_UUID_PREFIX,
  AGT002_PHASE01_FINAL_AUDIT_GATE_ID,
  validateAgt002Phase01Schema,
  canonicalizeAgt002Phase01,
  computeAgt002Phase01Hash,
  aggregateAgt002Phase01Verdict,
} from '../agt002-phase01-executable-controls.js';

const MODULE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'agt002-phase01-executable-controls.js',
);

test('frozen constants: exact shapes', () => {
  assert.equal(Object.isFrozen(AGT002_PHASE01_VERDICTS), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_GATE_STATUSES), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_GATE_OUTCOMES), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_GATE_TYPES), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_ALLOWED_TRANSITIONS), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_SCHEMA_VERSIONS), true);
  assert.equal(Object.isFrozen(AGT002_PHASE01_REASON_CODES), true);

  assert.deepEqual(AGT002_PHASE01_VERDICTS, ['VALID', 'INVALID', 'UNVERIFIED']);

  assert.deepEqual(AGT002_PHASE01_ALLOWED_TRANSITIONS, {
    DRAFT: ['OPEN'],
    OPEN: ['CONSUMED', 'EXPIRED', 'REVOKED'],
    CONSUMED: [],
    EXPIRED: [],
    REVOKED: [],
  });

  assert.equal(typeof AGT002_PHASE01_SYNTHETIC_UUID_PREFIX, 'string');
  assert.equal(AGT002_PHASE01_SYNTHETIC_UUID_PREFIX, 'f1c70000-');
  assert.equal(AGT002_PHASE01_FINAL_AUDIT_GATE_ID, 'FINAL_AUDIT_PHASE_0');
});

test('validateAgt002Phase01Schema: accepts a conforming object', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
    },
  };
  const result = validateAgt002Phase01Schema(schema, { name: 'ok' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateAgt002Phase01Schema: rejects additional property', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  };
  const result = validateAgt002Phase01Schema(schema, { name: 'ok', extra: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.additional_property' && e.path === '/extra'));
});

test('validateAgt002Phase01Schema: rejects missing required', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  };
  const result = validateAgt002Phase01Schema(schema, {});
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.missing_required'));
});

test('validateAgt002Phase01Schema: rejects type mismatch', () => {
  const schema = { type: 'string' };
  const result = validateAgt002Phase01Schema(schema, 42);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.type_mismatch'));
});

test('validateAgt002Phase01Schema: rejects enum mismatch', () => {
  const schema = { type: 'string', enum: ['A', 'B'] };
  const result = validateAgt002Phase01Schema(schema, 'C');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.enum_mismatch'));
});

test('validateAgt002Phase01Schema: rejects const mismatch', () => {
  const schema = { type: 'string', const: 'pinned' };
  const result = validateAgt002Phase01Schema(schema, 'other');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.const_mismatch'));
});

test('validateAgt002Phase01Schema: rejects pattern mismatch', () => {
  const schema = { type: 'string', pattern: '^[A-Z]+$' };
  const result = validateAgt002Phase01Schema(schema, 'lower');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.pattern_mismatch'));
});

test('validateAgt002Phase01Schema: rejects minLength violation', () => {
  const schema = { type: 'string', minLength: 8 };
  const result = validateAgt002Phase01Schema(schema, 'short');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.min_length'));
});

test('validateAgt002Phase01Schema: rejects minItems violation', () => {
  const schema = { type: 'array', minItems: 2, items: { type: 'string' } };
  const result = validateAgt002Phase01Schema(schema, ['one']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.min_items'));
});

test('validateAgt002Phase01Schema: rejects maxItems violation', () => {
  const schema = { type: 'array', maxItems: 1, items: { type: 'string' } };
  const result = validateAgt002Phase01Schema(schema, ['one', 'two']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.max_items'));
});

test('validateAgt002Phase01Schema: rejects uniqueItems violation', () => {
  const schema = { type: 'array', uniqueItems: true, items: { type: 'string' } };
  const result = validateAgt002Phase01Schema(schema, ['dup', 'dup']);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.not_unique'));
});

test('validateAgt002Phase01Schema: accepts null with type ["object","null"] and skips required', () => {
  const schema = {
    type: ['object', 'null'],
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string' },
    },
  };
  const result = validateAgt002Phase01Schema(schema, null);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateAgt002Phase01Schema: throws on unknown schema keyword', () => {
  const schema = { type: 'string', format: 'uuid' };
  assert.throws(() => validateAgt002Phase01Schema(schema, 'abc'));
});

test('validateAgt002Phase01Schema: local $defs + $ref resolves and validates', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: {
      item: { $ref: '#/$defs/closedItem' },
    },
    $defs: {
      closedItem: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: { type: 'string' },
        },
      },
    },
  };

  const ok = validateAgt002Phase01Schema(schema, { item: { name: 'ok' } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);

  const extra = validateAgt002Phase01Schema(schema, { item: { name: 'ok', extra: 1 } });
  assert.equal(extra.ok, false);
  assert.ok(
    extra.errors.some((e) => e.code === 'schema.additional_property' && e.path === '/item/extra'),
  );

  const missing = validateAgt002Phase01Schema(schema, { item: {} });
  assert.equal(missing.ok, false);
  assert.ok(
    missing.errors.some((e) => e.code === 'schema.missing_required' && e.path === '/item/name'),
  );
});

test('validateAgt002Phase01Schema: unresolved local $ref fails closed without throwing', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: {
      item: { $ref: '#/$defs/missing' },
    },
  };

  const result = validateAgt002Phase01Schema(schema, { item: { name: 'ok' } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.ref_unresolved'));
});

test('validateAgt002Phase01Schema: external $ref fails closed without network or throwing', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['item'],
    properties: {
      item: { $ref: 'https://example.invalid/schema.json' },
    },
  };

  const result = validateAgt002Phase01Schema(schema, { item: { name: 'ok' } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'schema.ref_unsupported'));
});

test('canonicalizeAgt002Phase01: object key order is irrelevant, array order matters', () => {
  const a = canonicalizeAgt002Phase01({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalizeAgt002Phase01({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);

  const arr1 = canonicalizeAgt002Phase01([2, 1]);
  const arr2 = canonicalizeAgt002Phase01([1, 2]);
  assert.notEqual(arr1, arr2);
});

test('computeAgt002Phase01Hash: deterministic 64-hex lowercase, changes with value', () => {
  const h1 = computeAgt002Phase01Hash({ a: 1, b: 2 });
  const h2 = computeAgt002Phase01Hash({ b: 2, a: 1 });
  const h3 = computeAgt002Phase01Hash({ a: 1, b: 3 });

  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('aggregateAgt002Phase01Verdict: fail-closed algebra', () => {
  assert.deepEqual(aggregateAgt002Phase01Verdict([]), { verdict: 'UNVERIFIED', reasons: [] });

  assert.deepEqual(
    aggregateAgt002Phase01Verdict([
      { term: 'x', verdict: 'VALID', reasons: [] },
      { term: 'y', verdict: 'VALID', reasons: [] },
    ]),
    { verdict: 'VALID', reasons: [] },
  );

  assert.deepEqual(
    aggregateAgt002Phase01Verdict([
      { term: 'x', verdict: 'VALID', reasons: [] },
      { term: 'y', verdict: 'UNVERIFIED', reasons: ['reason.y'] },
    ]),
    { verdict: 'UNVERIFIED', reasons: ['reason.y'] },
  );

  const mixed = aggregateAgt002Phase01Verdict([
    { term: 'x', verdict: 'UNVERIFIED', reasons: ['reason.x'] },
    { term: 'y', verdict: 'INVALID', reasons: ['reason.y'] },
  ]);
  assert.equal(mixed.verdict, 'INVALID');
  assert.deepEqual(mixed.reasons, ['reason.x', 'reason.y']);
});

test('source guard: no network, no supabase writes, no ambient clock', () => {
  const source = readFileSync(MODULE_PATH, 'utf8');
  assert.doesNotMatch(
    source,
    /@supabase\/supabase-js|createClient\(|SUPABASE_SERVICE_ROLE_KEY|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|fetch\(|node:https?|Date\.now\(\)|new Date\(\)/,
  );
});
