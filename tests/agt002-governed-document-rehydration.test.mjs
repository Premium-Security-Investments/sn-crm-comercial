import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAgt002GovernedDocumentForExecution } from '../agt002-governed-document-rehydration.js';

// RED slice: the governed document-workset EXECUTION path (agt002-reanalysis-executor.js,
// see tests/agt002-governed-document-workset-execution.test.mjs) already accepts an injected
// `governedDocumentResolver` seam and validates whatever it returns byte-for-byte against the
// frozen governed_workset_members evidence — but no real resolver exists yet. This file
// specifies the actual production resolver: it must read EXACTLY the one immutable document
// version row and EXACTLY the one 'ok' extraction row this frozen member identifies — by
// primary key plus tenant/tender scope, never by ordering or "latest" — and map them onto the
// shape the executor already cross-checks, including the immutable document_id (mapped from the
// real psi_tender_document_versions.source_document_id column — that table has no document_id
// column of its own, see supabase/migrations/026_tender_document_versions.sql).

function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function omit(obj, key) {
  const { [key]: _omitted, ...rest } = obj;
  return rest;
}

const OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
const TENDER_ID = '22222222-2222-2222-2222-222222222222';
const SNAPSHOT_ID = '33333333-3333-3333-3333-333333333333';
const CONTEXT_VERSION_ID = '44444444-4444-4444-4444-444444444444';
const DOCUMENT_VERSION_ID = '55555555-5555-5555-5555-555555555555';
const EXTRACTION_ID = '66666666-6666-6666-6666-666666666666';
const DOCUMENT_ID = '77777777-7777-7777-7777-777777777777';
const OTHER_OPPORTUNITY_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_TENDER_ID = '99999999-9999-9999-9999-999999999999';

const CONTENT_HASH = 'a'.repeat(64);
const EXTRACTED_TEXT = 'REAL EXTRACTED TEXT FOR DOCUMENT 55555555-...';
const TEXT_HASH = sha256Hex(EXTRACTED_TEXT);
const VERSION_NUMBER = 3;
const DOCUMENT_NAME = 'Pliego de condiciones';
const DOCUMENT_TYPE = 'pliego';

// Only the fields a real governed_workset_members entry carries — the resolver must never
// need anything else off `member` besides `extraction_id`.
const MEMBER = Object.freeze({
  document_version_id: DOCUMENT_VERSION_ID,
  source_classification: 'official',
  inclusion_reason: 'required by pliego',
  content_hash: CONTENT_HASH,
  extraction_id: EXTRACTION_ID,
  extraction_text_hash: TEXT_HASH,
});

function baseArgs(overrides = {}) {
  return {
    opportunityId: OPPORTUNITY_ID,
    tenderId: TENDER_ID,
    snapshotId: SNAPSHOT_ID,
    contextVersionId: CONTEXT_VERSION_ID,
    documentVersionId: DOCUMENT_VERSION_ID,
    member: MEMBER,
    ...overrides,
  };
}

// A fake Supabase-style query builder. Deliberately exposes ONLY select/eq/maybeSingle/single —
// no order/limit/in — so any production code that reaches for "latest" or a list read fails
// loudly with a TypeError instead of silently succeeding.
function createGovernedDocumentDatabase({ versionRow = null, versionError = null, extractionRow = null, extractionError = null } = {}) {
  const calls = { version: null, extraction: null };
  function tableCall(table, row, error) {
    const call = { table, select: null, eq: [], terminal: null };
    const builder = {
      select(columns) { call.select = columns; return builder; },
      eq(column, value) { call.eq.push([column, value]); return builder; },
      async maybeSingle() { call.terminal = 'maybeSingle'; return { data: row, error }; },
      async single() { call.terminal = 'single'; return { data: row, error }; },
    };
    return { call, builder };
  }
  return {
    calls,
    from(table) {
      if (table === 'psi_tender_document_versions') {
        const { call, builder } = tableCall(table, versionRow, versionError);
        calls.version = call;
        return builder;
      }
      if (table === 'psi_tender_document_extractions') {
        const { call, builder } = tableCall(table, extractionRow, extractionError);
        calls.extraction = call;
        return builder;
      }
      throw new Error(`unexpected table read: ${table}`);
    },
  };
}

