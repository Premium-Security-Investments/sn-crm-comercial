// Estudios de Seguridad Física: los antecedentes del puesto en SecurityOps (migración 201; Juan, 2026-11-10).
//
// El analista vincula el estudio a un puesto de SecurityOps; el servidor de tareas trae, en uno o dos minutos, lo que pasó
// allí en 12 meses y los reportes escritos para el estudio («Alerta de Riesgos» y el «Estudio de seguridad» del
// historial). «Llevar al estudio» abre el formulario del riesgo ya escrito: las calificaciones las pone el analista.
import { useEffect, useState } from 'react';
import {
  linkSecurityOps, refreshSecurityOps, searchSecurityOpsPuestos, updateStudy,
  type Risk, type RiskDraft, type SecurityOpsPuesto, type SecurityOpsState, type Study,
} from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : '—');
const TIPO_NOVEDAD: Record<string, string> = { general: 'generales', seguridad: 'de seguridad', tecnologia: 'de tecnología', infraestructura: 'de infraestructura', dotacion: 'de dotación', panico: 'de pánico', judicializacion: 'de judicialización', otro: 'otras' };
const TIPO_VISITA: Record<string, string> = { supervision: 'de supervisión', aprovisionamiento: 'de aprovisionamiento', soporte_tecnico: 'de soporte técnico' };
const counts = (map: Record<string, number> | undefined, words: Record<string, string>) => Object.entries(map || {}).sort((a, b) => b[1] - a[1]).map(([key, n]) => `${n} ${words[key] || key}`).join(', ');
const place = (puesto: SecurityOpsPuesto) => [puesto.address, puesto.municipio, puesto.regional].filter(Boolean).join(' · ');

