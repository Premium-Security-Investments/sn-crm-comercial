import assert from 'node:assert/strict';
import {
  planTenderSemanticDiscoveryBatches,
  computeTenderSemanticDiscoveryBatchHash,
  tenderSemanticDiscoveryBatchIdempotencyKey,
} from '../tender-semantic-discovery-batches.js';

// AGT-002 V3 complete discovery — pure, deterministic unit tests of the batch planner and the
// per-batch identity helpers in tender-semantic-discovery-batches.js, independent of the
// provider-facing discoverTenderSemanticManifest wiring (see
// tests/tender-semantic-discovery-multibatch-regression.test.mjs for that integration). No Date, no
// Math.random, no network, no provider client: every fixture below is a plain object, so a failure
// here always points at the planner/hash/idempotency-key logic itself.
//
// The final case in this file is a CRITICAL RED against current production: the planner throws an
// arbitrary hard stop (`TENDER_SEMANTIC_DISCOVERY_MAX_BATCHES_HARD_STOP = 500`) instead of planning
// every batch a finite corpus actually needs. That cap is explicitly forbidden by the
// full-coverage-over-cost rule this whole v7 remediation exists to satisfy: a real expediente must
// never be truncated or stopped merely because it needed more than an arbitrary number of batches.

function makeUnit(documentId, index, text) {
  return {
    source_unit_id: `${documentId}-${index}`,
    document_id: documentId,
    document_version_id: `${documentId}-v1`,
    index,
    unit_hash: `hash-${documentId}-${index}`,
    text,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Fair round-major representation: a document with many pending units can never fill the first
//    batch before every other document has contributed its own next unit.
// ---------------------------------------------------------------------------------------------
{
  const units = [
    ...Array.from({ length: 10 }, (_, i) => makeUnit('doc-a', i, 'a')),
    makeUnit('doc-b', 0, 'b'),
    makeUnit('doc-c', 0, 'c'),
  ];
  const { batches } = planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch: 3 });
  const firstBatchDocuments = new Set(batches[0].units.map(unit => unit.document_id));
  assert.ok(firstBatchDocuments.has('doc-b'), 'doc-b must reach the first batch even though doc-a has ten pending units');
  assert.ok(firstBatchDocuments.has('doc-c'), 'doc-c must reach the first batch even though doc-a has ten pending units');
}

// ---------------------------------------------------------------------------------------------
// 2. Every unit is assigned exactly once across the whole plan: none lost, none duplicated.
// ---------------------------------------------------------------------------------------------
{
  const units = [
    ...Array.from({ length: 7 }, (_, i) => makeUnit('doc-a', i, 'aa')),
    ...Array.from({ length: 5 }, (_, i) => makeUnit('doc-b', i, 'b')),
    ...Array.from({ length: 3 }, (_, i) => makeUnit('doc-c', i, 'ccc')),
  ];
  const { batches, ledger } = planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch: 6 });
  const assignedIds = batches.flatMap(batch => batch.units.map(unit => unit.source_unit_id));
  assert.deepEqual(
    assignedIds.slice().sort(),
    units.map(unit => unit.source_unit_id).slice().sort(),
    'every source unit must appear in exactly one batch',
  );
  assert.equal(new Set(assignedIds).size, assignedIds.length, 'no source unit may be duplicated across batches');
  assert.equal(ledger.total_source_units, units.length);
  assert.equal(ledger.assigned_source_units, units.length);
  assert.equal(ledger.failed_source_units.length, 0);
}

// ---------------------------------------------------------------------------------------------
// 3. Repeated input produces an identical batch plan and ledger.
// ---------------------------------------------------------------------------------------------
{
  const units = [
    ...Array.from({ length: 9 }, (_, i) => makeUnit('doc-a', i, 'aa')),
    ...Array.from({ length: 4 }, (_, i) => makeUnit('doc-b', i, 'bbb')),
  ];
  const first = planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch: 5 });
  const second = planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch: 5 });
  const shape = plan => plan.batches.map(batch => ({
    batch_index: batch.batch_index,
    char_count: batch.char_count,
    oversized_singleton: batch.oversized_singleton,
    source_unit_ids: batch.units.map(unit => unit.source_unit_id),
  }));
  assert.deepEqual(shape(first), shape(second), 'the same input must produce the same batch plan on repeat');
  assert.deepEqual(first.ledger, second.ledger, 'the same input must produce the same ledger on repeat');
}

