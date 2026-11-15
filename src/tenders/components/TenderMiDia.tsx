import { useCallback, useEffect, useState } from 'react';
import { loadTenderMiDia, markTenderMiDiaHecho } from '../api';
import type { TenderMiDia as TenderMiDiaPayload, TenderMiDiaAccion, TenderMiDiaActividad, TenderMiDiaPendiente, TenderRequest } from '../types';
import { formatDay, formatDeadline } from '../workspace/tenderWorkspaceFormat';

const ACTIVIDAD: Record<TenderMiDiaActividad, string> = { observar: 'Observar', presentar: 'Presentar', tramitar: 'Tramitar', unirnos: 'Unirnos' };
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const dayNumber = (day: string) => Number(day.slice(8, 10));
const weekday = (day: string) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** «Hoy, domingo 15», «Mañana, lunes 16», «Martes 17». */
function dayTitle(day: string, dias: number) {
  const name = `${weekday(day)} ${dayNumber(day)}`;
  return dias === 0 ? `Hoy, ${name}` : dias === 1 ? `Mañana, ${name}` : capital(name);
}
/** «mar 17» para las listas cortas de las tarjetas. */
const shortDay = (day: string) => formatDay(day).replace(/\s+\S+$/, '');
function hora(value: string, tieneHora: boolean) {
  if (!tieneHora) return '—';
  const text = formatDeadline(value);
  const comma = text.indexOf(', ');
  return comma >= 0 ? text.slice(comma + 2) : '—';
}
const isAccion = (item: TenderMiDiaAccion | TenderMiDiaPendiente): item is TenderMiDiaAccion => 'key' in item;

function Tag({ actividad }: { actividad: TenderMiDiaActividad }) {
  return <span className={`mi-dia-tag is-${actividad}`}>{ACTIVIDAD[actividad]}</span>;
}

/**
 * Mi día de quien trabaja licitaciones (Juan, 2026-11-15; maqueta aprobada). Es una sección de alertas: sólo lo que vence
 * o es crítico, y cada cosa lleva a la página de su proceso, donde se trabaja. Arriba la frase de la semana; luego lo
 * general (las cuatro actividades) y el día a día (lo que hace la persona, con «Hecho»). Lo que publica la entidad va
 * plegado al final. Si no se puede leer, Mi día sigue igual: es un aviso, no una condición.
 */