export function SecurityOpsPanel({ study, state, risks, editable, onChanged, onUseAsRisk }: {
  study: Study; state: SecurityOpsState; risks: Risk[]; editable: boolean; onChanged: () => void; onUseAsRisk: (draft: RiskDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);
  const pending = Boolean(state.puesto && state.pending);

  // Mientras el servidor de tareas trae los datos, la ficha se recarga sola cada 20 s (hasta 6 minutos).
  useEffect(() => {
    if (!pending) return undefined;
    let tries = 0;
    const timer = window.setInterval(() => { tries += 1; if (tries > 18) window.clearInterval(timer); else onChanged(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [pending, onChanged]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };

  if (!state.available) return null;
  if (!state.puesto) {
    return <section className="es-card es-secops" aria-label="SecurityOps">
      <h3>Antecedentes en SecurityOps</h3>
      <p className="es-muted">Vincule el puesto de SecurityOps de esta sede para traer lo que ha pasado allí: novedades, rondas, visitas, fallas y las alertas de riesgo que reportó la operación.</p>
      {editable ? (searching ? <PuestoSearch busy={busy} onPick={puesto => act(async () => { await linkSecurityOps(study.id, puesto.id); setSearching(false); })} onCancel={() => setSearching(false)} />
        : <button type="button" onClick={() => setSearching(true)}>Buscar el puesto en SecurityOps</button>) : <p className="es-muted">El estudio no tiene un puesto de SecurityOps vinculado.</p>}
      {error ? <p className="es-error" role="alert">{error}</p> : null}
    </section>;
  }

  const { puesto, data } = state;
  const s = data?.status === 'ok' ? data.summary : null;
  const used = new Map(risks.filter(risk => risk.source_ref).map(risk => [risk.source_ref as string, risk.number]));
  const canUseCoords = editable && puesto.latitude != null && puesto.longitude != null && (study.latitude == null || study.latitude === '');
  return <section className="es-card es-secops" aria-label="SecurityOps">
    <div className="es-section-head">
      <h3>Antecedentes en SecurityOps</h3>
      <div className="es-actions">
        {!['aprobado', 'archivado'].includes(study.status) ? <button type="button" className="secondary" disabled={busy || pending} onClick={() => act(() => refreshSecurityOps(study.id))}>Actualizar</button> : null}
        {editable ? <button type="button" className="secondary" disabled={busy} onClick={() => { if (window.confirm('¿Desvincular el puesto de SecurityOps? Los riesgos que ya se llevaron al estudio se quedan.')) act(() => linkSecurityOps(study.id, null)); }}>Desvincular</button> : null}
      </div>
    </div>
    <p><strong>{puesto.name}</strong>{puesto.monitoring ? ' · unidad de monitoreo' : ''}<br /><span className="es-muted">{place(puesto) || 'Sin dirección en SecurityOps'}</span></p>
    {canUseCoords ? <button type="button" className="es-link" disabled={busy} onClick={() => act(() => updateStudy(study.id, { latitude: Number(puesto.latitude), longitude: Number(puesto.longitude) }))}>Usar las coordenadas de SecurityOps en el estudio{puesto.geo_pending ? ' (SecurityOps las marca por verificar)' : ''}</button> : null}
    {pending ? <p className="es-muted">Trayendo los datos de SecurityOps; tarda uno o dos minutos y esta sección se actualiza sola.</p> : null}
    {data?.status === 'error' ? <p className="es-error">{data.error || 'No se pudo leer SecurityOps.'}</p> : null}
    {s ? <>
      <p className="es-muted">Últimos 12 meses ({fmtDate(data?.window_from)} a {fmtDate(data?.window_to)}) · corte {fmtDate(data?.synced_at)}</p>
      <ul className="es-secops-facts">
        <li><strong>{s.novedades?.total ?? 0}</strong> novedades{s.novedades?.total ? ` (${counts(s.novedades.por_tipo, TIPO_NOVEDAD)})` : ''}{s.novedades?.altas ? `; ${s.novedades.altas} de prioridad alta o crítica` : ''}</li>
        <li><strong>{s.rondas?.total ?? 0}</strong> rondas{s.rondas?.completitud_promedio != null ? `, ${s.rondas.completitud_promedio} % de puntos marcados en promedio` : ''}</li>
        <li><strong>{s.visitas?.total ?? 0}</strong> visitas{s.visitas?.total ? ` (${counts(s.visitas.por_tipo, TIPO_VISITA)})` : ''}{s.visitas?.ultima ? `; la última el ${fmtDate(s.visitas.ultima)}` : ''}</li>
        <li><strong>{s.fallas?.total ?? 0}</strong> fallas de medios técnicos{s.fallas?.abiertas ? `, ${s.fallas.abiertas} abiertas` : ''} · <strong>{s.visitas_tecnicas?.total ?? 0}</strong> visitas técnicas</li>
      </ul>
      {data?.failures.length ? <details><summary>Fallas reportadas ({data.failures.length})</summary>
        <ul className="es-history">{data.failures.map((item, index) => <li key={index}>{fmtDate(item.fecha)} · {item.titulo || 'Sin título'}{item.abierta ? ' · abierta' : ''}</li>)}</ul>
      </details> : null}
      <span className="es-label">Alertas de riesgo ({data?.alerts.length ?? 0})</span>
      {data?.alerts.length ? <ul className="es-secops-list">{data.alerts.map(alert => {
        const ref = `securityops:alerta:${alert.id}`;
        return <li key={alert.id}>
          <strong>{alert.riesgo}</strong> <small className="es-muted">· {fmtDate(alert.fecha)}{alert.fotos ? ` · ${alert.fotos} ${alert.fotos === 1 ? 'foto' : 'fotos'} en SecurityOps` : ''}</small>
          {alert.descripcion ? <p>{alert.descripcion}</p> : null}
          {alert.recomendaciones ? <p className="es-muted">Recomienda: {alert.recomendaciones}</p> : null}
          {used.has(ref) ? <small className="es-muted">Ya está en el estudio como R{used.get(ref)}.</small>
            : editable ? <button type="button" className="es-link" onClick={() => onUseAsRisk({ title: alert.riesgo.slice(0, 300), causes: alert.descripcion, proposed_control: alert.recomendaciones, source_ref: ref })}>Llevar al estudio</button> : null}
        </li>;
      })}</ul> : <p className="es-muted">Nadie ha reportado una «Alerta de Riesgos» en este puesto.</p>}
      <span className="es-label">Notas de coordinación ({data?.notes.length ?? 0})</span>
      {data?.notes.length ? <ul className="es-secops-list">{data.notes.map(note => {
        const ref = `securityops:nota:${note.id}`;
        return <li key={note.id}>
          <strong>{note.titulo || 'Estudio de seguridad'}</strong> <small className="es-muted">· {fmtDate(note.fecha)}{note.realizado_por ? ` · ${note.realizado_por}` : ''}</small>
          {note.detalle ? <p>{note.detalle}</p> : null}
          {note.recomendaciones ? <p className="es-muted">Recomienda: {note.recomendaciones}</p> : null}
          {used.has(ref) ? <small className="es-muted">Ya está en el estudio como R{used.get(ref)}.</small>
            : editable ? <button type="button" className="es-link" onClick={() => onUseAsRisk({ title: (note.titulo || 'Riesgo señalado por coordinación').slice(0, 300), causes: note.detalle, proposed_control: note.recomendaciones, source_ref: ref })}>Llevar al estudio</button> : null}
        </li>;
      })}</ul> : <p className="es-muted">Coordinación no ha dejado notas de «Estudio de seguridad» en el historial de este puesto.</p>}
    </> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}

function PuestoSearch({ busy, onPick, onCancel }: { busy: boolean; onPick: (puesto: SecurityOpsPuesto) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [todos, setTodos] = useState(false);
  const [results, setResults] = useState<SecurityOpsPuesto[] | null>(null);
  const [error, setError] = useState('');
  const search = async () => {
    setError('');
    try { setResults(await searchSecurityOpsPuestos(q, todos)); } catch (reason) { setError(message(reason)); }
  };
  return <div className="es-form">
    <div className="es-inline">
      <input value={q} onChange={event => setQ(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} placeholder="Nombre del puesto, dirección o municipio" aria-label="Buscar puesto en SecurityOps" />
      <button type="button" disabled={q.trim().length < 2} onClick={() => void search()}>Buscar</button>
      <button type="button" className="secondary" onClick={onCancel}>Cancelar</button>
    </div>
    <label className="checkline"><input type="checkbox" checked={todos} onChange={event => setTodos(event.target.checked)} /> Incluir unidades de monitoreo (alarmas)</label>
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    {results ? (results.length ? <ul className="es-secops-list">{results.map(puesto => <li key={puesto.id}>
      <strong>{puesto.name}</strong>{puesto.monitoring ? <small className="es-muted"> · monitoreo</small> : null}<br />
      <small className="es-muted">{place(puesto) || 'Sin dirección'}{puesto.sap ? ` · SAP ${puesto.sap}` : ''}</small><br />
      <button type="button" className="es-link" disabled={busy} onClick={() => onPick(puesto)}>Vincular este puesto</button>
    </li>)}</ul> : <p className="es-muted">No hay puestos con ese nombre o dirección.{todos ? '' : ' Pruebe incluyendo las unidades de monitoreo.'}</p>) : null}
  </div>;
}
