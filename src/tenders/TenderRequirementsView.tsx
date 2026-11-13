import { useEffect, useState, type ReactNode } from 'react';
import { canApproveTenderGoNoGo } from './permissions';
import type { TendersModuleProps } from './types';

/**
 * Pestaña «Requisitos» (Juan, 2026-11-11 y 2026-11-12): sólo los hechos que nos faltan y exigen un trámite —una sede o
 * sucursal, un código en el RUP, un registro, una licencia—, para que Katherine decida si se inicia el trámite y en el
 * futuro no nos inhabiliten por eso. Sale de cruzar con la ficha de la empresa los requisitos de la matriz histórica, de
 * los análisis del CRM y de las actas de cierre. Los papeles que se renuevan no aparecen.
 */
type Process = { opportunity_id: string | null; process: string; reason: string; blocked?: boolean; deadline?: string | null; upcoming?: boolean };
type Status = 'por_decidir' | 'iniciar' | 'en_tramite' | 'resuelto' | 'no_por_ahora';
type Focus = { key: string; title: string; live: string | null; live_state: string | null; processes: Process[]; upcoming: Process[]; past: Process[]; blocked: number; status: Status; owner: string | null; note: string | null; current_state: string | null; fix_action: string; updated_at: string | null };
type Pending = { key: string; title: string; processes: Process[]; upcoming: Process[]; past: Process[] };
type Payload = { installed: boolean; matrix: { rows: number; loaded_at: string | null }; crm_processes: number; focus: Focus[]; pending: Pending[]; catalog: { totals: { processes: number } } };

const STATUSES: [Status, string][] = [['por_decidir', 'Por decidir'], ['iniciar', 'Iniciar trámite'], ['en_tramite', 'En trámite'], ['resuelto', 'Resuelto'], ['no_por_ahora', 'No por ahora']];
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const day = (date?: string | null) => (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? `${Number(date.slice(8, 10))}-${MONTHS[Number(date.slice(5, 7)) - 1]}` : '');
// El nombre corto del proceso para la línea de próximos: la entidad sin «Rama Judicial · Dirección Seccional de…».
const foldName = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const shortName = (process: string) => {
  const [entity, ref] = process.split(' · ');
  const city = entity.match(/(?:Administraci[oó]n Judicial|Seccional)(?: de)? ([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)\s*$/)?.[1];
  const plain = entity.replace(/^SUPERINTENDENCIA (NACIONAL )?DE /i, '').trim();
  const acronym = plain.match(/^([A-ZÁÉÍÓÚÑ]{2,5}) [A-ZÁÉÍÓÚÑ]/)?.[1];
  const name = /Direcci[oó]n Ejecutiva de Administraci[oó]n Judicial/i.test(entity) ? 'DEAJ' : city ? `Rama ${city}` : acronym
    || (plain.length > 28 ? `${plain.slice(0, 26)}…` : plain);
  // «SIC» + «SIC 23 DE 2026»: si la referencia ya empieza por el nombre, va sola.
  if (ref && !city && name.length < 12) return foldName(ref).startsWith(foldName(name)) ? ref : `${name} ${ref}`;
  return name;
};

/**
 * Los procesos abiertos que este requisito bloquea, en una línea y por fecha de cierre (Juan, 2026-11-13: «que no se
 * vaya a volver una tarjeta pesada»). El motivo sale al pasar el mouse; los que no caben quedan en «+N».
 */
function UpcomingLine({ items }: { items: Process[] }) {
  if (!items.length) return <p className="tender-requirements-upcoming muted">Ningún proceso abierto lo pide hoy.</p>;
  const shown = items.slice(0, 4);
  return <p className="tender-requirements-upcoming"><strong>Próximos: </strong>{shown.map((item, index) => <span key={item.opportunity_id || item.process}>
    {index > 0 && ' · '}
    {item.opportunity_id ? <a href={`#/detail/${item.opportunity_id}`} title={item.reason}>{shortName(item.process)} {day(item.deadline)}</a>
      : <span title={item.reason}>{shortName(item.process)} {day(item.deadline)}</span>}
  </span>)}{items.length > shown.length && <span className="muted" title={items.slice(4).map(item => `${shortName(item.process)} ${day(item.deadline)}`).join(' · ')}> · +{items.length - shown.length}</span>}</p>;
}

function ProcessList({ items }: { items: Process[] }) {
  return <ul className="tender-requirements-processes">{items.map(item => <li key={item.opportunity_id || item.process}>
    {item.opportunity_id ? <a href={`#/detail/${item.opportunity_id}`}>{item.process}</a> : <strong>{item.process}</strong>}
    {item.blocked && <span className="tender-requirements-tag is-blocked">Nos frenó</span>}
    <span className="muted"> — {item.reason}</span>
  </li>)}</ul>;
}

function FocusCard({ focus, canEdit, request, onSaved }: { focus: Focus; canEdit: boolean; request: TendersModuleProps['request']; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(focus);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(focus); }, [focus]);
  const state = focus.live_state || focus.current_state;
  const save = async () => {
    setBusy(true); setError('');
    try {
      await request('/api/tender-requirements/focus', { method: 'POST', body: JSON.stringify({ focus_key: focus.key, status: draft.status, owner: draft.owner || '', note: draft.note || '', current_state: draft.current_state || '', fix_action: draft.fix_action || '' }) });
      setEditing(false); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  };
  return <article className={`tender-requirements-focus is-${focus.status}`}>
    <header>
      <h4>{focus.title}</h4>
      <span className={`tender-requirements-status is-${focus.status}`}>{STATUSES.find(([value]) => value === focus.status)?.[1]}</span>
    </header>
    <UpcomingLine items={focus.upcoming} />
    {!editing ? <>
      <dl>
        {state && <><dt>Cómo estamos hoy{focus.live ? ' (de la ficha de la empresa)' : ''}</dt><dd>{state}</dd></>}
        <dt>Qué lo resuelve</dt><dd>{focus.fix_action}</dd>
        {focus.note && <><dt>Nota</dt><dd>{focus.note}</dd></>}
        <dt>Responsable</dt><dd>{focus.owner || <span className="muted">Sin asignar.</span>}</dd>
      </dl>
      {canEdit && <button type="button" className="secondary" onClick={() => setEditing(true)}>Decidir</button>}
      {focus.past.length > 0 && <details className="tender-requirements-past"><summary>Procesos pasados ({focus.past.length})</summary><ProcessList items={focus.past} /></details>}
    </> : <div className="tender-requirements-form">
      <label>Decisión<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Status })}>{STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label>Responsable<input value={draft.owner || ''} onChange={event => setDraft({ ...draft, owner: event.target.value })} /></label>
      {!focus.live && <label>Cómo estamos hoy<textarea rows={2} value={draft.current_state || ''} onChange={event => setDraft({ ...draft, current_state: event.target.value })} /></label>}
      <label>Qué lo resuelve<textarea rows={3} value={draft.fix_action || ''} onChange={event => setDraft({ ...draft, fix_action: event.target.value })} /></label>
      <label>Nota (qué se hizo o por qué no)<textarea rows={2} value={draft.note || ''} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="tender-requirements-actions">
        <button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(focus); setEditing(false); }}>Cancelar</button>
      </div>
    </div>}
  </article>;
}

