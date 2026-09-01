// AGT-002 revisión accionable — proyección pura del frontend (spec §§8.2, 8.4, 8.7, 19.6,
// 12.3 de docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md).
//
// Sin fetch ni lógica de permisos: sólo traduce el estado/resultado server-owned a etiquetas
// humanas cerradas y nunca expone `unit_id`, `requirement_id`, hashes, rutas de storage ni
// eTags. `resolvesEligibleForNewDrawer` fija la exclusión mutua entre el drawer nuevo y el
// editor histórico (§8.7): una tarjeta jamás monta ambos.

export type TenderActionableReviewState = 'pendiente' | 'en_revision' | 'resuelto' | 'reabierto';

export type TenderActionableReviewOutcome =
  | 'aclarado_con_soporte'
  | 'riesgo_confirmado'
  | 'no_aplica'
  | 'informacion_insuficiente';

export type TenderActionableReviewCapabilities = {
  can_contribute: boolean;
  can_resolve: boolean;
};

export type TenderActionableReviewCardInput = {
  id: string | null;
  state: TenderActionableReviewState;
  outcome: TenderActionableReviewOutcome | null;
  comment_count: number;
  attachment_count: number;
  current_supports_count: number;
  capabilities: TenderActionableReviewCapabilities;
  has_structural_identity?: boolean;
};

export type TenderActionableReviewCardView = {
  id: string | null;
  badge_label: string;
  cta_label: string | null;
  outcome_label: string | null;
  comment_count: number;
  attachment_count: number;
  current_supports_count: number;
};

export type TenderActionableReviewSummaryInput = {
  state: TenderActionableReviewState;
  outcome: TenderActionableReviewOutcome | null;
};

export type TenderActionableReviewSummaryView = {
  open_count: number;
  confirmed_risk_count: number;
};

export type TenderActionableReviewEligibilityInput = {
  source_kind: string | null;
  source_id: string | null;
  is_historical_run: boolean;
};

const UNREVIEWABLE_BADGE_LABEL = 'Pendiente sin identidad revisable';

const STATE_LABELS: Readonly<Record<TenderActionableReviewState, string>> = Object.freeze({
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  resuelto: 'Resuelto',
  reabierto: 'Reabierto',
});

// Rótulos visibles del resultado persistido (§8.4); cerrado a los cuatro valores del dominio.
const OUTCOME_LABELS: Readonly<Record<TenderActionableReviewOutcome, string>> = Object.freeze({
  aclarado_con_soporte: 'Aclarado con soporte',
  riesgo_confirmado: 'Riesgo confirmado',
  no_aplica: 'No aplica',
  informacion_insuficiente: 'Información insuficiente',
});

const OPEN_STATES: ReadonlySet<TenderActionableReviewState> = new Set(['pendiente', 'en_revision', 'reabierto']);

const ELIGIBLE_SOURCE_KINDS: ReadonlySet<string> = new Set(['integral_unit', 'decision_review_finding']);

// La identidad estructural depende únicamente de si la fuente V3 trae `technical.unitId`
// (§18): un pendiente todavía no materializado (`id: null`, primera acción) con identidad
// estructural conocida sigue siendo revisable y debe ofrecer el CTA de iniciar la revisión.
function hasStructuralIdentity(item: TenderActionableReviewCardInput): boolean {
  return item.has_structural_identity !== false;
}

/** Tarjeta compacta (§8.2): nunca expone identificadores técnicos, sólo etiquetas humanas. */
export function projectActionableReviewCard(item: TenderActionableReviewCardInput): TenderActionableReviewCardView {
  const identityKnown = hasStructuralIdentity(item);
  const outcomeLabel = item.outcome != null ? OUTCOME_LABELS[item.outcome] : null;

  const badgeLabel = !identityKnown
    ? UNREVIEWABLE_BADGE_LABEL
    : (outcomeLabel ?? STATE_LABELS[item.state]);

  const canWrite = Boolean(item.capabilities?.can_contribute || item.capabilities?.can_resolve);
  const ctaLabel = !identityKnown ? null : (canWrite ? 'Revisar pendiente' : 'Ver revisión');

  return {
    id: item.id,
    badge_label: badgeLabel,
    cta_label: ctaLabel,
    outcome_label: outcomeLabel,
    comment_count: item.comment_count,
    attachment_count: item.attachment_count,
    current_supports_count: item.current_supports_count,
  };
}

// Resumen de Decisión (§8.1, §24.6): abiertos cuenta pendiente/en_revision/reabierto; riesgo
// confirmado vigente exige estado resuelto con resultado riesgo_confirmado — un riesgo
// reabierto deja de contar aunque permanezca en la historia.
export function projectActionableReviewSummary(
  items: ReadonlyArray<TenderActionableReviewSummaryInput>,
): TenderActionableReviewSummaryView {
  let openCount = 0;
  let confirmedRiskCount = 0;
  for (const item of items) {
    if (OPEN_STATES.has(item.state)) openCount += 1;
    if (item.state === 'resuelto' && item.outcome === 'riesgo_confirmado') confirmedRiskCount += 1;
  }
  return { open_count: openCount, confirmed_risk_count: confirmedRiskCount };
}

// Exclusión mutua (§8.7, §19.6): sólo una unidad V3 elegible de la corrida vigente (con
// source_kind/source_id estructurales y no histórica) monta el drawer nuevo; todo lo demás
// usa el editor legado.
export function resolvesEligibleForNewDrawer(input: TenderActionableReviewEligibilityInput): boolean {
  if (input.is_historical_run === true) return false;
  if (typeof input.source_kind !== 'string' || !ELIGIBLE_SOURCE_KINDS.has(input.source_kind)) return false;
  if (typeof input.source_id !== 'string' || input.source_id.length === 0) return false;
  return true;
}
