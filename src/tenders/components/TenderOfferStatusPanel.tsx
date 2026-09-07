import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadTenderDossierWorkspace, loadTenderOfferStatus, recordTenderOfferStatusTransition } from '../api';
import { canApproveTenderGoNoGo } from '../permissions';
import type { TenderCurrentProfile, TenderDossierWorkspace, TenderOfferStatus, TenderOfferStatusPayload, TenderRequest } from '../types';

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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Resumen corto de lo que el expediente canónico todavía debe cerrar. No reemplaza al expediente
// (que lista cada ítem), sólo explica por qué la transición no está disponible aquí.
function missingSummary(workspace: TenderDossierWorkspace): string {
  const readiness = workspace.readiness;
  const pending = readiness?.pending_required_items?.length || 0;
  const blockers = readiness?.active_blockers?.length || 0;
  const unapproved = readiness?.unapproved_artifacts?.length || 0;
  const parts: string[] = [];
  if (pending) parts.push(plural(pending, 'requisito obligatorio pendiente', 'requisitos obligatorios pendientes'));
  if (blockers) parts.push(plural(blockers, 'bloqueante activo', 'bloqueantes activos'));
  if (unapproved) parts.push(plural(unapproved, 'documento sin aprobar', 'documentos sin aprobar'));
  return parts.length
    ? `Faltan requisitos o evidencia en el expediente: ${parts.join(', ')}.`
    : 'El expediente aún no habilita la presentación: quedan requisitos o evidencia por completar.';
}