// ---------------------------------------------------------------------------------------------
// 4. Stable 64-char lowercase hex hash, sensitive to both batch index and unit order.
// ---------------------------------------------------------------------------------------------
{
  const base = { plannerVersion: 'planner-v1', policyVersion: 'policy-v1', snapshotHash: 'snap', inventoryHash: 'inv' };
  const unitsAB = [makeUnit('doc-a', 0, 'a'), makeUnit('doc-b', 0, 'b')];
  const unitsBA = [makeUnit('doc-b', 0, 'b'), makeUnit('doc-a', 0, 'a')];
  const hash0 = computeTenderSemanticDiscoveryBatchHash({ ...base, batchIndex: 0, units: unitsAB });
  const hash1 = computeTenderSemanticDiscoveryBatchHash({ ...base, batchIndex: 1, units: unitsAB });
  const hashReordered = computeTenderSemanticDiscoveryBatchHash({ ...base, batchIndex: 0, units: unitsBA });
  assert.match(hash0, /^[0-9a-f]{64}$/, 'the batch hash must be a stable 64-char lowercase hex digest');
  assert.notEqual(hash0, hash1, 'the hash must change when only the batch index changes');
  assert.notEqual(hash0, hashReordered, "the hash must change when the unit order changes, since a batch's own packet order is part of its identity");
  assert.equal(
    hash0,
    computeTenderSemanticDiscoveryBatchHash({ ...base, batchIndex: 0, units: unitsAB }),
    'the same input must re-derive the exact same hash',
  );
}

// ---------------------------------------------------------------------------------------------
// 5. The idempotency key is the base run key, the batch index, and a 16 lowercase hex char prefix
//    of the batch's own hash — never the whole-run key alone.
// ---------------------------------------------------------------------------------------------
{
  const batchHash = 'a1b2c3d4e5f60718' + 'ab'.repeat(24);
  assert.equal(batchHash.length, 64, 'fixture hash must look like a real sha256 hex digest');
  const key = tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey: 'run-1', batchIndex: 3, batchHash });
  assert.equal(key, 'run-1:semantic-discovery:3:a1b2c3d4e5f60718');
  assert.match(key, /^run-1:semantic-discovery:3:[0-9a-f]{16}$/);
}

// ---------------------------------------------------------------------------------------------
// 6. CRITICAL RED: no arbitrary batch-count cap may truncate or stop a finite corpus. A 501-unit
//    expediente that can only fit one character per batch must be allowed to produce 501 batches
//    and account for all 501 units, not be rejected merely because it crossed an arbitrary count.
//    Every fixture unit lives in the SAME document, on purpose, so the planner's own round-major
//    loop closes exactly one batch every two rounds (one unit fits, the next round finds nothing
//    else fits and closes) — O(n) rounds over a single queue, cheap in both memory and time.
//
//    Under current production this throws, because
//    TENDER_SEMANTIC_DISCOVERY_MAX_BATCHES_HARD_STOP = 500 rejects the 501st batch before the plan
//    is ever returned. That hard stop is the REAL deviation this file exists to pin as forbidden.
// ---------------------------------------------------------------------------------------------
{
  const UNIT_COUNT = 501;
  const units = Array.from({ length: UNIT_COUNT }, (_, i) => makeUnit('doc-single', i, 'x'));
  let result;
  assert.doesNotThrow(
    () => { result = planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch: 1 }); },
    'no arbitrary batch-count cap may truncate or stop a finite corpus: a 501-unit expediente at a '
    + 'one-char-per-batch budget must be allowed to produce 501 batches instead of throwing on an '
    + 'arbitrary hard stop',
  );
  assert.equal(
    result.batches.length,
    UNIT_COUNT,
    `a finite corpus of ${UNIT_COUNT} one-char units at a one-char-per-batch budget must produce exactly ${UNIT_COUNT} batches, not be capped short of full coverage`,
  );
  const allAssignedIds = result.batches.flatMap(batch => batch.units.map(unit => unit.source_unit_id)).sort();
  assert.deepEqual(
    allAssignedIds,
    units.map(unit => unit.source_unit_id).sort(),
    'every one of the 501 units must be accounted for across the batches, none lost to the cap',
  );
}

console.log('tests/tender-semantic-discovery-batching.test.mjs OK');
