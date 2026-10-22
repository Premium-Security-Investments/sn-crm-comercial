// AGT-003 — Chat de registro con Vig-IA en Mi día (Juan, 2026-10-15). El comercial cuenta (escribiendo o dictando) lo
// que hizo; Vig-IA propone los cambios en una tarjeta por cliente y nada se guarda hasta pulsar "Confirmar".
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../apiClient';
import { CHAT_MESSAGE_MAX_CHARS } from './chat-registro.js';
import './vigia-chat.css';

type StoredAction = { tipo: string; cliente: string; lineas: string[]; parecidos?: string[]; opportunity_id?: string };
type Applied = { index: number; ok: boolean; error?: string; opportunity_id?: string };
type ChatTurn = {
  id: string; user_text: string; status: 'running' | 'completed' | 'failed'; reply_text: string | null;
  proposal: { acciones: StoredAction[]; avisos: string[]; reemplazada_por?: string } | null;
  proposal_status: 'pendiente' | 'aplicando' | 'confirmada' | 'descartada' | null;
  applied: Applied[] | null; created_at: string;
};
type ChatState = { available: boolean; turns: ChatTurn[]; used?: number; max?: number };

const EXAMPLES = [
  'Llamé a la gerente de la constructora, le interesa cotizar 2 puestos. La vuelvo a llamar el martes.',
  'Hoy visité un conjunto residencial nuevo en Envigado: la administradora quiere vigilancia 24 horas.',
  'Le escribí por WhatsApp al cliente, quedó de responder el viernes. Su proveedor actual es Atlas.',
];
const VISIBLE_TURNS = 1;
const ACTION_ICON: Record<string, string> = { registrar_seguimiento: '✎', proximo_seguimiento: '◷', actualizar_datos: '☰', crear_oportunidad: '+' };
const timeLabel = (value: string) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

type SpeechCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
function speechRecognition(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function groupByClient(actions: StoredAction[]) {
  const groups: { cliente: string; items: { action: StoredAction; index: number }[] }[] = [];
  actions.forEach((action, index) => {
    const found = groups.find(group => group.cliente === action.cliente);
    if (found) found.items.push({ action, index });
    else groups.push({ cliente: action.cliente, items: [{ action, index }] });
  });
  return groups;
}

function ProposalCard({ turn, busy, onConfirm, onDiscard }: { turn: ChatTurn; busy: boolean; onConfirm: () => void; onDiscard: () => void }) {
  const proposal = turn.proposal;
  if (!proposal) return null;
  const applied = new Map((turn.applied || []).map(item => [item.index, item]));
  const state = turn.proposal_status;
  return <div className={`vchat-card is-${state || 'avisos'}`}>
    {proposal.acciones.length > 0 && <>
      <div className="vchat-card-head">{state === 'confirmada' ? 'Guardado en el CRM'
        : state === 'descartada' ? (proposal.reemplazada_por ? 'Reemplazado por lo que contó después: no se guardó nada' : 'Descartado: no se guardó nada')
        : state === 'aplicando' ? 'Guardando…' : 'Cambios para confirmar'}</div>
      {groupByClient(proposal.acciones).map(group => <div key={group.cliente} className="vchat-client">
        <strong>{group.cliente}</strong>
        <ul>{group.items.map(({ action, index }) => {
          const result = applied.get(index);
          return <li key={index} className={result ? (result.ok ? 'is-ok' : 'is-fail') : ''}>
            <span className="vchat-icon" aria-hidden="true">{result ? (result.ok ? '✓' : '!') : ACTION_ICON[action.tipo] || '•'}</span>
            <span>{action.lineas.map((line, i) => <span key={i} className="vchat-line">{line}</span>)}
              {action.parecidos?.length ? <span className="vchat-warn">Ojo: en el CRM hay clientes con nombre parecido ({action.parecidos.join(', ')}). Confirme sólo si es otro cliente.</span> : null}
              {result && !result.ok && <span className="vchat-warn">No se guardó: {result.error}</span>}
              {result?.ok && result.opportunity_id && <a className="vchat-link" href={`#/detail/${result.opportunity_id}`}>Ver ficha</a>}
            </span>
          </li>;
        })}</ul>
      </div>)}
    </>}
    {proposal.avisos.length > 0 && <ul className="vchat-avisos">{proposal.avisos.map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>}
    {state === 'pendiente' && <div className="vchat-actions">
      <button type="button" disabled={busy} onClick={onConfirm}>Confirmar</button>
      <button type="button" className="secondary" disabled={busy} onClick={onDiscard}>Descartar</button>
    </div>}
  </div>;
}

export function VigiaChatRegistro({ firstName, onSaved }: { firstName: string; onSaved: () => void | Promise<void> }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busyTurn, setBusyTurn] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  // El chat se llevaba toda la pantalla de Mi día (Juan, 2026-10-22): por defecto sólo el último intercambio.
  const [showAllTurns, setShowAllTurns] = useState(false);
  const recognitionRef = useRef<InstanceType<SpeechCtor> | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const Speech = typeof window !== 'undefined' ? speechRecognition() : null;

  useEffect(() => {
    let alive = true;
    api<ChatState>('/api/agt003/chat').then(next => { if (alive) setState(next); }).catch(() => { if (alive) setState({ available: false, turns: [] }); });
    return () => { alive = false; recognitionRef.current?.stop(); };
  }, []);
  useEffect(() => { if (state?.turns.length) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [state?.turns.length, sending]);

  const send = useCallback(async () => {
    const mensaje = draft.trim();
    if (!mensaje || sending) return;
    recognitionRef.current?.stop();
    setSending(true); setError('');
    try {
      setState(await api<ChatState>('/api/agt003/chat', { method: 'POST', body: JSON.stringify({ mensaje }) }));
      setDraft(''); setShowAllTurns(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSending(false); inputRef.current?.focus(); }
  }, [draft, sending]);

  const decide = async (turnId: string, action: 'confirm' | 'discard') => {
    setBusyTurn(turnId); setError('');
    try {
      setState(await api<ChatState>(`/api/agt003/chat/${action}`, { method: 'POST', body: JSON.stringify({ turn_id: turnId }) }));
      if (action === 'confirm') await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusyTurn(null); }
  };

  const toggleDictation = () => {
    if (!Speech) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new Speech();
    recognition.lang = 'es-CO'; recognition.interimResults = false; recognition.continuous = true;
    const base = draft.trim();
    let spoken = '';
    recognition.onresult = event => {
      spoken = Array.from(event.results).filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim();
      setDraft([base, spoken].filter(Boolean).join(' '));
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognition.onerror = () => { setListening(false); setError('No se pudo usar el micrófono. Revise el permiso del navegador o escriba el mensaje.'); };
    recognitionRef.current = recognition;
    setError('');
    recognition.start();
    setListening(true);
  };

  if (!state || (!state.available && !state.turns.length)) return null;
  const left = typeof state.max === 'number' ? Math.max(0, state.max - (state.used || 0)) : null;
  const turns = state.turns;
  const visibleTurns = showAllTurns ? turns : turns.slice(-VISIBLE_TURNS);
  const hiddenTurns = turns.length - visibleTurns.length;
  return <section className="panel vchat" aria-label="Contarle a Vig-IA">
    <header className="vchat-header">
      <div>
        <span className="eyebrow">Vig-IA Comercial</span>
        <h2>¿Cómo le fue hoy, {firstName}?</h2>
        <p>Cuénteme con quién habló y qué quedó pendiente. Yo preparo los cambios del CRM y usted los confirma.</p>
      </div>
      {left !== null && <small className="vchat-quota" title="Mensajes con Vig-IA que le quedan hoy a todo el equipo">{left} mensajes del equipo hoy</small>}
    </header>
    {hiddenTurns > 0 && <button type="button" className="secondary vchat-more" onClick={() => setShowAllTurns(true)}>
      Ver la conversación de hoy ({turns.length} {turns.length === 1 ? 'mensaje' : 'mensajes'})
    </button>}
    {turns.length > 0 && <div className="vchat-thread" role="log" aria-live="polite">
      {visibleTurns.map(turn => <div key={turn.id} className="vchat-turn">
        <div className="vchat-msg is-human"><span className="vchat-meta">Usted · {timeLabel(turn.created_at)}</span><p>{turn.user_text}</p></div>
        {turn.status === 'completed' && <div className="vchat-msg is-agent">
          <span className="vchat-meta">Vig-IA</span>
          {turn.reply_text && <p>{turn.reply_text}</p>}
          <ProposalCard turn={turn} busy={busyTurn === turn.id} onConfirm={() => void decide(turn.id, 'confirm')} onDiscard={() => void decide(turn.id, 'discard')} />
        </div>}
        {turn.status === 'failed' && <div className="vchat-msg is-agent is-failed"><p>No alcancé a responder este mensaje. Envíelo de nuevo.</p></div>}
      </div>)}
      {sending && <div className="vchat-msg is-agent vchat-typing"><span /><span /><span /> Vig-IA está preparando los cambios…</div>}
      <div ref={endRef} />
    </div>}
    {!turns.length && <div className="vchat-examples">
      <small>Por ejemplo (toque uno para usarlo de modelo):</small>
      {EXAMPLES.map(example => <button key={example} type="button" className="vchat-chip" onClick={() => { setDraft(example); inputRef.current?.focus(); }}>{example}</button>)}
    </div>}
    {error && <div className="error" role="alert">{error}</div>}
    <div className={`vchat-composer${listening ? ' is-listening' : ''}`}>
      <textarea ref={inputRef} aria-label="Mensaje para Vig-IA" rows={2} value={draft} maxLength={CHAT_MESSAGE_MAX_CHARS} disabled={sending}
        placeholder={listening ? 'Le escucho… hable con normalidad y pulse el micrófono para terminar.' : 'Ej.: Hablé con Frontier, les interesa cotizar 2 puestos. Los llamo el martes.'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} />
      {Speech && <button type="button" className={`secondary vchat-mic${listening ? ' is-on' : ''}`} aria-pressed={listening} aria-label={listening ? 'Terminar de dictar' : 'Dictar con el micrófono'} title={listening ? 'Terminar de dictar' : 'Dictar'} disabled={sending} onClick={toggleDictation}>{listening ? '■' : '🎤'}</button>}
      <button type="button" disabled={sending || !draft.trim() || left === 0} onClick={() => void send()}>{sending ? 'Enviando…' : 'Enviar'}</button>
    </div>
    <p className="vchat-foot">Enter envía · Mayús + Enter hace un salto de línea. Vig-IA sólo propone: nada se guarda hasta que usted pulsa <strong>Confirmar</strong>.</p>
  </section>;
}
