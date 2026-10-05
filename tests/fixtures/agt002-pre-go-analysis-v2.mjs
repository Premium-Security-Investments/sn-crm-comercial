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
