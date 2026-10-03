export type Agt002InitialAnalysisUiState = 'pending' | 'running' | 'ready' | 'failed';

export type Agt002InitialAnalysisProjection = {
  state: Agt002InitialAnalysisUiState;
  jobId: string | null;
  runId: string | null;
  errorCode: string | null;
  reportAvailable: boolean;
  humanDecisionRequired: boolean;
  action: { allowed: boolean; blockingCode: string | null; message: string };
};

const STATES = new Set<Agt002InitialAnalysisUiState>(['pending', 'running', 'ready', 'failed']);

/** Validates the server-owned projection; the browser never reconstructs it from result JSON. */
export function parseAgt002InitialAnalysisProjection(value: unknown): Agt002InitialAnalysisProjection {
  const item = value as Partial<Agt002InitialAnalysisProjection> | null;
  if (!item || !STATES.has(item.state as Agt002InitialAnalysisUiState)
      || typeof item.reportAvailable !== 'boolean'
      || typeof item.humanDecisionRequired !== 'boolean'
      || !item.action || typeof item.action.allowed !== 'boolean'
      || typeof item.action.message !== 'string') {
    throw new Error('El servidor devolvió un estado INITIAL no válido.');
  }
  if (item.state === 'ready' && (!item.reportAvailable || !item.runId || !item.humanDecisionRequired)) {
    throw new Error('El estado INITIAL listo no tiene una corrida canónica verificable.');
  }
  if (item.state !== 'ready' && item.reportAvailable) {
    throw new Error('Un estado INITIAL no listo no puede anunciar un reporte.');
  }
  return item as Agt002InitialAnalysisProjection;
}

export function agt002InitialAnalysisStateLabel(state: Agt002InitialAnalysisUiState): string {
  return ({ pending: 'Pendiente', running: 'Corriendo', ready: 'Listo', failed: 'Fallido' })[state];
}
