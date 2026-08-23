import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agt002ImportItemGapReason,
  loadAgt002TenderRequirementDocumentGaps,
} from '../agt002-tender-requirement-gaps.js';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';

function fakeDatabase({ snapshotJob = null, gaps = [], jobError = null, gapError = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const operations = [];
      calls.push({ table, operations });
      const query = {
        select(value) { operations.push(['select', value]); return this; },
        eq(column, value) { operations.push(['eq', column, value]); return this; },
        order(column, options) { operations.push(['order', column, options]); return this; },
        limit(value) { operations.push(['limit', value]); return this; },
        async maybeSingle() { return { data: snapshotJob, error: jobError }; },
        then(resolve, reject) {
          return Promise.resolve({ data: gaps, error: gapError }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

// Only 'imported' and 'unchanged' mean the source document really reached the snapshot.
test('every non-success import state is an unresolved gap, not just failed_terminal', async () => {
  const database = fakeDatabase({ gaps: [
    { source_document_id: 'doc-imported', name: 'Pliego', status: 'imported' },
    { source_document_id: 'doc-unchanged', name: 'Anexo estable', status: 'unchanged' },
    { source_document_id: 'doc-pending', name: 'Adenda encolada', status: 'pending' },
    { source_document_id: 'doc-processing', name: 'Adenda en curso', status: 'processing' },
    { source_document_id: 'doc-retryable', name: 'Anexo reintentable', status: 'failed_retryable' },
    { source_document_id: ' doc-failed ', name: ' Anexo ilegible ', status: 'failed_terminal' },
  ] });

  const result = await loadAgt002TenderRequirementDocumentGaps(database, {
    snapshotId: 'snapshot-ignored',
    jobId: ' job-current ',
  });

  // Output is sorted by (document_id, reason, name) so dedup never depends on unspecified
  // database row order — this is not insertion order.
  assert.deepEqual(result, [
    { document_id: 'doc-failed', name: 'Anexo ilegible', document_type: null, reason: 'failed_terminal' },
    { document_id: 'doc-pending', name: 'Adenda encolada', document_type: null, reason: 'pending' },
    { document_id: 'doc-processing', name: 'Adenda en curso', document_type: null, reason: 'processing' },
    { document_id: 'doc-retryable', name: 'Anexo reintentable', document_type: null, reason: 'failed_retryable' },
  ]);
});

// The status column is read, never used as a SQL equality filter: an `.eq`/`.in` predicate
// would drop exactly the NULL/unknown rows that must fail closed.
test('the loader reads id/status for the job and never filters resolution in SQL', async () => {
  const database = fakeDatabase({ gaps: [] });
  await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' });

  assert.deepEqual(database.calls.map(call => call.table), ['psi_tender_document_import_items']);
  assert.deepEqual(database.calls[0].operations, [
    ['select', 'id,source_document_id,name,status'],
    ['eq', 'job_id', 'job-current'],
  ]);
});

test('an unknown, empty or missing import state fails closed as an unresolved gap', async () => {
  const database = fakeDatabase({ gaps: [
    { source_document_id: 'doc-null', name: 'Sin estado' },
    { source_document_id: 'doc-empty', name: 'Estado vacío', status: '   ' },
    { source_document_id: 'doc-future', name: 'Estado futuro', status: 'quarantined' },
    { source_document_id: 'doc-cased', name: 'Éxito con mayúsculas', status: 'IMPORTED' },
  ] });

  const result = await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' });

  assert.deepEqual(result.map(gap => [gap.document_id, gap.reason]), [
    ['doc-cased', 'unknown_import_state'],
    ['doc-empty', 'unknown_import_state'],
    ['doc-future', 'unknown_import_state'],
    // Success is recognized only by the exact governed literal; anything else stays a gap.
    ['doc-null', 'unknown_import_state'],
  ]);
});

test('the reason classifier is exact: only imported/unchanged resolve', () => {
  assert.equal(agt002ImportItemGapReason('imported'), null);
  assert.equal(agt002ImportItemGapReason(' unchanged '), null);
  for (const state of ['pending', 'processing', 'failed_retryable', 'failed_terminal']) {
    assert.equal(agt002ImportItemGapReason(state), state);
  }
  for (const state of [null, undefined, '', 'done', 'ok', 0, {}]) {
    assert.equal(agt002ImportItemGapReason(state), 'unknown_import_state');
  }
});

// A missing source_document_id must never make an unresolved item disappear from the
// inventory (that would silently let expedient_coverage go 'complete'). It also must never
// be papered over with an invented document identity that could pass as a real citation.
test('a row without a source_document_id still becomes a gap, keyed by its own durable row id', async () => {
  const database = fakeDatabase({ gaps: [
    { id: 'item-42', source_document_id: ' ', name: 'row without durable document id', status: 'failed_terminal' },
  ] });
  assert.deepEqual(await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' }), [
    {
      document_id: 'agt002-missing-source-document:item-42',
      name: 'row without durable document id',
      document_type: null,
      reason: 'failed_terminal',
    },
  ]);
});

test('a row missing both source_document_id and its own row id falls back to a fixed placeholder, never a fabricated one', async () => {
  const database = fakeDatabase({ gaps: [
    { source_document_id: '', name: null, status: 'pending' },
  ] });
  assert.deepEqual(await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' }), [
    { document_id: 'agt002-missing-source-document:unknown', name: null, document_type: null, reason: 'pending' },
  ]);
});

test('two job items resolving to the identical (document_id, reason) pair are deduped deterministically', async () => {
  const database = fakeDatabase({ gaps: [
    { id: 'item-1', source_document_id: 'doc-dup', name: 'Zeta', status: 'failed_terminal' },
    { id: 'item-2', source_document_id: 'doc-dup', name: 'Alpha', status: 'failed_terminal' },
  ] });
  // Deterministic tie-break (sorted by document_id, reason, then name) — never "whichever row
  // the database happened to return first".
  assert.deepEqual(await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' }), [
    { document_id: 'doc-dup', name: 'Alpha', document_type: null, reason: 'failed_terminal' },
  ]);
});

test('two job items with the same document_id but distinct reasons are both kept', async () => {
  const database = fakeDatabase({ gaps: [
    { id: 'item-1', source_document_id: 'doc-multi', name: 'Vía A', status: 'pending' },
    { id: 'item-2', source_document_id: 'doc-multi', name: 'Vía B', status: 'failed_terminal' },
  ] });
  const result = await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' });
  assert.deepEqual(result.map(gap => [gap.document_id, gap.reason]), [
    ['doc-multi', 'failed_terminal'],
    ['doc-multi', 'pending'],
  ]);
});

test('a failed gap query throws instead of silently reporting no gaps', async () => {
  const database = fakeDatabase({ gapError: new Error('import_items query failed') });
  await assert.rejects(
    loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' }),
    /import_items query failed/,
  );
});

test('a failed job-resolution query throws instead of silently reporting no gaps', async () => {
  const database = fakeDatabase({ jobError: new Error('processing_jobs query failed') });
  await assert.rejects(
    loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: 'snapshot-1' }),
    /processing_jobs query failed/,
  );
});

