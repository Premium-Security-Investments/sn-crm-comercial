import { createHash } from 'node:crypto';

// Deterministic batch planner for AGT-002 V3 semantic discovery (tender-semantic-discovery.js).
//
// `sourcePacket` in tender-semantic-discovery.js used to fill ONE provider request up to a
// character budget, ordered by document_id, and silently OMIT everything past that budget: the
// first document in packet order could consume the whole budget and leave every later document
// unseen by the model in that discovery run. This module replaces that single greedy bag with a
// deterministic assignment of EVERY source unit to a batch — or an explicit, closed failure reason
// — BEFORE any provider call is made, so no unit is ever silently dropped and no single document
// can starve the others.
//
// The algorithm is round-major BY DOCUMENT: each round places at most one pending unit per document
// into the currently open batch, so a long document can never fill a batch before every other
// document has contributed its own next unit. A unit whose own text exceeds the per-batch budget
// closes the currently open batch (if it has content) and becomes its own singleton batch, in its
// deterministic packet position. A unit whose own text exceeds the absolute per-unit ceiling can
// never be sent to any provider at all and is reported in `ledger.failed_source_units` instead of
// being dropped silently; the caller is expected to complete it into the manifest as an explicit,
// visible gap.
//
// Pure: no Date, no Math.random, no localeCompare — only the caller's own packet order (already
// deterministic) and integer/string comparisons, so the same units always produce the same plan.

export const TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION = 'tender-semantic-discovery-batches.v1';
// A unit above this ceiling can never fit a single provider request no matter how the per-batch
// budget is configured; it is reported as a failed source unit instead of looping forever trying to
// place it.
export const TENDER_SEMANTIC_DISCOVERY_MAX_UNIT_CHARS = 200_000;
export const TENDER_SEMANTIC_DISCOVERY_BATCH_FAILURE_REASONS = Object.freeze(['source_unit_exceeds_unit_ceiling']);

function stableForHash(value) {
  if (Array.isArray(value)) return value.map(stableForHash);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableForHash(value[key])]));
  }
  return value;
}

function buildAssignmentLedger({ units, batches, failed, maxSourceCharsPerBatch }) {
  const documents = new Map();
  for (const unit of units) {
    if (!documents.has(unit.document_id)) {
      documents.set(unit.document_id, {
        document_id: unit.document_id,
        document_version_id: unit.document_version_id,
        source_unit_count: 0,
        batch_indexes: new Set(),
      });
    }
    documents.get(unit.document_id).source_unit_count += 1;
  }
  for (const batch of batches) {
    for (const unit of batch.units) {
      documents.get(unit.document_id).batch_indexes.add(batch.batch_index);
    }
  }
  return {
    planner_version: TENDER_SEMANTIC_DISCOVERY_BATCH_PLANNER_VERSION,
    max_source_chars_per_batch: maxSourceCharsPerBatch,
    total_source_units: units.length,
    assigned_source_units: batches.reduce((total, batch) => total + batch.units.length, 0),
    failed_source_units: failed,
    batch_count: batches.length,
    documents: [...documents.values()].map(entry => ({
      document_id: entry.document_id,
      document_version_id: entry.document_version_id,
      source_unit_count: entry.source_unit_count,
      batch_indexes: [...entry.batch_indexes].sort((left, right) => left - right),
    })),
    batches: batches.map(batch => ({
      batch_index: batch.batch_index,
      char_count: batch.char_count,
      source_unit_ids: batch.units.map(unit => unit.source_unit_id),
      oversized_singleton: batch.oversized_singleton,
    })),
  };
}

/**
 * Assigns every unit of `units` (already in the caller's own deterministic packet order) to a
 * batch, or to `ledger.failed_source_units`, before any provider call is made.
 *
 * @param {object} args
 * @param {Array} args.units Ordered source units: {source_unit_id, document_id, text, ...}.
 * @param {number} args.maxSourceCharsPerBatch Per-batch technical character budget.
 * @returns {{batches: Array<{batch_index:number, units:Array, char_count:number,
 *   oversized_singleton:boolean}>, ledger: object}}
 */
