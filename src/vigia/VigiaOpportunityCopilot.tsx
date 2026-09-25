import React, { useEffect, useRef, useState } from 'react';
import { VIGIA_VISIBLE_NAMES } from './agentIdentity';
import {
  beginCopilotGeneration,
  canGenerateCopilotFollowup,
  changeCopilotOpportunity,
  changeCopilotPreparation,
  completeCopilotGeneration,
  copilotClipboardPayload,
  createOpportunityCopilotState,
  editCopilotDraft,
  failCopilotGeneration,
  setCopilotCommercialIntent,
  setCopilotContactChannel,
  type ContactChannel,
  type CopilotResult,
} from './opportunity-copilot-state';
import {
  buildCommercialAlerts,
  COMMERCIAL_PREFLIGHT_EXPLANATION,
  type CommercialPreflightInput,
} from './opportunity-preflight-presentation';
import { presentCopilotBrief, presentCompactCopilotSummary, type CopilotPresentationBrief } from './copilot-presentation';

type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Props = {
  opportunityId: string;
  request: Request;
  preflight: CommercialPreflightInput;
};

type ProposalDraft = { subject: string | null; body: string };
type ProposalProps = {
  brief: CopilotPresentationBrief;
  draft: ProposalDraft;
  channel: ContactChannel | null;
  alerts: ReturnType<typeof buildCommercialAlerts>;
  onDraftChange: (patch: Partial<ProposalDraft>) => void;
  onCopy: () => void;
  onChangePreparation: () => void;
};

export function VigiaCommercialAlerts({ alerts }: { alerts: ReturnType<typeof buildCommercialAlerts> }) {
  return <section className="notice vigia-preflight-alerts" aria-labelledby="vigia-preflight-title">
    <h4 id="vigia-preflight-title">Alertas comerciales</h4>
    {alerts.length === 0
      ? <p className="muted">Sin alertas comerciales detectadas.</p>
      : <>
          <p>{COMMERCIAL_PREFLIGHT_EXPLANATION}</p>
          <ul>{alerts.map(alert => <li key={alert.key}>
            {alert.risk_text}
          </li>)}</ul>
        </>}
  </section>;
}

const CONFIDENCE_LABEL: Record<'low' | 'medium' | 'high', string> = { low: 'Baja', medium: 'Media', high: 'Alta' };

