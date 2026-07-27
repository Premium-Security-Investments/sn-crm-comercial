import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadTenderGoNoGoDecision, recordTenderGoNoGoDecision } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import { tenderDecisionGate, tenderRecommendationLabel } from '../tenderDecisionGate';
import type { TenderPanelState } from '../detailNavigationState';
import type { TenderCurrentProfile, TenderDocumentAnalysis, TenderGoNoGoDecision, TenderGoNoGoPayload, TenderRequest } from '../types';

type Decision = 'go' | 'no_go';
export type TenderGoNoGoDecisionPanelProps = {
  opportunityId: string;
  opportunityName: string;
  analysis: TenderDocumentAnalysis | null;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  onChanged: () => Promise<void> | void;
  onNavigationStateChanged?: (state: TenderPanelState<TenderGoNoGoDecision | null>) => void;
};

const EMPTY_PAYLOAD: TenderGoNoGoPayload = { decision: null, history: [], preparation: null };
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
const decisionLabel = (value?: string | null) => value === 'go' ? 'GO registrado' : value === 'no_go' ? 'NO GO registrado' : 'Pendiente de decisión';

export function TenderGoNoGoDecisionPanel({ opportunityId, opportunityName, analysis, currentProfile, request, onChanged, onNavigationStateChanged }: TenderGoNoGoDecisionPanelProps) {
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
  const recommendation = tenderRecommendationLabel(analysis?.recommendation);
  const analysisWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (!analysis) warnings.push('El análisis no está disponible. La decisión humana autorizada permanece habilitada.');
    else {
      if (analysis.status === 'failed') warnings.push('El análisis falló. Revise el expediente antes de decidir.');
      if (analysis.current === false) warnings.push('El análisis está obsoleto frente al expediente vigente.');
      if ((analysis.critical_open_count ?? 0) > 0) warnings.push(`Hay ${analysis.critical_open_count} preguntas críticas abiertas.`);
      if (recommendation === 'Información insuficiente') warnings.push('La recomendación indica Información insuficiente.');
      const recommendationContradictsDecision = (selectedDecision === 'go' && recommendation === 'NO GO recomendado')
        || (selectedDecision === 'no_go' && recommendation === 'GO recomendado');
      if (recommendationContradictsDecision) warnings.push('Advertencia: recomendación contraria a la decisión humana elegida.');
    }
    return warnings;
  }, [analysis, recommendation, selectedDecision]);

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
      if (activeOpportunityRef.current === opportunityId) setSyncPending(false);
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
    <header className="tender-go-no-go-head">
      <div><span className="eyebrow">Control formal de licitación</span><h3 id="tender-go-no-go-heading">Decisión GO / NO GO</h3><p>La recomendación asistida no autoriza la oferta. La decisión humana queda auditada y no se edita ni elimina.</p></div>
      <div className="tender-go-no-go-status"><small>Decisión vigente</small><strong>{loading ? 'Cargando…' : decisionLabel(current?.decision)}</strong><span>{current ? `${current.psi_sales_profiles?.full_name || current.decided_by} · ${date(current.decided_at)}` : 'Sin decisión humana registrada'}</span></div>
    </header>
    <div className="tender-go-no-go-grid">
      <article><small>Recomendación del sistema</small><strong>{recommendation}</strong></article>
      <article><small>Decisión humana</small><strong>{decisionLabel(current?.decision)}</strong><p>{current?.justification || 'Sin comentario humano.'}</p>{current && <span>Actor: {current.psi_sales_profiles?.full_name || current.decided_by} · {date(current.decided_at)}</span>}</article>
    </div>

    {analysisWarnings.length > 0 && <div className="notice" role="alert"><strong>Advertencias del análisis</strong><ul>{analysisWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul><p>Estas advertencias no autorizan ni bloquean la decisión humana.</p></div>}
    {status && <div className="notice" role="status">{status}</div>}
    {syncPending && <div className="tender-go-no-go-actions"><button type="button" className="secondary" onClick={() => void reconcile()} disabled={busy}>{busy ? 'Actualizando…' : 'Reintentar actualización'}</button></div>}
    {allowed ? <div className="tender-go-no-go-actions">
      <button type="button" onClick={event => open('go', event.currentTarget)} disabled={!decisionGate.canGo || busy || loading || syncPending}>Registrar GO</button>
      <button type="button" className="danger" onClick={event => open('no_go', event.currentTarget)} disabled={!decisionGate.canNoGo || busy || loading || syncPending}>Registrar NO GO</button>
      <p className="muted">AGT-002 recomienda; la persona autorizada conserva la autoridad absoluta para GO o NO GO.</p>
    </div> : <p className="muted">Solo Admin, Gerencia o Dirección de Licitaciones con permiso pueden registrar una decisión. La decisión vigente permanece disponible en solo lectura.</p>}
    <section className="tender-go-no-go-history" aria-label="Historial inmutable de decisiones"><strong>Historial inmutable</strong>{loading ? <p>Cargando historial…</p> : payload.history.length ? <ol>{payload.history.map(entry => <li key={entry.id}><strong>{decisionLabel(entry.decision)}</strong><span>{entry.psi_sales_profiles?.full_name || entry.decided_by} · {date(entry.decided_at)}</span>{entry.justification && <p>{entry.justification}</p>}</li>)}</ol> : <p>Sin entradas previas.</p>}</section>
    {selectedDecision && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={close}>
      <div className="tender-go-no-go-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="tender-go-no-go-confirm-title" onMouseDown={event => event.stopPropagation()}>
        <header><h4 id="tender-go-no-go-confirm-title" tabIndex={-1} ref={initialFocusRef}>Confirmar {selectedDecision === 'go' ? 'GO' : 'NO GO'}</h4><button type="button" className="secondary" onClick={close} disabled={busy} aria-label="Cerrar confirmación">Cerrar</button></header>
        <dl><dt>Oportunidad</dt><dd>{opportunityName}</dd><dt>Referencia</dt><dd>{opportunityId}</dd><dt>Recomendación del sistema</dt><dd>{recommendation}</dd><dt>Decisión elegida</dt><dd>{selectedDecision === 'go' ? 'Registrar GO' : 'Registrar NO GO'}</dd></dl>
        {analysisWarnings.length > 0 && <div className="notice" role="alert"><ul>{analysisWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        <label>Comentario opcional<textarea value={justification} onChange={event => setJustification(event.target.value)} disabled={busy} placeholder="Puede documentar brevemente el criterio de la decisión." /></label>
        <footer><button type="button" className="secondary" onClick={close} disabled={busy}>Cancelar</button><button type="button" className={selectedDecision === 'no_go' ? 'danger' : ''} onClick={() => void submit()} disabled={busy || syncPending}>{busy ? 'Registrando…' : 'Confirmar decisión'}</button></footer>
      </div>
    </div>}
  </section>;
}
