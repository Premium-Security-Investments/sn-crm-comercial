import type { TenderDocumentAnalysis } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function tenderDecisionGate(analysis: TenderDocumentAnalysis | null | undefined): { canGo: boolean; canNoGo: boolean } {
  const canNoGo = Boolean(analysis?.run_id && UUID.test(analysis.run_id) && analysis?.status === 'completed' && analysis?.current === true);
  return { canGo: canNoGo && (analysis?.critical_open_count ?? 0) <= 0, canNoGo };
}