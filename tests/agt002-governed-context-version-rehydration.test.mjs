import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAgt002GovernedContextVersionForExecution } from '../agt002-governed-context-version-rehydration.js';

// RED slice: the AGT-002 context v2 fail-closed rehydration seam (agt002-reanalysis-executor.js,
// see tests/agt002-reanalysis-executor.test.mjs "AGT-002 context v2 fail-closed rehydration")
// already accepts an injected `governedContextVersionResolver` seam and validates whatever it
// returns byte-for-byte against the job's own immutable identity — but no real resolver exists
// yet. This file specifies the actual production resolver: it must read EXACTLY the one
// immutable psi_agt002_context_versions row this job's contextVersionId identifies — by primary
// key plus opportunity/tender/snapshot scope, never by ordering or "latest" — and map it onto the
// shape the executor cross-checks (the full context jsonb blob plus its own content_hash).

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableSort(value[key])]));
  }
  return value;
}

function sha256HexStable(value) {
  return createHash('sha256').update(JSON.stringify(stableSort(value))).digest('hex');
}

const OPPORTUNITY_ID = '11111111-1111-1111-1111-111111111111';
const TENDER_ID = '22222222-2222-2222-2222-222222222222';
const SNAPSHOT_ID = '33333333-3333-3333-3333-333333333333';
const CONTEXT_VERSION_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_OPPORTUNITY_ID = '88888888-8888-8888-8888-888888888888';
const OTHER_TENDER_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_SNAPSHOT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function baseArgs(overrides = {}) {
  return { contextVersionId: CONTEXT_VERSION_ID, opportunityId: OPPORTUNITY_ID, tenderId: TENDER_ID, snapshotId: SNAPSHOT_ID, ...overrides };
}

// A realistic buildAgt002ContextV2 output shape (agt002-context-v2.js) — only shallow shape
// matters here; deep per-field schema is that module's own concern, never re-validated by the
// resolver or by the executor's own cross-check.
function validContextBlob() {
  return {
    context_version: 2,
    snapshot_id: SNAPSHOT_ID,
    opportunity: { opportunity_id: { status: 'verified', value: OPPORTUNITY_ID, source: { type: 'database', reference: 'psi_sales_opportunities', observed_at: '2026-08-01T00:00:00.000Z' } } },
    company_dossier: { legal_name: { status: 'not_verified', value: null, source: { type: 'database', reference: 'psi_company_profile', observed_at: '2026-08-01T00:00:00.000Z' } } },
    commercial_context: { opportunity_status: { status: 'not_verified', value: null, source: { type: 'database', reference: 'psi_sales_opportunities', observed_at: '2026-08-01T00:00:00.000Z' } } },
    human_evidence: [],
  };
}

function validVersionRow() {
  const context = validContextBlob();
  return {
    id: CONTEXT_VERSION_ID,
    opportunity_id: OPPORTUNITY_ID,
    tender_id: TENDER_ID,
    snapshot_id: SNAPSHOT_ID,
    context_version: 2,
    context,
    context_hash: sha256HexStable(context),
  };
}

// A fake Supabase-style query builder. Deliberately exposes ONLY select/eq/maybeSingle/single —
// no order/limit/in — so any production code that reaches for "latest" or a list read fails
// loudly with a TypeError instead of silently succeeding.
function createContextVersionDatabase({ row = null, error = null } = {}) {
  const calls = { version: null };
  return {
    calls,
    from(table) {
      if (table !== 'psi_agt002_context_versions') throw new Error(`unexpected table read: ${table}`);
      const call = { table, select: null, eq: [], terminal: null };
      calls.version = call;
      const builder = {
        select(columns) { call.select = columns; return builder; },
        eq(column, value) { call.eq.push([column, value]); return builder; },
        async maybeSingle() { call.terminal = 'maybeSingle'; return { data: row, error }; },
        async single() { call.terminal = 'single'; return { data: row, error }; },
      };
      return builder;
    },
  };
}

function eqObject(call) {
  assert.ok(call, 'expected a recorded query call');
  return Object.fromEntries(call.eq.map(([column, value]) => [column, value]));
}

