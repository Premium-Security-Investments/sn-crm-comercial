import React, { useEffect, useMemo, useState } from 'react';
import { loadTenderGoNoGoDecision, recordTenderGoNoGoDecision } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import type { TenderCurrentProfile, TenderDocumentAnalysis, TenderGoNoGoDecision, TenderGoNoGoPayload, TenderRequest } from '../types';

type Decision = 'go' | 'no_go';
export type TenderGoNoGoDecisionPanelProps = {
  opportunityId: string;
  analysis: TenderDocumentAnalysis | null;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  onChanged: () => Promise<void> | void;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';
const decisionLabel = (value?: string | null) => value === 'go' ? 'GO autorizado' : value === 'no_go' ? 'NO GO registrado' : 'Pendiente de decisión';

export function TenderGoNoGoDecisionPanel({ opportunityId, analysis, currentProfile, request, onChanged }: TenderGoNoGoDecisionPanelProps) {
  const [payload, setPayload] = useState<TenderGoNoGoPayload>({ decision: null, history: [], preparation: null });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [justification, setJustification] = useState('');
  const allowed = canApproveTenderGoNoGo(currentProfile);
  const hasCurrentAnalysis = Boolean(analysis?.interaction_id && UUID.test(analysis.interaction_id));
  const risks = useMemo(() => [analysis?.risk, ...(analysis?.findings || []), ...(analysis?.commercial_fit?.concerns || [])].filter((item): item is string => Boolean(item && item.trim())), [analysis]);
  const load = async () => {
    setLoading(true);
    try { setPayload(await loadTenderGoNoGoDecision(request, opportunityId)); setStatus(''); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [opportunityId]);
  const close = () => { if (!busy) { setSelectedDecision(null); setJustification(''); } };
  const submit = async () => {
    if (!selectedDecision || !analysis || !analysis.interaction_id || !UUID.test(analysis.interaction_id) || busy) return;
    const submittedDecision = selectedDecision;
    setBusy(true); setStatus('Registrando decisión formal…');
    try {
      await recordTenderGoNoGoDecision(request, {
        opportunity_id: opportunityId,
        decision: submittedDecision,
        analysis_interaction_id: analysis.interaction_id,
        justification: justification.trim() || null,
      });
      setSelectedDecision(null); setJustification('');
      await load();
      await onChanged?.();
      setStatus(submittedDecision === 'go' ? 'GO autorizado y expediente de oferta actualizado.' : 'NO GO registrado; el expediente queda en solo lectura.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const current = payload.decision;
  return <section className="tender-go-no-go-panel" aria-labelledby="tender-go-no-go-heading">
    <header className="tender-go-no-go-head">
      <div><span className="eyebrow">Control formal de licitación</span><h3 id="tender-go-no-go-heading">Decisión GO / NO GO</h3><p>La recomendación asistida no autoriza la oferta. La decisión humana queda auditada y no se edita ni elimina.</p></div>
      <div className="tender-go-no-go-status"><small>Decisión vigente</small><strong>{loading ? 'Cargando…' : decisionLabel(current?.decision)}</strong><span>{current ? `${current.psi_sales_profiles?.full_name || current.decided_by} · ${date(current.decided_at)}` : 'Sin decisión humana registrada'}</span></div>
    </header>
    <div className="tender-go-no-go-grid">
      <article><small>Recomendación del sistema</small><strong>{analysis?.recommendation || 'Análisis pendiente'}</strong><p>{analysis?.summary || 'Hace falta un análisis documental vigente para proponer una decisión formal.'}</p></article>
      <article><small>Decisión humana</small><strong>{decisionLabel(current?.decision)}</strong><p>{current?.justification || 'Aún no hay justificación registrada.'}</p>{current && <span>Actor: {current.psi_sales_profiles?.full_name || current.decided_by} · {date(current.decided_at)}</span>}</article>
    </div>
    <div className="tender-go-no-go-risks"><strong>Riesgos y hallazgos relevantes</strong>{risks.length ? <ul>{risks.slice(0, 6).map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul> : <p>Sin riesgos adicionales reportados por el análisis vigente.</p>}</div>
    {status && <div className="notice" role="status">{status}</div>}
    {allowed ? <div className="tender-go-no-go-actions">
      <button type="button" onClick={() => setSelectedDecision('go')} disabled={!hasCurrentAnalysis || busy}>Autorizar GO</button>
      <button type="button" className="danger" onClick={() => setSelectedDecision('no_go')} disabled={!hasCurrentAnalysis || busy}>Registrar NO GO</button>
      {!hasCurrentAnalysis && <p className="muted">Hace falta un análisis vigente con identificador válido antes de registrar una decisión.</p>}
    </div> : <p className="muted">Solo Admin, Gerencia o Dirección de Licitaciones con permiso pueden registrar una decisión. La decisión vigente permanece disponible en solo lectura.</p>}
    <section className="tender-go-no-go-history" aria-label="Historial inmutable de decisiones"><strong>Historial inmutable</strong>{loading ? <p>Cargando historial…</p> : payload.history.length ? <ol>{payload.history.map((entry: TenderGoNoGoDecision) => <li key={entry.id}><strong>{decisionLabel(entry.decision)}</strong><span>{entry.psi_sales_profiles?.full_name || entry.decided_by} · {date(entry.decided_at)}</span>{entry.justification && <p>{entry.justification}</p>}</li>)}</ol> : <p>Sin entradas previas.</p>}</section>
    {selectedDecision && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={close}>
      <div className="tender-go-no-go-dialog" role="dialog" aria-modal="true" aria-labelledby="tender-go-no-go-confirm-title" onMouseDown={event => event.stopPropagation()}>
        <header><h4 id="tender-go-no-go-confirm-title">Confirmar {selectedDecision === 'go' ? 'GO' : 'NO GO'}</h4><button type="button" className="secondary" onClick={close} disabled={busy} aria-label="Cerrar confirmación">Cerrar</button></header>
        <dl><dt>Oportunidad</dt><dd>{opportunityId}</dd><dt>Recomendación del sistema</dt><dd>{analysis?.recommendation || 'No disponible'}</dd><dt>Riesgo</dt><dd>{risks[0] || analysis?.risk || 'No reportado'}</dd><dt>Decisión elegida</dt><dd>{selectedDecision === 'go' ? 'Autorizar GO' : 'Registrar NO GO'}</dd></dl>
        <label>Justificación opcional<textarea value={justification} onChange={event => setJustification(event.target.value)} disabled={busy} placeholder="Explique brevemente el criterio de la decisión." /></label>
        <footer><button type="button" className="secondary" onClick={close} disabled={busy}>Cancelar</button><button type="button" className={selectedDecision === 'no_go' ? 'danger' : ''} onClick={() => void submit()} disabled={busy}>{busy ? 'Registrando…' : 'Confirmar decisión'}</button></footer>
      </div>
    </div>}
  </section>;
}
