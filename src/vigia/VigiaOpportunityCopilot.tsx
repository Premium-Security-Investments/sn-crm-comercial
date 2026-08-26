import React, { useEffect, useRef, useState } from 'react';
import { VIGIA_VISIBLE_NAMES } from './agentIdentity';
import {
  beginCopilotGeneration,
  changeCopilotOpportunity,
  completeCopilotGeneration,
  createOpportunityCopilotState,
  discardCopilotDraft,
  editCopilotDraft,
  failCopilotGeneration,
  type CopilotResult,
} from './opportunity-copilot-state';
import {
  beginPreflightAnalysis,
  completePreflightAnalysis,
  createOpportunityPreflightState,
  failPreflightAnalysis,
  invalidateStalePreflight,
  type OpportunityPreflightState,
  type PreflightResult,
} from './opportunity-preflight-state';
import {
  buildCommercialAlerts,
  COMMERCIAL_PREFLIGHT_EXPLANATION,
  mergeCommercialAlertsWithPreflight,
  normalizePreflightErrorMessage,
  type CommercialAlert,
  type CommercialPreflightInput,
  type ConsolidatedPreflightAction,
} from './opportunity-preflight-presentation';
import { normalizeCopilotErrorMessage, presentCopilotBrief, type CopilotPresentationBrief } from './copilot-presentation';

type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Props = {
  opportunityId: string;
  request: Request;
  preflight: CommercialPreflightInput;
  contextVersion: string;
};

type ProposalDraft = { subject: string; body: string };
type ProposalProps = {
  brief: CopilotPresentationBrief;
  draft: ProposalDraft;
  onDraftChange: (patch: Partial<ProposalDraft>) => void;
  onCopy: () => void;
  onDiscard: () => void;
};

export function VigiaCommercialAlerts({ alerts }: { alerts: CommercialAlert[] }) {
  return <section className="notice vigia-preflight-alerts" aria-labelledby="vigia-preflight-title">
    <h4 id="vigia-preflight-title">Alertas comerciales</h4>
    {alerts.length === 0
      ? <p className="muted">Sin alertas comerciales detectadas.</p>
      : <>
          <p>{COMMERCIAL_PREFLIGHT_EXPLANATION}</p>
          <ul>{alerts.map(alert => <li key={alert.key}>
            {alert.risk_text}
            {alert.contextualAction && <p className="vigia-preflight-context">{alert.contextualAction.description}</p>}
          </li>)}</ul>
        </>}
  </section>;
}

type PreflightAnalysisProps = {
  phase: OpportunityPreflightState['phase'];
  standaloneActions: ConsolidatedPreflightAction[];
  onAnalyze: () => void;
  onRetry: () => void;
  errorMessage: string | null;
};

export function VigiaPreflightAnalysis({
  phase,
  standaloneActions,
  onAnalyze,
  onRetry,
  errorMessage,
}: PreflightAnalysisProps) {
  return <section className="vigia-preflight-analysis" aria-labelledby="vigia-preflight-analysis-title">
    <h4 id="vigia-preflight-analysis-title">Análisis inteligente del seguimiento</h4>
    {phase === 'idle' && <button type="button" onClick={onAnalyze}>Analizar cómo fortalecer el seguimiento</button>}
    {phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está revisando el historial de la oportunidad…</div>}
    {phase === 'error' && <div className="error" role="alert"><strong>No fue posible analizar el historial.</strong>{errorMessage && <p>{normalizePreflightErrorMessage(errorMessage)}</p>}<button type="button" onClick={onRetry}>Reintentar</button></div>}
    {phase === 'ready' && <>
      {standaloneActions.length === 0
        ? <p className="muted">Vig-IA no encontró acciones adicionales fuera de las alertas comerciales.</p>
        : <ul className="vigia-preflight-standalone">{standaloneActions.map(action => <li key={action.issue_code}><strong>{action.title}</strong><p>{action.description}</p></li>)}</ul>}
      <button type="button" className="secondary" onClick={onAnalyze}>Actualizar análisis</button>
    </>}
  </section>;
}

