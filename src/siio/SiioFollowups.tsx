import { useEffect, useRef, useState } from 'react';
import { AUTO_RULE_LABELS, ORIGIN_LABELS, changeFollowup, dueLabel, isOverdue, saveFollowup, todayIso, addDays, type Followup, type FollowupDraft, type FollowupList, type FollowupOrigin } from './followups';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const MANUAL_ORIGINS: FollowupOrigin[] = ['reunion', 'junta', 'finanzas', 'otro'];

// Small form used from the Torre (prefilled) and from the Seguimiento tab (blank).
export function FollowupComposer({ draft, onSaved, onCancel, allowOriginChoice = false }: { draft: FollowupDraft; onSaved: (item: Followup) => void; onCancel: () => void; allowOriginChoice?: boolean }) {
  const [form, setForm] = useState<FollowupDraft>(draft);
  const formRef = useRef<HTMLFormElement>(null);
  // The composer opens away from the clicked row, so bring it into view and focus the first field.
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    formRef.current?.querySelector('input')?.focus({ preventScroll: true });
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<FollowupDraft>) => setForm(current => ({ ...current, ...patch }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      onSaved(await saveFollowup(form));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };
  return <form ref={formRef} className="siio-followup-composer" onSubmit={submit} aria-label="Nuevo seguimiento">
    <div className="siio-followup-composer-head">
      <strong>Nuevo seguimiento</strong>
      {form.origin_label ? <span>{ORIGIN_LABELS[form.origin_type]} · {form.origin_label}</span> : null}
    </div>
    <label className="siio-followup-title">Qué hay que hacer
      <input value={form.title} onChange={event => set({ title: event.target.value })} required minLength={3} maxLength={300} />
    </label>
    <div className="siio-followup-row">
      <label>Responsable (persona o área)
        <input value={form.owner_label} onChange={event => set({ owner_label: event.target.value })} required minLength={2} maxLength={120} placeholder="Ej.: Licitaciones, Gerente Comercial" />
      </label>
      <label>Fecha compromiso
        <input type="date" value={form.due_date} onChange={event => set({ due_date: event.target.value })} required />
      </label>
      {allowOriginChoice ? <label>Origen
        <select value={form.origin_type} onChange={event => set({ origin_type: event.target.value as FollowupOrigin })}>
          {MANUAL_ORIGINS.map(origin => <option key={origin} value={origin}>{ORIGIN_LABELS[origin]}</option>)}
        </select>
      </label> : null}
    </div>
    {form.auto_rule ? <p className="siio-pulse-footnote">{AUTO_RULE_LABELS[form.auto_rule]}</p> : null}
    {error ? <p className="siio-followup-error" role="alert">{error}</p> : null}
    <div className="siio-followup-actions">
      <button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar seguimiento'}</button>
      <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
    </div>
  </form>;
}

// Inline marker for a Torre row: the open follow-up if there is one, else a create button.
export function FollowupCell({ existing, today, canCreate, onCreate }: { existing: Followup | null; today: string; canCreate: boolean; onCreate: () => void }) {
  if (existing) return <span className={`siio-followup-chip${isOverdue(existing, today) ? ' siio-followup-chip-late' : ''}`}>Seguimiento: {existing.owner_label} · {dueLabel(existing, today)}</span>;
  if (!canCreate) return null;
  return <button type="button" className="siio-link-button" onClick={onCreate}>Crear seguimiento</button>;
}

