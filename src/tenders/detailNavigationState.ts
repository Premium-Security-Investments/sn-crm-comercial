import type { TenderDocumentAnalysis, TenderGoNoGoDecision } from './types';

export type TenderDetailSectionId =
  | 'tender-summary'
  | 'tender-document-review'
  | 'tender-analysis'
  | 'tender-decision'
  | 'tender-preparation'
  | 'tender-follow-up';

export type TenderIndicatorTone = 'ready' | 'attention' | 'error' | 'unknown';
export type TenderPanelState<T> =
  | { phase: 'loading' }
  | { phase: 'pending'; label: string }
  | { phase: 'ready'; value: T }
  | { phase: 'error'; message: string };

export type TenderDocumentNavigationValue = { currentDocumentCount: number; importError: boolean };
export type TenderPreparationNavigationValue = {
  preparationStatus: string | null;
  decision: 'go' | 'no_go' | null;
  humanPendingCount: number;
};
export type TenderFollowUpNavigationValue = {
  code: 'closed' | 'missing' | 'overdue' | 'today' | 'soon' | 'scheduled';
  label: string;
  detail: string;
};

export type TenderDetailStatusSnapshot = {
  documents: TenderPanelState<TenderDocumentNavigationValue>;
  analysis: TenderPanelState<TenderDocumentAnalysis | null>;
  decision: TenderPanelState<TenderGoNoGoDecision | null>;
  preparation: TenderPanelState<TenderPreparationNavigationValue>;
  followUp: TenderFollowUpNavigationValue;
};

export type TenderDetailIndicator = { tone: TenderIndicatorTone; label: string };

export const TENDER_DETAIL_SECTIONS: ReadonlyArray<{
  id: TenderDetailSectionId;
  label: string;
  accessibleLabel: string;
}> = [
  { id: 'tender-summary', label: 'Resumen', accessibleLabel: 'Resumen de la oportunidad' },
  { id: 'tender-document-review', label: 'Documentos', accessibleLabel: 'Revisión documental' },
  { id: 'tender-analysis', label: 'Análisis', accessibleLabel: 'Análisis / preanálisis' },
  { id: 'tender-decision', label: 'Decisión', accessibleLabel: 'Decisión GO / NO GO' },
  { id: 'tender-preparation', label: 'Preparación', accessibleLabel: 'Preparación de oferta' },
  { id: 'tender-follow-up', label: 'Seguimiento', accessibleLabel: 'Seguimiento comercial' },
];

export function tenderDetailSectionHref(opportunityId: string, sectionId: TenderDetailSectionId): string {
  return `#/detail/${opportunityId}?section=${sectionId}`;
}

export function tenderDetailHashWithSection(hash: string, sectionId: TenderDetailSectionId): string {
  const [path, query = ''] = hash.split('?');
  const params = new URLSearchParams(query);
  if (params.get('focus') === 'documents') params.delete('focus');
  if (params.has('section')) params.set('section', sectionId);
  else params.append('section', sectionId);
  const rebuiltQuery = params.toString();
  return rebuiltQuery ? `${path}?${rebuiltQuery}` : path;
}

function fromPanelError<T>(state: TenderPanelState<T>): TenderDetailIndicator | null {
  if (state.phase === 'error') return { tone: 'error', label: state.message || 'Error al cargar' };
  if (state.phase === 'pending') return { tone: 'attention', label: state.label };
  if (state.phase === 'loading') return { tone: 'unknown', label: 'Estado por confirmar' };
  return null;
}

export function resolveTenderDetailIndicators(
  snapshot: TenderDetailStatusSnapshot,
): Partial<Record<TenderDetailSectionId, TenderDetailIndicator>> {
  const indicators: Partial<Record<TenderDetailSectionId, TenderDetailIndicator>> = {};

  const documentFallback = fromPanelError(snapshot.documents);
  indicators['tender-document-review'] = documentFallback || (snapshot.documents.phase === 'ready' && snapshot.documents.value.importError
    ? { tone: 'error', label: 'Importación documental fallida' }
    : snapshot.documents.phase === 'ready' && snapshot.documents.value.currentDocumentCount > 0
      ? { tone: 'ready', label: 'Documentos vigentes' }
      : { tone: 'unknown', label: 'Sin estado documental confirmado' });

  const analysisFallback = fromPanelError(snapshot.analysis);
  if (analysisFallback) indicators['tender-analysis'] = analysisFallback;
  else if (snapshot.analysis.phase === 'ready') {
    const analysis = snapshot.analysis.value;
    indicators['tender-analysis'] = !analysis
      ? { tone: 'unknown', label: 'Sin análisis vigente' }
      : analysis.status === 'failed'
        ? { tone: 'error', label: 'Análisis fallido' }
        : analysis.current
          ? { tone: 'ready', label: 'Análisis vigente' }
          : { tone: 'attention', label: 'Análisis desactualizado' };
  }

  const decisionFallback = fromPanelError(snapshot.decision);
  if (decisionFallback) indicators['tender-decision'] = decisionFallback;
  else if (snapshot.decision.phase === 'ready') {
    const decision = snapshot.decision.value;
    const analysisIsReady = snapshot.analysis.phase === 'ready'
      && snapshot.analysis.value?.status === 'completed'
      && snapshot.analysis.value.current;
    indicators['tender-decision'] = decision
      ? { tone: 'ready', label: decision.decision === 'go' ? 'GO autorizado' : 'NO GO autorizado' }
      : analysisIsReady
        ? { tone: 'attention', label: 'Decisión humana pendiente' }
        : { tone: 'unknown', label: 'Decisión aún no aplicable' };
  }

  const preparationFallback = fromPanelError(snapshot.preparation);
  if (preparationFallback) indicators['tender-preparation'] = preparationFallback;
  else if (snapshot.preparation.phase === 'ready') {
    const preparation = snapshot.preparation.value;
    indicators['tender-preparation'] = preparation.preparationStatus
      ? preparation.humanPendingCount > 0
        ? { tone: 'attention', label: `${preparation.humanPendingCount} pendiente(s) humanos` }
        : { tone: 'ready', label: 'Preparación vigente' }
      : preparation.decision === 'go'
        ? { tone: 'attention', label: 'Preparación pendiente de iniciar' }
        : { tone: 'unknown', label: preparation.decision === 'no_go' ? 'No aplica por NO GO' : 'Sin preparación confirmada' };
  }

  const followUp = snapshot.followUp;
  indicators['tender-follow-up'] = followUp.code === 'scheduled'
    ? { tone: 'ready', label: `${followUp.label}: ${followUp.detail}` }
    : followUp.code === 'today' || followUp.code === 'soon'
      ? { tone: 'attention', label: `${followUp.label}: ${followUp.detail}` }
      : followUp.code === 'missing' || followUp.code === 'overdue'
        ? { tone: 'error', label: `${followUp.label}: ${followUp.detail}` }
        : { tone: 'unknown', label: `${followUp.label}: ${followUp.detail}` };

  return indicators;
}
