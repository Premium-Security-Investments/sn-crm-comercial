import type { TenderDecisionReview, TenderDecisionReviewFinding, TenderQuestionResponse } from './types';

// Pure selectors over the governed decision_review projection (contrato exacto vinculante,
// task-2-brief). Never mutate inputs. Never fall back to `rationale`. The internal `id` of a
// finding may live as `key` (React key / navigation), but never as printed frontal text.

export type TenderDecisionConditionState =
  | 'Pendiente de validación'
  | 'Validación registrada'
  | 'No aplica';

export type TenderDecisionSurfaceCard = {
  key: string;
  persistence: { questionText: string };
  title: string;
  state: TenderDecisionConditionState | null;
  summary: string | null;
  missing: string | null;
  actionRequired: string | null;
};

const CONDITION_STATE_LABELS: Partial<Record<TenderQuestionResponse['status'], TenderDecisionConditionState>> = {
  resolved: 'Validación registrada',
  not_applicable: 'No aplica',
};
const CONDITION_STATE_PENDING_LABEL: TenderDecisionConditionState = 'Pendiente de validación';

const MISSING_PRESENTATION_FALLBACK: Readonly<{
  title: string;
  state: TenderDecisionConditionState;
  missing: string;
  actionRequired: string;
}> = Object.freeze({
  title: 'Clasificación ejecutiva no disponible',
  state: CONDITION_STATE_PENDING_LABEL,
  missing: 'Revisar el respaldo técnico gobernado de esta condición.',
  actionRequired: 'Completar la presentación humana antes de cerrar la validación.',
});

export function latestQuestionResponse(
  responses: TenderQuestionResponse[] | null | undefined,
  questionId: string,
): TenderQuestionResponse | null {
  const matches = (responses ?? []).filter(response => response.question_id === questionId);
  if (matches.length === 0) return null;
  return matches.reduce((latest, current) => (
    new Date(current.responded_at).getTime() > new Date(latest.responded_at).getTime() ? current : latest
  ));
}

export function conditionState(response: TenderQuestionResponse | null | undefined): TenderDecisionConditionState {
  if (!response) return CONDITION_STATE_PENDING_LABEL;
  return CONDITION_STATE_LABELS[response.status] ?? CONDITION_STATE_PENDING_LABEL;
}

const CONDITION_ANCHOR_PREFIX = 'tender-condition-';

// Ancla gobernada, opaca y no técnica para navegar a una condición/impedimento específico, por
// orden estable de decision_questions + blockers (nunca por texto, nunca el id gobernado crudo).
// Misma función pura consumida por la tarjeta de Análisis (atributo `id`) y por el enlace
// `Ver condición principal` de V3 (atributo `href`), para no duplicar la relación.
export function tenderDecisionConditionAnchorMap(
  review: TenderDecisionReview | null | undefined,
): Map<string, string> {
  const orderedIds = [...(review?.decision_questions ?? []), ...(review?.blockers ?? [])].map(finding => finding.id);
  const anchors = new Map<string, string>();
  orderedIds.forEach((id, index) => {
    if (!anchors.has(id)) anchors.set(id, `${CONDITION_ANCHOR_PREFIX}${index + 1}`);
  });
  return anchors;
}

export function tenderDecisionConditionAnchor(
  review: TenderDecisionReview | null | undefined,
  findingId: string | null | undefined,
): string | null {
  if (!findingId) return null;
  return tenderDecisionConditionAnchorMap(review).get(findingId) ?? null;
}

function presentationCard(
  finding: TenderDecisionReviewFinding,
  state: TenderDecisionConditionState | null,
): TenderDecisionSurfaceCard {
  if (!finding.presentation) {
    return {
      key: finding.id,
      persistence: { questionText: finding.label },
      title: MISSING_PRESENTATION_FALLBACK.title,
      state: MISSING_PRESENTATION_FALLBACK.state,
      summary: null,
      missing: MISSING_PRESENTATION_FALLBACK.missing,
      actionRequired: MISSING_PRESENTATION_FALLBACK.actionRequired,
    };
  }
  return {
    key: finding.id,
    persistence: { questionText: finding.label },
    title: finding.presentation.title,
    state,
    summary: finding.presentation.summary ?? null,
    missing: finding.presentation.missing ?? null,
    actionRequired: finding.presentation.action_required ?? null,
  };
}

function projectWithResponses(
  findings: TenderDecisionReviewFinding[] | null | undefined,
  responses: TenderQuestionResponse[] | null | undefined,
): TenderDecisionSurfaceCard[] {
  return (findings ?? []).map(finding => {
    const response = latestQuestionResponse(responses, finding.id);
    return presentationCard(finding, conditionState(response));
  });
}

export function tenderDecisionConditions(
  review: TenderDecisionReview | null | undefined,
  responses: TenderQuestionResponse[] | null | undefined = [],
): TenderDecisionSurfaceCard[] {
  return projectWithResponses(review?.decision_questions, responses);
}

export function tenderDecisionBlockers(
  review: TenderDecisionReview | null | undefined,
  responses: TenderQuestionResponse[] | null | undefined = [],
): TenderDecisionSurfaceCard[] {
  return projectWithResponses(review?.blockers, responses);
}

export function tenderDecisionSupportedAspects(
  review: TenderDecisionReview | null | undefined,
): TenderDecisionSurfaceCard[] {
  return (review?.supported ?? []).map(finding => presentationCard(finding, null));
}

export function tenderDecisionPreparationActions(
  review: TenderDecisionReview | null | undefined,
): TenderDecisionSurfaceCard[] {
  return (review?.preparation ?? []).map(finding => presentationCard(finding, null));
}
