import type { TenderDocumentAnalysis } from './types';

export type TenderRecommendationKind = 'advance' | 'advance_conditionally' | 'do_not_advance' | 'pause';

const NORMALIZED_RECOMMENDATION_KINDS = new Map<string, TenderRecommendationKind>([
  ['advance', 'advance'],
  ['go', 'advance'],
  ['go recomendado', 'advance'],
  ['avanzar', 'advance'],
  ['advance_conditionally', 'advance_conditionally'],
  ['avanzar_condicionado', 'advance_conditionally'],
  ['go condicionado', 'advance_conditionally'],
  ['avanzar condicionado', 'advance_conditionally'],
  ['do_not_advance', 'do_not_advance'],
  ['no_avanzar', 'do_not_advance'],
  ['no_go', 'do_not_advance'],
  ['no go', 'do_not_advance'],
  ['no go recomendado', 'do_not_advance'],
  ['no avanzar', 'do_not_advance'],
  ['pause', 'pause'],
  ['no_avanzar_temporalmente', 'pause'],
  ['no avanzar temporalmente', 'pause'],
  ['no go temporal / completar documentos', 'pause'],
  ['información insuficiente', 'pause'],
  ['informacion insuficiente', 'pause'],
]);

const RECOMMENDATION_LABELS: Record<TenderRecommendationKind, string> = {
  advance: 'Avanzar el flujo de evidencia',
  advance_conditionally: 'Avanzar de forma condicionada',
  do_not_advance: 'No avanzar el flujo de evidencia',
  pause: 'Información insuficiente',
};

const RECOMMENDATION_COPY: Record<TenderRecommendationKind, string> = {
  advance: 'La lectura no registra impedimentos materiales ni condiciones abiertas. La decisión humana permanece aparte.',
  advance_conditionally: 'Se puede continuar el flujo de evidencia; quedan condiciones o preparación a cargo de la encargada. No equivale a GO.',
  do_not_advance: 'Hay un impedimento material no subsanable en esta lectura. No equivale a NO GO; la encargada conserva la decisión.',
  pause: 'Falta evidencia para completar la lectura. No autoriza ni cierra el caso.',
};

export function tenderRecommendationKind(value: unknown): TenderRecommendationKind {
  return NORMALIZED_RECOMMENDATION_KINDS.get(String(value ?? '').trim().toLowerCase()) || 'pause';
}

export function tenderRecommendationLabel(value: unknown): string {
  return RECOMMENDATION_LABELS[tenderRecommendationKind(value)];
}

export function tenderRecommendationCopy(value: unknown): string {
  return RECOMMENDATION_COPY[tenderRecommendationKind(value)];
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
