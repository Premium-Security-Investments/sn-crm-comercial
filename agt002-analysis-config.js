// Fail-closed feature flags for the AGT-002 / Vig-IA analysis improvement
// program. Every flag defaults to false; only the literals 'true' and '1'
// (case-insensitive) enable a flag. Anything else, including unset or
// malformed values, stays off.
export const ANALYSIS_FLAG_NAMES = Object.freeze([
  'TENDER_IMMEDIATE_DISPATCH',
  'TENDER_CONTINUOUS_DRAIN',
  'AGT002_CANONICAL_ONLY',
  'AGT002_CONTEXT_V2',
  'AGT002_DOCUMENT_RETRIEVAL',
  'AGT002_LEGAL_CORPUS',
  'AGT002_INTEGRAL_CONTRACT_V3',
]);

const TRUE_LITERALS = new Set(['true', '1']);

function parseAnalysisFlag(rawValue) {
  if (typeof rawValue !== 'string') return false;
  return TRUE_LITERALS.has(rawValue.trim().toLowerCase());
}

export function buildAgt002AnalysisConfig(environment = process.env) {
  const flags = {};
  for (const name of ANALYSIS_FLAG_NAMES) {
    flags[name] = parseAnalysisFlag(environment?.[name]);
  }

  // AGT002_DOCUMENT_RETRIEVAL and AGT002_LEGAL_CORPUS both depend on the
  // structured context v2 contract (opportunity/company/evidence sections);
  // without it there is no closed schema for them to populate, so enabling
  // either alone is a contradictory configuration and must fail loudly
  // instead of silently degrading.
  if (flags.AGT002_DOCUMENT_RETRIEVAL && !flags.AGT002_CONTEXT_V2) {
    throw new Error('agt002-analysis-config: AGT002_DOCUMENT_RETRIEVAL requires AGT002_CONTEXT_V2 to be enabled.');
  }
  if (flags.AGT002_LEGAL_CORPUS && !flags.AGT002_CONTEXT_V2) {
    throw new Error('agt002-analysis-config: AGT002_LEGAL_CORPUS requires AGT002_CONTEXT_V2 to be enabled.');
  }

  // AGT002_INTEGRAL_CONTRACT_V3 assembles a governed envelope (ordered requirement
  // manifest, five independent evidence axes, deterministic v2 projection) that only
  // exists when the canonical-only run model, the structured context v2 contract and
  // bounded document retrieval are all active; enabling it alone would have no
  // governed input to validate against, so it fails closed instead of silently
  // degrading to an unvalidated shape. Legal-corpus absence is deliberately NOT a
  // dependency here: v3 must still be able to run without a published legal corpus,
  // forcing legal abstention/human review per unit instead of blocking the whole
  // contract at the config layer.
  if (
    flags.AGT002_INTEGRAL_CONTRACT_V3
    && !(flags.AGT002_CANONICAL_ONLY && flags.AGT002_CONTEXT_V2 && flags.AGT002_DOCUMENT_RETRIEVAL)
  ) {
    throw new Error(
      'agt002-analysis-config: AGT002_INTEGRAL_CONTRACT_V3 requires AGT002_CANONICAL_ONLY, AGT002_CONTEXT_V2 and AGT002_DOCUMENT_RETRIEVAL to be enabled.',
    );
  }

  return Object.freeze({ ...flags });
}
