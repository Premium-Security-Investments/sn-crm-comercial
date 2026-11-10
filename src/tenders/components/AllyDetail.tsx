import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TenderRequest } from '../types';

/**
 * La ficha de una empresa de Aliados: datos del listado, procesos donde la vimos y «Nuestra relación con la empresa».
 * Se usa abierta en la tabla de Aliados y, desde «Posibles socios» en Decidir, en una ventana encima (Juan, 2026-11-10:
 * «desde ahí pudiera entrarse a la ficha de la empresa… en una ventana pop up»).
 */
export type City = { city: string; city_key: string; department: string | null };
export type Participation = { id: string; nit: string | null; company_label: string; entity: string | null; process_ref: string; kind: string; detail: string | null; source: string | null; occurred_on: string | null };
export type Company = { nit: string; dv: string | null; name: string; acronyms: string | null; representative: string | null; phone: string | null; email: string | null; license_resolution: string | null; role: string; contact: string | null; contact_name?: string | null; contact_title?: string | null; contact_phone?: string | null; contact_email?: string | null; notes: string | null; cities: City[]; participations: Participation[] };

export const ROLES: Array<[string, string]> = [['sin_clasificar', 'Sin clasificar'], ['aliado_potencial', 'Aliado potencial'], ['aliado', 'Aliado'], ['competidor', 'Competidor'], ['descartado', 'Descartado'], ['nosotros', 'Nosotros']];
export const KINDS: Array<[string, string]> = [['oferto', 'Ofertó'], ['observo_proyecto', 'Observó el proyecto'], ['observo_definitivo', 'Observó el definitivo'], ['adjudicatario', 'Adjudicatario'], ['contratista_actual', 'Contratista actual'], ['otro', 'Otro']];
export const allyLabel = (pairs: Array<[string, string]>, key: string) => pairs.find(([value]) => value === key)?.[1] || key;
const label = allyLabel;
/** Nuestro contacto en la empresa: los cuatro campos (197) o, si es de antes, el texto libre. */
export const ownContact = (company: Company) => ({ name: company.contact_name || '', title: company.contact_title || '', phone: company.contact_phone || '', email: company.contact_email || '', legacy: company.contact || '' });

const draftOf = (company: Company) => { const own = ownContact(company); return { role: company.role, name: own.name || own.legacy, title: own.title, phone: own.phone, email: own.email, notes: company.notes || '' }; };