export function TenderRequirementsView({ request, data, moduleNavigation }: TendersModuleProps & { moduleNavigation: ReactNode }) {
  const canEdit = canApproveTenderGoNoGo(data.currentProfile);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const load = async () => {
    try { setPayload(await request<Payload>('/api/tender-requirements')); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, []);

  return <section className="stack tenders-page tender-requirements-view" aria-labelledby="tender-requirements-heading">
    <header className="tracking-header"><div><span className="eyebrow">Licitaciones</span><h2 id="tender-requirements-heading">Requisitos</h2>
      <p>Lo que nos falta y nos inhabilita en las licitaciones: registros, códigos, sedes y licencias que exigen un trámite. Para decidir si lo iniciamos.</p></div></header>
    {moduleNavigation}
    {message && <div className="notice" role="status">{message}</div>}
    {!payload ? <div className="notice">Cargando requisitos…</div> : <>
      <section className="stack" aria-labelledby="tender-requirements-focus-heading">
        <h3 id="tender-requirements-focus-heading">Lo que nos inhabilita</h3>
        <p className="muted">Cada requisito de {payload.catalog.totals.processes} procesos, cruzado con la ficha de la empresa. No aparecen los papeles que se renuevan (Cámara de Comercio, RUP con fecha nueva, certificados, pólizas).</p>
        {!payload.installed && <div className="notice">Las decisiones todavía no se pueden guardar (falta la migración 215).</div>}
        {!payload.focus.length ? <div className="notice">Con la ficha de hoy, ningún requisito revisado nos inhabilita.</div>
          : <div className="tender-requirements-focus-grid">{payload.focus.map(focus => <FocusCard key={focus.key} focus={focus} canEdit={canEdit && payload.installed} request={request} onSaved={load} />)}</div>}
      </section>
      {payload.pending.length > 0 && <details className="tender-requirements-pending">
        <summary>Por confirmar: {plural(payload.pending.length, 'requisito que la ficha no deja decidir', 'requisitos que la ficha no deja decidir')}</summary>
        {payload.pending.map(item => <div key={item.key}><h4>{item.title}</h4>
          {item.upcoming.length ? <ProcessList items={item.upcoming.map(process => ({ ...process, process: `${process.process}${process.deadline ? ` (cierra ${day(process.deadline)})` : ''}` }))} />
            : <p className="muted">Ningún proceso abierto.</p>}
          {item.past.length > 0 && <details className="tender-requirements-past"><summary>Procesos pasados ({item.past.length})</summary><ProcessList items={item.past} /></details>}
        </div>)}
      </details>}
      <p className="muted">Fuentes: {payload.matrix.rows ? `la matriz histórica de SharePoint (${payload.matrix.rows} filas)` : 'la matriz histórica de SharePoint todavía no se ha cargado'}, {payload.crm_processes} procesos analizados en el CRM y las actas de cierre. Cada análisis nuevo entra solo.</p>
    </>}
  </section>;
}
