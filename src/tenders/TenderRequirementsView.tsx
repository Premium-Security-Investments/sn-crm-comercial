import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { canApproveTenderGoNoGo } from './permissions';
import type { TendersModuleProps } from './types';

/**
 * Pestaña «Requisitos» (Juan, 2026-11-11: «vamos así y luego vemos detalles»). Arriba, lo que nos ha impedido
 * presentarnos, para trabajarlo (lo lleva Katherine); abajo, el catálogo histórico de requisitos habilitantes y
 * puntuables, una fila por tipo, armado con la matriz histórica de SharePoint, los análisis del CRM y las actas de cierre.
 */
type Process = { opportunity_id: string | null; process: string };
type Occurrence = { type: string; source: 'matriz' | 'crm' | 'acta'; id: string | null; opportunity_id?: string; process: string; text: string; threshold: string | null; points?: string | null; quote: string | null; url: string | null; incomplete: boolean; blocked: boolean };
type CatalogType = { key: string; kind: 'habilitante' | 'puntuable'; category: string; category_label: string; title: string; processes: number; blocked_in: Process[]; occurrences: Occurrence[] };
type Focus = { key: string; title: string; live: string | null; live_state: string | null; blocked_in: Process[]; processes: number; status: Status; owner: string | null; note: string | null; current_state: string | null; fix_action: string; updated_at: string | null };
type Status = 'pendiente' | 'en_tramite' | 'resuelto';
type Payload = { installed: boolean; matrix: { path: string; rows: number; loaded_at: string | null; source_modified_at: string | null }; crm_processes: number; focus: Focus[]; catalog: { types: CatalogType[]; totals: { occurrences: number; excluded_fragments: number; processes: number; types: number } } };

const STATUSES: [Status, string][] = [['pendiente', 'Pendiente'], ['en_tramite', 'En trámite'], ['resuelto', 'Resuelto']];
const SOURCES = { matriz: 'Matriz histórica', crm: 'Análisis del CRM', acta: 'Acta de cierre' } as const;
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function ProcessLinks({ items }: { items: Process[] }) {
  return <ul className="tender-requirements-processes">{items.map(item => <li key={item.opportunity_id || item.process}>
    {item.opportunity_id ? <a href={`#/detail/${item.opportunity_id}`}>{item.process}</a> : item.process}
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
    <p className="tender-requirements-count"><strong>{focus.blocked_in.length ? `Nos frenó en ${plural(focus.blocked_in.length, 'proceso', 'procesos')}` : 'Todavía no nos ha frenado'}</strong> · lo piden {plural(focus.processes, 'proceso', 'procesos')}</p>
    {focus.blocked_in.length > 0 && <details><summary>En cuáles</summary><ProcessLinks items={focus.blocked_in} /></details>}
    {!editing ? <>
      <dl>
        <dt>Cómo estamos hoy{focus.live ? ' (de la ficha de la empresa)' : ''}</dt><dd>{state || <span className="muted">Sin registrar.</span>}</dd>
        <dt>Qué lo resuelve</dt><dd>{focus.fix_action}</dd>
        {focus.note && <><dt>Nota</dt><dd>{focus.note}</dd></>}
        <dt>Responsable</dt><dd>{focus.owner || <span className="muted">Sin asignar.</span>}</dd>
      </dl>
      {canEdit && <button type="button" className="secondary" onClick={() => setEditing(true)}>Actualizar</button>}
    </> : <div className="tender-requirements-form">
      <label>Estado<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Status })}>{STATUSES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      <label>Responsable<input value={draft.owner || ''} onChange={event => setDraft({ ...draft, owner: event.target.value })} /></label>
      {!focus.live && <label>Cómo estamos hoy<textarea rows={3} value={draft.current_state || ''} onChange={event => setDraft({ ...draft, current_state: event.target.value })} /></label>}
      <label>Qué lo resuelve<textarea rows={3} value={draft.fix_action || ''} onChange={event => setDraft({ ...draft, fix_action: event.target.value })} /></label>
      <label>Nota (qué se hizo)<textarea rows={2} value={draft.note || ''} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label>
      {error && <div className="notice" role="alert">{error}</div>}
      <div className="tender-requirements-actions">
        <button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => { setDraft(focus); setEditing(false); }}>Cancelar</button>
      </div>
    </div>}
  </article>;
}

function OccurrenceList({ type }: { type: CatalogType }) {
  const [all, setAll] = useState(false);
  const shown = all ? type.occurrences : type.occurrences.slice(0, 20);
  return <div className="tender-requirements-occurrences">
    <ul>{shown.map((item, index) => <li key={`${item.source}-${item.id || index}-${item.process}`}>
      <p className="tender-requirements-occurrence-head">
        {item.opportunity_id ? <a href={`#/detail/${item.opportunity_id}`}>{item.process}</a> : <span>{item.process}</span>}
        <span className="muted"> · {SOURCES[item.source]}</span>
        {item.blocked && <span className="tender-requirements-tag is-blocked">Nos frenó</span>}
        {item.incomplete && <span className="tender-requirements-tag">Texto incompleto en la matriz</span>}
      </p>
      <p>{item.text}</p>
      {(item.threshold || item.points) && <p className="muted">{[item.threshold, item.points ? `${item.points} puntos` : ''].filter(Boolean).join(' · ')}</p>}
      {item.quote && <blockquote>{item.quote}</blockquote>}
    </li>)}</ul>
    {type.occurrences.length > shown.length && <button type="button" className="secondary" onClick={() => setAll(true)}>Ver las {type.occurrences.length}</button>}
  </div>;
}

