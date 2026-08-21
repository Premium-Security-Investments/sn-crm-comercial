import type { TenderDecisionSurfaceCard } from './tenderDecisionSurface';
import type { TenderDecisionReviewFinding, TenderDecisionReviewFindingSource } from './types';

export type TenderCommercialContext = {
  amountLabel?: string | null;
  closeLabel?: string | null;
  daysLabel?: string | null;
  city?: string | null;
  sector?: string | null;
  commercialFitPositives?: string[] | null;
};

export function tenderBriefClassificationAvailable(review: unknown): boolean {
  return Boolean(review);
}

export function tenderBriefUnavailableCopy() {
  return {
    title: 'Clasificación ejecutiva no disponible',
    body: 'No existe una revisión de materialidad para este expediente. Que no haya clasificación ejecutiva no significa que se hayan buscado impedimentos y no se hayan encontrado.',
    impedimentNote: 'No hay clasificación ejecutiva de impedimentos. No se afirma que no existan.',
  };
}

export function tenderCommercialPotential(context: TenderCommercialContext = {}) {
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
      ? 'Razones comerciales tomadas del encaje comercial explícito.'
      : 'Sin razones comerciales priorizadas en el expediente.',
  };
}

type TenderBriefHeadlineInput = {
  blockers: TenderDecisionSurfaceCard[];
  conditions: TenderDecisionSurfaceCard[];
  potential: ReturnType<typeof tenderCommercialPotential>;
};

// La síntesis frontal se limita a tres frases: impedimentos, condiciones y potencial comercial.
// Los selectores ya entregan sólo la presentación humana; este modelo no lee rationale ni arrays crudos.
export type TenderBriefEvidence = {
  id: string;
  kind: 'review_finding' | 'registry_citation' | 'manifest_requirement';
  title: string;
  locator: string;
  summary: string;
};

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

export function tenderBriefHeadline({ blockers, conditions, potential }: TenderBriefHeadlineInput): string {
  const impediments = blockers.length === 0
    ? 'Esta revisión no confirma impedimentos materiales.'
    : blockers.length === 1
      ? 'Hay 1 impedimento confirmado.'
      : `Hay ${blockers.length} impedimentos confirmados.`;
  const pending = conditions.length === 0
    ? 'No hay condiciones materiales pendientes de validar.'
    : `Hay ${conditions.length} condiciones pendientes de validar.`;
  const commercial = potential.classified && potential.reasons[0]
    ? `Potencial comercial explícito: ${potential.reasons[0]}.`
    : 'No hay razones comerciales priorizadas en el expediente.';
  return `${impediments} ${pending} ${commercial}`;
}