function FollowupItem({ item, today, canEdit, onChanged }: { item: Followup; today: string; canEdit: boolean; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const act = async (body: Parameters<typeof changeFollowup>[1]) => {
    setBusy(true);
    setError('');
    try {
      await changeFollowup(item.id, body);
      setNote('');
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  };
  const late = isOverdue(item, today);
  return <li className={`siio-followup-item${late ? ' siio-followup-late' : ''}`}>
    <div className="siio-followup-main">
      <strong>{item.title}</strong>
      <span>{item.owner_label} · <span className={late ? 'siio-alert-text' : undefined}>{dueLabel(item, today)}</span></span>
      <small>{ORIGIN_LABELS[item.origin_type]}{item.origin_label ? ` · ${item.origin_label}` : ''}{item.created_role === 'junta' ? ' · creado por la Junta' : ''}</small>
      {item.status === 'abierto' && item.auto_rule ? <small>{AUTO_RULE_LABELS[item.auto_rule]}</small> : null}
      {item.status !== 'abierto' ? <small>{item.status === 'cumplido' ? (item.close_reason === 'automatico' ? `Cumplido automáticamente. ${item.close_evidence || ''}` : 'Cumplido') : 'Cancelado'} · {item.closed_at ? item.closed_at.slice(0, 10) : ''}</small> : null}
      {item.notes?.length ? <ul className="siio-followup-notes">{item.notes.map(entry => <li key={entry.at}><time>{entry.at.slice(0, 10)}</time> {entry.text}</li>)}</ul> : null}
    </div>
    {canEdit ? <div className="siio-followup-controls">
      {item.status === 'abierto' ? <>
        <button type="button" onClick={() => act({ action: 'cumplir', ...(note.trim() ? { note } : {}) })} disabled={busy}>Marcar cumplido</button>
        <button type="button" className="secondary" onClick={() => act({ action: 'cancelar', ...(note.trim() ? { note } : {}) })} disabled={busy}>Cancelar</button>
        <span className="siio-followup-note">
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="Nota de avance" maxLength={1000} aria-label={`Nota de avance para ${item.title}`} />
          <button type="button" className="secondary" onClick={() => act({ action: 'nota', note })} disabled={busy || !note.trim()}>Agregar nota</button>
        </span>
      </> : <button type="button" className="secondary" onClick={() => act({ action: 'reabrir' })} disabled={busy}>Reabrir</button>}
      {error ? <p className="siio-followup-error" role="alert">{error}</p> : null}
    </div> : null}
  </li>;
}

// The Seguimiento gerencial tab (also shown to the Junta below its published reports).
export function SiioFollowupsView({ list, state, reload }: { list: FollowupList | null; state: 'loading' | 'ready' | 'error'; reload: () => void }) {
  const [composing, setComposing] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  if (state === 'loading') return <section className="panel"><p className="siio-secondary">Cargando seguimientos…</p></section>;
  if (state === 'error' || !list) return <section className="panel"><div className="error">No se pudieron cargar los seguimientos.</div><button type="button" onClick={reload}>Reintentar</button></section>;
  const today = list.today || todayIso();
  const open = list.followups.filter(item => item.status === 'abierto').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const late = open.filter(item => isOverdue(item, today));
  const closed = list.followups.filter(item => item.status !== 'abierto').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
  return <section className="panel siio-followups" aria-label="Seguimiento gerencial">
    <div className="siio-followups-head">
      <div>
        <h2>Seguimiento gerencial</h2>
        <p className="siio-secondary">{plural(open.length, 'abierto', 'abiertos')}{late.length ? ` · ${plural(late.length, 'vencido', 'vencidos')}` : ''} · {plural(closed.length, 'cerrado', 'cerrados')}</p>
      </div>
      {list.permissions.create && !composing ? <button type="button" onClick={() => setComposing(true)}>+ Nuevo seguimiento</button> : null}
    </div>
    {composing ? <FollowupComposer allowOriginChoice draft={{ title: '', owner_label: '', due_date: addDays(today, 7), origin_type: 'reunion' }} onCancel={() => setComposing(false)} onSaved={() => { setComposing(false); reload(); }} /> : null}
    {open.length ? <ul className="siio-followup-list">{open.map(item => <FollowupItem key={item.id} item={item} today={today} canEdit={list.permissions.edit} onChanged={reload} />)}</ul>
      : <p className="siio-secondary">No hay seguimientos abiertos. Créalos desde "Requiere atención" en el Resumen ejecutivo o con "+ Nuevo seguimiento".</p>}
    {closed.length ? <div className="siio-pulse-block">
      <button type="button" className="siio-link-button" onClick={() => setShowClosed(value => !value)}>{showClosed ? 'Ocultar cerrados' : `Ver cerrados (${closed.length})`}</button>
      {showClosed ? <ul className="siio-followup-list siio-followup-closed">{closed.map(item => <FollowupItem key={item.id} item={item} today={today} canEdit={list.permissions.edit} onChanged={reload} />)}</ul> : null}
    </div> : null}
    {!list.permissions.edit ? <p className="siio-pulse-footnote">{list.permissions.create ? 'Puedes crear seguimientos; los cierran los dueños.' : 'Vista de consulta.'}</p> : null}
  </section>;
}