export function AllyDetail({ company, canEdit, request, onSaved }: { company: Company; canEdit: boolean; request: TenderRequest; onSaved: () => Promise<void> | void }) {
  const [draft, setDraft] = useState(() => draftOf(company));
  const [part, setPart] = useState<Record<string, string>>({ kind: 'oferto' });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setDraft(draftOf(company)); }, [company]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setMessage('');
    try { await fn(); await onSaved(); setMessage(done); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  const save = () => act(() => request('/api/tender-allies/company', { method: 'POST', body: JSON.stringify({ nit: company.nit, role: draft.role, notes: draft.notes, contact: { name: draft.name, title: draft.title, phone: draft.phone, email: draft.email } }) }), 'Guardado.');
  const addPart = () => act(async () => {
    await request('/api/tender-allies/participation', { method: 'POST', body: JSON.stringify({ ...part, nit: company.nit, company_label: company.name }) });
    setPart({ kind: 'oferto' }); setAdding(false);
  }, 'Proceso agregado.');
  return <>
    {message && <div className="notice" role="status">{message}</div>}
              <div className="tender-allies-detail">
                <div className="tender-allies-facts">
                <dl>
                  <dt>NIT</dt><dd>{company.nit}{company.dv ? `-${company.dv}` : ''}</dd>
                  <dt>Representante</dt><dd>{company.representative || '—'}</dd>
                  <dt>Teléfono</dt><dd>{company.phone || '—'}</dd>
                  <dt>Correo</dt><dd>{company.email || '—'}</dd>
                  <dt>Licencia</dt><dd>{company.license_resolution || '—'}</dd>
                  <dt>Oficinas</dt><dd>{company.cities.map(city => city.city).join(', ') || '—'}</dd>
                </dl>
                <div>
                  <strong>Procesos donde la vimos</strong>
                  {company.participations.length > 0
                    ? <ul>{company.participations.map(item => <li key={item.id}>{item.process_ref}{item.entity ? ` (${item.entity})` : ''} · {label(KINDS, item.kind)}{item.detail ? ` · ${item.detail}` : ''}{item.occurred_on ? ` · ${item.occurred_on}` : ''}</li>)}</ul>
                    : <p className="muted">Ninguno todavía.</p>}
                  {canEdit && !adding && <button type="button" className="secondary tender-allies-add" onClick={() => setAdding(true)}>+ Agregar proceso</button>}
                </div>
                {canEdit && adding && <form className="tender-allies-form" onSubmit={event => { event.preventDefault(); void addPart(); }}>
                  <h4>Agregar un proceso donde la vimos</h4>
                  <label>Proceso<input required value={part.process_ref || ''} onChange={event => setPart({ ...part, process_ref: event.target.value })} placeholder="Ej. FGN-REC-IPSE-0058-2026" /></label>
                  <label>Entidad<input value={part.entity || ''} onChange={event => setPart({ ...part, entity: event.target.value })} placeholder="Ej. Fiscalía" /></label>
                  <label>Qué hizo<select value={part.kind} onChange={event => setPart({ ...part, kind: event.target.value })}>{KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                  <label>Fecha<input type="date" value={part.occurred_on || ''} onChange={event => setPart({ ...part, occurred_on: event.target.value })} /></label>
                  <label className="wide">Detalle<input value={part.detail || ''} onChange={event => setPart({ ...part, detail: event.target.value })} placeholder="Ej. Puesto 3 de 28" /></label>
                  <div className="wide row-actions"><button type="submit" disabled={busy}>Agregar</button><button type="button" className="secondary" onClick={() => setAdding(false)}>Cancelar</button></div>
                </form>}
                </div>
                {canEdit && <div className="tender-allies-forms">
                {canEdit && <form className="tender-allies-form" onSubmit={event => { event.preventDefault(); void save(); }}>
                  <h4>Nuestra relación con la empresa</h4>
                  <p className="muted wide">Lo llenamos nosotros: qué es para nosotros y con quién hablamos allá.</p>
                  <label className="wide">Rol<select value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value })}>{ROLES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                  <label>Nombre del contacto<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={200} /></label>
                  <label>Cargo<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} maxLength={200} placeholder="Ej. Gerente comercial" /></label>
                  <label>Teléfono<input type="tel" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} maxLength={100} /></label>
                  <label>Correo<input type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} maxLength={200} /></label>
                  <div className="wide tender-allies-notes"><label>Notas<textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={4000} rows={2} /></label><button type="submit" disabled={busy}>Guardar</button></div>
                </form>}
                </div>}
              </div>
  </>;
}

/** La misma ficha en una ventana encima de la pantalla; se cierra con Escape, con «Cerrar» o haciendo clic afuera. */
export function AllyCardDialog({ nit, canEdit, request, onClose, onChanged }: { nit: string; canEdit: boolean; request: TenderRequest; onClose: () => void; onChanged?: () => void }) {
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const load = async () => {
    try { setCompany((await request<{ company: Company }>(`/api/tender-allies/company?nit=${encodeURIComponent(nit)}`)).company); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  useEffect(() => { void load(); }, [nit]);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  // En el cuerpo de la página: los paneles de Decidir encierran a los elementos fijos y la ventana quedaba atrapada.
  return createPortal(<div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="ally-card-dialog" role="dialog" aria-modal="true" aria-labelledby="ally-card-title" tabIndex={-1} ref={dialogRef} onMouseDown={event => event.stopPropagation()}>
      <header><div><span className="eyebrow">Aliados</span><h4 id="ally-card-title">{company?.name || 'Empresa'}</h4>{company?.acronyms ? <small>{company.acronyms}</small> : null}</div><button type="button" className="secondary" onClick={onClose}>Cerrar</button></header>
      {error ? <div className="notice">{error}</div>
        : !company ? <p className="muted">Cargando…</p>
        : <AllyDetail company={company} canEdit={canEdit} request={request} onSaved={async () => { await load(); onChanged?.(); }} />}
    </div>
  </div>, document.body);
}