export function planTenderSemanticDiscoveryBatches({ units, maxSourceCharsPerBatch } = {}) {
  if (!Array.isArray(units)) {
    throw new Error('El planificador de lotes de descubrimiento semántico requiere la lista ordenada de unidades.');
  }
  if (!Number.isInteger(maxSourceCharsPerBatch) || maxSourceCharsPerBatch <= 0) {
    throw new Error('El planificador de lotes de descubrimiento semántico requiere un presupuesto entero positivo de caracteres por lote.');
  }

  const queues = new Map();
  for (const unit of units) {
    if (!queues.has(unit.document_id)) queues.set(unit.document_id, []);
    queues.get(unit.document_id).push(unit);
  }

  const failed = [];
  const batches = [];
  let open = null;
  const closeOpen = () => {
    if (open && open.units.length) batches.push(open);
    open = null;
  };
  const ensureOpen = () => {
    if (!open) open = { batch_index: batches.length, units: [], char_count: 0, oversized_singleton: false };
    return open;
  };

  let pending = units.length;
  while (pending > 0) {
    let progressed = false;
    for (const queue of queues.values()) {
      const unit = queue[0];
      if (unit === undefined) continue;
      const length = unit.text.length;
      if (length > TENDER_SEMANTIC_DISCOVERY_MAX_UNIT_CHARS) {
        queue.shift();
        pending -= 1;
        progressed = true;
        failed.push({ source_unit_id: unit.source_unit_id, reason: 'source_unit_exceeds_unit_ceiling' });
        continue;
      }
      if (length > maxSourceCharsPerBatch) {
        closeOpen();
        queue.shift();
        pending -= 1;
        progressed = true;
        batches.push({ batch_index: batches.length, units: [unit], char_count: length, oversized_singleton: true });
        continue;
      }
      const current = ensureOpen();
      if (current.char_count + length > maxSourceCharsPerBatch) continue;
      queue.shift();
      pending -= 1;
      progressed = true;
      current.units.push(unit);
      current.char_count += length;
    }
    // Nothing fit this round: the open batch (if any) is as full as it will get, so it closes and
    // every remaining pending unit — none of which exceeds the per-batch budget individually, or it
    // would already have been handled above as a singleton — is guaranteed to fit the next, empty
    // batch. This is what makes the loop terminate for any input.
    if (!progressed) closeOpen();
  }
  closeOpen();

  const assigned = batches.reduce((total, batch) => total + batch.units.length, 0);
  if (assigned + failed.length !== units.length) {
    throw new Error('El plan de lotes de descubrimiento semántico no cubre exactamente todas las source_units del expediente.');
  }

  return { batches, ledger: buildAssignmentLedger({ units, batches, failed, maxSourceCharsPerBatch }) };
}

/**
 * Stable identity of one planned batch: every field that determines what the model is actually
 * asked in that request. The array of `units` is hashed as an ARRAY (order preserved, not sorted),
 * so the batch's own deterministic packet order is part of its identity.
 */
export function computeTenderSemanticDiscoveryBatchHash({
  plannerVersion, policyVersion, snapshotHash, inventoryHash, batchIndex, units,
} = {}) {
  return createHash('sha256').update(JSON.stringify(stableForHash({
    planner_version: plannerVersion,
    policy_version: policyVersion,
    snapshot_hash: snapshotHash,
    inventory_hash: inventoryHash,
    batch_index: batchIndex,
    units: (units ?? []).map(unit => ({ source_unit_id: unit.source_unit_id, unit_hash: unit.unit_hash })),
  }))).digest('hex');
}

/**
 * Per-batch idempotency key, derived from the caller's own run key plus the batch's own stable
 * identity — so a run reserved under one contract is never silently reused for a different one, and
 * the same expediente always re-derives the same key for the same batch.
 */
export function tenderSemanticDiscoveryBatchIdempotencyKey({ idempotencyKey, batchIndex, batchHash } = {}) {
  return `${idempotencyKey}:semantic-discovery:${batchIndex}:${String(batchHash).slice(0, 16)}`;
}
