// AGT-003 — Premio "análisis profundo" en la ficha (Juan, 2026-10-08): se gana con perfil completo 8/8.
import { useEffect, useState } from 'react';
import { api } from '../apiClient';
import type { LeadAnalysisOutput } from './lead-analysis.js';

type LeadAnalysis = { id: string; status: string; website_url: string | null; website_status: string | null; output: LeadAnalysisOutput; usage: { cost_usd_estimate?: number } | null; created_at: string; message_event?: { action: 'used' | 'dismissed'; created_at: string } | null };
type LeadAnalysisState = { available: boolean; analysis: LeadAnalysis | null; profile_changed?: boolean; used?: number; max?: number; period?: 'day' | 'month' };

const WEBSITE_NOTE: Record<string, string> = {
  leida: 'Se leyó la página web del cliente.',
  sin_texto: 'La página web casi no tiene texto; el análisis se apoya sobre todo en la ficha.',
  sin_web: 'Sin página web: el análisis usa sólo la ficha.',
};
const fmtDay = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(value));

export function LeadAnalysisPanel({ opportunityId, profile, canRun, showCost, onMessageUsed }: {
  opportunityId: string; profile: { complete: boolean; done: number; total: number }; canRun: boolean; showCost: boolean; onMessageUsed?: () => void;
}) {
  const [state, setState] = useState<LeadAnalysisState | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [showUsedMessage, setShowUsedMessage] = useState(false);
  const [messageBusy, setMessageBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<LeadAnalysisState>(`/api/agt003/lead-analysis?id=${encodeURIComponent(opportunityId)}`)
      .then(next => { if (alive) setState(next); })
      .catch(() => { if (alive) setState({ available: false, analysis: null }); });
    return () => { alive = false; };
  }, [opportunityId]);

  if (!state || !state.available && !state.analysis) return null;
  const quotaLeft = typeof state.max === 'number' ? Math.max(0, state.max - (state.used || 0)) : null;
  const generate = async () => {
    setPhase('loading'); setMessage('');
    try {
      const next = await api<LeadAnalysisState>(`/api/agt003/lead-analysis?id=${encodeURIComponent(opportunityId)}`, { method: 'POST', body: JSON.stringify({}) });
      setState(next); setPhase('idle');
    } catch (error) {
      setPhase('error'); setMessage(error instanceof Error ? error.message : 'No se pudo preparar el análisis.');
    }
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* sin portapapeles */ }
  };
  const markMessage = async (analysisId: string, action: 'used' | 'dismissed') => {
    setMessageBusy(true); setMessage('');
    try {
      const next = await api<LeadAnalysisState>(`/api/agt003/lead-analysis-message?id=${encodeURIComponent(opportunityId)}`, { method: 'POST', body: JSON.stringify({ analysis_id: analysisId, action }) });
      setState(next);
      if (action === 'used') onMessageUsed?.();
    } catch (error) {
      setPhase('error'); setMessage(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally { setMessageBusy(false); }
  };
  const a = state.analysis;
  const messageEvent = a?.message_event || null;
  const canGenerate = canRun && profile.complete && state.available && (!a || state.profile_changed) && quotaLeft !== 0;

  return <section className="panel lead-analysis-panel" aria-label="Análisis profundo">
    <header>
      <div><span className="eyebrow">Premio · Vig-IA Comercial</span><h2>Análisis profundo del cliente</h2></div>
      {quotaLeft !== null && <small className="lead-analysis-quota">Quedan {quotaLeft} de {state.max} {state.period === 'day' ? 'hoy' : 'este mes'}</small>}
    </header>
    {!a && !profile.complete && <p className="lead-analysis-teaser">Complete el perfil del cliente ({profile.done} de {profile.total}) y gane un análisis profundo con IA: qué hace la empresa, riesgos de su sector, qué servicio le encaja y un mensaje listo para revisar.</p>}
    {!a && profile.complete && <p className="lead-analysis-teaser is-won"><strong>¡Ganó su análisis profundo!</strong> Vig-IA lee la página web del cliente y su ficha, y le prepara un informe de una página.</p>}
    {a && state.profile_changed && <p className="lead-analysis-teaser">El perfil del cliente cambió desde este análisis. Puede pedir uno actualizado.</p>}
    {canGenerate && phase !== 'loading' && <button type="button" onClick={() => void generate()}>{a ? 'Actualizar análisis' : 'Generar mi análisis'}</button>}
    {canRun && profile.complete && quotaLeft === 0 && (!a || state.profile_changed) && <p className="muted">Se acabó el cupo de este mes. Vuelve el próximo mes.</p>}
    {phase === 'loading' && <div className="notice" role="status">Vig-IA está leyendo la página web y la ficha del cliente… puede tardar hasta un minuto.</div>}
    {phase === 'error' && <div className="vigia-copilot-error" role="alert">{message}</div>}
    {a && <div className="lead-analysis-body">
      <p className="lead-analysis-meta">Preparado el {fmtDay(a.created_at)}. {WEBSITE_NOTE[a.website_status || ''] || 'No se pudo leer la página web; el análisis usa sólo la ficha.'}{showCost && typeof a.usage?.cost_usd_estimate === 'number' && <> Costo equivalente estimado: USD {a.usage.cost_usd_estimate.toFixed(3)}.</>}</p>
      <div className="lead-analysis-section"><h3>La empresa</h3><p>{a.output.empresa.que_hace}</p><p><strong>Sedes:</strong> {a.output.empresa.sedes}</p><p><strong>Tamaño:</strong> {a.output.empresa.tamano}</p></div>
      <div className="lead-analysis-section"><h3>Riesgos de seguridad de su sector</h3><ul>{a.output.riesgos_sector.map((risk, i) => <li key={i}>{risk}</li>)}</ul></div>
      <div className="lead-analysis-section"><h3>Servicio que le encaja: {a.output.servicio_recomendado.servicio}</h3><p>{a.output.servicio_recomendado.por_que}</p></div>
      <div className="lead-analysis-section"><h3>Mensaje sugerido ({a.output.mensaje_sugerido.canal === 'whatsapp' ? 'WhatsApp' : 'correo'})</h3>
        {messageEvent
          ? <>
              <p className="lead-analysis-message-done">{messageEvent.action === 'used' ? 'Mensaje usado' : 'Mensaje descartado'} el {fmtDay(messageEvent.created_at)}{messageEvent.action === 'used' ? ' (quedó en el historial)' : ''}. <button type="button" className="link-button" onClick={() => setShowUsedMessage(!showUsedMessage)}>{showUsedMessage ? 'ocultar' : 'ver'}</button></p>
              {showUsedMessage && <p className="lead-analysis-message">{a.output.mensaje_sugerido.texto}</p>}
            </>
          : <>
              <p className="lead-analysis-message">{a.output.mensaje_sugerido.texto}</p>
              <div className="lead-analysis-message-actions">
                <button type="button" className="secondary" onClick={() => void copy(a.output.mensaje_sugerido.texto)}>{copied ? 'Copiado' : 'Copiar mensaje'}</button>
                {canRun && <button type="button" disabled={messageBusy} onClick={() => void markMessage(a.id, 'used')}>Ya lo usé</button>}
                {canRun && <button type="button" className="secondary" disabled={messageBusy} onClick={() => void markMessage(a.id, 'dismissed')}>Descartar</button>}
              </div>
            </>}
      </div>
      {a.output.pendientes_por_confirmar.length > 0 && <div className="lead-analysis-section"><h3>Por confirmar con el cliente</h3><ul>{a.output.pendientes_por_confirmar.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      <p className="lead-analysis-review"><strong>Revisión humana:</strong> es una sugerencia de la IA. Verifique datos, nombres y tono antes de usarla; nada se envía solo.</p>
    </div>}
  </section>;
}