export function TenderOfferStatusPanel({ opportunityId, opportunityName, currentProfile, request, onChanged, readinessRevision }: {
  opportunityId: string;
  opportunityName: string;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  onChanged: () => Promise<void> | void;
  /**
   * Señal del contenedor: aumenta cuando el expediente confirmó una mutación. Sólo obliga a releer
   * la disponibilidad canónica; no es parte de ninguna key, así que este panel no se remonta y el
   * estado local en curso (nota de la confirmación, historial ya cargado) sobrevive al refresco.
   */
  readinessRevision?: number;
}) {
  const [payload, setPayload] = useState<TenderOfferStatusPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [target, setTarget] = useState<TenderOfferStatus | null>(null);
  const [note, setNote] = useState('');
  const [checkingReadiness, setCheckingReadiness] = useState(false);
  const [canMarkReady, setCanMarkReady] = useState(false);
  const [readinessDetail, setReadinessDetail] = useState('');
  const readinessVersionRef = useRef(0);
  const allowed = canApproveTenderGoNoGo(currentProfile);
  const load = useCallback(async () => {
    setLoading(true);
    try { setPayload(await loadTenderOfferStatus(request, opportunityId)); }
    catch (error) { setStatusText(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, [opportunityId, request]);
  useEffect(() => { setPayload(EMPTY); setStatusText(''); setTarget(null); void load(); }, [load]);

  // El gate real vive en la migración 042 (psi_transition_tender_offer_status). La UI no lo
  // reemplaza ni lo debilita: consulta la MISMA lectura canónica del expediente para no ofrecer
  // una acción que el servidor rechazará. Falla cerrado si no puede leerla.
  const refreshReadiness = useCallback(async (): Promise<boolean> => {
    const version = ++readinessVersionRef.current;
    setCheckingReadiness(true);
    try {
      const workspace = await loadTenderDossierWorkspace(request, opportunityId);
      if (version !== readinessVersionRef.current) return false;
      const ready = workspace.can_mark_ready === true;
      setCanMarkReady(ready);
      setReadinessDetail(ready ? '' : missingSummary(workspace));
      return ready;
    } catch (error) {
      if (version !== readinessVersionRef.current) return false;
      setCanMarkReady(false);
      setReadinessDetail(`No fue posible verificar los requisitos del expediente; la transición permanece bloqueada. ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      if (version === readinessVersionRef.current) setCheckingReadiness(false);
    }
  }, [opportunityId, request]);

  // Se relee en la carga inicial, al cambiar el estado canónico de oferta y cada vez que el
  // contenedor incrementa `readinessRevision` tras una mutación confirmada del expediente. El
  // refresco es una re-ejecución del efecto, no un remontaje: nada del estado local se pierde.
  useEffect(() => {
    if (payload.status !== 'en_preparacion') {
      readinessVersionRef.current += 1;
      setCheckingReadiness(false);
      setCanMarkReady(false);
      setReadinessDetail('');
      return;
    }
    void refreshReadiness();
  }, [payload.status, refreshReadiness, readinessRevision]);

  const gatedByDossier = (status: TenderOfferStatus) => payload.status === 'en_preparacion' && status === 'lista_para_presentar';

  // Revalidación inmediata antes de abrir: entre la carga y el clic el expediente pudo cambiar,
  // así que una vista obsoleta nunca llega a ofrecer la confirmación.
  const openTransition = async (status: TenderOfferStatus) => {
    if (busy || loading || checkingReadiness) return;
    if (gatedByDossier(status)) {
      setStatusText('');
      const ready = await refreshReadiness();
      if (!ready) return;
    }
    setTarget(status);
  };

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    if (gatedByDossier(target)) {
      setStatusText('Verificando requisitos del expediente…');
      const ready = await refreshReadiness();
      if (!ready) {
        setTarget(null); setNote('');
        setStatusText('El expediente dejó de estar listo: quedan requisitos o evidencia pendientes. Complete el expediente y vuelva a intentarlo.');
        setBusy(false);
        return;
      }
    }
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
  const readinessBlocked = payload.status === 'en_preparacion' && !loading && (checkingReadiness || !canMarkReady);
  return <section className="tender-offer-status-panel" aria-labelledby="tender-offer-status-heading">
    <header><div><span className="eyebrow">Control posterior a GO</span><h3 id="tender-offer-status-heading">Estado de oferta</h3><p>Transiciones formales, secuenciales y auditables para {opportunityName}.</p></div><div className="tender-go-no-go-status"><small>Estado actual</small><strong>{loading ? 'Cargando…' : label(payload.status)}</strong></div></header>
    {statusText && <div className="notice" role="status">{statusText}</div>}
    {allowed && options.length > 0 ? <div className="tender-go-no-go-actions">{options.map(option => <button key={option.status} id={`tender-offer-status-to-${option.status}`} type="button" onClick={() => void openTransition(option.status)} disabled={busy || loading || (gatedByDossier(option.status) && (checkingReadiness || !canMarkReady))}>{option.label}</button>)}</div> : null}
    {allowed && readinessBlocked && <p className="muted" role="status">{checkingReadiness
      ? 'Verificando requisitos y evidencia del expediente…'
      : readinessDetail || 'Faltan requisitos o evidencia en el expediente antes de marcar la oferta lista para presentar.'}</p>}
    {!allowed && <p className="muted">Solo Admin, Gerencia o Dirección de Licitaciones con permiso pueden cambiar el estado. El historial permanece disponible en solo lectura.</p>}
    {!options.length && !loading && <p className="muted">No hay transiciones disponibles: este estado es terminal o requiere el paso secuencial previo.</p>}
    {/* El historial auditable sigue completo, pero sin eventos no ocupa espacio ni se describe con
        un texto propio: un expediente recién autorizado simplemente no tiene historial que mostrar.
        Con eventos vive plegado, secundario a las transiciones y a su explicación. */}
    {payload.history.length > 0 && <details className="tender-go-no-go-history"><summary>Historial de estados</summary><ol>{payload.history.map(event => <li key={event.id}><strong>{label(event.from_status)} → {label(event.to_status)}</strong><span>{event.psi_sales_profiles?.full_name || event.actor_id} · {date(event.changed_at)}</span>{event.note && <p>{event.note}</p>}</li>)}</ol></details>}
    {target && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={() => !busy && setTarget(null)}><div className="tender-go-no-go-dialog" role="dialog" aria-modal="true" aria-labelledby="tender-offer-status-confirm-title" onMouseDown={event => event.stopPropagation()}><header><h4 id="tender-offer-status-confirm-title" tabIndex={-1}>Confirmar cambio de estado</h4><button type="button" className="secondary" disabled={busy} onClick={() => setTarget(null)} aria-label="Cerrar confirmación">Cerrar</button></header><dl><dt>Oportunidad</dt><dd>{opportunityName}</dd><dt>Estado actual</dt><dd>{label(payload.status)}</dd><dt>Nuevo estado</dt><dd>{label(target)}</dd></dl><label>Nota opcional<textarea value={note} onChange={event => setNote(event.target.value)} disabled={busy} placeholder="Contexto o evidencia del cambio." /></label><footer><button type="button" className="secondary" disabled={busy} onClick={() => setTarget(null)}>Cancelar</button><button type="button" onClick={() => void submit()} disabled={busy}>{busy ? 'Registrando…' : 'Confirmar cambio'}</button></footer></div></div>}
  </section>;
}
