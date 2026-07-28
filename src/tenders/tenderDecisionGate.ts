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

export function tenderDecisionGate(_analysis: TenderDocumentAnalysis | null | undefined): { canGo: boolean; canNoGo: boolean } {
  return { canGo: true, canNoGo: true };
}
