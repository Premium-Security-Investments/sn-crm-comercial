import { strict as assert } from 'node:assert';
import { deriveAgt002IntegralCategoryManifest } from '../agt002-integral-category-manifest.js';

// ---------------------------------------------------------------------------
// The real AGT-002 requirement manifest only ever carries `front` ∈ {legal, financial,
// technical} (agt002-deep-analysis-matrix.js). The v3 contract's 5-category taxonomy
// (discard/habilitating/technical/financial_execution/strategic) has no direct source
// for discard/habilitating, and 'legal' front has no traceable 1:1 correspondence to any
// of them either. This module must NEVER guess: technical/financial front map by honest
// identity; everything else requires an explicit governed override or fails closed.
// ---------------------------------------------------------------------------

function run() {
  // technical/financial front map deterministically without any override.
  {
    const manifest = [
      { requirement_id: 'REQ-TECH', front: 'technical' },
      { requirement_id: 'REQ-FIN', front: 'financial' },
    ];
    const result = deriveAgt002IntegralCategoryManifest(manifest);
    assert.deepEqual(result, [
      { requirement_id: 'REQ-TECH', category: 'technical' },
      { requirement_id: 'REQ-FIN', category: 'financial_execution' },
    ]);
  }

  // Production regression: the raw generic manifest is alphabetic by requirement_id,
  // which can put financial before legal/technical. The governed category manifest must
  // establish the institutional order required by the v3 contract while preserving the
  // governed source order inside each category.
  {
    const manifest = [
      { requirement_id: 'financial-working-capital', front: 'financial' },
      { requirement_id: 'legal-collective-life-policy', front: 'legal' },
      { requirement_id: 'legal-rce-policy', front: 'legal' },
      { requirement_id: 'technical-cctv', front: 'technical' },
    ];
    assert.deepEqual(deriveAgt002IntegralCategoryManifest(manifest), [
      { requirement_id: 'legal-collective-life-policy', category: 'habilitating' },
      { requirement_id: 'legal-rce-policy', category: 'habilitating' },
      { requirement_id: 'technical-cctv', category: 'technical' },
      { requirement_id: 'financial-working-capital', category: 'financial_execution' },
    ]);
  }

  // The two closed legal-policy extractors only emit these stable ids after finding the
  // policy in an explicitly habilitating context. Their category is therefore deterministic
  // across tenders and does not depend on the Manizales pilot or an opportunity-scoped override.
  {
    const manifest = [
      { requirement_id: 'legal-rce-policy', front: 'legal' },
      { requirement_id: 'legal-collective-life-policy', front: 'legal' },
    ];
    assert.deepEqual(deriveAgt002IntegralCategoryManifest(manifest), [
      { requirement_id: 'legal-rce-policy', category: 'habilitating' },
      { requirement_id: 'legal-collective-life-policy', category: 'habilitating' },
    ]);
  }

  // Any other legal requirement remains ambiguous and fails closed without an explicit override.
  {
    const manifest = [{ requirement_id: 'REQ-LEGAL', front: 'legal' }];
    assert.throws(
      () => deriveAgt002IntegralCategoryManifest(manifest),
      /categoría gobernada|fail-closed|no tiene una categoría/i,
    );
  }

  // An explicit governed override resolves an otherwise-ambiguous legal requirement — either as a plain object or a Map.
  {
    const manifest = [{ requirement_id: 'REQ-LEGAL', front: 'legal' }];
    const resultObj = deriveAgt002IntegralCategoryManifest(manifest, { 'REQ-LEGAL': 'habilitating' });
    assert.deepEqual(resultObj, [{ requirement_id: 'REQ-LEGAL', category: 'habilitating' }]);
    const resultMap = deriveAgt002IntegralCategoryManifest(manifest, new Map([['REQ-LEGAL', 'discard']]));
    assert.deepEqual(resultMap, [{ requirement_id: 'REQ-LEGAL', category: 'discard' }]);
  }

  // An explicit governed override can also reclassify a technical/financial-front
  // requirement (e.g. a known disqualifying clause) — governance always wins over the
  // default identity mapping, but only when explicitly supplied, never inferred.
  {
    const manifest = [{ requirement_id: 'REQ-TECH', front: 'technical' }];
    const result = deriveAgt002IntegralCategoryManifest(manifest, { 'REQ-TECH': 'discard' });
    assert.deepEqual(result, [{ requirement_id: 'REQ-TECH', category: 'discard' }]);
  }

  // An invalid override category is rejected rather than silently accepted.
  {
    const manifest = [{ requirement_id: 'REQ-LEGAL', front: 'legal' }];
    assert.throws(
      () => deriveAgt002IntegralCategoryManifest(manifest, { 'REQ-LEGAL': 'strategic' }),
      /categoría gobernada inválida/i,
    );
  }

  // A requirement without a requirement_id is rejected.
  assert.throws(() => deriveAgt002IntegralCategoryManifest([{ front: 'technical' }]), /requirement_id/i);

  console.log('agt002-integral-category-manifest fail-closed derivation passed');
}

run();