function eqObject(call) {
  assert.ok(call, 'expected a recorded query call');
  return Object.fromEntries(call.eq.map(([column, value]) => [column, value]));
}

// psi_tender_document_versions (migration 026) has no document_id column — the document's
// immutable identity is source_document_id.
function validVersionRow() {
  return {
    id: DOCUMENT_VERSION_ID,
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    source_document_id: DOCUMENT_ID,
    version: VERSION_NUMBER,
    name: DOCUMENT_NAME,
    content_hash: CONTENT_HASH,
    document_type: DOCUMENT_TYPE,
    current: true,
  };
}

function validExtractionRow() {
  return { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, text_hash: TEXT_HASH, extracted_text: EXTRACTED_TEXT };
}

test('reads the exact document version and ok extraction rows by primary key plus tenant/tender scope, never by ordering or a list read', async () => {
  const database = createGovernedDocumentDatabase({ versionRow: validVersionRow(), extractionRow: validExtractionRow() });

  const result = await resolveAgt002GovernedDocumentForExecution(database, baseArgs());

  assert.equal(database.calls.version.table, 'psi_tender_document_versions');
  assert.equal(
    database.calls.version.select,
    'id,opportunity_id,tender_id,source_document_id,version,name,content_hash,document_type,current',
    'the document version read must select exactly the real migration 026 columns it needs',
  );
  assert.deepEqual(
    eqObject(database.calls.version),
    { id: DOCUMENT_VERSION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID },
    'the document version read must be constrained by exactly id + opportunity_id + tender_id',
  );
  assert.notEqual(database.calls.version.terminal, null, 'the document version read must terminate in a single-row fetch (single/maybeSingle), never a list');

  assert.equal(database.calls.extraction.table, 'psi_tender_document_extractions');
  assert.equal(
    database.calls.extraction.select,
    'id,document_version_id,text_hash,extracted_text',
    'the extraction read must select only id, document_version_id, text_hash and extracted_text',
  );
  assert.deepEqual(
    eqObject(database.calls.extraction),
    { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, status: 'ok' },
    'the extraction read must be constrained by exactly id (member.extraction_id) + document_version_id + opportunity_id + tender_id + status=ok',
  );
  assert.notEqual(database.calls.extraction.terminal, null, 'the extraction read must terminate in a single-row fetch (single/maybeSingle), never a list');

  assert.deepEqual(
    result,
    {
      document_id: DOCUMENT_ID,
      document_version_id: DOCUMENT_VERSION_ID,
      opportunity_id: OPPORTUNITY_ID,
      tender_id: TENDER_ID,
      version: VERSION_NUMBER,
      name: DOCUMENT_NAME,
      content_hash: CONTENT_HASH,
      document_type: DOCUMENT_TYPE,
      current: true,
      extraction_id: EXTRACTION_ID,
      extraction_text_hash: TEXT_HASH,
      text: EXTRACTED_TEXT,
    },
    'success must return exactly the mapped shape, with document_id sourced from source_document_id',
  );
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'content_hash',
      'current',
      'document_id',
      'document_type',
      'document_version_id',
      'extraction_id',
      'extraction_text_hash',
      'name',
      'opportunity_id',
      'tender_id',
      'text',
      'version',
    ],
    'success must never return a superset of the fields the executor cross-checks',
  );
});