export function VigiaCopilotProposal({ brief, draft, channel, alerts, onDraftChange, onCopy, onChangePreparation }: ProposalProps) {
  const presented = presentCopilotBrief(brief);
  const compact = presentCompactCopilotSummary(presented, alerts);
  const isEmail = channel === 'email';
  return <div className="vigia-copilot-result">
    <p role="status" className="sr-only">Propuesta preparada para revisión.</p>
    <header className="vigia-copilot-proposal-header">
      <h4>Propuesta de seguimiento</h4>
      <button type="button" className="secondary" onClick={onChangePreparation}>Cambiar preparación</button>
    </header>
    <section className="vigia-copilot-brief">
      <div className="vigia-copilot-brief-row"><strong>Situación actual</strong><p>{presented.summary}</p></div>
      <div className="vigia-copilot-brief-row"><strong>Información por confirmar</strong><p>{presented.missingSummary}</p></div>
      <div className="vigia-copilot-brief-row"><strong>Objetivo del próximo contacto</strong><p>{presented.contactObjective}</p></div>
    </section>
    {compact.nextStep && <div className="vigia-copilot-next-step">
      <strong>Siguiente paso:</strong> <span>{compact.nextStep}</span>
    </div>}
    <div className="vigia-copilot-draft">{isEmail && <label>Asunto<input value={draft.subject ?? ''} maxLength={300} onChange={event => onDraftChange({ subject: event.target.value })}/></label>}<label>Cuerpo<textarea value={draft.body} maxLength={8000} rows={10} onChange={event => onDraftChange({ body: event.target.value })}/></label></div>
    <div className="vigia-human-warning"><strong>Revisión humana</strong><span>Puede editar esta propuesta sin modificar el historial de la oportunidad. Verifique nombres, fechas, compromisos y tono antes de copiar el mensaje.</span></div>
    <div className="vigia-copilot-actions"><button type="button" onClick={onCopy}>{isEmail ? 'Copiar correo' : 'Copiar WhatsApp'}</button></div>
    <details className="vigia-copilot-context">
      <summary>Contexto y evidencia · {presented.facts.length} datos · {presented.inferences.length} inferencias · {presented.missingInformation.length} pendientes</summary>
      <section><h5>Datos utilizados</h5>{presented.facts.length ? <ul>{presented.facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}</li>)}</ul> : <p className="muted">Sin datos adicionales.</p>}</section>
      <section><h5>Inferencias de Vig-IA · por confirmar</h5>{presented.inferences.length ? <ul>{presented.inferences.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <span className={`vigia-copilot-confidence confidence-${item.confidence}`}>{CONFIDENCE_LABEL[item.confidence]}</span></li>)}</ul> : <p className="muted">Sin inferencias.</p>}</section>
      <section><h5>Información no verificada</h5>{presented.missingInformation.length ? <ul>{presented.missingInformation.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">Sin brechas de información registradas.</p>}</section>
      {presented.hasApprovedAssets && <section><h5>Adjuntos sugeridos</h5><ul>{presented.recommendedAssetIds.map(id => <li key={id}>{id}</li>)}</ul></section>}
    </details>
  </div>;
}

export function VigiaOpportunityCopilot({ opportunityId, request, preflight }: Props) {
  const [state, setState] = useState(() => createOpportunityCopilotState(opportunityId));
  const [notice, setNotice] = useState('');
  const intentFieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setState(current => changeCopilotOpportunity(current, opportunityId));
    setNotice('');
  }, [opportunityId]);

  const generate = () => {
    setNotice('');
    setState(current => {
      if (!canGenerateCopilotFollowup(current)) return current;
      const { requestId, state: loadingState } = beginCopilotGeneration(current);
      const requestedOpportunityId = opportunityId;
      const channel = current.preparation.contactChannel;
      const rawIntent = intentFieldRef.current?.value ?? current.preparation.commercialIntent;
      const intent = String(rawIntent).trim().slice(0, 500);
      void request<CopilotResult>('/api/vigia/copilot/generate', {
        method: 'POST',
        body: JSON.stringify({ opportunity_id: requestedOpportunityId, contact_channel: channel, commercial_intent: intent || undefined }),
      }).then(result => {
        setState(next => completeCopilotGeneration(next, { opportunityId: requestedOpportunityId, requestId, result }));
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        setState(next => failCopilotGeneration(next, { opportunityId: requestedOpportunityId, requestId, message }));
      });
      return loadingState;
    });
  };

  const copyDraft = async () => {
    if (state.phase !== 'ready') return;
    await navigator.clipboard.writeText(copilotClipboardPayload(state).text);
    setNotice('Borrador copiado. Revísalo antes de usarlo.');
  };

  const alerts = buildCommercialAlerts(preflight);
  const ready = state.phase === 'ready' ? state : null;
  const brief = ready?.result.output.brief;
  const showForm = state.phase === 'idle' || state.phase === 'loading';

  return <section className="vigia-opportunity-copilot" aria-labelledby="vigia-copilot-title">
    <header><div><span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial}</span><h3 id="vigia-copilot-title">Próximo seguimiento</h3><p>Analiza el contexto y propone un siguiente paso de seguimiento</p></div></header>
    <VigiaCommercialAlerts alerts={alerts} />
    {showForm && <div className="vigia-copilot-generate">
      <fieldset className="vigia-copilot-channel">
        <legend>¿Cómo será el próximo contacto?</legend>
        <label><input type="radio" name="contact_channel" value="whatsapp" checked={state.preparation.contactChannel === 'whatsapp'} onChange={() => setState(current => setCopilotContactChannel(current, 'whatsapp'))}/> WhatsApp</label>
        <label><input type="radio" name="contact_channel" value="email" checked={state.preparation.contactChannel === 'email'} onChange={() => setState(current => setCopilotContactChannel(current, 'email'))}/> Correo</label>
      </fieldset>
      <label>¿Qué necesita lograr con este contacto?<textarea ref={intentFieldRef} maxLength={500} defaultValue={state.preparation.commercialIntent} onChange={event => setState(current => setCopilotCommercialIntent(current, event.target.value))}/></label>
      <button type="button" disabled={state.phase === 'loading' || !canGenerateCopilotFollowup(state)} onClick={generate}>Generar seguimiento</button>
    </div>}
    {state.phase === 'idle' && <div className="vigia-copilot-empty"><p className="muted">Prepara un borrador editable de seguimiento, separado del registro original.</p></div>}
    {state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
    {state.phase === 'error' && <div className="vigia-copilot-error" role="alert">
      <span>No se pudo preparar el seguimiento. Puede continuar registrándolo manualmente.</span>
      <button type="button" className="secondary" onClick={generate}>Reintentar</button>
    </div>}
    {ready && brief && <VigiaCopilotProposal
      key={ready.requestId}
      brief={brief}
      draft={ready.draft}
      channel={ready.preparation.contactChannel}
      alerts={alerts}
      onDraftChange={patch => setState(current => editCopilotDraft(current, patch))}
      onCopy={() => void copyDraft()}
      onChangePreparation={() => setState(current => changeCopilotPreparation(current))}
    />}
    {notice && <div className="notice" role="status">{notice}</div>}
  </section>;
}
