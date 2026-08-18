import type { TenderDocumentAnalysis } from './types';

const NORMALIZED_RECOMMENDATIONS = new Map<string, string>([
  ['advance', 'GO recomendado'],
  ['go', 'GO recomendado'],
  ['go recomendado', 'GO recomendado'],
  ['avanzar', 'GO recomendado'],
  ['advance_conditionally', 'Avanzar de forma condicionada'],
  ['avanzar_condicionado', 'Avanzar de forma condicionada'],
  ['go condicionado', 'Avanzar de forma condicionada'],
  ['avanzar condicionado', 'Avanzar de forma condicionada'],
  ['do_not_advance', 'NO GO recomendado'],
  ['no_avanzar', 'NO GO recomendado'],
  ['no_go', 'NO GO recomendado'],
  ['no go', 'NO GO recomendado'],
  ['no go recomendado', 'NO GO recomendado'],
  ['no avanzar', 'NO GO recomendado'],
  ['pause', 'Información insuficiente'],
  ['no_avanzar_temporalmente', 'Información insuficiente'],
  ['no avanzar temporalmente', 'Información insuficiente'],
  ['no go temporal / completar documentos', 'Información insuficiente'],
  ['información insuficiente', 'Información insuficiente'],
  ['informacion insuficiente', 'Información insuficiente'],
]);

export function tenderRecommendationLabel(value: unknown): string {
  return NORMALIZED_RECOMMENDATIONS.get(String(value ?? '').trim().toLowerCase()) || 'Información insuficiente';
}

export function tenderExecutiveRecommendation(analysis: TenderDocumentAnalysis | null | undefined): unknown {
  return analysis?.decision_review?.recommendation ?? analysis?.recommendation;
}

export function tenderExecutiveProjectionAvailable(analysis: TenderDocumentAnalysis | null | undefined): boolean {
  const hasIntegralV3 = Boolean(analysis?.integral_analysis?.analysis_units?.length);
  return !hasIntegralV3 || Boolean(analysis?.decision_review);
}

export function tenderExecutiveOpenIssueCount(analysis: TenderDocumentAnalysis | null | undefined): number {
  const review = analysis?.decision_review;
  if (review) return Number(review.counts?.blockers || 0) + Number(review.counts?.decision_questions || 0);
  if (!tenderExecutiveProjectionAvailable(analysis)) return 0;
  return Number(analysis?.critical_open_count || 0);
}

export function tenderDecisionGate(_analysis: TenderDocumentAnalysis | null | undefined): { canGo: boolean; canNoGo: boolean } {
  return { canGo: true, canNoGo: true };
}
