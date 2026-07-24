import type { TenderDocumentAnalysis } from './types';

export function tenderAnalysisMethodLabel(producer: TenderDocumentAnalysis['producer']) {
  return producer === 'AGT-002'
    ? 'Análisis AGT-002'
    : producer === 'HERMES-INTERIM'
      ? 'Análisis asistido por Hermes — transitorio'
      : 'Preanálisis por reglas SIIO';
}

export function tenderDecisionStatusTone(status: string | null | undefined): 'red' | 'green' | 'amber' {
  const normalizedStatus = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const unfavorable = new Set(['no_go', 'cerrada_no_go', 'no_adjudicada']);
  return unfavorable.has(normalizedStatus) ? 'red' : normalizedStatus === 'go' || normalizedStatus === 'adjudicada' ? 'green' : 'amber';
}

export function normalizeTenderEvidence(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap(item => {
    const text = typeof item === 'string'
      ? item
      : item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
        ? item.text
        : '';
    const normalized = text.trim();
    return normalized ? [normalized] : [];
  });
}
