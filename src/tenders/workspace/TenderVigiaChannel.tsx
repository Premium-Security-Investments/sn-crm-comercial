import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTenderDossierWorkbench, postTenderDossierWorkbenchMessage, retryTenderDossierWorkbenchJob } from '../api';
import type { TenderDossierWorkbench, TenderRequest } from '../types';
import { clarificationSentText, loadTenderClarifications, sendTenderClarification, type TenderClarification } from './TenderClarify';

const REPLY_CAPABILITY_ID = 'agt002.dossier-workbench.reply.v1';
const POLL_MS = 5_000;
const MAX_POLLS = 24;

const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
};

/**
 * Canal directo entre la responsable de la licitación y Vig-IA (Juan, 2026-10-13). Reutiliza la Mesa
 * (hilo, trabajos y respuestas gobernadas por el servidor) con una superficie de chat simple: el
 * servidor le pasa a Vig-IA las tareas abiertas del expediente y responde en el mismo pedido.
 */
export function TenderVigiaChannel({ opportunityId, request }: { opportunityId: string; request: TenderRequest }) {
  const [data, setData] = useState<TenderDossierWorkbench | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const pollsRef = useRef(0);
  // Solo la conversación de esta sesión (Juan, 2026-10-13): lo anterior queda guardado, pero no ocupa la pantalla.
  const sessionStartRef = useRef(Date.now() - 60_000);
  const [showPrevious, setShowPrevious] = useState(false);
  // Un solo espacio, dos tipos de mensaje (Juan, 2026-10-21): la pregunta no cambia nada; la aclaración queda registrada
  // y Vig-IA actualiza el análisis en lo que toca.
  const [mode, setMode] = useState<'question' | 'clarification'>('question');
  const [clarifications, setClarifications] = useState<TenderClarification[]>([]);
  const [notice, setNotice] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    try { setData(await loadTenderDossierWorkbench(request, opportunityId)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    try { setClarifications(await loadTenderClarifications(request, opportunityId)); } catch { /* sin aclaraciones visibles */ }
  }, [opportunityId, request]);
  useEffect(() => { void reload(); }, [reload]);

  const pending = (data?.jobs || []).some(job => job.status === 'queued' || job.status === 'in_progress');
  const failed = (data?.jobs || []).filter(job => job.status === 'failed');
  // Si la respuesta no llegó con el envío (cola ocupada o demora), se consulta un rato más.
  useEffect(() => {
    if (!pending) { pollsRef.current = 0; return; }
    if (pollsRef.current >= MAX_POLLS) return;
    const timer = window.setTimeout(() => { pollsRef.current += 1; void reload(); }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [pending, data, reload]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [data?.messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    if (mode === 'clarification') {
      setSending(true); setError(''); setNotice('');
      try {
        const response = await sendTenderClarification(request, opportunityId, content, null);
        setDraft(''); setNotice(clarificationSentText(response));
        await reload();
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { setSending(false); }
      return;
    }
    if (!data) return;
    setSending(true); setError(''); setNotice('');
    try {
      await postTenderDossierWorkbenchMessage(request, {
        opportunity_id: opportunityId,
        thread_id: data.thread_id,
        client_message_id: crypto.randomUUID(),
        content,
        context_links: data.reference.context_links,
        capability_id: REPLY_CAPABILITY_ID,
        snapshot_id: data.reference.snapshot_id,
        base_version_id: null,
      });
      setDraft('');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSending(false); }
  };
  const retry = async (jobId: string) => {
    setSending(true); setError('');
    try { await retryTenderDossierWorkbenchJob(request, { opportunity_id: opportunityId, job_id: jobId }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSending(false); }
  };

  // Las aclaraciones se muestran en la conversación, en su lugar en el tiempo, marcadas como tales.
  type Entry = { id: string; created_at: string; author_kind: string; content: string; visible_agent_name?: string | null; origin_job_id?: string | null; clarification?: TenderClarification };
  const allMessages: Entry[] = [
    ...((data?.messages || []) as Entry[]),
    ...clarifications.map(item => ({ id: `clar-${item.id}`, created_at: item.created_at, author_kind: 'human', content: item.content, visible_agent_name: item.author_name, clarification: item })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const previousCount = allMessages.filter(message => new Date(message.created_at).getTime() < sessionStartRef.current).length;
  const messages = showPrevious ? allMessages : allMessages.filter(message => new Date(message.created_at).getTime() >= sessionStartRef.current);
  // Las sugerencias de la última respuesta (cada respuesta trae las suyas).
  const lastJobId = [...messages].reverse().find(message => message.author_kind === 'agent')?.origin_job_id || null;
  const actions = (data?.required_actions || []).filter(action => !lastJobId || action.job_id === lastJobId).slice(0, 6);
  return <section className="tw-card tw-channel" aria-label="Conversación con Vig-IA">
    <div>
      <small>Preguntarle a Vig-IA</small>
      <p className="tw-muted">Vig-IA conoce el análisis, los documentos y, después del GO, las tareas abiertas de esta licitación. Responde y sugiere; no aprueba, no firma ni presenta nada, ni decide el GO.</p>
    </div>
    {previousCount > 0 && <button type="button" className="tw-link" onClick={() => setShowPrevious(value => !value)}>{showPrevious ? 'Ocultar las conversaciones anteriores' : `Ver conversaciones anteriores (${previousCount} mensajes)`}</button>}
    <div className="tw-channel-thread" role="log" aria-live="polite">
      {messages.length === 0 && <p className="tw-muted">Todavía no hay mensajes. Ejemplos: «¿Qué nos falta para la garantía de seriedad?», «¿Qué documentos vencen antes del cierre?».</p>}
      {messages.map(message => <div key={message.id} className={`tw-msg ${message.author_kind === 'agent' ? 'is-agent' : 'is-human'}${message.clarification ? ' is-clarification' : ''}`}>
        <span className="tw-msg-meta">{message.clarification ? 'Aclaración · ' : ''}{message.author_kind === 'agent' ? 'Vig-IA' : (message.visible_agent_name || 'Equipo')} · {timeLabel(message.created_at)}{message.clarification?.target_label ? ` · sobre «${message.clarification.target_label}»` : ''}</span>
        <p>{message.content}</p>
      </div>)}
      {(pending || sending) && <p className="tw-muted tw-typing">Vig-IA está respondiendo…</p>}
      {failed.length > 0 && !pending && <div className="notice">Vig-IA no pudo responder el último mensaje. <button type="button" className="secondary" disabled={sending} onClick={() => void retry(failed[0].id)}>Reintentar</button></div>}
      <div ref={endRef} />
    </div>
    {actions.length > 0 && <details className="tw-fold"><summary>Lo que Vig-IA sugiere hacer ({actions.length})</summary>
      <ul>{actions.map(action => <li key={action.id}>{action.action_text}</li>)}</ul>
    </details>}
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <p className="tw-muted" role="status">{notice}</p>}
    <div className="tw-channel-mode" role="group" aria-label="Tipo de mensaje">
      <button type="button" className="secondary" aria-pressed={mode === 'question'} onClick={() => setMode('question')}>Pregunta</button>
      <button type="button" className="secondary" aria-pressed={mode === 'clarification'} onClick={() => setMode('clarification')}>Aclaración</button>
      <span className="tw-muted">{mode === 'question' ? 'Vig-IA responde y no cambia nada.' : 'Queda registrada con su nombre y Vig-IA actualiza el análisis en lo que toque.'}</span>
    </div>
    <div className="tw-channel-composer">
      <textarea aria-label="Mensaje para Vig-IA" value={draft} maxLength={4000} placeholder={mode === 'question' ? 'Escriba su pregunta…' : 'Escriba lo que Vig-IA debe saber o corregir…'} disabled={(mode === 'question' && !data) || sending}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send(); }} />
      <button type="button" disabled={(mode === 'question' && !data) || sending || !draft.trim()} onClick={() => void send()}>{sending ? 'Enviando…' : mode === 'question' ? 'Enviar pregunta' : 'Enviar aclaración'}</button>
    </div>
  </section>;
}
