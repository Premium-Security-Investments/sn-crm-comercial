import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  tenderOperationalPendingCardDomId,
  type TenderIntegralOperationalGroup,
  type TenderIntegralUnitPresentation,
} from '../tenderIntegralAnalysisPresentation';
import type { TenderDecisionAxisView } from '../tenderDecisionAxisSurface';
import {
  createTenderActionableReviewActions,
  type TenderActionableReviewItem,
  type TenderActionableReviewListPayload,
} from '../tenderActionableReviewActions';
import { projectActionableReviewCard, type TenderActionableReviewCardView } from '../tenderActionableReviewProjection';
import {
  TenderActionableReviewDrawer,
  TENDER_ACTIONABLE_REVIEW_DRAWER_DOM_ID,
  type TenderActionableReviewDrawerItem,
} from './TenderActionableReviewDrawer';
import type { TenderCurrentProfile, TenderRequest } from '../types';
import './tender-decision-axis-surface.css';

// Toda unidad V3 abierta de la corrida vigente debe ofrecer "Revisar pendiente" en Análisis, sin
// importar si los cinco ejes de Decisión ya tienen lectura material (§8.7 de la spec): un eje
// poblado describe una lectura distinta, no evidencia de que los pendientes documentales del
// expediente estén resueltos. `axes` se conserva en la firma porque las pruebas y llamadas
// existentes documentan el contrato con ambos insumos, pero ya no participa de la decisión.
export function shouldShowTenderOperationalPendingProjection(
  axes: TenderDecisionAxisView[],
  openUnits: TenderIntegralUnitPresentation[],
) {
  void axes;
  return openUnits.length > 0;
}

// Une pendientes persistidos a tarjetas exclusivamente por `requirement_id` no nulo (design §10.1,
// §18): nunca por título/texto. Un `requirement_id` compartido por más de un pendiente persistido
// es una colisión que ninguna tarjeta puede resolver sin ambigüedad, así que ambas quedan sin
// enlazar antes que adivinar cuál corresponde.
function reviewsByUniqueRequirementId(items: ReadonlyArray<TenderActionableReviewItem>): Map<string, TenderActionableReviewItem> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.requirement_id) continue;
    counts.set(item.requirement_id, (counts.get(item.requirement_id) ?? 0) + 1);
  }
  const map = new Map<string, TenderActionableReviewItem>();
  for (const item of items) {
    if (!item.requirement_id || counts.get(item.requirement_id) !== 1) continue;
    map.set(item.requirement_id, item);
  }
  return map;
}

// Reutiliza la proyección pura ya validada (§8.2) tanto para un pendiente ya persistido como para
// uno todavía no materializado: sin fila persistida, sólo una identidad humana puede iniciar el
// puente `ensure` (§7.2), así que una identidad no humana no recibe ningún CTA.
function projectPendingCardReview(
  card: TenderIntegralUnitPresentation,
  reviewItem: TenderActionableReviewItem | undefined,
  isHuman: boolean,
): TenderActionableReviewCardView {
  const hasIdentity = Boolean(card.technical.unitId);
  if (reviewItem) {
    return projectActionableReviewCard({
      id: reviewItem.id,
      state: reviewItem.state,
      outcome: reviewItem.outcome,
      comment_count: reviewItem.comment_count,
      attachment_count: reviewItem.attachment_count,
      current_supports_count: reviewItem.current_supports_count,
      capabilities: reviewItem.capabilities,
      has_structural_identity: hasIdentity,
    });
  }
  const view = projectActionableReviewCard({
    id: null,
    state: 'pendiente',
    outcome: null,
    comment_count: 0,
    attachment_count: 0,
    current_supports_count: 0,
    capabilities: { can_contribute: isHuman, can_resolve: false },
    has_structural_identity: hasIdentity,
  });
  return isHuman ? view : { ...view, cta_label: null };
}