// End-to-end proof: an unresolved import item, once turned into a gap by the loader, is
// enough on its own to keep expedient_coverage.status out of 'complete' — the whole point
// of this loader existing.
test('an unresolved import gap prevents expedient_coverage from reaching complete', async () => {
  const database = fakeDatabase({ gaps: [
    { id: 'item-1', source_document_id: 'doc-stuck', name: 'Adenda sin resolver', status: 'processing' },
  ] });
  const documentGaps = await loadAgt002TenderRequirementDocumentGaps(database, { jobId: 'job-current' });

  const inventory = buildTenderRequirementInventory({ snapshotId: 'snapshot-1', documents: [], documentGaps });

  assert.notEqual(inventory.expedient_coverage.status, 'complete');
  assert.equal(inventory.expedient_coverage.status, 'partial');
  assert.equal(
    inventory.source_units.some(unit => unit.document_id === 'doc-stuck' && unit.disposition === 'unresolved_visible' && unit.reason === 'processing'),
    true,
  );
});

test('reanálisis resolves the newest processing job by immutable snapshot before loading gaps', async () => {
  const database = fakeDatabase({
    snapshotJob: { id: 'job-for-snapshot' },
    gaps: [{ source_document_id: 'doc-gap', name: null, status: 'failed_terminal' }],
  });
  const result = await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: ' snapshot-1 ' });

  assert.equal(result[0].document_id, 'doc-gap');
  assert.deepEqual(database.calls.map(call => call.table), [
    'psi_tender_processing_jobs',
    'psi_tender_document_import_items',
  ]);
  assert.deepEqual(database.calls[0].operations, [
    ['select', 'id'],
    ['eq', 'snapshot_id', 'snapshot-1'],
    ['order', 'created_at', { ascending: false }],
    ['limit', 1],
  ]);
  assert.deepEqual(database.calls[1].operations.slice(1), [
    ['eq', 'job_id', 'job-for-snapshot'],
  ]);
});

test('a snapshot with no originating processing job has no durable import gaps', async () => {
  const database = fakeDatabase({ snapshotJob: null });
  assert.deepEqual(await loadAgt002TenderRequirementDocumentGaps(database, { snapshotId: 'snapshot-manual' }), []);
  assert.equal(database.calls.length, 1);
});
