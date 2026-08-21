// Deterministic, traceable derivation of the AGT-002 integral v3 "category" (discard |
// habilitating | technical | financial_execution) for each governed requirement.
//
// The real requirement manifest (agt002-deep-analysis-matrix.js) carries `front` in
// {legal, financial, technical}. Technical and financial have direct mappings. Legal is
// ambiguous by default, except for the two stable policy ids emitted by the closed extractors
// in tender-requirement-extraction.js only when their source text is in habilitating context.
// Those two ids therefore have a global, process-independent mapping to `habilitating`; every
// other legal requirement still requires an explicit curated override and fails closed without
// one. Neither evidence presence nor a model claim can create a category here.
//
// Audit: docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md (gap C-3).

const FRONT_CATEGORY_MAP = new Map([
  ['technical', 'technical'],
  ['financial', 'financial_execution'],
]);

const CLOSED_REQUIREMENT_CATEGORY_MAP = new Map([
  ['legal-rce-policy', 'habilitating'],
  ['legal-collective-life-policy', 'habilitating'],
]);

const FORMAL_CATEGORIES = new Set(['discard', 'habilitating', 'technical', 'financial_execution']);

/**
 * `categoryOverrides`: an explicit, governed requirement_id -> category mapping (plain
 * object or Map), curated outside this function — never invented here. Required for any
 * requirement whose front has no direct mapping (front: 'legal'); optional otherwise,
 * where it can still override the default identity mapping when a requirement's real
 * institutional role differs from its front (e.g. a technical clause that is in fact a
 * disqualifying cause).
 */
export function deriveAgt002IntegralCategoryManifest(requirementManifest, categoryOverrides = {}) {
  if (!Array.isArray(requirementManifest)) {
    throw new Error('AGT-002 integral category manifest: requirementManifest debe ser un arreglo.');
  }
  const overrides = categoryOverrides instanceof Map ? categoryOverrides : new Map(Object.entries(categoryOverrides || {}));

  return requirementManifest.map(entry => {
    const requirementId = entry?.requirement_id;
    if (typeof requirementId !== 'string' || !requirementId.trim()) {
      throw new Error('AGT-002 integral category manifest: cada requisito necesita un requirement_id no vacío.');
    }

    if (overrides.has(requirementId)) {
      const overrideCategory = overrides.get(requirementId);
      if (!FORMAL_CATEGORIES.has(overrideCategory)) {
        throw new Error(`AGT-002 integral category manifest: categoría gobernada inválida para ${requirementId}: ${String(overrideCategory)}.`);
      }
      return { requirement_id: requirementId, category: overrideCategory };
    }

    const derived = CLOSED_REQUIREMENT_CATEGORY_MAP.get(requirementId)
      ?? FRONT_CATEGORY_MAP.get(entry?.front);
    if (!derived) {
      throw new Error(
        `AGT-002 integral category manifest: el requisito ${requirementId} (front "${entry?.front}") no tiene una categoría gobernada `
        + 'explícita ni una regla determinística trazable derivable de datos reales; se rechaza en lugar de fabricarla (fail-closed).',
      );
    }
    return { requirement_id: requirementId, category: derived };
  });
}