// La propuesta final no repite riesgos ni faltantes: abre con un plan numerado, mantiene el correo
// editable y deja el contexto plegado al final. La revisión humana queda junto a las acciones.
export function VigiaCopilotProposal({ brief, draft, onDraftChange, onCopy, onDiscard }: ProposalProps) {
  const presented = presentCopilotBrief(brief);
  return <div className="vigia-copilot-result">
    <section className="vigia-copilot-plan"><h4>Plan de contacto</h4><ol>{presented.contactPlanSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></section>
    <div className="vigia-copilot-draft"><label>Asunto<input value={draft.subject} maxLength={300} onChange={event => onDraftChange({ subject: event.target.value })}/></label><label>Cuerpo<textarea value={draft.body} maxLength={8000} rows={10} onChange={event => onDraftChange({ body: event.target.value })}/></label></div>
    <div className="vigia-copilot-actions"><button type="button" onClick={onCopy}>Copiar correo</button><button type="button" className="secondary" onClick={onDiscard}>Descartar</button></div>
    <div className="vigia-human-warning"><strong>Revisión humana</strong><span>Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.</span></div>
    <details className="vigia-copilot-context"><summary>Contexto analizado</summary>
      <p>{presented.summary}</p>
      <div><small>Objetivo de contacto</small><p>{presented.contactObjective}</p></div>
      <section><h5>Hechos observados</h5>{presented.facts.length ? <ul>{presented.facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}</li>)}</ul> : <p className="muted">Sin hechos adicionales.</p>}</section>
      <section><h5>Inferencias</h5>{presented.inferences.length ? <ul>{presented.inferences.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <small>Confianza {item.confidence}</small></li>)}</ul> : <p className="muted">Sin inferencias.</p>}</section>
      {presented.hasApprovedAssets && <section><h5>Adjuntos sugeridos</h5><ul>{presented.recommendedAssetIds.map(id => <li key={id}>{id}</li>)}</ul></section>}
    </details>
  </div>;
}

