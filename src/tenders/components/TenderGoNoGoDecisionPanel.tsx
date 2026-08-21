import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { loadTenderGoNoGoDecision, recordTenderGoNoGoDecision } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import { tenderDecisionGate, tenderExecutiveOpenIssueCount, tenderExecutiveProjectionAvailable, tenderExecutiveRecommendation, tenderRecommendationKind } from '../tenderDecisionGate';
import type { TenderPanelState } from '../detailNavigationState';
import { tenderDecisionBlockers, tenderDecisionConditions } from '../tenderDecisionSurface';
import type { TenderCurrentProfile, TenderDocumentAnalysis, TenderGoNoGoDecision, TenderGoNoGoPayload, TenderQuestionResponse, TenderRequest } from '../types';
import { TenderGoNoGoDecisionSummary } from './TenderGoNoGoDecisionSummary';

type Decision = 'go' | 'no_go';
export type TenderGoNoGoDecisionPanelProps = {
  opportunityId: string;
  opportunityName: string;
  analysis: TenderDocumentAnalysis | null;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  questionResponses: TenderQuestionResponse[];
  onChanged: () => Promise<void> | void;
  onNavigationStateChanged?: (state: TenderPanelState<TenderGoNoGoDecision | null>) => void;
};

const EMPTY_PAYLOAD: TenderGoNoGoPayload = { decision: null, history: [], preparation: null };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
const decisionLabel = (value?: string | null) => value === 'go' ? 'GO registrado' : value === 'no_go' ? 'NO GO registrado' : 'Pendiente de decisión';