test('snapshotId and contextVersionId are never used to scope either read, and can never substitute the frozen opportunity/tender/document/extraction identity', async () => {
  // A hostile/malformed caller could try to smuggle a completely different tenant's id in
  // through the audit-only fields. Neither read may ever filter on these values, or on
  // anything by-value equal to them instead of the frozen identity fields.
  const SPOOFED_SNAPSHOT_ID = OPPORTUNITY_ID.replace(/^1/, '9');
  const SPOOFED_CONTEXT_VERSION_ID = TENDER_ID.replace(/^2/, '8');

  const database = createGovernedDocumentDatabase({ versionRow: validVersionRow(), extractionRow: validExtractionRow() });
  const result = await resolveAgt002GovernedDocumentForExecution(database, baseArgs({
    snapshotId: SPOOFED_SNAPSHOT_ID,
    contextVersionId: SPOOFED_CONTEXT_VERSION_ID,
  }));

  const allEqValues = [...database.calls.version.eq, ...database.calls.extraction.eq].map(([, value]) => value);
  assert.ok(!allEqValues.includes(SPOOFED_SNAPSHOT_ID), 'snapshotId must never appear as a query filter value');
  assert.ok(!allEqValues.includes(SPOOFED_CONTEXT_VERSION_ID), 'contextVersionId must never appear as a query filter value');
  assert.deepEqual(
    eqObject(database.calls.version),
    { id: DOCUMENT_VERSION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID },
    'the document version read must still be scoped by the real frozen opportunity/tender identity, unaffected by snapshotId/contextVersionId',
  );
  assert.deepEqual(
    eqObject(database.calls.extraction),
    { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, status: 'ok' },
    'the extraction read must still be scoped by the real frozen identity, unaffected by snapshotId/contextVersionId',
  );
  assert.equal(result.document_version_id, DOCUMENT_VERSION_ID);
});

function isInvalidError(error) {
  return error instanceof Error && typeof error.code === 'string' && error.code.includes('INVALID');
}

const INVALID_VERSION_READ_CASES = [
  { name: 'missing document version row', db: { versionRow: null } },
  { name: 'errored document version read', db: { versionError: { message: 'db unavailable' } } },
  { name: 'document version row missing content_hash', db: { versionRow: omit(validVersionRow(), 'content_hash') } },
  { name: 'document version row with non-string content_hash', db: { versionRow: { ...validVersionRow(), content_hash: 123 } } },
  {
    name: 'document version row whose id does not match the requested documentVersionId',
    db: { versionRow: { ...validVersionRow(), id: 'aaaaaaaa-0000-0000-0000-000000000000' } },
  },
  {
    name: 'document version row whose opportunity_id does not match the requested opportunityId',
    db: { versionRow: { ...validVersionRow(), opportunity_id: OTHER_OPPORTUNITY_ID } },
  },
  {
    name: 'document version row whose tender_id does not match the requested tenderId',
    db: { versionRow: { ...validVersionRow(), tender_id: OTHER_TENDER_ID } },
  },
  { name: 'document version row missing source_document_id', db: { versionRow: omit(validVersionRow(), 'source_document_id') } },
  { name: 'document version row with blank source_document_id', db: { versionRow: { ...validVersionRow(), source_document_id: '   ' } } },
  { name: 'document version row with non-string source_document_id', db: { versionRow: { ...validVersionRow(), source_document_id: 123 } } },
  { name: 'document version row missing name', db: { versionRow: omit(validVersionRow(), 'name') } },
  { name: 'document version row with blank name', db: { versionRow: { ...validVersionRow(), name: '   ' } } },
  { name: 'document version row missing document_type', db: { versionRow: omit(validVersionRow(), 'document_type') } },
  { name: 'document version row with blank document_type', db: { versionRow: { ...validVersionRow(), document_type: '   ' } } },
  { name: 'document version row missing version', db: { versionRow: omit(validVersionRow(), 'version') } },
  { name: 'document version row with zero version', db: { versionRow: { ...validVersionRow(), version: 0 } } },
  { name: 'document version row with negative version', db: { versionRow: { ...validVersionRow(), version: -1 } } },
  { name: 'document version row with non-integer version', db: { versionRow: { ...validVersionRow(), version: 1.5 } } },
  { name: 'document version row with non-numeric version', db: { versionRow: { ...validVersionRow(), version: '3' } } },
  { name: 'document version row missing current', db: { versionRow: omit(validVersionRow(), 'current') } },
  { name: 'document version row with non-boolean current', db: { versionRow: { ...validVersionRow(), current: 'true' } } },
];

