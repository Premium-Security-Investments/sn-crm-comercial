import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadTracking, loadTrackingEvents, updateTracking } from './api';
import { daysSince, matchesTrackingFilter, trackingSemaphore, type TrackingFilter } from './trackingUtils';
import type { PublicTender, TenderConversionResult, TenderTrackingEvent, TenderTrackingStatus, TenderTrackingUpdate, TendersModuleProps } from './types';

const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
const statuses: Array<{ value: TenderTrackingStatus; label: string }> = [
  { value: 'pendiente_revision', label: 'Pendiente de revisión' },
  { value: 'analizando', label: 'Analizando' },
  { value: 'esperando_informacion', label: 'Esperando información' },
  { value: 'listo_para_decision', label: 'Listo para decisión' },
  { value: 'bloqueado', label: 'Bloqueado' },
];

type TrackingForm = Omit<TenderTrackingUpdate, 'id' | 'expected_tracking_updated_at'>;

function formatDate(value?: string | null, withTime = false) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return (withTime ? dateTime : date).format(new Date(value));
}

function dateInput(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function startForm(tender: PublicTender, fallbackOwner: string): TrackingForm {
  return {
    tracking_owner_id: tender.tracking_owner_id || fallbackOwner,
    tracking_status: tender.tracking_status || 'pendiente_revision',
    tracking_next_action: tender.tracking_next_action || '',
    tracking_due_at: dateInput(tender.tracking_due_at),
    tracking_blocker: tender.tracking_blocker || '',
    note: tender.tracking_last_note || '',
  };
}

function statusLabel(value?: string | null) {
  return statuses.find(status => status.value === value)?.label || 'Pendiente de revisión';
}

function conversionMessage(result: TenderConversionResult) {
  if (result.document_import_status === 'analisis_generado') return 'Oportunidad creada. Documentos oficiales importados y análisis generado.';
  if (result.document_import_status) return `Oportunidad creada. Estado documental: ${result.document_import_status}.${result.document_import_error ? ` ${result.document_import_error}` : ''}`;
  return `Oportunidad creada. El detalle mostrará el estado documental real.${result.document_import_error ? ` ${result.document_import_error}` : ''}`;
}

type TenderTrackingViewProps = TendersModuleProps & { moduleNavigation: ReactNode };

export function TenderTrackingView({ data, refresh, request, navigate, moduleNavigation }: TenderTrackingViewProps) {
  const [rows, setRows] = useState<PublicTender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversion, setConversion] = useState<TenderConversionResult | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TrackingForm | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, TenderTrackingEvent[]>>({});
  const [eventsLoadingId, setEventsLoadingId] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('todas');
  const [owner, setOwner] = useState<string>('todas');
  const [semaphore, setSemaphore] = useState<TrackingFilter['semaphore']>('todas');

  const load = async () => {
    setLoading(true); setError(null);
    try { setRows(await loadTracking<PublicTender[]>(request)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => rows.filter(row => matchesTrackingFilter(row, { status, owner, semaphore })), [rows, status, owner, semaphore]);
  const owners = useMemo(() => data.profiles.filter(profile => rows.some(row => row.tracking_owner_id === profile.id)), [data.profiles, rows]);
  const currentFormRow = rows.find(row => row.id === editingId) || null;

  const openEditor = (tender: PublicTender) => {
    setEditingId(tender.id); setForm(startForm(tender, data.currentProfile.id)); setError(null); setNotice(null); setConversion(null);
  };
  const save = async () => {
    if (!currentFormRow || !form) return;
    setSavingId(currentFormRow.id); setError(null); setNotice(null);
    try {
      const saved = await updateTracking<PublicTender>(request, {
        id: currentFormRow.id,
        ...form,
        tracking_due_at: form.tracking_due_at ? new Date(`${form.tracking_due_at}T12:00:00`).toISOString() : null,
        expected_tracking_updated_at: currentFormRow.tracking_updated_at ?? null,
      });
      setRows(current => current.map(row => row.id === saved.id ? { ...row, ...saved } : row));
      setEditingId(null); setForm(null); setNotice('Seguimiento guardado.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/desactualizado|\b409\b/i.test(message) ? 'Seguimiento desactualizado. Otra persona modificó esta licitación; recargue la fila antes de guardar.' : message);
    } finally { setSavingId(null); }
  };
  const toggleHistory = async (tender: PublicTender) => {
    if (expandedId === tender.id) { setExpandedId(null); return; }
    setExpandedId(tender.id); setEventsError(null);
    if (events[tender.id]) return;
    setEventsLoadingId(tender.id);
    try {
      const loadedEvents = await loadTrackingEvents(request, tender.id);
      setEvents(current => ({ ...current, [tender.id]: loadedEvents }));
    } catch (cause) { setEventsError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setEventsLoadingId(null); }
  };
  const convert = async (tender: PublicTender) => {
    if (tender.converted_opportunity_id) { navigate(`#/detail/${tender.converted_opportunity_id}`); return; }
    if (!window.confirm(`¿Convertir el proceso de ${tender.entity} en oportunidad?`)) return;
    setSavingId(tender.id); setError(null); setNotice(null); setConversion(null);
    try {
      const result = await request<TenderConversionResult>('/api/tender-convert', { method: 'POST', body: JSON.stringify({ tender }) });
      const message = conversionMessage(result);
      setNotice(message);
      setConversion(result);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSavingId(null); }
  };

  if (loading) return <div className="notice">Cargando seguimiento operativo…</div>;
  if (error && !rows.length) return <div className="error">{error}</div>;
  return <section className="stack tenders-page tender-tracking-view" aria-labelledby="tender-tracking-heading">
    <header className="tracking-header"><div><span className="eyebrow">Cola operativa</span><h2 id="tender-tracking-heading">Seguimiento</h2><p>Gestione responsables, compromisos, bloqueos y trazabilidad de cada proceso en revisión.</p></div><button className="secondary" onClick={() => void load()}>Recargar cola</button></header>
    {moduleNavigation}
    {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error" role="alert">{error}</div>}
    {conversion && <section className="notice tender-conversion-result" role="status" aria-label="Resultado de conversión documental"><strong>Conversión confirmada</strong><dl className="tracking-metadata"><div><dt>Estado documental</dt><dd>{conversion.document_import_status || 'Pendiente de confirmación'}</dd></div><div><dt>Error documental</dt><dd>{conversion.document_import_error || 'Sin errores reportados.'}</dd></div></dl><button onClick={() => navigate(`#/detail/${conversion.id}`)}>Abrir oportunidad</button></section>}
    <section className="tracking-filters" aria-label="Filtros de seguimiento"><label>Estado<select value={status} onChange={event => setStatus(event.target.value)}><option value="todas">Todos</option>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Responsable<select value={owner} onChange={event => setOwner(event.target.value)}><option value="todas">Todos</option>{owners.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label><label>Semáforo<select value={semaphore} onChange={event => setSemaphore(event.target.value as TrackingFilter['semaphore'])}><option value="todas">Todos</option><option value="rojo">Rojo — bloqueo o vencido</option><option value="amarillo">Amarillo — próximo o sin fecha</option><option value="verde">Verde — en fecha</option></select></label><strong>{filtered.length} procesos</strong></section>
    {!rows.length ? <div className="notice">No hay procesos en seguimiento. Selecciónelos desde Radar.</div> : !filtered.length ? <div className="notice">No hay procesos con los filtros actuales.</div> : <div className="tracking-queue">{filtered.map(tender => {
      const ownerName = data.profiles.find(profile => profile.id === tender.tracking_owner_id)?.full_name || 'Sin asignar';
      const inactive = daysSince(tender.reviewed_at || tender.tracking_updated_at);
      const isExpanded = expandedId === tender.id;
      return <article className={`card tracking-row semaphore-${trackingSemaphore(tender)}`} key={tender.id}><div className="tracking-row-head"><div><span className="badge">{statusLabel(tender.tracking_status)}</span><h3>{tender.entity} — {tender.city || tender.dept || 'Sin ciudad'}</h3><p>{tender.title}</p></div><span className="badge">{trackingSemaphore(tender)}</span></div><dl className="tracking-metadata"><div><dt>Referencia</dt><dd>{tender.ref || tender.process_id || 'Referencia pendiente'}</dd></div><div><dt>Inicio de seguimiento</dt><dd>{tender.tracking_started_at ? formatDate(tender.tracking_started_at, true) : 'Pendiente de inicio'}</dd></div><div><dt>Cierre del proceso</dt><dd>{tender.deadline ? formatDate(tender.deadline, true) : 'Cierre no informado'}</dd></div><div><dt>Prioridad / score</dt><dd>{Number.isFinite(Number(tender.score)) ? `${tender.score} / 100` : 'Score pendiente'}</dd></div><div><dt>Riesgos</dt><dd>{tender.risks?.length ? tender.risks.join(' · ') : 'Sin riesgos reportados'}</dd></div><div><dt>Responsable</dt><dd>{ownerName}</dd></div><div><dt>Última revisión</dt><dd>{formatDate(tender.reviewed_at || tender.tracking_updated_at, true)}</dd></div><div><dt>Próxima acción</dt><dd>{tender.tracking_next_action || 'Sin definir'}</dd></div><div><dt>Fecha compromiso</dt><dd>{formatDate(tender.tracking_due_at)}</dd></div><div><dt>Días sin gestión</dt><dd>{inactive === null ? 'Sin revisión' : `${inactive} días`}</dd></div><div><dt>Bloqueo</dt><dd>{tender.tracking_blocker || 'Sin bloqueo'}</dd></div><div><dt>Nota</dt><dd>{tender.tracking_last_note || 'Sin nota'}</dd></div></dl><div className="row-actions"><button className="secondary" onClick={() => openEditor(tender)}>Editar seguimiento</button><button className="secondary" onClick={() => void toggleHistory(tender)} aria-expanded={isExpanded}>{isExpanded ? 'Ocultar historial' : 'Historial'}</button><button onClick={() => void convert(tender)} disabled={savingId === tender.id}>{savingId === tender.id ? 'Convirtiendo…' : 'Convertir en oportunidad'}</button></div>{editingId === tender.id && form && <form className="tracking-form" onSubmit={event => { event.preventDefault(); void save(); }}><label>Responsable<select value={form.tracking_owner_id} onChange={event => setForm(current => current ? { ...current, tracking_owner_id: event.target.value } : current)}>{data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}</select></label><label>Estado<select value={form.tracking_status} onChange={event => setForm(current => current ? { ...current, tracking_status: event.target.value as TenderTrackingStatus } : current)}>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>Próxima acción<input value={form.tracking_next_action || ''} onChange={event => setForm(current => current ? { ...current, tracking_next_action: event.target.value } : current)} /></label><label>Fecha compromiso<input type="date" value={form.tracking_due_at || ''} onChange={event => setForm(current => current ? { ...current, tracking_due_at: event.target.value } : current)} /></label><label>Bloqueo<textarea value={form.tracking_blocker || ''} onChange={event => setForm(current => current ? { ...current, tracking_blocker: event.target.value } : current)} /></label><label>Nota<textarea value={form.note || ''} onChange={event => setForm(current => current ? { ...current, note: event.target.value } : current)} /></label><div className="row-actions"><button type="submit" disabled={savingId === tender.id}>{savingId === tender.id ? 'Guardando…' : 'Guardar seguimiento'}</button><button type="button" className="secondary" onClick={() => { setEditingId(null); setForm(null); }}>Cancelar</button></div></form>}{isExpanded && <section className="tracking-history" aria-label={`Historial de ${tender.entity}`}><h4>Historial</h4>{eventsLoadingId === tender.id ? <p className="muted">Cargando historial…</p> : eventsError ? <p className="error">{eventsError}</p> : events[tender.id]?.length ? <ol>{events[tender.id].map(event => <li key={event.id}><strong>{event.event_type}</strong> · {formatDate(event.created_at, true)}{event.note ? ` — ${event.note}` : ''}</li>)}</ol> : <p className="muted">Sin eventos registrados.</p>}</section>}</article>;
    })}</div>}
  </section>;
}