export function TenderGoNoGoDecisionPanel({ opportunityId, opportunityName, analysis, currentProfile, request, questionResponses, onChanged, onNavigationStateChanged }: TenderGoNoGoDecisionPanelProps) {
  const [payload, setPayload] = useState<TenderGoNoGoPayload>(EMPTY_PAYLOAD);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [justification, setJustification] = useState('');
  const requestVersionRef = useRef(0);
  const activeOpportunityRef = useRef(opportunityId);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const initialFocusRef = useRef<HTMLHeadingElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onNavigationStateChangedRef = useRef(onNavigationStateChanged);
  onNavigationStateChangedRef.current = onNavigationStateChanged;
  activeOpportunityRef.current = opportunityId;
  const allowed = canApproveTenderGoNoGo(currentProfile);
  const decisionGate = tenderDecisionGate(analysis);
  const decisionBlockers = tenderDecisionBlockers(analysis?.decision_review, questionResponses);
  const pendingConditions = tenderDecisionConditions(analysis?.decision_review, questionResponses).filter(
    (condition) => condition.state === 'Pendiente de validación'
  );
  const recommendationValue = tenderExecutiveRecommendation(analysis);
  const recommendationKind = tenderRecommendationKind(recommendationValue);
  const executiveOpenIssueCount = tenderExecutiveOpenIssueCount(analysis);
  const executiveProjectionAvailable = tenderExecutiveProjectionAvailable(analysis);
  const analysisWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!analysis) warnings.push('El análisis no está disponible. La decisión humana autorizada permanece habilitada.');
    else {
      if (analysis.status === 'failed') warnings.push('El análisis falló. Revise el expediente antes de decidir.');
      if (analysis.current === false) warnings.push('El análisis está obsoleto frente al expediente vigente.');
      if (analysis.decision_review) {
        if (decisionBlockers.length > 0) warnings.push('Hay impedimentos materiales confirmados. Revise el brief de decisión antes de registrar.');
        if (pendingConditions.length > 0) warnings.push('Hay condiciones pendientes de validar con la encargada. Revise el brief de decisión.');
      } else if (!executiveProjectionAvailable) warnings.push('La clasificación ejecutiva de materialidad aún no está disponible; revise la trazabilidad técnica antes de decidir.');
      else if (executiveOpenIssueCount > 0) warnings.push(`Hay ${executiveOpenIssueCount} preguntas críticas abiertas.`);
      if (recommendationKind === 'pause') warnings.push('La lectura de evidencia está incompleta. Eso no clasifica el potencial comercial.');
      const recommendationContradictsDecision = (selectedDecision === 'go' && recommendationKind === 'do_not_advance')
        || (selectedDecision === 'no_go' && recommendationKind === 'advance');
      if (recommendationContradictsDecision) warnings.push('Advertencia: recomendación contraria a la decisión humana elegida.');
    }
    return warnings;
  }, [analysis, decisionBlockers.length, executiveOpenIssueCount, executiveProjectionAvailable, pendingConditions.length, recommendationKind, selectedDecision]);
  const hasDecisionPending = decisionBlockers.length + pendingConditions.length > 0;
  const decisionPendingCount = decisionBlockers.length + pendingConditions.length;

  const load = useCallback(async (preserveStatus = false, preservePayload = false): Promise<boolean> => {
    const requestVersion = ++requestVersionRef.current;
    const requestedId = opportunityId;
    setLoading(true);
    onNavigationStateChangedRef.current?.({ phase: 'loading' });
    if (!preservePayload) setPayload(EMPTY_PAYLOAD);
    if (!preserveStatus) setStatus('');
    try {
      const next = await loadTenderGoNoGoDecision(request, requestedId);
      if (requestVersion !== requestVersionRef.current || activeOpportunityRef.current !== requestedId) return false;
      setPayload(next);
      onNavigationStateChangedRef.current?.({ phase: 'ready', value: next.decision });
      return true;
    } catch (error) {
      if (requestVersion === requestVersionRef.current && activeOpportunityRef.current === requestedId) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(message);
        onNavigationStateChangedRef.current?.({ phase: 'error', message });
      }
      return false;
    } finally {
      if (requestVersion === requestVersionRef.current && activeOpportunityRef.current === requestedId) setLoading(false);
    }
  }, [opportunityId, request]);

  const restoreFocus = () => {
    const target = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    if (target?.isConnected) target.focus();
  };
  const close = () => {
    if (busy) return;
    setSelectedDecision(null);
    setJustification('');
    restoreFocus();
  };
  const open = (decision: Decision, trigger: HTMLButtonElement) => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    triggerRef.current = trigger;
    setSelectedDecision(decision);
  };
  const scrollToPreparation = useCallback(() => {
    const target = document.getElementById('tender-preparation');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const focusable = target?.querySelector<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
    focusable?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    requestVersionRef.current += 1;
    setPayload(EMPTY_PAYLOAD);
    setStatus('');
    setLoading(true);
    setBusy(false);
    setSyncPending(false);
    setSelectedDecision(null);
    setJustification('');
    restoreFocus();
    void load();
  }, [opportunityId, load]);

  useEffect(() => {
    if (!selectedDecision) return;
    initialFocusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedDecision, busy]);

  const reconcile = async () => {
    if (busy || !syncPending) return;
    setBusy(true);
    setStatus('Actualizando la vista…');
    const reloaded = await load(true, true);
    if (reloaded) {
      try {
        await onChanged();
        if (activeOpportunityRef.current === opportunityId) {
          setSyncPending(false);
          setStatus('Vista actualizada.');
        }
      } catch (error) {
        if (activeOpportunityRef.current === opportunityId) setStatus(`La decisión ya está registrada; la vista sigue pendiente de actualización. ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (activeOpportunityRef.current === opportunityId) {
      setStatus('La decisión ya está registrada; no fue posible actualizar la vista. Puede reintentar sin duplicar la decisión.');
    }
    if (activeOpportunityRef.current === opportunityId) setBusy(false);
  };

  const submit = async () => {
    if (!selectedDecision || busy || syncPending) return;
    const submittedDecision = selectedDecision;
    const submittedJustification = justification.trim() || null;
    let persistedSuccessfully = false;
    setBusy(true);
    setStatus('Registrando decisión formal…');
    onNavigationStateChangedRef.current?.({ phase: 'pending', label: 'Registrando decisión humana' });
    try {
      const persisted = await recordTenderGoNoGoDecision(request, {
        opportunity_id: opportunityId,
        decision: submittedDecision,
        analysis_run_id: analysis?.run_id || null,
        justification: submittedJustification,
      });
      persistedSuccessfully = true;
      if (activeOpportunityRef.current !== opportunityId) return;
      const optimistic: TenderGoNoGoDecision = {
        id: persisted.decision.decision_id,
        opportunity_id: opportunityId,
        tender_id: '',
        decision: persisted.decision.decision,
        analysis_interaction_id: null,
        analysis_run_id: analysis?.run_id || null,
        justification: submittedJustification,
        decided_by: currentProfile?.id || '',
        decided_at: new Date().toISOString(),
        supersedes_decision_id: persisted.decision.supersedes_decision_id,
        psi_sales_profiles: currentProfile ? { full_name: currentProfile.full_name } : null,
      };
      setPayload(previous => ({ ...previous, decision: optimistic, preparation: submittedDecision === 'go' ? persisted.preparation : null, history: [optimistic, ...previous.history.filter(entry => entry.id !== optimistic.id)] }));
      onNavigationStateChangedRef.current?.({ phase: 'ready', value: optimistic });
      setSelectedDecision(null);
      setJustification('');
      restoreFocus();
      setSyncPending(true);
      setBusy(false);
      setStatus(submittedDecision === 'go' ? 'GO registrado y expediente de oferta actualizado.' : 'NO GO registrado; el expediente queda en solo lectura.');
      const reloaded = await load(true, true);
      if (!reloaded) {
        setStatus('La decisión ya está registrada; no fue posible actualizar la vista. Puede reintentar sin duplicar la decisión.');
        return;
      }
      await onChanged();
      if (activeOpportunityRef.current === opportunityId) {
        setSyncPending(false);
        if (submittedDecision === 'go') requestAnimationFrame(scrollToPreparation);
      }
    } catch (error) {
      if (activeOpportunityRef.current === opportunityId) {
        setStatus(persistedSuccessfully
          ? `La decisión ya está registrada; la vista sigue pendiente de actualización. ${error instanceof Error ? error.message : String(error)}`
          : `No fue posible registrar la decisión. ${error instanceof Error ? error.message : String(error)}`);
        if (!persistedSuccessfully) setSyncPending(false);
        if (!persistedSuccessfully) onNavigationStateChangedRef.current?.({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (activeOpportunityRef.current === opportunityId) setBusy(false);
    }
  };

  const current = payload.decision;
  return <section className="tender-go-no-go-panel" aria-labelledby="tender-go-no-go-heading">
    <header className="tender-go-no-go-head"><div><span className="eyebrow">Control formal de licitación</span><h3 id="tender-go-no-go-heading">Decisión GO / NO GO</h3><p>{VIGIA_VISIBLE_NAMES.tenders} recomienda; la decisión y el avance operativo pertenecen a la persona autorizada.</p></div></header>
    <div className="tender-go-no-go-grid tender-go-no-go-summary">
      <article className="tender-go-no-go-brief-pointer"><small>Control formal</small><strong>Aquí sólo se registra la decisión humana</strong><span>El brief de decisión precede este control. Esta sección no vuelve a listar impedimentos, capacidad ni preparación.</span></article>
      <TenderGoNoGoDecisionSummary loading={loading} current={current} />
      {current?.decision === 'go' && <article className="tender-go-no-go-next"><small>Estado operativo</small><strong>Preparación iniciada</strong><p><b>Siguiente paso:</b> completar el expediente y dejar la oferta lista para presentar.</p><button type="button" className="secondary" onClick={scrollToPreparation}>Abrir expediente de oferta</button></article>}
      {current?.decision === 'no_go' && <article className="tender-go-no-go-next"><small>Estado operativo</small><strong>Proceso cerrado por NO GO</strong><p><b>Siguiente paso:</b> conservar la decisión y su evidencia para consulta.</p></article>}
    </div>

    {hasDecisionPending && <p className="tender-go-no-go-analysis-pointer"><a href="#tender-analysis">Revisar pendientes en Análisis ({decisionPendingCount})</a></p>}
    {status && <div className="notice" role="status">{status}</div>}
    {syncPending && <div className="tender-go-no-go-actions"><button type="button" className="secondary" onClick={() => void reconcile()} disabled={busy}>{busy ? 'Actualizando…' : 'Reintentar actualización'}</button></div>}
    {allowed ? <div id="tender-go-no-go-actions" className="tender-go-no-go-actions" tabIndex={-1}>
      <button type="button" id="tender-decision-register-go" onClick={event => open('go', event.currentTarget)} disabled={!decisionGate.canGo || busy || loading || syncPending}>Registrar GO</button>
      <button type="button" id="tender-decision-register-nogo" className="danger" onClick={event => open('no_go', event.currentTarget)} disabled={!decisionGate.canNoGo || busy || loading || syncPending}>Registrar NO GO</button>
      <p className="muted">{VIGIA_VISIBLE_NAMES.tenders} recomienda; la persona autorizada conserva la autoridad absoluta para GO o NO GO.</p>
    </div> : <p id="tender-go-no-go-actions" className="muted" tabIndex={-1}>Solo Admin, Gerencia o Dirección de Licitaciones con permiso pueden registrar una decisión. La decisión vigente permanece disponible en solo lectura.</p>}
    <details className="tender-go-no-go-history"><summary>Historial de decisiones</summary>{loading ? <p>Cargando historial…</p> : payload.history.length ? <ol>{payload.history.map(entry => <li key={entry.id}><strong>{decisionLabel(entry.decision)}</strong><span>{entry.psi_sales_profiles?.full_name || entry.decided_by} · {date(entry.decided_at)}</span>{entry.justification && <p>{entry.justification}</p>}</li>)}</ol> : <p>Sin entradas previas.</p>}</details>
    {selectedDecision && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={close}>
      <div className="tender-go-no-go-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tender-go-no-go-confirm-title" onMouseDown={event => event.stopPropagation()}>
        <header><h4 id="tender-go-no-go-confirm-title" tabIndex={-1} ref={initialFocusRef}>Confirmar {selectedDecision === 'go' ? 'GO' : 'NO GO'}</h4><button type="button" className="secondary" onClick={close} disabled={busy} aria-label="Cerrar confirmación">Cerrar</button></header>
        <p className="tender-go-no-go-confirmation"><strong>Decisión elegida:</strong> {selectedDecision === 'go' ? 'Registrar GO e iniciar la preparación de la oferta.' : 'Registrar NO GO y cerrar el proceso.'}</p>
        {analysisWarnings.length > 0 && <div className="notice" role="alert"><ul>{analysisWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        <label>Comentario opcional<textarea value={justification} onChange={event => setJustification(event.target.value)} disabled={busy} placeholder="Puede documentar brevemente el criterio de la decisión." /></label>
        <footer><button type="button" className="secondary" onClick={close} disabled={busy}>Cancelar</button><button type="button" className={selectedDecision === 'no_go' ? 'danger' : ''} onClick={() => void submit()} disabled={busy || syncPending}>{busy ? 'Registrando…' : 'Confirmar decisión'}</button></footer>
      </div>
    </div>}
  </section>;
}
