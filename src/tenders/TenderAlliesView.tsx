import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { canApproveTenderGoNoGo } from './permissions';
import type { TendersModuleProps } from './types';

/**
 * Aliados para uniones temporales (encargo AGT-002 del 2026-11-09; Juan, 2026-11-09): la base de empresas de vigilancia
 * —aliados y competidores— con filtro por ciudad y rol, lo nuestro de cada una (rol, contacto, notas) y en qué procesos
 * la hemos visto. La plataforma es la fuente; el listado de la Superintendencia se carga con un botón y su actualización
 * nunca toca rol, contacto ni notas.
 */
type City = { city: string; city_key: string; department: string | null };
type Participation = { id: string; nit: string | null; company_label: string; entity: string | null; process_ref: string; kind: string; detail: string | null; source: string | null; occurred_on: string | null };
type Company = { nit: string; dv: string | null; name: string; acronyms: string | null; representative: string | null; phone: string | null; email: string | null; license_resolution: string | null; role: string; contact: string | null; notes: string | null; cities: City[]; participations: Participation[] };
type Payload = { installed: boolean; companies: Company[]; participations_without_nit: Participation[]; listing_source: string; seed_missing?: number };

const ROLES: Array<[string, string]> = [['sin_clasificar', 'Sin clasificar'], ['aliado_potencial', 'Aliado potencial'], ['aliado', 'Aliado'], ['competidor', 'Competidor'], ['descartado', 'Descartado'], ['nosotros', 'Nosotros']];
const KINDS: Array<[string, string]> = [['oferto', 'Ofertó'], ['observo_proyecto', 'Observó el proyecto'], ['observo_definitivo', 'Observó el definitivo'], ['adjudicatario', 'Adjudicatario'], ['contratista_actual', 'Contratista actual'], ['otro', 'Otro']];
const label = (pairs: Array<[string, string]>, key: string) => pairs.find(([value]) => value === key)?.[1] || key;
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PAGE = 50;

