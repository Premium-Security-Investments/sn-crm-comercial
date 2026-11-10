import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { canApproveTenderGoNoGo } from './permissions';
import type { TendersModuleProps } from './types';
import { AllyDetail, KINDS, ROLES, allyLabel as label, ownContact, type Company, type Participation } from './components/AllyDetail';

/**
 * Aliados para uniones temporales (encargo AGT-002 del 2026-11-09; Juan, 2026-11-09): la base de empresas de vigilancia
 * —aliados y competidores— con filtro por ciudad y rol, lo nuestro de cada una (rol, contacto, notas) y en qué procesos
 * la hemos visto. La plataforma es la fuente; el listado de la Superintendencia se carga con un botón y su actualización
 * nunca toca rol, contacto ni notas.
 */
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PAGE = 50;
type Payload = { installed: boolean; companies: Company[]; participations_without_nit: Participation[]; listing_source: string; seed_missing?: number };

export function TenderAlliesView({ request, data, moduleNavigation }: TendersModuleProps & { moduleNavigation: ReactNode }) {
  const canEdit = canApproveTenderGoNoGo(data.currentProfile);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const [cities, setCities] = useState('');
  const [role, setRole] = useState('');
  const [query, setQuery] = useState('');
  const [onlySeen, setOnlySeen] = useState(false);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

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

  const toggle = (company: Company) => setOpen(open === company.nit ? null : company.nit);

  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  return <section className="stack tenders-page tender-allies-view" aria-labelledby="tender-allies-heading">
    <header className="tracking-header"><div><span className="eyebrow">Uniones temporales</span><h2 id="tender-allies-heading">Aliados</h2><p>Empresas de vigilancia —aliados y competidores— para buscar socio. Una oficina en el listado no prueba la agencia: el pliego pide la resolución de la Superintendencia y el certificado de Cámara.</p></div></header>
    {moduleNavigation}
    {message && <div className="notice" role="status">{message}</div>}
    {!payload ? <div className="notice">Cargando aliados…</div>
      : !payload.installed ? <div className="notice">Aliados todavía no está instalado en la base (falta la migración 196).</div>
      : <>
        {/* Sin tarjeta del listado (Juan, 2026-11-10: «no aporta nada, quita espacio y distrae»). Un listado nuevo de la
            Superintendencia lo carga el agente con POST /api/tender-allies/load. */}
        {!payload.companies.length && <div className="notice">El listado de la Superintendencia todavía no se ha cargado.</div>}
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
            <thead><tr><th scope="col">Empresa</th><th scope="col">Ciudades</th><th scope="col">Rol</th><th scope="col">Vista en procesos</th><th scope="col">Contacto</th></tr></thead>
            <tbody>{rows.map(company => <AllyRow key={company.nit} company={company} isOpen={open === company.nit} onToggle={() => toggle(company)}>
              <AllyDetail company={company} canEdit={canEdit} request={request} onSaved={load} />
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
      {/* Sin contacto propio, el del listado (Juan, 2026-11-10): el representante legal, su teléfono y su correo, en gris. */}
      <td><ContactCell company={company} /></td>
    </tr>
    {isOpen && <tr className="is-open-detail"><td colSpan={5}>{children}</td></tr>}
  </>;
}

function ContactCell({ company }: { company: Company }) {
  const own = ownContact(company);
  if (own.name || own.title || own.phone || own.email) return <span className="tender-allies-own-contact"><b>{own.name || own.title}</b>{own.name && own.title ? <small>{own.title}</small> : null}<small>{[own.phone, own.email].filter(Boolean).join(' · ')}</small></span>;
  if (own.legacy) return <>{own.legacy}</>;
  return <span className="tender-allies-listing-contact">{company.representative && <b>{company.representative}</b>}{[company.phone, company.email].filter(Boolean).join(' · ')}</span>;
}