export function TenderRequirementsView({ request, data, moduleNavigation }: TendersModuleProps & { moduleNavigation: ReactNode }) {
  const canEdit = canApproveTenderGoNoGo(data.currentProfile);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    try { setPayload(await request<Payload>('/api/tender-requirements')); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, []);

  const types = payload?.catalog.types || [];
  const categories = useMemo(() => [...new Map(types.map(type => [type.category, type.category_label]))].sort((a, b) => a[1].localeCompare(b[1])), [types]);
  const filtered = useMemo(() => {
    const q = fold(query.trim());
    return types.filter(type => (!kind || type.kind === kind) && (!category || type.category === category)
      && (!q || fold(type.title).includes(q) || type.occurrences.some(item => fold(item.text).includes(q))));
  }, [types, kind, category, query]);

  return <section className="stack tenders-page tender-requirements-view" aria-labelledby="tender-requirements-heading">
    <header className="tracking-header"><div><span className="eyebrow">Licitaciones</span><h2 id="tender-requirements-heading">Requisitos</h2>
      <p>Lo que nos ha impedido presentarnos, para trabajarlo, y el histórico de requisitos habilitantes y puntuables de los procesos que hemos revisado.</p></div></header>
    {moduleNavigation}
    {message && <div className="notice" role="status">{message}</div>}
    {!payload ? <div className="notice">Cargando requisitos…</div> : <>
      <section className="stack" aria-labelledby="tender-requirements-focus-heading">
        <h3 id="tender-requirements-focus-heading">Lo que nos frena</h3>
        <p className="muted">«Nos frenó» quiere decir que un análisis lo marcó como bloqueante o que el acta de cierre lo registró como incumplido. Ningún proceso nos ha rechazado en un informe de evaluación: son los que nos impidieron presentarnos.</p>
        {!payload.installed && <div className="notice">El estado de cada requisito todavía no se puede guardar (falta la migración 210).</div>}
        <div className="tender-requirements-focus-grid">{payload.focus.map(focus => <FocusCard key={focus.key} focus={focus} canEdit={canEdit && payload.installed} request={request} onSaved={load} />)}</div>
      </section>

      <section className="stack" aria-labelledby="tender-requirements-catalog-heading">
        <h3 id="tender-requirements-catalog-heading">Catálogo histórico</h3>
        <div className="tender-allies-filters">
          <label>Tipo<select value={kind} onChange={event => setKind(event.target.value)}><option value="">Todos</option><option value="habilitante">Habilitantes</option><option value="puntuable">Puntuables</option></select></label>
          <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas</option>{categories.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
          <label>Buscar<input value={query} onChange={event => setQuery(event.target.value)} placeholder="liquidez, sucursal, ISO…" /></label>
        </div>
        <p className="muted">{filtered.length} de {types.length} tipos de requisito, de {payload.catalog.totals.processes} procesos ({payload.crm_processes} analizados en el CRM).</p>
        <div className="tender-allies-scroll"><table className="tender-requirements-table">
          <colgroup><col className="col-title" /><col className="col-category" /><col className="col-count" /><col className="col-count" /></colgroup>
          <thead><tr><th scope="col">Requisito</th><th scope="col">Categoría</th><th scope="col">Lo piden</th><th scope="col">Nos frenó</th></tr></thead>
          <tbody>{filtered.map(type => <Fragment key={type.key}>
            <tr className={open === type.key ? 'is-open' : ''}>
              <td><button type="button" className="tender-requirements-name" aria-expanded={open === type.key} onClick={() => setOpen(open === type.key ? null : type.key)}>{type.title}</button>
                {type.kind === 'puntuable' && <span className="tender-requirements-tag">Puntaje</span>}</td>
              <td>{type.category_label}</td>
              <td>{plural(type.processes, 'proceso', 'procesos')}</td>
              <td>{type.blocked_in.length ? plural(type.blocked_in.length, 'proceso', 'procesos') : '—'}</td>
            </tr>
            {open === type.key && <tr className="tender-requirements-detail"><td colSpan={4}><OccurrenceList type={type} /></td></tr>}
          </Fragment>)}</tbody>
        </table></div>
        <p className="muted">Fuentes: la matriz histórica de SharePoint ({payload.matrix.rows ? `${payload.matrix.rows} filas, copiadas el ${new Date(payload.matrix.loaded_at || '').toLocaleDateString('es-CO')}` : 'todavía no se ha copiado; el puente diario la trae'}), los análisis del CRM y las actas de cierre, en vivo. {payload.catalog.totals.excluded_fragments} filas de la matriz eran pedazos de frase sin un requisito y no cuentan.</p>
      </section>
    </>}
  </section>;
}
