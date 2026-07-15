import type { SiioInstitutionalAgent } from '../siioAgents';

export type BoardSourceReference = { id: string };
export type BoardEvidenceReference = { id: string; sourceIds: string[] };
export type ExcludedBoardEvidence<T> = T & { exclusionReason: string };

export type BoardDraftGovernance<Source extends BoardSourceReference, Recommendation extends BoardEvidenceReference, Tracking extends BoardEvidenceReference> = {
  agent: SiioInstitutionalAgent;
  authorizedSourceIds: string[];
  eligibleSources: Source[];
  excludedSources: Source[];
  eligibleRecommendations: Recommendation[];
  excludedRecommendations: Array<ExcludedBoardEvidence<Recommendation>>;
  eligibleTrackingItems: Tracking[];
  excludedTrackingItems: Array<ExcludedBoardEvidence<Tracking>>;
};

function exclusionReason(sourceIds: string[], authorizedSourceIds: Set<string>, loadedSourceIds: Set<string>) {
  if (!sourceIds.length) return 'Sin fuente vinculada: no es evidencia elegible para Junta.';
  const invalidIds = sourceIds.filter(sourceId => !authorizedSourceIds.has(sourceId) || !loadedSourceIds.has(sourceId));
  return invalidIds.length
    ? `Fuente no autorizada o no cargada: ${invalidIds.join(', ')}. Excluida como evidencia de Junta.`
    : '';
}

export function createBoardDraftGovernance<Source extends BoardSourceReference, Recommendation extends BoardEvidenceReference, Tracking extends BoardEvidenceReference>(
  catalog: SiioInstitutionalAgent[],
  context: { sources: Source[]; recommendations: Recommendation[]; trackingItems: Tracking[] },
): BoardDraftGovernance<Source, Recommendation, Tracking> {
  const agent = catalog.find(candidate => candidate.id === 'AGT-001');
  if (!agent) throw new Error('AGT-001 no está disponible para gobernar el borrador de Junta.');

  const authorizedSourceIds = [...agent.authorized_sources];
  const authorizedSourceSet = new Set(authorizedSourceIds);
  const loadedSourceIds = new Set(context.sources.map(source => source.id));
  const classifyEvidence = <Item extends BoardEvidenceReference>(items: Item[]) => {
    const eligible: Item[] = [];
    const excluded: Array<ExcludedBoardEvidence<Item>> = [];
    for (const item of items) {
      const reason = exclusionReason(item.sourceIds, authorizedSourceSet, loadedSourceIds);
      if (reason) excluded.push({ ...item, exclusionReason: reason });
      else eligible.push(item);
    }
    return { eligible, excluded };
  };

  const recommendations = classifyEvidence(context.recommendations);
  const tracking = classifyEvidence(context.trackingItems);
  return {
    agent,
    authorizedSourceIds,
    eligibleSources: context.sources.filter(source => authorizedSourceSet.has(source.id)),
    excludedSources: context.sources.filter(source => !authorizedSourceSet.has(source.id)),
    eligibleRecommendations: recommendations.eligible,
    excludedRecommendations: recommendations.excluded,
    eligibleTrackingItems: tracking.eligible,
    excludedTrackingItems: tracking.excluded,
  };
}

export function focusTrapTargetIndex(focusableCount: number, activeIndex: number, shiftKey: boolean): number | null {
  if (!focusableCount) return null;
  if (activeIndex < 0) return shiftKey ? focusableCount - 1 : 0;
  if (shiftKey && activeIndex === 0) return focusableCount - 1;
  if (!shiftKey && activeIndex === focusableCount - 1) return 0;
  return null;
}