export function TenderAlliesView({ request, data, moduleNavigation }: TendersModuleProps & { moduleNavigation: ReactNode }) {
  const canEdit = canApproveTenderGoNoGo(data.currentProfile);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState('');
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [onlySeen, setOnlySeen] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ role: string; contact: string; notes: string }>({ role: '', contact: '', notes: '' });
  const [part, setPart] = useState<Record<string, string>>({ kind: 'oferto' });

  const load = async () => {
    try { setPayload(await request<Payload>('/api/tender-allies')); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const wanted = cities.split(/[,;+]/).map(item => fold(item).trim()).filter(Boolean);
    const q = fold(query.trim());
    return (payload?.companies || []).filter(company => {
      if (role && company.role !== role) return false;
      if (onlySeen && !company.participations.length) return false;
      if (q && !fold(`${company.name} ${company.acronyms || ''} ${company.nit}`).includes(q)) return false;
      return wanted.every(city => company.cities.some(item => item.city_key.includes(city.replace(/[^a-z0-9 ]+/g, ' ').trim())));
    }).sort((a, b) => b.participations.length - a.participations.length || a.name.localeCompare(b.name));
  }, [payload, cities, role, query, onlySeen]);
  useEffect(() => { setPage(0); }, [cities, role, query, onlySeen]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage('');
    try { await fn(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  };
  const loadListing = () => act(async () => {
    const result = await request<{ companies: number; offices: number; participations_seeded: number }>('/api/tender-allies/load', { method: 'POST', body: '{}' });
    setMessage(`Listado cargado: ${result.companies} empresas, ${result.offices} oficinas${result.participations_seeded ? `, ${result.participations_seeded} participaciones` : ''}.`);
  });
  const toggle = (company: Company) => {
    setOpen(open === company.nit ? null : company.nit);
    setDraft({ role: company.role, contact: company.contact || '', notes: company.notes || '' });
    setPart({ kind: 'oferto' });
  };
  const save = (company: Company) => act(() => request('/api/tender-allies/company', { method: 'POST', body: JSON.stringify({ nit: company.nit, ...draft }) }));
  const addPart = (company: Company) => act(() => request('/api/tender-allies/participation', { method: 'POST', body: JSON.stringify({ ...part, nit: company.nit, company_label: company.name }) }));

  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const totalParticipations = (payload?.companies || []).reduce((sum, company) => sum + company.participations.length, 0) + (payload?.participations_without_nit.length || 0);
  return <section className="stack tenders-page tender-allies-view" aria-labelledby="tender-allies-heading">
    <header className="tracking-header"><div><span className="eyebrow">Uniones temporales</span><h2 id="tender-allies-heading">Aliados</h2><p>Empresas de vigilancia —aliados y competidores— para buscar socio. Una oficina en el listado no prueba la agencia: el pliego pide la resolución de la Superintendencia y el certificado de Cámara.</p></div></header>
    {moduleNavigation}
    {message && <div className="notice" role="status">{message}</div>}
    {!payload ? <div className="notice">Cargando aliados…</div>
      : !payload.installed ? <div className="notice">Aliados todavía no está instalado en la base (falta la migración 196).</div>
      : <>
        <div className="tender-allies-source">
          <div>
            <strong>Listado de la Superintendencia</strong>
            <span>{payload.companies.length ? `${payload.companies.length} empresas · ${totalParticipations} participaciones registradas` : 'Todavía no se ha cargado.'}</span>
            <small>{payload.listing_source}. Actualizar no toca rol, contacto ni notas.</small>
            {(payload.seed_missing || 0) > 0 && <small className="tender-allies-warn">Faltan {payload.seed_missing} participaciones de la carga inicial: «Actualizar listado» las completa.</small>}
          </div>
          {canEdit && <button type="button" disabled={busy} onClick={() => void loadListing()}>{busy ? 'Actualizando…' : payload.companies.length ? 'Actualizar listado' : 'Cargar el listado'}</button>}
        </div>
        {payload.companies.length > 0 && <>
          <div className="tender-allies-filters">
            <label>Ciudades (separadas por coma)<input value={cities} onChange={event => setCities(event.target.value)} placeholder="Quibdó, Armenia" /></label>
            <label>Rol<select value={role} onChange={event => setRole(event.target.value)}><option value="">Todos</option>{ROLES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label>Empresa o NIT<input value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label className="tender-allies-check"><input type="checkbox" checked={onlySeen} onChange={event => setOnlySeen(event.target.checked)} /> Sólo las vistas en procesos</label>
          </div>
          <p className="muted">{filtered.length} de {payload.companies.length} empresas.</p>
          <div className="tender-allies-scroll"><table className="tender-allies-table">
            <colgroup><col className="col-name" /><col className="col-cities" /><col className="col-role" /><col className="col-seen" /><col className="col-contact" /></colgroup>
            <thead><tr><th scope="col">Empresa</th><th scope="col">Ciudades</th><th scope="col">Rol</th><th scope="col">Procesos</th><th scope="col">Contacto</th></tr></thead>
            <tbody>{rows.map(company => <AllyRow key={company.nit} company={company} isOpen={open === company.nit} onToggle={() => toggle(company)}>
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
                </div>
                </div>
                {canEdit && <div className="tender-allies-forms">
                {canEdit && <form className="tender-allies-form" onSubmit={event => { event.preventDefault(); void save(company); }}>
                  <h4>Lo nuestro</h4>
                  <label>Rol<select value={draft.role} onChange={event => setDraft({ ...draft, role: event.target.value })}>{ROLES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                  <label>Contacto<input value={draft.contact} onChange={event => setDraft({ ...draft, contact: event.target.value })} maxLength={1000} placeholder="Nombre, cargo, teléfono" /></label>
                  <label className="wide">Notas<textarea value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} maxLength={4000} rows={3} /></label>
                  <div className="wide"><button type="submit" disabled={busy}>Guardar</button></div>
                </form>}
                {canEdit && <form className="tender-allies-form" onSubmit={event => { event.preventDefault(); void addPart(company); }}>
                  <h4>Agregar un proceso donde la vimos</h4>
                  <label>Proceso<input required value={part.process_ref || ''} onChange={event => setPart({ ...part, process_ref: event.target.value })} placeholder="Ej. FGN-REC-IPSE-0058-2026" /></label>
                  <label>Entidad<input value={part.entity || ''} onChange={event => setPart({ ...part, entity: event.target.value })} placeholder="Ej. Fiscalía" /></label>
                  <label>Qué hizo<select value={part.kind} onChange={event => setPart({ ...part, kind: event.target.value })}>{KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                  <label>Fecha<input type="date" value={part.occurred_on || ''} onChange={event => setPart({ ...part, occurred_on: event.target.value })} /></label>
                  <label className="wide">Detalle<input value={part.detail || ''} onChange={event => setPart({ ...part, detail: event.target.value })} placeholder="Ej. Puesto 3 de 28" /></label>
                  <div className="wide"><button type="submit" className="secondary" disabled={busy}>Agregar</button></div>
                </form>}
                </div>}
              </div>
            </AllyRow>)}</tbody>
          </table></div>
          <nav className="pagination" aria-label="Páginas de aliados"><button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span className="pagination-status">Página {page + 1} de {Math.max(1, Math.ceil(filtered.length / PAGE))}</span><button className="secondary" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Siguiente</button></nav>
          {payload.participations_without_nit.length > 0 && <details><summary>Participaciones sin NIT ({payload.participations_without_nit.length}): uniones temporales sin integrantes conocidos</summary>
            <ul>{payload.participations_without_nit.map(item => <li key={item.id}>{item.company_label} · {item.process_ref} · {label(KINDS, item.kind)}{item.detail ? ` · ${item.detail}` : ''}</li>)}</ul></details>}
        </>}
      </>}
  </section>;
}

function AllyRow({ company, isOpen, onToggle, children }: { company: Company; isOpen: boolean; onToggle: () => void; children: ReactNode }) {
  const shown = company.cities.slice(0, 5).map(city => city.city).filter(Boolean).join(', ');
  return <>
    <tr className={isOpen ? 'is-open' : ''}>
      <th scope="row"><button type="button" className="tender-allies-name" aria-expanded={isOpen} onClick={onToggle}>{company.name}</button>{company.acronyms ? <small>{company.acronyms}</small> : null}</th>
      <td>{shown}{company.cities.length > 5 ? ` y ${company.cities.length - 5} más` : ''}</td>
      <td>{label(ROLES, company.role)}</td>
      <td>{company.participations.length || ''}</td>
      <td>{company.contact || ''}</td>
    </tr>
    {isOpen && <tr><td colSpan={5}>{children}</td></tr>}
  </>;
}