export function VigiaOpportunityCopilot({ opportunityId, request, preflight, contextVersion }: Props) {
  const [state, setState] = useState(() => createOpportunityCopilotState(opportunityId));
  const [preflightState, setPreflightState] = useState(() => createOpportunityPreflightState(opportunityId, contextVersion));
  const [acknowledgedNoPreflight, setAcknowledgedNoPreflight] = useState(false);
  const [notice, setNotice] = useState('');
  const requestSequenceRef = useRef(0);
  const preflightRequestSequenceRef = useRef(0);
  const currentOpportunityIdRef = useRef(opportunityId);
  const currentContextVersionRef = useRef(contextVersion);
  currentOpportunityIdRef.current = opportunityId;
  currentContextVersionRef.current = contextVersion;

  useEffect(() => {
    requestSequenceRef.current += 1;
    setState(current => changeCopilotOpportunity(current, opportunityId));
    setNotice('');
  }, [opportunityId]);

  useEffect(() => {
    setPreflightState(current => invalidateStalePreflight(current, opportunityId, contextVersion));
    setAcknowledgedNoPreflight(false);
  }, [opportunityId, contextVersion]);

  useEffect(() => {
    if (preflightState.phase === 'idle') setAcknowledgedNoPreflight(false);
  }, [preflightState.phase]);

  const runPreflight = () => {
    const requestId = ++preflightRequestSequenceRef.current;
    const requestedOpportunityId = opportunityId;
    setPreflightState(current => {
      const fresh = invalidateStalePreflight(current, opportunityId, contextVersion);
      return beginPreflightAnalysis(fresh, requestId).state;
    });
    void request<{ status: 'completed'; actions: PreflightResult['actions'] }>('/api/vigia/copilot/preflight', {
      method: 'POST',
      body: JSON.stringify({ opportunity_id: requestedOpportunityId }),
    }).then(response => {
      setPreflightState(current => {
        const completed = completePreflightAnalysis(current, {
          opportunityId: requestedOpportunityId,
          requestId,
          result: { actions: response.actions },
          currentContextFingerprint: currentContextVersionRef.current,
        });
        return invalidateStalePreflight(completed, currentOpportunityIdRef.current, currentContextVersionRef.current);
      });
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setPreflightState(current => {
        const failed = failPreflightAnalysis(current, { opportunityId: requestedOpportunityId, requestId, message });
        return invalidateStalePreflight(failed, currentOpportunityIdRef.current, currentContextVersionRef.current);
      });
    });
  };

  const generate = () => {
    const requestId = ++requestSequenceRef.current;
    setState(current => beginCopilotGeneration(current, requestId).state);
    const requestedOpportunityId = opportunityId;
    setNotice('');
    void request<CopilotResult>('/api/vigia/copilot/generate', {
      method: 'POST',
      body: JSON.stringify({ opportunity_id: requestedOpportunityId }),
    }).then(result => {
      setState(current => completeCopilotGeneration(current, { opportunityId: requestedOpportunityId, requestId, result }));
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      setState(current => failCopilotGeneration(current, { opportunityId: requestedOpportunityId, requestId, message }));
    });
  };

  const copyDraft = async () => {
    if (state.phase !== 'ready') return;
    await navigator.clipboard.writeText(`${state.draft.subject}\n\n${state.draft.body}`);
    setNotice('Borrador copiado. Revísalo antes de usarlo.');
  };

  const baseAlerts = buildCommercialAlerts(preflight);
  const merged = preflightState.phase === 'ready'
    ? mergeCommercialAlertsWithPreflight(baseAlerts, preflightState.result.actions)
    : { alerts: baseAlerts.map(alert => ({ ...alert, contextualAction: null })), standaloneActions: [] };
  const canGenerate = state.phase !== 'loading'
    && preflightState.phase !== 'loading'
    && (preflightState.phase === 'ready' || acknowledgedNoPreflight);
  const ready = state.phase === 'ready' ? state : null;
  const brief = ready?.result.output.brief;

  return <section className="vigia-opportunity-copilot" aria-labelledby="vigia-copilot-title">
    <header><div><span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial}</span><h3 id="vigia-copilot-title">Próximo seguimiento</h3><p>Analiza el contexto y propone un siguiente paso de seguimiento</p></div></header>
    <VigiaCommercialAlerts alerts={merged.alerts} />
    <VigiaPreflightAnalysis
      phase={preflightState.phase}
      standaloneActions={merged.standaloneActions}
      onAnalyze={runPreflight}
      onRetry={runPreflight}
      errorMessage={preflightState.phase === 'error' ? preflightState.message : null}
    />
    <div className="vigia-copilot-generate">
      {preflightState.phase !== 'ready' && preflightState.phase !== 'loading' && <label className="vigia-preflight-ack">
        <input type="checkbox" checked={acknowledgedNoPreflight} onChange={event => setAcknowledgedNoPreflight(event.target.checked)} />
        Entiendo que no se ejecutó el análisis inteligente antes de generar.
      </label>}
      <button type="button" disabled={!canGenerate} onClick={generate}>{ready ? 'Actualizar propuesta con el contexto actual' : 'Generar propuesta con el contexto actual'}</button>
    </div>
    {state.phase === 'idle' && <div className="vigia-copilot-empty"><p className="muted">Genera una propuesta editable y separada del registro original.</p></div>}
    {state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
    {state.phase === 'error' && <div className="error" role="alert"><strong>No fue posible generar el borrador.</strong><p>{normalizeCopilotErrorMessage(state.message)}</p></div>}
    {ready && brief && <VigiaCopilotProposal
      brief={brief}
      draft={ready.draft}
      onDraftChange={patch => setState(current => editCopilotDraft(current, patch))}
      onCopy={() => void copyDraft()}
      onDiscard={() => { setState(current => discardCopilotDraft(current)); setNotice('Borrador descartado localmente.'); }}
    />}
    {notice && <div className="notice" role="status">{notice}</div>}
  </section>;
}