function TenderOperationalPendingCard({
  card,
  headingId,
  review,
  ensureBusy,
  ensureError,
  isHuman,
  isSelected,
  onTrigger,
}: {
  card: TenderIntegralUnitPresentation;
  headingId: string;
  review: TenderActionableReviewItem | undefined;
  ensureBusy: boolean;
  ensureError: string | null;
  isHuman: boolean;
  isSelected: boolean;
  onTrigger: (trigger: HTMLButtonElement) => void;
}) {
  const title = card.title?.trim() || 'Requisito sin título registrado.';
  const known = card.conclusionSummary?.trim() || 'No hay una conclusión documental registrada.';
  const impact = card.commercialImpactSummary?.trim() || 'No hay impacto comercial documentado.';
  const missing = card.missingEvidenceReasons.filter(reason => reason.trim().length > 0);
  const actions = card.actionSummaries.filter(action => action.trim().length > 0);
  const sourceCount = Math.max(card.evidenceSourceLabels.length, 1);
  const references = card.citedEvidenceCount > 0
    ? `${card.citedEvidenceCount} cita${card.citedEvidenceCount === 1 ? '' : 's'} en ${sourceCount} documento${sourceCount === 1 ? '' : 's'}: ${card.evidenceSourceLabels.length > 0 ? card.evidenceSourceLabels.join(' · ') : 'fuente documental registrada'}`
    : 'Sin referencias documentales legibles asociadas.';
  const view = projectPendingCardReview(card, review, isHuman);
  // Id estable derivado del `unit_id` estructural (§8/§18): Decisión reutiliza el mismo helper
  // para enfocar exactamente esta tarjeta, nunca interpolando el id crudo en un selector CSS.
  // Sin identidad estructural no hay id anclable, igual que no hay CTA.
  const domId = card.technical.unitId ? tenderOperationalPendingCardDomId(card.technical.unitId) : undefined;

  return <article id={domId} tabIndex={-1} className="tender-decision-operational-card" aria-labelledby={headingId}>
    <span className="tender-decision-operational-label">Requisito</span>
    <h5 id={headingId}>{title}</h5>
    <p className="tender-decision-operational-card-review">
      <strong className="tender-decision-operational-card-badge">{view.badge_label}</strong>
      <span className="tender-decision-operational-card-counts">{view.comment_count} comentario{view.comment_count === 1 ? '' : 's'} · {view.attachment_count} archivo{view.attachment_count === 1 ? '' : 's'}</span>
    </p>
    <dl>
      <div><dt>Qué sabemos</dt><dd>{known}</dd></div>
      <div><dt>Qué falta por confirmar o aportar</dt><dd>{missing.length > 0
        ? <ul>{missing.map((reason, index) => <li key={`${card.key}-missing-${index}`}>{reason}</li>)}</ul>
        : 'No hay un faltante específico registrado; la validación humana continúa pendiente.'}</dd></div>
      <div><dt>Por qué importa</dt><dd>{impact}</dd></div>
      <div><dt>Siguiente acción</dt><dd>{actions.length > 0
        ? <ul>{actions.map((action, index) => <li key={`${card.key}-action-${index}`}>{action}</li>)}</ul>
        : 'No hay una siguiente acción específica registrada; asignar revisión humana.'}</dd></div>
      <div><dt>Referencias</dt><dd>{references}</dd></div>
    </dl>
    {view.cta_label && <button
      type="button"
      className="tender-decision-operational-card-review-cta"
      aria-haspopup="dialog"
      aria-controls={TENDER_ACTIONABLE_REVIEW_DRAWER_DOM_ID}
      aria-expanded={isSelected}
      disabled={ensureBusy}
      onClick={event => onTrigger(event.currentTarget)}
    >{ensureBusy ? 'Abriendo…' : view.cta_label}</button>}
    {ensureError && <p className="tender-decision-operational-card-error" role="alert">{ensureError}</p>}
  </article>;
}

export type TenderOperationalPendingProjectionProps = {
  groups: TenderIntegralOperationalGroup[];
  count: number;
  opportunityId: string;
  analysisRunId: string;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  apiDownload: (url: string) => Promise<Blob>;
  uploadToSignedUrl?: (path: string, token: string, file: Blob) => Promise<{ error: unknown | null }>;
};