test('reads the exact context version row by primary key plus opportunity/tender/snapshot scope, never by ordering or a list read', async () => {
  const row = validVersionRow();
  const database = createContextVersionDatabase({ row });
  const result = await resolveAgt002GovernedContextVersionForExecution({ database, ...baseArgs() });

  assert.equal(database.calls.version.table, 'psi_agt002_context_versions');
  assert.deepEqual(
    eqObject(database.calls.version),
    { id: CONTEXT_VERSION_ID, opportunity_id: OPPORTUNITY_ID, tender_id: TENDER_ID, snapshot_id: SNAPSHOT_ID },
    'the read must be constrained by exactly id (contextVersionId) + opportunity_id + tender_id + snapshot_id',
  );
  assert.notEqual(database.calls.version.terminal, null, 'the read must terminate in a single-row fetch (single/maybeSingle), never a list');

  assert.equal(result.opportunity_id, OPPORTUNITY_ID);
  assert.equal(result.tender_id, TENDER_ID);
  assert.equal(result.snapshot_id, SNAPSHOT_ID);
  assert.deepEqual(result.context, row.context, 'the full context jsonb blob must be returned verbatim');
  assert.equal(result.content_hash, row.context_hash, 'the row\'s own content hash must be forwarded verbatim, under the executor-facing name content_hash');
});

function isInvalidError(error) {
  return error instanceof Error && typeof error.code === 'string' && error.code.includes('INVALID');
}

const INVALID_CASES = [
  { name: 'missing row', row: null },
  { name: 'row whose id does not match the requested contextVersionId', row: { ...validVersionRow(), id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' } },
  { name: 'row whose opportunity_id does not match the requested opportunityId', row: { ...validVersionRow(), opportunity_id: OTHER_OPPORTUNITY_ID } },
  { name: 'row whose tender_id does not match the requested tenderId', row: { ...validVersionRow(), tender_id: OTHER_TENDER_ID } },
  { name: 'row whose snapshot_id does not match the requested snapshotId', row: { ...validVersionRow(), snapshot_id: OTHER_SNAPSHOT_ID } },
  { name: 'row missing context', row: { ...validVersionRow(), context: null } },
  { name: 'row missing context_hash', row: (() => { const { context_hash, ...rest } = validVersionRow(); return rest; })() },
  { name: 'row with non-string context_hash', row: { ...validVersionRow(), context_hash: 12345 } },
];

for (const { name, row } of INVALID_CASES) {
  test(`fails closed with a code containing INVALID when the context version read is: ${name}`, async () => {
    const database = createContextVersionDatabase({ row });
    await assert.rejects(
      () => resolveAgt002GovernedContextVersionForExecution({ database, ...baseArgs() }),
      isInvalidError,
      'a missing/malformed/mismatched context version row must throw a safe error whose code contains INVALID',
    );
  });
}

test('an errored context version read fails closed with a code containing INVALID', async () => {
  const database = createContextVersionDatabase({ error: { message: 'db unavailable' } });
  await assert.rejects(
    () => resolveAgt002GovernedContextVersionForExecution({ database, ...baseArgs() }),
    isInvalidError,
  );
});

// ---------------------------------------------------------------------------
// Static wiring assertion, mirroring tests/agt002-governed-document-rehydration.test.mjs: the
// reanalysis worker entrypoint must actually wire this resolver into
// createAgt002ReanalysisExecutor's governedContextVersionResolver seam (see
// tests/agt002-reanalysis-executor.test.mjs for the executor-side contract) — not left unset, and
// not hand-rolled inline.
// ---------------------------------------------------------------------------
test('ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs imports resolveAgt002GovernedContextVersionForExecution and wires it into createAgt002ReanalysisExecutor as governedContextVersionResolver', () => {
  const ROOT = new URL('..', import.meta.url).pathname;
  const workerPath = path.join(ROOT, 'ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs');
  const source = readFileSync(workerPath, 'utf8');

  assert.match(
    source,
    /import\s*\{\s*resolveAgt002GovernedContextVersionForExecution\s*\}\s*from\s*['"]\.\.\/\.\.\/agt002-governed-context-version-rehydration\.js['"]/,
    'the worker entrypoint must import resolveAgt002GovernedContextVersionForExecution from ../../agt002-governed-context-version-rehydration.js',
  );
  assert.match(
    source,
    /governedContextVersionResolver:\s*resolveAgt002GovernedContextVersionForExecution/,
    'the worker entrypoint must pass governedContextVersionResolver: resolveAgt002GovernedContextVersionForExecution into createAgt002ReanalysisExecutor',
  );
});
