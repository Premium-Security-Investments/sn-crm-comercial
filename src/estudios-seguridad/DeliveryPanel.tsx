// Estudios de Seguridad Física: socialización con el cliente y enlace en línea (migración 206; Juan, 2026-11-11).
// Héctor: "hasta que no se socialice el informe … no ha sido entregado el estudio". El enlace muestra al cliente la
// versión aprobada y el estado de hoy de sus recomendaciones; se ve una sola vez al crearlo, vence y se puede anular.
import { useState } from 'react';
import { createShare, recordDelivery, revokeShare, type Entrega, type StudyStatus } from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : '—');
const MEDIUM: Record<string, string> = { presencial: 'presencial', virtual: 'virtual', correo: 'por correo' };
const STATE: Record<string, string> = { activo: 'Activo', vencido: 'Vencido', anulado: 'Anulado' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export function DeliveryPanel({ studyId, status, latestVersion, entrega, onChanged }: { studyId: string; status: StudyStatus; latestVersion: number | null; entrega: Entrega; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ delivered_on: today(), medium: 'presencial', presented_by: '', attendees: '', support: '', notes: '' });
  const [link, setLink] = useState<{ label: string; days: number }>({ label: '', days: 90 });
  const [created, setCreated] = useState<string | null>(null);
  if (!entrega.available || !['aprobado', 'archivado'].includes(status) || !latestVersion) return null;
  const delivery = entrega.deliveries.find(item => item.version === latestVersion) || null;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); onChanged(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const share = () => act(async () => {
    const result = await createShare(studyId, { label: link.label || undefined, days: link.days });
    setCreated(`${window.location.origin}${result.path}`);
    setLink({ label: '', days: 90 });
  });
  return <section className="es-card es-delivery" aria-label="Entrega al cliente">
    <h3>Entrega al cliente</h3>
    {delivery ? <p><span className="es-nivel es-nivel-aceptable">Entregado</span> Versión {delivery.version} socializada {MEDIUM[delivery.medium]} el {fmtDate(delivery.delivered_on)}. Presentó: {delivery.presented_by}. Asistentes: {delivery.attendees}.{delivery.support ? ` Soporte: ${delivery.support}.` : ''}</p>
      : <>
        <p><span className="es-nivel es-nivel-tolerable">Aprobado, sin entregar</span> El estudio cuenta como entregado cuando se socializa con el cliente.</p>
        {entrega.can ? <form className="es-form" onSubmit={event => { event.preventDefault(); void act(() => recordDelivery(studyId, form)); }}>
          <div className="es-grid-2">
            <label>Fecha de la socialización<input type="date" value={form.delivered_on} max={today()} onChange={event => setForm({ ...form, delivered_on: event.target.value })} required /></label>
            <label>Medio
              <select value={form.medium} onChange={event => setForm({ ...form, medium: event.target.value })}>
                <option value="presencial">Reunión presencial</option><option value="virtual">Reunión virtual</option><option value="correo">Por correo</option>
              </select>
            </label>
            <label>Quién presentó<input value={form.presented_by} onChange={event => setForm({ ...form, presented_by: event.target.value })} required minLength={2} maxLength={300} placeholder="Analista y coordinador" /></label>
            <label>Asistentes del cliente<input value={form.attendees} onChange={event => setForm({ ...form, attendees: event.target.value })} required minLength={2} maxLength={1000} placeholder="Nombres y cargos" /></label>
          </div>
          <label>Soporte<input value={form.support} onChange={event => setForm({ ...form, support: event.target.value })} maxLength={1000} placeholder="Acta, correo de envío o enlace al documento" /></label>
          <label>Observaciones<textarea rows={2} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} maxLength={2000} /></label>
          <div className="es-actions"><button type="submit" disabled={busy}>Registrar la socialización</button></div>
        </form> : null}
      </>}

    <span className="es-label">Enlace para que el cliente vea el estudio en línea</span>
    <p className="es-muted">Muestra el resumen, los riesgos y el estado de hoy de cada recomendación; nunca fotos ni datos internos. Vence y se puede anular.</p>
    {created ? <div className="es-share-created" role="status">
      <strong>Copie el enlace ahora: no se vuelve a mostrar.</strong>
      <input readOnly value={created} onFocus={event => event.target.select()} aria-label="Enlace para el cliente" />
      <button type="button" className="secondary" onClick={() => { void navigator.clipboard?.writeText(created); }}>Copiar</button>
      <button type="button" className="es-link" onClick={() => setCreated(null)}>Listo</button>
    </div> : null}
    {entrega.can ? <div className="es-inline">
      <input value={link.label} onChange={event => setLink({ ...link, label: event.target.value })} maxLength={160} placeholder="Para quién (opcional)" aria-label="Para quién es el enlace" />
      <select value={link.days} onChange={event => setLink({ ...link, days: Number(event.target.value) })} aria-label="Vigencia">
        <option value={30}>30 días</option><option value={90}>90 días</option><option value={180}>6 meses</option><option value={365}>1 año</option>
      </select>
      <button type="button" disabled={busy} onClick={() => void share()}>Crear enlace</button>
    </div> : null}
    {entrega.shares.length ? <ul className="es-history">{entrega.shares.map(item => <li key={item.id}>
      {STATE[item.state]} · versión {item.version}{item.label ? ` · ${item.label}` : ''} · creado {fmtDate(item.created_at)} · {item.state === 'activo' ? `vence ${fmtDate(item.expires_at)}` : item.state === 'anulado' ? `anulado ${fmtDate(item.revoked_at)}` : `venció ${fmtDate(item.expires_at)}`}
      <small className="es-muted"> · {item.views ? `abierto ${item.views} ${item.views === 1 ? 'vez' : 'veces'}, la última ${fmtDate(item.last_view)}` : 'no se ha abierto'}</small>
      {item.state === 'activo' && entrega.can ? <button type="button" className="es-link" disabled={busy} onClick={() => { if (window.confirm('¿Anular este enlace? El cliente ya no podrá abrirlo.')) void act(() => revokeShare(studyId, item.id)); }}>Anular</button> : null}
    </li>)}</ul> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
  </section>;
}
