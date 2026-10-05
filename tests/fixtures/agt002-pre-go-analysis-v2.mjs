// pre_go_analysis.v2 fixtures: the v1 baselines without the render manifest, stamped as v2.
import { buildBaselineScopeA, buildBaselineScopeAPlusB } from './agt002-pre-go-analysis-v1.mjs';

export function toPreGoV2(doc) {
  const out = structuredClone(doc);
  delete out.render_manifest;
  out.meta.schema_version = 'pre_go_analysis.v2';
  return out;
}

export function buildInitialScopeAV2(overrides = {}) {
  return toPreGoV2(buildBaselineScopeA(overrides));
}

export function buildInitialScopeAPlusBV2(overrides = {}) {
  return toPreGoV2(buildBaselineScopeAPlusB(overrides));
}

// --- builder inputs: the model-authored analytical sections and the frozen package, derived from a v1/v2 baseline ---

const ANALYSIS_KEYS = ['process_analysis', 'requirements', 'findings', 'contradictions', 'coverage', 'recommendation', 'open_items'];

/** The sections the MODEL writes (sources as {document_id, locator}), taken from a baseline envelope. */
export function analysisFromBaseline(baseline, documentIds) {
  const pick = index => documentIds[index % documentIds.length];
  let counter = 0;
  const claims = baseline.claims.map(claim => {
    const { created_by: _createdBy, created_at: _createdAt, decision_ref: _decisionRef, ...rest } = structuredClone(claim);
    return {
      ...rest,
      source_refs: claim.source_refs.map(ref => ({ document_id: pick(counter++), locator: ref.locator })),
    };
  });
  const analysis = { claims, process_deadlines: structuredClone(baseline.meta.process_deadlines) };
  for (const key of ANALYSIS_KEYS) analysis[key] = structuredClone(baseline[key]);
  return analysis;
}

/** A frozen-package stub (version row + member rows) whose members are exactly the given documents. */
export function packageForDocuments(documents, { packageHash, createdAt = '2026-08-25T00:00:00Z', batchIndexOf = () => 0 } = {}) {
  return {
    version: {
      id: '20000000-0000-4000-8000-000000000002', package_id: '20000000-0000-4000-8000-000000000003',
      package_hash: packageHash, document_manifest_hash: 'd'.repeat(64), semantic_manifest_hash: 'e'.repeat(64),
      member_count: documents.length, batch_count: new Set(documents.map((_, index) => batchIndexOf(index))).size,
      created_at: createdAt,
    },
    members: documents.map((document, index) => ({
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      document_version_id: document.id, batch_index: batchIndexOf(index),
      source_classification: document.classification ?? 'official', inclusion_reason: 'Fixture',
      content_hash: document.contentHash ?? 'a'.repeat(64), extraction_text_hash: document.extractionHash ?? 'b'.repeat(64),
    })),
  };
}
