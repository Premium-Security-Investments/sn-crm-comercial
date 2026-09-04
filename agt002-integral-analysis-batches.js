// AGT-002 durable batched analysis — Task 4 (docs/plans/2026-09-03-agt002-durable-batched-analysis.md).
//
// Pure, deterministic planner/projector for splitting the governed integral-analysis requirement
// frontier into contiguous, exactly-once-covered batches that each fit the existing V3 prompt
// budget estimator (agt002-v3-prompt-budget.js). No I/O, no provider calls, no mutation of inputs.
//
// planAgt002IntegralAnalysisBatches(...) -> { plan, batches }
//   `plan` is safe, persistable metadata only (versions/ids/hashes/counts — never chunk text, never
//   the policy/prompt string, never a full requirement id array). `batches` is the ephemeral
//   in-memory assignment fed straight into projectAgt002IntegralAnalysisBatch.
//
// projectAgt002IntegralAnalysisBatch({ previewInput, batch }) -> previewInput-shaped object
//   Slices document_evidence to exactly one batch's requirement ids; every other previewInput
//   section is carried through untouched. Independently re-validates rather than trusting the plan.

import { createHash } from 'node:crypto';
import { AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION } from './agt002-integral-analysis-v3.js';
import { estimateAgt002V3RequestTokens } from './agt002-v3-prompt-budget.js';

export const AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION = 'agt002-integral-analysis-batch-planner-v1';

// Conservative initial cap per docs/plans/2026-09-03-agt002-durable-batched-analysis.md §5.
export const AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS = 20;

export const AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE = 'AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(message) {
  throw new Error(`AGT-002 integral analysis batches: ${message}`);
}

