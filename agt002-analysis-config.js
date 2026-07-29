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

  return Object.freeze({ ...flags });
}
