import { buildGovernedRequirementAnalysis, buildRequirementAnalysis } from './tender-requirement-extraction.js';

export function buildTenderDeepAnalysis(documents, companyProfile = {}, { governedRequirements = false } = {}) {
  const analysis = governedRequirements
    ? buildGovernedRequirementAnalysis(documents, companyProfile)
    : buildRequirementAnalysis(documents, companyProfile);
  return {
    version: '1.0',
    matrix: {
      legal: analysis.legal,
      financial: analysis.financial,
      technical: analysis.technical,
    },
    coverage: analysis.coverage,
    strengths: analysis.strengths,
    weaknesses: analysis.weaknesses,
    blockers: analysis.blockers,
    questions: analysis.questions,
    unverified: analysis.unverified,
    unverifiable_documents: analysis.unverifiable_documents,
    next_action: analysis.next_action,
  };
}