// Governed requirement id order/set, independently extracted from either the validationContext
// manifest or document_evidence.requirement_manifest — both must agree exactly (order and set).
function extractGovernedIds(manifest, label) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    fail(`${label} debe ser un arreglo no vacío.`);
  }
  const ids = [];
  const seen = new Set();
  for (const entry of manifest) {
    const id = entry?.requirement_id;
    if (typeof id !== 'string' || !id.trim()) fail(`${label} tiene un requirement_id inválido.`);
    if (seen.has(id)) fail(`${label} tiene un requirement_id duplicado: ${id}.`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// Shared, fail-closed shape/coverage validation for document_evidence material referenced by both
// the planner and the (independently re-validating) projector.
function validateDocumentEvidenceMaterial(documentEvidence, governedIds) {
  const governedIdSet = new Set(governedIds);

  if (!Array.isArray(documentEvidence.selected_chunks)) {
    fail('document_evidence.selected_chunks debe ser un arreglo.');
  }
  for (const chunk of documentEvidence.selected_chunks) {
    if (!isPlainObject(chunk) || !Array.isArray(chunk.requirement_ids)) {
      fail('un chunk de document_evidence.selected_chunks tiene requirement_ids inválido.');
    }
    for (const id of chunk.requirement_ids) {
      if (typeof id !== 'string' || !governedIdSet.has(id)) {
        fail('un chunk de document_evidence.selected_chunks referencia un requirement_id no gobernado.');
      }
    }
  }

  if (!Array.isArray(documentEvidence.citation_allowlist)) {
    fail('document_evidence.citation_allowlist debe ser un arreglo.');
  }

  const coverageManifest = documentEvidence.coverage_manifest;
  if (!isPlainObject(coverageManifest) || !Array.isArray(coverageManifest.by_requirement)) {
    fail('document_evidence.coverage_manifest.by_requirement debe ser un arreglo.');
  }
  const coverageByRequirement = new Map();
  for (const entry of coverageManifest.by_requirement) {
    if (!isPlainObject(entry) || !isNonEmptyString(entry.requirement_id)) {
      fail('una entrada de document_evidence.coverage_manifest.by_requirement es inválida.');
    }
    if (!governedIdSet.has(entry.requirement_id)) {
      fail(`document_evidence.coverage_manifest.by_requirement referencia un requirement_id no gobernado: ${entry.requirement_id}.`);
    }
    if (coverageByRequirement.has(entry.requirement_id)) {
      fail(`document_evidence.coverage_manifest.by_requirement tiene una entrada duplicada para ${entry.requirement_id}.`);
    }
    coverageByRequirement.set(entry.requirement_id, entry);
  }
  for (const id of governedIds) {
    if (!coverageByRequirement.has(id)) {
      fail(`document_evidence.coverage_manifest.by_requirement no cubre el requisito gobernado ${id}.`);
    }
  }

  if (!Array.isArray(documentEvidence.omitted_chunks)) {
    fail('document_evidence.omitted_chunks debe ser un arreglo.');
  }
  for (const entry of documentEvidence.omitted_chunks) {
    if (!isPlainObject(entry) || !Object.prototype.hasOwnProperty.call(entry, 'requirement_id')) {
      fail('una entrada de document_evidence.omitted_chunks es inválida.');
    }
    const { requirement_id: requirementId } = entry;
    if (requirementId !== null && !(isNonEmptyString(requirementId) && governedIdSet.has(requirementId))) {
      fail('una entrada de document_evidence.omitted_chunks tiene un requirement_id inválido.');
    }
  }

  return { coverageByRequirement };
}

export function computeAgt002IntegralAnalysisBatchHash({
  plannerVersion, contractVersion, requirementManifestVersion, snapshotHash, inventoryHash,
  model, maxInputTokens, maxRequirementsPerBatch, batchIndex, requirementIds,
}) {
  const canonical = JSON.stringify({
    plannerVersion, contractVersion, requirementManifestVersion, snapshotHash, inventoryHash,
    model, maxInputTokens, maxRequirementsPerBatch, batchIndex, requirementIds,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function projectAgt002IntegralAnalysisBatch({ previewInput, batch }) {
  if (!isPlainObject(previewInput) || !isPlainObject(previewInput.document_evidence)) {
    fail('previewInput.document_evidence debe ser un objeto.');
  }
  if (!isPlainObject(batch)) fail('batch debe ser un objeto.');

  const { batch_index: batchIndex, batch_count: batchCount, requirement_ids: requirementIds } = batch;
  if (!Number.isInteger(batchIndex) || batchIndex < 0) fail('batch.batch_index debe ser un entero no negativo.');
  if (!Number.isInteger(batchCount) || batchCount < 1) fail('batch.batch_count debe ser un entero positivo.');
  if (batchIndex >= batchCount) fail('batch.batch_index está fuera de rango para batch.batch_count.');
  if (!Array.isArray(requirementIds) || requirementIds.length === 0) {
    fail('batch.requirement_ids debe ser un arreglo no vacío.');
  }
  const requirementIdSet = new Set(requirementIds);
  if (requirementIdSet.size !== requirementIds.length) {
    fail('batch.requirement_ids tiene un requirement_id duplicado.');
  }

  const documentEvidence = previewInput.document_evidence;
  const governedIds = extractGovernedIds(documentEvidence.requirement_manifest, 'document_evidence.requirement_manifest');
  const governedIdSet = new Set(governedIds);
  for (const id of requirementIds) {
    if (!governedIdSet.has(id)) fail(`el requisito de batch "${id}" no está en el manifiesto gobernado.`);
  }

  const { coverageByRequirement } = validateDocumentEvidenceMaterial(documentEvidence, governedIds);

  const manifestById = new Map(documentEvidence.requirement_manifest.map(entry => [entry.requirement_id, entry]));
  const projectedManifest = requirementIds.map(id => manifestById.get(id));

  const retainedChunks = [];
  for (const chunk of documentEvidence.selected_chunks) {
    const intersected = chunk.requirement_ids.filter(id => requirementIdSet.has(id));
    if (intersected.length === 0) continue;
    retainedChunks.push({ ...chunk, requirement_ids: intersected });
  }

  const citationAllowlist = [...new Set(retainedChunks.map(chunk => chunk.evidence_ref))].sort();
  const projectedByRequirement = requirementIds.map(id => coverageByRequirement.get(id));

  const byDocumentMap = new Map();
  const byDocumentTypeMap = new Map();
  for (const chunk of retainedChunks) {
    const docEntry = byDocumentMap.get(chunk.document_id)
      || { document_id: chunk.document_id, document_type: chunk.document_type, chunks_available: 0, chunks_selected: 0 };
    docEntry.chunks_available += 1;
    docEntry.chunks_selected += 1;
    byDocumentMap.set(chunk.document_id, docEntry);

    const typeEntry = byDocumentTypeMap.get(chunk.document_type)
      || { document_type: chunk.document_type, chunks_available: 0, chunks_selected: 0 };
    typeEntry.chunks_available += 1;
    typeEntry.chunks_selected += 1;
    byDocumentTypeMap.set(chunk.document_type, typeEntry);
  }
  const byDocument = [...byDocumentMap.keys()].sort()
    .map(id => ({ ...byDocumentMap.get(id), gap: false, covered: byDocumentMap.get(id).chunks_selected > 0 }));
  const byDocumentType = [...byDocumentTypeMap.keys()].sort()
    .map(type => ({ ...byDocumentTypeMap.get(type), covered: byDocumentTypeMap.get(type).chunks_selected > 0 }));

  const omittedChunks = documentEvidence.omitted_chunks.filter(entry => (
    entry?.requirement_id === null || requirementIdSet.has(entry?.requirement_id)
  ));

  const projectedDocumentEvidence = {
    ...documentEvidence,
    selected_chunks: retainedChunks,
    citation_allowlist: citationAllowlist,
    coverage_manifest: { by_document: byDocument, by_document_type: byDocumentType, by_requirement: projectedByRequirement },
    omitted_chunks: omittedChunks,
    requirement_manifest: projectedManifest,
    integral_analysis_batch: { batch_index: batchIndex, batch_count: batchCount, requirement_ids: requirementIds },
  };

  return { ...previewInput, document_evidence: projectedDocumentEvidence };
}

export function planAgt002IntegralAnalysisBatches({
  previewInput, validationContext, model, policy, outputSchema, maxInputTokens, maxRequirementsPerBatch,
}) {
  if (!isPlainObject(previewInput) || !isPlainObject(previewInput.document_evidence)) {
    fail('previewInput.document_evidence debe ser un objeto.');
  }
  if (!isPlainObject(validationContext)) fail('validationContext debe ser un objeto.');
  if (!isNonEmptyString(model)) fail('model debe ser texto no vacío.');
  if (!isNonEmptyString(policy)) fail('policy debe ser texto no vacío.');
  if (!isPlainObject(outputSchema)) fail('outputSchema debe ser un objeto.');
  if (!Number.isInteger(maxInputTokens) || maxInputTokens <= 0) fail('maxInputTokens debe ser un entero positivo.');
  if (
    !Number.isInteger(maxRequirementsPerBatch)
    || maxRequirementsPerBatch <= 0
    || maxRequirementsPerBatch > AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS
  ) {
    fail(`maxRequirementsPerBatch debe ser un entero entre 1 y ${AGT002_INTEGRAL_ANALYSIS_BATCH_MAX_REQUIREMENTS}.`);
  }

  const documentEvidence = previewInput.document_evidence;

  if (!isNonEmptyString(validationContext.requirementManifestVersion)) {
    fail('validationContext.requirementManifestVersion debe ser texto no vacío.');
  }
  if (validationContext.requirementManifestVersion !== documentEvidence.requirement_manifest_version) {
    fail('document_evidence.requirement_manifest_version no coincide con validationContext.requirementManifestVersion.');
  }
  if (previewInput.snapshot_id !== documentEvidence.snapshot_id) {
    fail('previewInput.snapshot_id no coincide con document_evidence.snapshot_id.');
  }

  const contextIds = extractGovernedIds(validationContext.requirementManifest, 'validationContext.requirementManifest');
  const manifestIds = extractGovernedIds(documentEvidence.requirement_manifest, 'document_evidence.requirement_manifest');
  if (contextIds.length !== manifestIds.length || contextIds.some((id, index) => id !== manifestIds[index])) {
    fail('el orden/conjunto de document_evidence.requirement_manifest no coincide con validationContext.requirementManifest.');
  }
  const governedIds = contextIds;

  validateDocumentEvidenceMaterial(documentEvidence, governedIds);

  const inventory = documentEvidence.tender_requirement_inventory;
  if (!isPlainObject(inventory) || !isNonEmptyString(inventory.snapshot_hash) || !isNonEmptyString(inventory.inventory_hash)) {
    fail('document_evidence.tender_requirement_inventory.snapshot_hash/inventory_hash deben ser texto no vacío.');
  }

  // Candidate provisional sizing: an initial greedy pass packs up to maxRequirementsPerBatch
  // requirements per batch, shrinking a batch (never growing beyond the cap) until its provisional
  // { batch_index: 0, batch_count: 1 } single-batch projection fits maxInputTokens. This is only an
  // approximation — it never accounts for the real, larger batch_index/batch_count bytes a batch
  // will actually carry once every batch's true position/count is known — so no failure is raised
  // here; a size-1 slice is pushed even if its provisional trial still does not fit, and the
  // fixed-point pass below is the sole authority on whether a batch (or a lone requirement) truly
  // fits.
  const requirementIdBatches = [];
  {
    let cursor = 0;
    while (cursor < governedIds.length) {
      const remaining = governedIds.length - cursor;
      let size = Math.min(maxRequirementsPerBatch, remaining);
      let slice = governedIds.slice(cursor, cursor + size);
      while (size > 1) {
        const trialInput = projectAgt002IntegralAnalysisBatch({
          previewInput, batch: { batch_index: 0, batch_count: 1, requirement_ids: slice },
        });
        const trialEstimate = estimateAgt002V3RequestTokens({ model, policy, input: trialInput, outputSchema });
        if (trialEstimate <= maxInputTokens) break;
        size -= 1;
        slice = governedIds.slice(cursor, cursor + size);
      }
      requirementIdBatches.push(slice);
      cursor += slice.length;
    }
  }

  // Fixed-point repair pass: this is the sole authority on fit. It projects each batch with its
  // REAL contiguous batch_index and the REAL shared batch_count (the bytes actually persisted/sent,
  // never the provisional {0,1} candidate above), and estimates the complete request. If any real
  // final batch exceeds maxInputTokens, that batch alone is split contiguously in place — never
  // reordering, skipping, or duplicating ids — and every real index/count/estimate is recomputed
  // from scratch, since batch_count (and therefore every other batch's serialized bytes) changed.
  // This repeats until every batch fits. batch_count only ever grows across iterations, so a
  // singleton's real estimate can only stay the same or grow between iterations — an overflowing
  // singleton can never later start fitting on its own, so it fails closed immediately rather than
  // looping forever. Because each split strictly shrinks the offending batch and the number of
  // batches is bounded by the (finite) governed requirement count, this pass always terminates on
  // its own — no arbitrary retry cap is needed or applied.
  let idBatches = requirementIdBatches;
  for (;;) {
    const candidateBatchCount = idBatches.length;
    let overflowIndex = -1;
    let overflowEstimate = null;
    for (let index = 0; index < idBatches.length; index += 1) {
      const projectedInput = projectAgt002IntegralAnalysisBatch({
        previewInput, batch: { batch_index: index, batch_count: candidateBatchCount, requirement_ids: idBatches[index] },
      });
      const estimatedInputTokens = estimateAgt002V3RequestTokens({ model, policy, input: projectedInput, outputSchema });
      if (estimatedInputTokens > maxInputTokens) {
        overflowIndex = index;
        overflowEstimate = estimatedInputTokens;
        break;
      }
    }
    if (overflowIndex === -1) break;

    const overflowingIds = idBatches[overflowIndex];
    if (overflowingIds.length <= 1) {
      const error = new Error(
        'AGT-002 integral analysis batches: un único requisito excede el presupuesto de tokens de entrada '
        + 'incluso solo; se rechaza antes de cualquier llamada al proveedor.',
      );
      error.code = AGT002_INTEGRAL_ANALYSIS_BATCH_SINGLETON_TOO_LARGE_CODE;
      error.report = {
        requirement_id: overflowingIds[0], max_input_tokens: maxInputTokens, estimated_input_tokens: overflowEstimate,
      };
      throw error;
    }

    const splitPoint = Math.ceil(overflowingIds.length / 2);
    idBatches = [
      ...idBatches.slice(0, overflowIndex),
      overflowingIds.slice(0, splitPoint),
      overflowingIds.slice(splitPoint),
      ...idBatches.slice(overflowIndex + 1),
    ];
  }

  const batchCount = idBatches.length;
  const batches = idBatches.map((requirementIds, batchIndex) => ({
    batch_index: batchIndex, batch_count: batchCount, requirement_ids: requirementIds,
  }));

  const planBatches = batches.map((batch) => {
    const projectedInput = projectAgt002IntegralAnalysisBatch({ previewInput, batch });
    const estimatedInputTokens = estimateAgt002V3RequestTokens({ model, policy, input: projectedInput, outputSchema });
    const requestHash = computeAgt002IntegralAnalysisBatchHash({
      plannerVersion: AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION,
      contractVersion: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
      requirementManifestVersion: validationContext.requirementManifestVersion,
      snapshotHash: inventory.snapshot_hash,
      inventoryHash: inventory.inventory_hash,
      model,
      maxInputTokens,
      maxRequirementsPerBatch,
      batchIndex: batch.batch_index,
      requirementIds: batch.requirement_ids,
    });
    return {
      batch_index: batch.batch_index,
      batch_count: batch.batch_count,
      requirement_count: batch.requirement_ids.length,
      first_requirement_id: batch.requirement_ids[0],
      last_requirement_id: batch.requirement_ids[batch.requirement_ids.length - 1],
      request_hash: requestHash,
      estimated_input_tokens: estimatedInputTokens,
    };
  });

  const plan = {
    planner_version: AGT002_INTEGRAL_ANALYSIS_BATCH_PLANNER_VERSION,
    contract_version: AGT002_INTEGRAL_ANALYSIS_CONTRACT_VERSION,
    requirement_manifest_version: validationContext.requirementManifestVersion,
    snapshot_id: documentEvidence.snapshot_id,
    snapshot_hash: inventory.snapshot_hash,
    inventory_hash: inventory.inventory_hash,
    model,
    max_input_tokens: maxInputTokens,
    max_requirements_per_batch: maxRequirementsPerBatch,
    requirement_count: governedIds.length,
    batch_count: batchCount,
    batches: planBatches,
  };

  return { plan, batches };
}
