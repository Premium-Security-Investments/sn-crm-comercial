import type { Agt002InitialAnalysisProjection } from './agt002InitialAnalysisProjection';

export const AGT002_INITIAL_ANALYSIS_POLL_INTERVAL_MS = 5_000;
export const AGT002_INITIAL_ANALYSIS_MAX_POLLS = 120;

export function classifyAgt002InitialAnalysisPoll(projection: Agt002InitialAnalysisProjection) {
  return Object.freeze({
    terminal: projection.state === 'ready' || projection.state === 'failed',
    shouldReloadReport: projection.state === 'ready' && projection.reportAvailable,
    tone: projection.state === 'failed' ? 'error' as const : 'status' as const,
  });
}