export function TenderMiDia({ request, onOpen, onGo }: { request: TenderRequest; onOpen: (opportunityId: string) => void; onGo: (hash: string) => void }) {
  const [data, setData] = useState<TenderMiDiaPayload | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => loadTenderMiDia(request).then(setData, () => undefined), [request]);
  useEffect(() => { void reload(); }, [reload]);
  if (!data) return null;

  const toggle = async (item: TenderMiDiaAccion) => {
    setSaving(item.key); setError(null);
    try { await markTenderMiDiaHecho(request, { item_key: item.key, opportunity_id: item.opportunity_id, hecho: !item.hecho }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'); }
    finally { setSaving(null); }
  };
  const goProcess = (opportunityId: string | null) => <button type="button" className="mi-dia-go" onClick={() => opportunityId && onOpen(opportunityId)}>Ir al proceso →</button>;
  const goRequisitos = <button type="button" className="mi-dia-go" onClick={() => onGo('#/tenders?view=requisitos')}>Ir a Requisitos →</button>;

  const row = (item: TenderMiDiaAccion) => <div key={item.key} className={`mi-dia-row${item.hecho ? ' is-done' : ''}`}>
    <span className="mi-dia-hora">{hora(item.value, item.tiene_hora)}</span>
    <span className="mi-dia-text"><Tag actividad={item.actividad} />{item.texto} · {item.proceso} {goProcess(item.opportunity_id)}
      {item.hecho && <small className="muted"> — hecho{item.hecho.por ? ` por ${item.hecho.por}` : ''}</small>}</span>
    <span className="mi-dia-who">{item.responsable || '—'}</span>
    {data.hechos_disponible
      ? <button type="button" className="mi-dia-hecho" aria-pressed={Boolean(item.hecho)} disabled={saving === item.key} onClick={() => void toggle(item)}>{item.hecho ? 'Hecho ✓' : 'Hecho'}</button>
      : <span />}
  </div>;

  const { frase, actividades: a } = data;
  const primero = frase.primero;
  const observar = a.observar;
  const presentar = a.presentar;
  const critico = presentar.critico;

  return <section className="mi-dia" aria-label="Mi día de licitaciones">
    <p className="mi-dia-lead">
      {frase.observaciones || frase.manifestaciones.length || frase.cierres
        ? <>Esta semana {[
          frase.observaciones ? <>radica <b>{frase.observaciones === 1 ? '1 observación' : `${frase.observaciones} observaciones`}</b></> : null,
          frase.manifestaciones.length ? <>manifiesta interés en <b>{frase.manifestaciones.map(item => item.proceso).join(', ')}</b></> : null,
          frase.cierres ? <>presenta <b>{frase.cierres === 1 ? '1 oferta' : `${frase.cierres} ofertas`}</b></> : null,
        ].filter(Boolean).map((part, index, list) => <span key={index}>{index > 0 ? (index === list.length - 1 ? ' y ' : ', ') : ''}{part}</span>)}.</>
        : <>Esta semana no tiene plazos para radicar.</>}
      {primero && <> Lo primero: <b>{primero.proceso}, {dayTitle(primero.day, Math.round((Date.parse(`${primero.day}T00:00:00Z`) - Date.parse(`${data.today}T00:00:00Z`)) / 86_400_000)).toLowerCase()}{primero.tiene_hora ? `, ${hora(primero.value, true)}` : ''}</b>{primero.tiene_hora ? '' : '.'}</>}
    </p>

    <h3 className="mi-dia-h">Lo general · las cuatro actividades</h3>
    <div className="mi-dia-macro">
      <article className="mi-dia-card is-observar">
        <h4>Observar</h4>
        <p className="mi-dia-n">{observar.esta_semana} esta semana · {observar.proxima} la próxima</p>
        {observar.items.length ? <ul>{observar.items.map(item => <li key={item.key}>{item.proceso} · {shortDay(item.day)}{item.texto.includes('proyecto') ? ' (proyecto)' : item.texto.includes('definitivo') ? ' (definitivo)' : ''}</li>)}</ul> : <p className="muted">Nada que observar esta semana.</p>}
        {observar.proximo && <p className="mi-dia-next">Próximo: {observar.proximo.proceso}, {shortDay(observar.proximo.day)}{observar.proximo.tiene_hora ? `, ${hora(observar.proximo.value, true)}` : ''} {goProcess(observar.proximo.opportunity_id)}</p>}
      </article>
      <article className="mi-dia-card is-presentar">
        <h4>Presentar</h4>
        <p className="mi-dia-n">{presentar.cierres === 1 ? '1 plazo' : `${presentar.cierres} plazos`} en 15 días</p>
        {presentar.items.length ? <ul>{presentar.items.map(item => <li key={item.key}>{item.proceso} · {item.texto === 'Manifestar interés' ? 'interés ' : ''}{shortDay(item.day)}</li>)}</ul> : <p className="muted">Ningún cierre en 15 días.</p>}
        {critico && <p className="mi-dia-next">Crítico: {critico.texto}{critico.proceso ? ` · ${critico.proceso}` : ''}{!isAccion(critico) && critico.vencido_hace ? ` (venció hace ${critico.vencido_hace} d)` : ''} {goProcess(critico.opportunity_id)}</p>}
      </article>
      <article className="mi-dia-card is-tramitar">
        <h4>Tramitar</h4>
        <p className="mi-dia-n">{a.tramitar.por_tramitar} por tramitar · {a.tramitar.sin_dato} sin dato en la ficha</p>
        {a.tramitar.items.length ? <ul>{a.tramitar.items.map(item => <li key={item.key}>{item.titulo}</li>)}</ul> : <p className="muted">Nada que frene un proceso abierto.</p>}
        <p className="mi-dia-next">{goRequisitos}</p>
      </article>
      <article className="mi-dia-card is-unirnos">
        <h4>Unirnos</h4>
        <p className="mi-dia-n">{a.unirnos.total === 1 ? '1 proceso espera socio' : `${a.unirnos.total} procesos esperan socio`}</p>
        {a.unirnos.items.length ? <ul>{a.unirnos.items.map(item => <li key={item.opportunity_id} title={item.motivo}>{item.proceso}{item.cierre ? ` · cierra ${shortDay(item.cierre)}` : ''}</li>)}</ul> : <p className="muted">Ninguno.</p>}
        <p className="mi-dia-next"><button type="button" className="mi-dia-go" onClick={() => onGo('#/tenders?view=aliados')}>Ir a Aliados →</button></p>
      </article>
    </div>

    <h3 className="mi-dia-h">El día a día · lo que hace usted</h3>
    {error && <p className="notice" role="alert">{error}</p>}
    {data.dias.map(day => <div key={day.day} className={`mi-dia-day${day.dias === 0 ? ' is-today' : ''}`}>
      <h4>{dayTitle(day.day, day.dias)}</h4>
      {day.items.length ? day.items.map(row) : <div className="mi-dia-row"><span className="mi-dia-hora">—</span><span className="muted">Nada para hoy.</span><span /><span /></div>}
    </div>)}
    {data.pendientes.length > 0 && <div className="mi-dia-day">
      <h4>Mis pendientes sin fecha de la entidad</h4>
      {data.pendientes.map((item, index) => <div key={`${item.opportunity_id || 'req'}-${index}`} className="mi-dia-row">
        <span className="mi-dia-hora">—</span>
        <span className="mi-dia-text"><Tag actividad={item.actividad} />{item.texto}{item.proceso ? ` · ${item.proceso}` : ''}{item.vencido_hace ? <small className="muted"> (venció hace {item.vencido_hace} d)</small> : null} {item.destino === 'requisitos' ? goRequisitos : goProcess(item.opportunity_id)}</span>
        <span className="mi-dia-who">{item.responsable || '—'}</span>
        <span />
      </div>)}
    </div>}
    <details className="mi-dia-fold">
      <summary>La próxima semana ({data.proxima.length})</summary>
      {data.proxima.length ? data.proxima.map(item => <div key={item.key} className="mi-dia-row">
        <span className="mi-dia-hora">{shortDay(item.day)}</span>
        <span className="mi-dia-text"><Tag actividad={item.actividad} />{item.texto} · {item.proceso}{item.tiene_hora ? `, ${hora(item.value, true)}` : ''} {goProcess(item.opportunity_id)}</span>
        <span className="mi-dia-who">{item.responsable || '—'}</span><span />
      </div>) : <p className="muted">Nada todavía.</p>}
    </details>
    <details className="mi-dia-fold">
      <summary>Lo que publica la entidad esta semana ({data.entidad.length})</summary>
      {data.entidad.length ? data.entidad.map(item => <div key={item.key} className="mi-dia-row">
        <span className="mi-dia-hora">{shortDay(item.day)}</span>
        <span className="mi-dia-text">{item.texto} · {item.proceso}{item.tiene_hora ? `, ${hora(item.value, true)}` : ''} {goProcess(item.opportunity_id)}</span>
        <span /><span />
      </div>) : <p className="muted">Nada esta semana.</p>}
    </details>
  </section>;
}