for (const { name, db } of INVALID_VERSION_READ_CASES) {
  test(`fails closed with a code containing INVALID when the document version read is: ${name}`, async () => {
    const database = createGovernedDocumentDatabase({ extractionRow: validExtractionRow(), ...db });
    await assert.rejects(
      () => resolveAgt002GovernedDocumentForExecution(database, baseArgs()),
      isInvalidError,
      'a missing/errored/malformed/mismatched document version row must throw a safe error whose code contains INVALID',
    );
  });
}

const INVALID_EXTRACTION_READ_CASES = [
  { name: 'missing extraction row', db: { extractionRow: null } },
  { name: 'errored extraction read', db: { extractionError: { message: 'db unavailable' } } },
  { name: 'extraction row missing extracted_text', db: { extractionRow: { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, text_hash: TEXT_HASH } } },
  { name: 'extraction row with blank extracted_text', db: { extractionRow: { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, text_hash: TEXT_HASH, extracted_text: '   ' } } },
  { name: 'extraction row missing text_hash', db: { extractionRow: { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, extracted_text: EXTRACTED_TEXT } } },
  { name: 'extraction row with malformed text_hash', db: { extractionRow: { id: EXTRACTION_ID, document_version_id: DOCUMENT_VERSION_ID, text_hash: 'not-a-hash', extracted_text: EXTRACTED_TEXT } } },
  {
    name: 'extraction row whose id does not match member.extraction_id',
    db: { extractionRow: { id: 'bbbbbbbb-0000-0000-0000-000000000000', document_version_id: DOCUMENT_VERSION_ID, text_hash: TEXT_HASH, extracted_text: EXTRACTED_TEXT } },
  },
  {
    name: 'extraction row whose document_version_id does not match the requested documentVersionId',
    db: { extractionRow: { id: EXTRACTION_ID, document_version_id: 'cccccccc-0000-0000-0000-000000000000', text_hash: TEXT_HASH, extracted_text: EXTRACTED_TEXT } },
  },
];

for (const { name, db } of INVALID_EXTRACTION_READ_CASES) {
  test(`fails closed with a code containing INVALID when the extraction read is: ${name}`, async () => {
    const database = createGovernedDocumentDatabase({ versionRow: validVersionRow(), ...db });
    await assert.rejects(
      () => resolveAgt002GovernedDocumentForExecution(database, baseArgs()),
      isInvalidError,
      'a missing/errored/malformed/mismatched extraction row must throw a safe error whose code contains INVALID',
    );
  });
}

// ---------------------------------------------------------------------------
// Static wiring assertion: the reanalysis worker entrypoint must actually wire this resolver
// into createAgt002ReanalysisExecutor's governedDocumentResolver seam (see
// tests/agt002-governed-document-workset-execution.test.mjs for the executor-side contract),
// scoped by its own `database` client — not left unset, and not hand-rolled inline.
// ---------------------------------------------------------------------------
test('ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs imports resolveAgt002GovernedDocumentForExecution and wires it into createAgt002ReanalysisExecutor as governedDocumentResolver', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  const workerPath = path.join(ROOT, 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs');
  const source = readFileSync(workerPath, 'utf8');

  assert.match(
    source,
    /import\s*\{\s*resolveAgt002GovernedDocumentForExecution\s*\}\s*from\s*['"]\.\.\/\.\.\/agt002-governed-document-rehydration\.js['"]/,
    'the worker entrypoint must import resolveAgt002GovernedDocumentForExecution from ../../agt002-governed-document-rehydration.js',
  );
  assert.match(
    source,
    /governedDocumentResolver:\s*args\s*=>\s*resolveAgt002GovernedDocumentForExecution\(database,\s*args\)/,
    'the worker entrypoint must pass governedDocumentResolver: args => resolveAgt002GovernedDocumentForExecution(database, args) into createAgt002ReanalysisExecutor',
  );
});
