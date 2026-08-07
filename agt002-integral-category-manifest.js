// Deterministic, traceable derivation of the AGT-002 integral v3 "category" (discard |
// habilitating | technical | financial_execution) for each governed requirement.
//
// The real requirement manifest (agt002-deep-analysis-matrix.js) only ever carries
// `front` in {legal, financial, technical}. Two of those have an honest, traceable 1:1
// correspondence to a v3 category: 'technical' means 'technical', and 'financial' — the
// existing financial-capacity-to-execute front — means 'financial_execution'. Neither
// 'discard' nor 'habilitating' has any real signal in that data today, and 'legal' front
// does not correspond unambiguously to either one. This module NEVER guesses: any
// requirement without a direct front mapping requires an explicit, human/product-curated
// override, or derivation fails closed rather than fabricating a category.
//
// Audit: docs/superpowers/specs/2026-08-06-agt002-integral-analysis-v3-audit.md (gap C-3).

const FRONT_CATEGORY_MAP = new Map([
  ['technical', 'technical'],
  ['financial', 'financial_execution'],
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

    const derived = FRONT_CATEGORY_MAP.get(entry?.front);
    if (!derived) {
      throw new Error(
        `AGT-002 integral category manifest: el requisito ${requirementId} (front "${entry?.front}") no tiene una categoría gobernada `
        + 'explícita ni una regla determinística trazable derivable de datos reales; se rechaza en lugar de fabricarla (fail-closed).',
      );
    }
    return { requirement_id: requirementId, category: derived };
  });
}
