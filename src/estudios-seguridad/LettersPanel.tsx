// Estudios de Seguridad Física: carta de recomendación al cliente (migración 213; Juan, 2026-11-12).
// Héctor: cuando el cliente no aplica lo recomendado, se le recuerda por escrito con la evidencia; "eso nos blinda".
// El SIIO arma la carta y el servidor de tareas la deja en PDF en SharePoint; el envío lo hace una persona y lo registra.
import { useEffect, useState } from 'react';
import { markLetterSent, requestLetter, type Letters } from './api';

const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : '—');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
const STATUS: Record<string, string> = { pendiente: 'En cola', procesando: 'Preparando el PDF', lista: 'Lista para enviar', fallida: 'No se pudo preparar', enviada: 'Enviada' };
const MEDIUM: Record<string, string> = { correo: 'por correo', fisico: 'en físico', reunion: 'en reunión' };

export function LettersPanel({ studyId, cartas, onChanged }: { studyId: string; cartas: Letters; onChanged: () => void }) {
  const [chosen, setChosen] = useState<string[]>(() => cartas.pending.map(item => item.id));
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState({ sent_on: today(), sent_to: '', sent_medium: 'correo' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preparing = cartas.letters.some(item => item.status === 'pendiente' || item.status === 'procesando');
  // Mientras el servidor de tareas prepara el PDF (hasta 5 minutos), la ficha se recarga sola cada 30 s.
  useEffect(() => {
    if (!preparing) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => { tries += 1; if (tries > 20) window.clearInterval(timer); else onChanged(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [preparing, onChanged]);
  if (!cartas.available || (!cartas.pending.length && !cartas.letters.length)) return null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const toggle = (id: string) => setChosen(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  return <section className="es-card es-letters" aria-label="Recomendaciones a cargo del cliente">
    <h3>Recomendaciones a cargo del cliente</h3>
    {cartas.pending.length ? <>
      <p className="es-muted">Siguen pendientes {cartas.pending.length}. Si el cliente no las aplica, una carta de recomendación con la evidencia de SecurityOps deja constancia de que se le advirtió.</p>
      <ul className="es-secops-list">{cartas.pending.map(item => <li key={item.id}>
        <label className="checkline"><input type="checkbox" checked={chosen.includes(item.id)} disabled={!cartas.can} onChange={() => toggle(item.id)} />
          <span><strong>{item.riesgo}</strong> · {item.accion} <small className="es-muted">· para el {fmtDate(item.fecha)}{item.vencida ? ' · vencida' : ''}</small></span>
        </label>
      </li>)}</ul>
      {cartas.can ? <div className="es-inline">
        <input value={recipient} onChange={event => setRecipient(event.target.value)} maxLength={300} placeholder="Dirigida a: nombre y cargo en el cliente" aria-label="Destinatario de la carta" />
        <button type="button" disabled={busy || recipient.trim().length < 2 || !chosen.length} onClick={() => void act(async () => { await requestLetter(studyId, { recipient, items: chosen }); setRecipient(''); })}>Preparar carta</button>
      </div> : null}
    </> : <p className="es-muted">No hay recomendaciones a cargo del cliente pendientes.</p>}
    {cartas.letters.length ? <>
      <span className="es-label">Cartas</span>
      <ul className="es-history">{cartas.letters.map(letter => <li key={letter.id}>
        {STATUS[letter.status]} · {letter.items} {letter.items === 1 ? 'recomendación' : 'recomendaciones'} · para {letter.recipient} · pedida {fmtDate(letter.requested_at)}
        {letter.file_url ? <> · <a href={letter.file_url} target="_blank" rel="noopener noreferrer">Abrir el PDF</a></> : null}
        {letter.status === 'enviada' ? <small className="es-muted"> · enviada {MEDIUM[letter.sent_medium || '']} el {fmtDate(letter.sent_on)} a {letter.sent_to}</small> : null}
        {letter.status === 'fallida' ? <small className="es-error"> · {letter.error}</small> : null}
        {letter.status === 'lista' && cartas.can ? (sending === letter.id ? <div className="es-inline">
          <input type="date" value={sent.sent_on} max={today()} onChange={event => setSent({ ...sent, sent_on: event.target.value })} aria-label="Fecha de envío" />
          <input value={sent.sent_to} onChange={event => setSent({ ...sent, sent_to: event.target.value })} maxLength={300} placeholder="A quién se envió" aria-label="A quién se envió" />
          <select value={sent.sent_medium} onChange={event => setSent({ ...sent, sent_medium: event.target.value })} aria-label="Medio"><option value="correo">Correo</option><option value="fisico">Físico</option><option value="reunion">En reunión</option></select>
          <button type="button" disabled={busy || sent.sent_to.trim().length < 2} onClick={() => void act(async () => { await markLetterSent(studyId, letter.id, sent); setSending(null); })}>Registrar</button>
        </div> : <button type="button" className="es-link" onClick={() => setSending(letter.id)}>Registrar el envío</button>) : null}
      </li>)}</ul>
    </> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}
