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

export function tenderBriefShortLabel(label: string, max = 88) {
  const cleaned = String(label || '').replace(/\s+/g, ' ').trim();
  const head = cleaned.split(/\s+[—–]\s+/)[0];
  return head.length > max ? `${head.slice(0, max - 1).trim()}…` : head;
}

export function tenderBriefFindingBody(finding: TenderDecisionReviewFinding) {
  return String(finding.rationale || '').replace(/^NOTA PARA LA ENCARGADA:\s*/i, '').trim();
}

export function tenderBriefEffortSummary(preparation: TenderDecisionReviewFinding[] = []) {
  if (!preparation.length) {
    return {
      present: false,
      headline: 'Sin trámites preparables identificados en esta lectura.',
      count: 0,
      samples: [] as string[],
      items: [] as TenderDecisionReviewFinding[],
    };
  }
  const samples = preparation.slice(0, 2).map(item => tenderBriefShortLabel(item.label, 42));
  return {
    present: true,
    headline: `${preparation.length} trámites preparables${samples.length ? ` (${samples.join('; ')})` : ''}. Documentos y gestiones obtenibles; no miden el esfuerzo comercial ni son impedimentos materiales.`,
    count: preparation.length,
    samples,
    items: preparation,
  };
}

export function tenderBriefHeadline(
  review: TenderDecisionReview,
  context: TenderCommercialContext = {},
) {
  const potential = tenderCommercialPotential(context, review);
  const effort = tenderBriefEffortSummary(review.preparation);
  const sentences: string[] = [];
  if (review.blockers.length === 0) sentences.push('Esta revisión no confirma impedimentos materiales.');
  else if (review.blockers.length === 1) sentences.push(`Impedimento confirmado: ${tenderBriefShortLabel(review.blockers[0].label)}.`);
  else sentences.push(`${review.blockers.length} impedimentos confirmados. El potencial comercial se lee aparte.`);
  if (review.decision_questions.length === 1) sentences.push(`Hay que validar: ${tenderBriefShortLabel(review.decision_questions[0].label)}.`);
  else if (review.decision_questions.length > 1) sentences.push(`Hay que validar ${review.decision_questions.length} condiciones: ${review.decision_questions.map(item => tenderBriefShortLabel(item.label, 64)).join('; ')}.`);
  else sentences.push('No hay condiciones materiales abiertas.');
  if (potential.classified && potential.reasons[0]) sentences.push(`Encaje comercial explícito: ${potential.reasons[0]}`);
  else if (potential.contextFacts.length) sentences.push(`Sin razones comerciales priorizadas. Contexto de la oportunidad: ${potential.contextFacts.join(' · ')}.`);
  else sentences.push('Sin razones comerciales priorizadas en el expediente.');
  if (review.supported.length) sentences.push(`${review.supported.length} aspectos de capacidad ya revisados a favor; no se presentan como razón para invertir.`);
  if (effort.present) sentences.push(effort.headline);
  return sentences.join(' ');
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
  _context: TenderCommercialContext = {},
): { visible: TenderBriefPriorityItem[]; overflow: TenderBriefPriorityItem[] } {
  if (!review) return { visible: [], overflow: [] };
  const material: TenderBriefPriorityItem[] = [
    ...review.blockers.map(finding => ({
      kind: 'impediment' as const,
      id: finding.id,
      title: finding.label,
      body: tenderBriefFindingBody(finding),
      finding,
    })),
    ...review.decision_questions.map(finding => ({
      kind: 'condition' as const,
      id: finding.id,
      title: finding.label,
      body: tenderBriefFindingBody(finding),
      finding,
    })),
  ];
  return {
    visible: material.slice(0, TENDER_BRIEF_PRIORITY_LIMIT),
    overflow: material.slice(TENDER_BRIEF_PRIORITY_LIMIT),
  };
}