export function TenderOperationalPendingProjection({
  groups,
  count,
  opportunityId,
  analysisRunId,
  currentProfile,
  request,
  apiDownload,
  uploadToSignedUrl,
}: TenderOperationalPendingProjectionProps) {
  const actions = useMemo(
    () => createTenderActionableReviewActions({ request, apiDownload, uploadToSignedUrl }),
    [request, apiDownload, uploadToSignedUrl],
  );
  const isHuman = currentProfile != null && currentProfile.identity_type !== 'agent';

  const [listPhase, setListPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listPayload, setListPayload] = useState<TenderActionableReviewListPayload | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [ensureBusyKey, setEnsureBusyKey] = useState<string | null>(null);
  const [ensureErrorByKey, setEnsureErrorByKey] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<{ itemId: string; card: TenderIntegralUnitPresentation } | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const fetchReviews = useCallback(async () => {
    setListPhase('loading');
    setListError(null);
    try {
      const payload = await actions.listReviews(opportunityId, analysisRunId);
      setListPayload(payload);
      setListPhase('ready');
    } catch {
      setListError('No se pudo cargar el estado de revisión de los pendientes.');
      setListPhase('error');
    }
  }, [actions, opportunityId, analysisRunId]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const reviewsByRequirementId = useMemo(
    () => reviewsByUniqueRequirementId(listPayload?.items ?? []),
    [listPayload],
  );

  const openReview = (card: TenderIntegralUnitPresentation, itemId: string, trigger: HTMLButtonElement) => {
    previouslyFocusedRef.current = trigger;
    setSelection({ itemId, card });
  };

  // Al cerrar, el foco regresa exactamente al disparador original y las tarjetas se refrescan con
  // el estado servidor vigente (nuevos comentarios/adjuntos/resultado registrados en el drawer).
  const closeReview = () => {
    setSelection(null);
    const target = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    requestAnimationFrame(() => target?.isConnected && target.focus());
    void fetchReviews();
  };

  const handleTrigger = async (
    card: TenderIntegralUnitPresentation,
    reviewItem: TenderActionableReviewItem | undefined,
    trigger: HTMLButtonElement,
  ) => {
    if (reviewItem) { openReview(card, reviewItem.id, trigger); return; }
    const unitId = card.technical.unitId;
    if (!unitId) return;
    setEnsureBusyKey(card.key);
    setEnsureErrorByKey(previous => {
      if (!(card.key in previous)) return previous;
      const next = { ...previous };
      delete next[card.key];
      return next;
    });
    try {
      const ensured = await actions.ensureReview(opportunityId, analysisRunId, unitId);
      await fetchReviews();
      openReview(card, ensured.id, trigger);
    } catch {
      setEnsureErrorByKey(previous => ({ ...previous, [card.key]: 'No se pudo iniciar la revisión. Intente nuevamente.' }));
    } finally {
      setEnsureBusyKey(null);
    }
  };

  const selectedReviewItem = selection ? listPayload?.items.find(item => item.id === selection.itemId) ?? null : null;
  const drawerItem: TenderActionableReviewDrawerItem | null = selection ? {
    id: selection.itemId,
    requirement_title: selection.card.title,
    analysis_conclusion_summary: selection.card.conclusionSummary,
    state: selectedReviewItem?.state ?? 'pendiente',
    outcome: selectedReviewItem?.outcome ?? null,
    comment_count: selectedReviewItem?.comment_count ?? 0,
    attachment_count: selectedReviewItem?.attachment_count ?? 0,
    current_supports_count: selectedReviewItem?.current_supports_count ?? 0,
    capabilities: selectedReviewItem?.capabilities ?? { can_contribute: isHuman, can_resolve: false },
    timeline: selectedReviewItem?.timeline ?? [],
  } : null;

  return <section id="tender-analysis-operational-pending" className="tender-decision-operational" aria-labelledby="tender-analysis-operational-title">
    <header>
      <div><span className="eyebrow">Pendientes para revisión humana</span><h3 id="tender-analysis-operational-title">Lectura documental incompleta</h3><p>Priorice confirmar o aportar la información pendiente. Esta lectura organiza el trabajo y no equivale a cumplimiento ni decide GO / NO GO.</p></div>
      <strong aria-live="polite">{count} pendiente{count === 1 ? '' : 's'} accionable{count === 1 ? '' : 's'}</strong>
    </header>
    {listPhase === 'loading' && <p className="tender-decision-operational-status" role="status">Cargando estado de revisión…</p>}
    {listPhase === 'error' && <div className="tender-decision-operational-alert" role="alert">
      <p>{listError}</p>
      <button type="button" onClick={() => void fetchReviews()}>Reintentar</button>
    </div>}
    <div className="tender-decision-operational-groups">{groups.map((group, groupIndex) => <section className="tender-decision-operational-group" key={group.key} aria-labelledby={`tender-analysis-operational-group-${groupIndex + 1}`}>
      <header><h4 id={`tender-analysis-operational-group-${groupIndex + 1}`}>{group.label}</h4><span>{group.units.length} pendiente{group.units.length === 1 ? '' : 's'}</span></header>
      <div className="tender-decision-operational-cards">{group.units.map((card, cardIndex) => {
        const reviewItem = card.requirementId ? reviewsByRequirementId.get(card.requirementId) : undefined;
        return <TenderOperationalPendingCard
          key={card.key}
          card={card}
          headingId={`tender-analysis-operational-card-${groupIndex + 1}-${cardIndex + 1}`}
          review={reviewItem}
          ensureBusy={ensureBusyKey === card.key}
          ensureError={ensureErrorByKey[card.key] ?? null}
          isHuman={isHuman}
          isSelected={selection?.card.key === card.key}
          onTrigger={trigger => void handleTrigger(card, reviewItem, trigger)}
        />;
      })}</div>
    </section>)}</div>
    {selection && drawerItem && <TenderActionableReviewDrawer
      item={drawerItem}
      opportunityId={opportunityId}
      analysisRunId={analysisRunId}
      currentProfile={currentProfile}
      request={request}
      apiDownload={apiDownload}
      uploadToSignedUrl={uploadToSignedUrl}
      onClose={closeReview}
      triggerLabel="Revisar pendiente"
    />}
  </section>;
}
