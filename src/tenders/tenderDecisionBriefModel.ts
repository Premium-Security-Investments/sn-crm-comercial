import type { TenderDecisionReview, TenderDecisionReviewFinding, TenderDecisionReviewFindingSource } from './types';

export const TENDER_BRIEF_PRIORITY_LIMIT = 7;

export type TenderCommercialContext = {
  amountLabel?: string | null;
  closeLabel?: string | null;
  daysLabel?: string | null;
  city?: string | null;
  sector?: string | null;
  commercialFitPositives?: string[] | null;
};

export type TenderBriefEvidence = {
  id: string;
  kind: 'review_finding' | 'registry_citation' | 'manifest_requirement';
  title: string;
  locator: string;
  summary: string;
};

export type TenderBriefPriorityKind = 'impediment' | 'condition' | 'potential' | 'effort';

export type TenderBriefPriorityItem = {
  kind: TenderBriefPriorityKind;
  id: string;
  title: string;
  body: string;
  finding?: TenderDecisionReviewFinding;
};

export function tenderBriefClassificationAvailable(review: TenderDecisionReview | null | undefined): boolean {
  return Boolean(review);
}

export function tenderBriefUnavailableCopy() {
  return {
    title: 'Clasificación ejecutiva no disponible',
    body: 'No existe una revisión de materialidad para este expediente. Que no haya clasificación ejecutiva no significa que se hayan buscado impedimentos y no se hayan encontrado.',
    impedimentNote: 'No hay clasificación ejecutiva de impedimentos. No se afirma que no existan.',
  };
}

export function tenderCommercialPotential(context: TenderCommercialContext = {}, _review?: TenderDecisionReview | null) {
  const positives = Array.isArray(context.commercialFitPositives)
    ? context.commercialFitPositives.map(item => String(item || '').trim()).filter(Boolean)
    : [];
  const contextFacts = [
    context.amountLabel ? `Cuantía: ${context.amountLabel}` : null,
    context.closeLabel ? `Cierre: ${context.closeLabel}` : null,
    context.daysLabel ? `Plazo: ${context.daysLabel}` : null,
    context.city ? `Ubicación: ${context.city}` : null,
    context.sector ? `Sector: ${context.sector}` : null,
  ].filter((item): item is string => Boolean(item));
  return {
    classified: positives.length > 0,
    reasons: positives.slice(0, 3),
    contextFacts,
    note: positives.length
      ? 'Razones comerciales tomadas del encaje comercial explícito. No se infieren desde capacidad, impedimentos ni condiciones pendientes.'
      : 'Sin razones comerciales priorizadas en el expediente. La cuantía, el plazo y la ubicación son contexto de la oportunidad; no se infieren desde capacidad, impedimentos ni condiciones pendientes.',
  };
}

export function tenderBriefEffortSummary(preparation: TenderDecisionReviewFinding[] = []) {
  if (!preparation.length) {
    return {
      present: false,
      headline: 'Sin trámites preparables identificados en esta lectura.',
      count: 0,
      items: [] as TenderDecisionReviewFinding[],
    };
  }
  return {
    present: true,
    headline: 'Hay trámites preparables — documentos y gestiones obtenibles. No miden el esfuerzo comercial ni son impedimentos materiales.',
    count: preparation.length,
    items: preparation,
  };
}

export function resolveFindingEvidence(
  finding: TenderDecisionReviewFinding,
  reviewFindings: TenderDecisionReviewFindingSource[] = [],
): TenderBriefEvidence[] {
  return (finding.evidence_refs || []).map((ref, index) => {
    if (ref.type === 'review_finding') {
      const source = reviewFindings.find(item => item.id === ref.finding_id);
      return {
        id: `${finding.id}-ev-${index}`,
        kind: 'review_finding' as const,
        title: source?.locator || ref.finding_id,
        locator: source?.locator || ref.finding_id,
        summary: source?.summary || 'Evidencia de revisión vinculada.',
      };
    }
    if (ref.type === 'registry_citation') {
      return {
        id: `${finding.id}-ev-${index}`,
        kind: 'registry_citation' as const,
        title: `Cláusula ${ref.sub_item_id}`,
        locator: `${ref.item_ref} · ${ref.sub_item_id} · carácter ${ref.char_start}`,
        summary: 'Cita del registro contractual.',
      };
    }
    return {
      id: `${finding.id}-ev-${index}`,
      kind: 'manifest_requirement' as const,
      title: `Requisito ${ref.requirement_id}`,
      locator: ref.requirement_id,
      summary: 'Requisito del manifiesto gobernado.',
    };
  });
}

export function tenderBriefPriorityItems(
  review: TenderDecisionReview | null | undefined,
  context: TenderCommercialContext = {},
): { visible: TenderBriefPriorityItem[]; overflow: TenderBriefPriorityItem[] } {
  if (!review) return { visible: [], overflow: [] };
  const potential = tenderCommercialPotential(context, review);
  const effort = tenderBriefEffortSummary(review.preparation);
  const material: TenderBriefPriorityItem[] = [
    ...review.blockers.map(finding => ({
      kind: 'impediment' as const,
      id: finding.id,
      title: finding.label,
      body: finding.rationale,
      finding,
    })),
    ...review.decision_questions.map(finding => ({
      kind: 'condition' as const,
      id: finding.id,
      title: finding.label,
      body: finding.rationale,
      finding,
    })),
  ];
  const summaries: TenderBriefPriorityItem[] = [
    {
      kind: 'potential',
      id: 'brief-potential',
      title: potential.classified ? 'Razones comerciales priorizadas' : 'Potencial comercial sin clasificar',
      body: [potential.note, potential.reasons.join(' '), potential.contextFacts.join(' · ')].filter(Boolean).join(' '),
    },
    {
      kind: 'effort',
      id: 'brief-effort',
      title: 'Esfuerzo inmediato',
      body: effort.headline,
    },
  ];
  const materialBudget = Math.max(0, TENDER_BRIEF_PRIORITY_LIMIT - summaries.length);
  return {
    visible: [...material.slice(0, materialBudget), ...summaries],
    overflow: material.slice(materialBudget),
  };
}
