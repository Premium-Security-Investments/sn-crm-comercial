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

type Request = <T>(url: string, options?: RequestInit) => Promise<T>;
type Props = { opportunityId: string; request: Request };

export function VigiaOpportunityCopilot({ opportunityId, request }: Props) {
  const [state, setState] = useState(() => createOpportunityCopilotState(opportunityId));
  const [notice, setNotice] = useState('');
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setState(current => changeCopilotOpportunity(current, opportunityId));
    setNotice('');
  }, [opportunityId]);

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

  const feedback = async (rating: 'useful' | 'needs_changes') => {
    if (state.phase !== 'ready') return;
    try {
      await request('/api/vigia/copilot/feedback', {
        method: 'POST',
        body: JSON.stringify({ opportunity_id: opportunityId, run_id: state.result.run_id, rating }),
      });
      setNotice(rating === 'useful' ? 'Feedback útil registrado.' : 'Feedback de cambios registrado.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const ready = state.phase === 'ready' ? state : null;
  const brief = ready?.result.output.brief;
  return <section className="vigia-opportunity-copilot" aria-labelledby="vigia-copilot-title">
    <header><div><span className="eyebrow">{VIGIA_VISIBLE_NAMES.commercial}</span><h3 id="vigia-copilot-title">Próximo seguimiento</h3><p>Analiza el contexto y propone un siguiente paso de seguimiento</p></div>{state.phase !== 'loading' && <button type="button" onClick={generate}>Preparar seguimiento</button>}</header>
    {state.phase === 'idle' && <p className="muted">Genera una propuesta editable y separada del registro original.</p>}
    {state.phase === 'loading' && <div className="notice" role="status">{VIGIA_VISIBLE_NAMES.commercial} está preparando un borrador acotado…</div>}
    {state.phase === 'error' && <div className="error" role="alert"><strong>No fue posible generar el borrador.</strong><p>{state.message}</p></div>}
    {ready && brief && <div className="vigia-copilot-result">
      <details><summary><strong>Resumen de {VIGIA_VISIBLE_NAMES.commercial}</strong><span>{brief.summary}</span></summary>
        <div className="vigia-copilot-evidence"><section><h4>Hechos observados</h4>{brief.facts.length ? <ul>{brief.facts.map((fact, index) => <li key={`${fact.text}-${index}`}>{fact.text}</li>)}</ul> : <p className="muted">Sin hechos adicionales.</p>}</section><section><h4>Inferencias</h4>{brief.inferences.length ? <ul>{brief.inferences.map((item, index) => <li key={`${item.text}-${index}`}>{item.text} <small>Confianza {item.confidence}</small></li>)}</ul> : <p className="muted">Sin inferencias.</p>}</section></div>
      </details>
      {brief.missing_information.length > 0 && <section><h4>Información faltante</h4><ul>{brief.missing_information.map(item => <li key={item}>{item}</li>)}</ul></section>}
      <div className="grid two"><div><small>Objetivo de contacto</small><p>{brief.contact_objective}</p></div><div><small>Estrategia sugerida</small><p>{brief.strategy}</p></div></div>
      <div className="vigia-copilot-draft"><label>Asunto<input value={ready.draft.subject} maxLength={300} onChange={event => setState(current => editCopilotDraft(current, { subject: event.target.value }))}/></label><label>Cuerpo<textarea value={ready.draft.body} maxLength={8000} rows={10} onChange={event => setState(current => editCopilotDraft(current, { body: event.target.value }))}/></label></div>
      {brief.recommended_asset_ids.length > 0 && <section><h4>Adjuntos sugeridos</h4><ul>{brief.recommended_asset_ids.map(id => <li key={id}>{id}</li>)}</ul></section>}
      {brief.warnings.length > 0 && <div className="notice"><strong>Advertencias</strong><ul>{brief.warnings.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <div className="vigia-human-warning"><strong>Revisión humana obligatoria</strong><span>La edición es local y no altera el run original. Verifica hechos, compromisos y tono antes de usar el texto.</span></div>
      <div className="vigia-copilot-actions"><button type="button" onClick={() => void copyDraft()}>Copiar</button><button type="button" className="secondary" onClick={() => { setState(current => discardCopilotDraft(current)); setNotice('Borrador descartado localmente.'); }}>Descartar</button><button type="button" className="secondary" onClick={() => void feedback('useful')}>Útil</button><button type="button" className="secondary" onClick={() => void feedback('needs_changes')}>Necesita cambios</button></div>
    </div>}
    {notice && <div className="notice" role="status">{notice}</div>}
  </section>;
}
