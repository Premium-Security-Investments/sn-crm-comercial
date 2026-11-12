// Estudios de Seguridad Física: vigencia del estudio y revaloración (migración 209; Juan, 2026-11-11).
// Héctor: "como mínimo cada 6 meses y como máximo cada 3 años", y antes si cambian las instalaciones o hay un siniestro.
import { useState } from 'react';
import { RENEWAL_OPTIONS, requestRevaluation, updateStudy, type Validity } from './api';

const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`)) : '—');
const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar la operación.');

export function ValidityBadge({ validity }: { validity?: Validity }) {
  if (!validity || validity.estado === 'sin_aprobar') return <span className="es-muted">—</span>;
  const tone = validity.estado === 'vencido' ? 'inaceptable' : validity.estado === 'por_vencer' ? 'tolerable' : 'aceptable';
  const text = validity.estado === 'vencido' ? `Vencido desde ${fmtDate(validity.vence)}` : validity.estado === 'por_vencer' ? `Vence ${fmtDate(validity.vence)}` : `Vigente hasta ${fmtDate(validity.vence)}`;
  return <span className={`es-nivel es-nivel-${tone}`}>{text}{validity.revalorar.length ? ' · revalorar' : ''}</span>;
}

export function ValidityLine({ studyId, validity, renewalMonths, editable, canRequest, onChanged }: {
  studyId: string; validity?: Validity; renewalMonths: number; editable: boolean; canRequest: boolean; onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const option = RENEWAL_OPTIONS.find(item => item.meses === renewalMonths);
  return <div className="es-validity" aria-label="Vigencia del estudio">
    <p>
      <span className="es-label">Vigencia:</span>{' '}
      {editable ? <select value={renewalMonths} disabled={busy} onChange={event => void act(() => updateStudy(studyId, { renewal_months: Number(event.target.value) }))} aria-label="Frecuencia de renovación">
        {RENEWAL_OPTIONS.map(item => <option key={item.meses} value={item.meses}>{item.etiqueta} ({item.cuando})</option>)}
      </select> : <span>se renueva {option?.etiqueta.toLowerCase() || `cada ${renewalMonths} meses`}</span>}
      {' '}<ValidityBadge validity={validity} />
      {validity?.estado === 'sin_aprobar' ? <small className="es-muted"> El vencimiento se cuenta desde la aprobación.</small> : null}
    </p>
    {validity?.revalorar.length ? <ul className="es-review-list es-review-block">{validity.revalorar.map((item, index) => <li key={index}>
      {item.motivo === 'siniestro' ? 'Revalorar por siniestro: ' : item.motivo === 'indicador' ? 'La realidad superó la calificación: ' : `Revaloración pedida el ${fmtDate(item.fecha)}: `}{item.detalle}
    </li>)}</ul> : null}
    {canRequest && validity && validity.estado !== 'sin_aprobar' ? (asking ? <div className="es-inline">
      <input value={note} onChange={event => setNote(event.target.value)} maxLength={1000} placeholder="Motivo: cambio en las instalaciones, siniestro, pedido del cliente…" aria-label="Motivo de la revaloración" />
      <button type="button" disabled={busy || note.trim().length < 3} onClick={() => void act(async () => { await requestRevaluation(studyId, note); setAsking(false); setNote(''); })}>Pedir</button>
      <button type="button" className="secondary" onClick={() => setAsking(false)}>Cancelar</button>
    </div> : <button type="button" className="es-link" onClick={() => setAsking(true)}>Pedir revaloración</button>) : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </div>;
}
