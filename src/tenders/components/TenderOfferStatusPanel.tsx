import React, { useCallback, useEffect, useState } from 'react';
import { loadTenderOfferStatus, recordTenderOfferStatusTransition } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import type { TenderCurrentProfile, TenderOfferStatus, TenderOfferStatusPayload, TenderRequest } from '../types';

const EMPTY: TenderOfferStatusPayload = { status: 'pendiente_decision', history: [] };
const NEXT: Partial<Record<TenderOfferStatus, Array<{ status: TenderOfferStatus; label: string }>>> = {
  en_preparacion: [{ status: 'lista_para_presentar', label: 'Marcar lista para presentar' }],
  lista_para_presentar: [{ status: 'presentada', label: 'Registrar presentada' }],
  presentada: [{ status: 'adjudicada', label: 'Registrar adjudicada' }, { status: 'no_adjudicada', label: 'Registrar no adjudicada' }],
};
const label = (status: TenderOfferStatus) => ({
  pendiente_decision: 'Pendiente de decisión', en_preparacion: 'En preparación', lista_para_presentar: 'Lista para presentar',
  presentada: 'Presentada', adjudicada: 'Adjudicada', no_adjudicada: 'No adjudicada', cerrada_no_go: 'Cerrada NO GO',
}[status] || status);
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Sin fecha';

export function TenderOfferStatusPanel({ opportunityId, opportunityName, currentProfile, request, onChanged }: {
  opportunityId: string;
  opportunityName: string;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  onChanged: () => Promise<void> | void;
}) {
  const [payload, setPayload] = useState<TenderOfferStatusPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [target, setTarget] = useState<TenderOfferStatus | null>(null);
  const [note, setNote] = useState('');
  const allowed = canApproveTenderGoNoGo(currentProfile);
  const load = useCallback(async () => {
    setLoading(true);
    try { setPayload(await loadTenderOfferStatus(request, opportunityId)); }
    catch (error) { setStatusText(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [opportunityId, request]);
  useEffect(() => { setPayload(EMPTY); setStatusText(''); setTarget(null); void load(); }, [load]);

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    setStatusText('Registrando transición auditable…');
    try {
      const persisted = await recordTenderOfferStatusTransition(request, {
        opportunity_id: opportunityId, to_status: target, expected_current_status: payload.status, note: note.trim() || null,
      });
      setPayload(previous => ({ status: persisted.status, history: [persisted.event, ...previous.history] }));
      setTarget(null); setNote('');
      await onChanged();
      setStatusText('Estado de oferta actualizado y auditado.');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : String(error));
      await load();
    } finally { setBusy(false); }
  };
  const options = NEXT[payload.status] || [];
  return <section className="tender-offer-status-panel" aria-labelledby="tender-offer-status-heading">
    <header><div><span className="eyebrow">Control posterior a GO</span><h3 id="tender-offer-status-heading">Estado de oferta</h3><p>Transiciones formales, secuenciales y auditables para {opportunityName}.</p></div><div className="tender-go-no-go-status"><small>Estado actual</small><strong>{loading ? 'Cargando…' : label(payload.status)}</strong></div></header>
    {statusText && <div className="notice" role="status">{statusText}</div>}
    {allowed && options.length > 0 ? <div className="tender-go-no-go-actions">{options.map(option => <button key={option.status} type="button" onClick={() => setTarget(option.status)} disabled={busy || loading}>{option.label}</button>)}</div> : null}
    {!allowed && <p className="muted">Solo Admin, Gerencia o Dirección de Licitaciones con permiso pueden cambiar el estado. El historial permanece disponible en solo lectura.</p>}
    {!options.length && !loading && <p className="muted">No hay transiciones disponibles: este estado es terminal o requiere el paso secuencial previo.</p>}
    <section aria-label="Historial auditable de estado de oferta"><strong>Historial auditable</strong>{loading ? <p>Cargando historial…</p> : payload.history.length ? <ol>{payload.history.map(event => <li key={event.id}><strong>{label(event.from_status)} → {label(event.to_status)}</strong><span>{event.psi_sales_profiles?.full_name || event.actor_id} · {date(event.changed_at)}</span>{event.note && <p>{event.note}</p>}</li>)}</ol> : <p>Sin cambios posteriores a la autorización GO.</p>}</section>
    {target && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={() => !busy && setTarget(null)}><div className="tender-go-no-go-dialog" role="dialog" aria-modal="true" aria-labelledby="tender-offer-status-confirm-title" onMouseDown={event => event.stopPropagation()}><header><h4 id="tender-offer-status-confirm-title" tabIndex={-1}>Confirmar cambio de estado</h4><button type="button" className="secondary" disabled={busy} onClick={() => setTarget(null)} aria-label="Cerrar confirmación">Cerrar</button></header><dl><dt>Oportunidad</dt><dd>{opportunityName}</dd><dt>Estado actual</dt><dd>{label(payload.status)}</dd><dt>Nuevo estado</dt><dd>{label(target)}</dd></dl><label>Nota opcional<textarea value={note} onChange={event => setNote(event.target.value)} disabled={busy} placeholder="Contexto o evidencia del cambio." /></label><footer><button type="button" className="secondary" disabled={busy} onClick={() => setTarget(null)}>Cancelar</button><button type="button" onClick={() => void submit()} disabled={busy}>{busy ? 'Registrando…' : 'Confirmar cambio'}</button></footer></div></div>}
  </section>;
}
