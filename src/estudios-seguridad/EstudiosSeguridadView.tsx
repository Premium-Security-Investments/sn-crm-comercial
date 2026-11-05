// Estudios de Seguridad Física, tramo 1 (Juan, 2026-11-05): quien hace el estudio lo registra aquí en vez de un
// Excel. Lista de estudios, alta (cliente y sede elegidos de Avancys o del CRM, nunca escritos) y ficha del estudio
// con zonas, riesgos, controles y acciones. La valoración la calcula el servidor; esta pantalla sólo la muestra.
import { useCallback, useEffect, useMemo, useState } from 'react';
import './estudios.css';
import { EvidenceStrip } from './EvidenceStrip';
import { WorkflowPanel } from './WorkflowPanel';
import {
  CONTROL_SCALE, IMPACT_SCALE, NIVEL_LABELS, NIVEL_ORDER, PROBABILITY_SCALE, STATUS_LABELS,
  addAction, addRisk, addZone, clientPosts, createStudy, deleteAction, deleteRisk, deleteZone, evidenceUrls, getStudy, listStudies, searchClients, updateRisk,
  type Action, type Catalog, type ClientOption, type Evidence, type Nivel, type PostsResult, type Risk, type RiskDraft, type StudyDetail, type StudySummaryRow, type Zone,
} from './api';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
const fmtDate = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : '—');

export function EstudiosSeguridadView({ studyId, navigate }: { studyId?: string; navigate: (hash: string) => void }) {
  return studyId
    ? <StudyFile key={studyId} studyId={studyId} onBack={() => navigate('#/estudios')} />
    : <StudyList onOpen={id => navigate(`#/estudios/${encodeURIComponent(id)}`)} />;
}

function NivelBadge({ nivel, value }: { nivel: Nivel; value?: number }) {
  return <span className={`es-nivel es-nivel-${nivel}`}>{value !== undefined ? `${value} · ` : ''}{NIVEL_LABELS[nivel]}</span>;
}

// --- Lista ---------------------------------------------------------------------------------------------------

function StudyList({ onOpen }: { onOpen: (id: string) => void }) {
  const [studies, setStudies] = useState<StudySummaryRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    listStudies().then(result => setStudies(result.studies)).catch(reason => setError(message(reason)));
  }, []);
  return <section className="panel es-panel" aria-label="Estudios de seguridad">
    <div className="es-head">
      <div>
        <h2>Estudios de seguridad</h2>
        <p className="es-muted">Cada estudio se registra aquí: zonas, riesgos, controles y acciones. El cálculo y el informe salen de lo registrado.</p>
      </div>
      {!creating ? <button type="button" onClick={() => setCreating(true)}>+ Nuevo estudio</button> : null}
    </div>
    {creating ? <NewStudyForm onCancel={() => setCreating(false)} onCreated={onOpen} /> : null}
    {error ? <div className="error" role="alert">{error}</div> : null}
    {studies === null && !error ? <p className="es-muted">Cargando estudios…</p> : null}
    {studies?.length === 0 ? <p className="es-muted">Todavía no hay estudios. Cree el primero con "+ Nuevo estudio".</p> : null}
    {studies?.length ? <div className="tablewrap"><table>
      <thead><tr><th>Código</th><th>Estudio</th><th>Cliente y sede</th><th>Estado</th><th>Visita</th><th>Riesgos</th></tr></thead>
      <tbody>{studies.map(study => <tr key={study.id} className="clickable" onClick={() => onOpen(study.id)}>
        <td><strong>{study.code}</strong></td>
        <td>{study.title}</td>
        <td>{study.client_name}<br /><small className="es-muted">{study.site_name}{study.site_city ? ` · ${study.site_city}` : ''}</small></td>
        <td><span className="badge">{STATUS_LABELS[study.status]}</span></td>
        <td>{fmtDate(study.visit_date)}</td>
        <td>{study.risk_count}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}

// --- Alta: el cliente y la sede se eligen de las fuentes ------------------------------------------------------------

type SiteChoice = { site_source: 'avancys_puesto' | 'crm' | 'manual'; site_ref: string | null; site_name: string; site_city: string };

function NewStudyForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ClientOption[]>([]);
  const [avancysState, setAvancysState] = useState('ok');
  const [client, setClient] = useState<ClientOption | null>(null);
  const [posts, setPosts] = useState<PostsResult | null>(null);
  const [site, setSite] = useState<SiteChoice | null>(null);
  const [manualSite, setManualSite] = useState(false);
  const [visitDate, setVisitDate] = useState('');
  const [scope, setScope] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (client || query.trim().length < 3) { setOptions([]); return; }
    const timer = window.setTimeout(() => {
      searchClients(query.trim()).then(result => { setOptions(result.clients); setAvancysState(result.avancys); }).catch(reason => setError(message(reason)));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, client]);

  const chooseClient = (option: ClientOption) => {
    setClient(option);
    setSite(null);
    setManualSite(false);
    setPosts(null);
    if (option.source === 'avancys' && option.nit) clientPosts(option.nit).then(setPosts).catch(() => setPosts({ encontrado: false, contratos: [], avancys: 'no_disponible' }));
    // Un cliente del CRM trae su sede si la tiene; si no, se escribe y queda marcada como escrita a mano.
    if (option.source === 'crm' && option.site) setSite({ site_source: 'crm', site_ref: option.ref, site_name: option.site, site_city: option.city || '' });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!client || !site) return;
    setSaving(true);
    setError('');
    try {
      const created = await createStudy({
        title, client_source: client.source, client_ref: client.ref, client_name: client.name, client_nit: client.nit,
        ...site, visit_date: visitDate || null, scope: scope || null,
      });
      onCreated(created.id);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };

  const allPosts = (posts?.contratos || []).flatMap(contract => contract.puestos.map(post => ({ ...post, contrato: contract.nombre })));
  return <form className="es-card es-form" onSubmit={submit} aria-label="Nuevo estudio">
    <strong>Nuevo estudio</strong>
    <label>Título del estudio
      <input value={title} onChange={event => setTitle(event.target.value)} required minLength={3} maxLength={200} placeholder="Ej.: Estudio de seguridad física bodega principal" />
    </label>
    {!client ? <label>Cliente
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Escriba al menos 3 letras del nombre" aria-describedby="es-client-help" />
      <small id="es-client-help" className="es-muted">Se busca en Avancys y en el CRM. Los clientes no se escriben a mano.{avancysState !== 'ok' ? ' Avancys no respondió: solo se muestran los del CRM.' : ''}</small>
    </label> : <div className="es-chosen">
      <span><strong>{client.name}</strong>{client.nit ? ` · NIT ${client.nit}` : ''} <span className="badge">{client.source === 'avancys' ? 'Avancys' : 'CRM'}</span></span>
      <button type="button" className="secondary" onClick={() => { setClient(null); setSite(null); setPosts(null); }}>Cambiar</button>
    </div>}
    {!client && options.length ? <ul className="es-options" role="listbox" aria-label="Clientes encontrados">
      {options.map(option => <li key={`${option.source}:${option.ref}`}><button type="button" className="secondary" onClick={() => chooseClient(option)}>
        {option.name}{option.nit ? ` · ${option.nit}` : ''} <small>{option.source === 'avancys' ? 'Avancys' : 'CRM'}{option.city ? ` · ${option.city}` : ''}</small>
      </button></li>)}
    </ul> : null}

    {client ? <fieldset className="es-fieldset">
      <legend>Sede</legend>
      {client.source === 'avancys' && posts === null ? <p className="es-muted">Buscando los puestos del cliente en Avancys…</p> : null}
      {allPosts.length && !manualSite ? <label>Puesto de Avancys
        <select value={site?.site_source === 'avancys_puesto' ? site.site_ref || '' : ''} onChange={event => {
          const post = allPosts.find(item => item.codigo === event.target.value);
          setSite(post ? { site_source: 'avancys_puesto', site_ref: post.codigo, site_name: post.nombre || post.codigo || '', site_city: '' } : null);
        }}>
          <option value="">Elija el puesto</option>
          {allPosts.map(post => <option key={post.codigo || post.nombre} value={post.codigo || ''}>{post.nombre}{post.contrato ? ` · ${post.contrato}` : ''}</option>)}
        </select>
      </label> : null}
      {site?.site_source === 'crm' && !manualSite ? <p>{site.site_name}{site.site_city ? ` · ${site.site_city}` : ''} <span className="badge">CRM</span></p> : null}
      {!manualSite ? <button type="button" className="es-link" onClick={() => { setManualSite(true); setSite({ site_source: 'manual', site_ref: null, site_name: '', site_city: '' }); }}>
        La sede no aparece (prospecto o sede nueva)
      </button> : <div className="es-grid-2">
        <label>Nombre de la sede<input value={site?.site_name || ''} onChange={event => setSite(current => ({ site_source: 'manual', site_ref: null, site_city: current?.site_city || '', site_name: event.target.value }))} required minLength={2} maxLength={200} /></label>
        <label>Ciudad<input value={site?.site_city || ''} onChange={event => setSite(current => ({ site_source: 'manual', site_ref: null, site_name: current?.site_name || '', site_city: event.target.value }))} maxLength={80} /></label>
        <small className="es-muted">Queda marcada como escrita a mano.</small>
      </div>}
    </fieldset> : null}

    <div className="es-grid-2">
      <label>Fecha de la visita<input type="date" value={visitDate} onChange={event => setVisitDate(event.target.value)} /></label>
    </div>
    <label>Alcance<textarea value={scope} onChange={event => setScope(event.target.value)} rows={3} maxLength={4000} placeholder="Qué instalaciones y qué tipo de riesgos cubre el estudio" /></label>
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    <div className="es-actions">
      <button type="submit" disabled={saving || !client || !site || !site.site_name}>{saving ? 'Creando…' : 'Crear estudio'}</button>
      <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
    </div>
  </form>;
}

// --- Ficha del estudio ---------------------------------------------------------------------------------------

function StudyFile({ studyId, onBack }: { studyId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<StudyDetail | null>(null);
  const [error, setError] = useState('');
  const [addingRisk, setAddingRisk] = useState(false);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  // Los enlaces de las fotos son firmados y vencen a los 10 minutos: se piden de nuevo con cada recarga.
  const reload = useCallback(() => getStudy(studyId).then(next => {
    setDetail(next);
    if (next.evidence.length) evidenceUrls(studyId).then(result => setUrls(result.urls)).catch(() => setUrls({}));
  }).catch(reason => setError(message(reason))), [studyId]);
  useEffect(() => { reload(); }, [reload]);

  if (error && !detail) return <section className="panel es-panel"><div className="error" role="alert">{error}</div><button type="button" className="secondary" onClick={onBack}>Volver a la lista</button></section>;
  if (!detail) return <section className="panel es-panel"><p className="es-muted">Cargando estudio…</p></section>;
  const { study, zones, risks, actions, editable, catalog, summary, evidence } = detail;
  const zoneName = new Map(zones.map(zone => [zone.id, zone.name]));
  return <section className="panel es-panel" aria-label={`Estudio ${study.code}`}>
    <button type="button" className="es-link" onClick={onBack}>← Estudios</button>
    <div className="es-head">
      <div>
        <h2>{study.code} · {study.title}</h2>
        <p className="es-muted">{study.client_name}{study.client_nit ? ` · NIT ${study.client_nit}` : ''} · {study.site_name}{study.site_city ? `, ${study.site_city}` : ''}{study.site_source === 'manual' ? ' (sede escrita a mano)' : ''}</p>
        <p className="es-muted">Visita: {fmtDate(study.visit_date)} · Metodología {study.methodology_id}</p>
      </div>
      <span className="badge">{STATUS_LABELS[study.status]}</span>
    </div>
    {study.scope ? <p className="es-scope">{study.scope}</p> : null}
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    {detail.workflow?.available ? <WorkflowPanel studyId={study.id} status={study.status} preparedBy={study.prepared_by} workflow={detail.workflow} onChanged={reload} /> : null}

    <div className="es-summary" aria-label="Resumen de la valoración">
      <SummaryRow label="Riesgo actual" counts={summary.levels.actual} />
      <SummaryRow label="Riesgo residual" counts={summary.levels.residual} />
    </div>

    <ZonesBlock studyId={study.id} zones={zones} editable={editable} onChanged={reload} onError={setError} />

    {detail.evidence_available
      ? <EvidenceStrip studyId={study.id} items={evidence.filter(item => !item.risk_id)} urls={urls} editable={editable} label="Fotos y documentos generales de la visita" onChanged={reload} />
      : <p className="es-muted">Las fotos y documentos todavía no están habilitados en esta instalación.</p>}

    <div className="es-section-head">
      <h3>Riesgos ({risks.length})</h3>
      {editable && !addingRisk ? <button type="button" onClick={() => setAddingRisk(true)}>+ Agregar riesgo</button> : null}
    </div>
    {addingRisk ? <RiskForm studyId={study.id} zones={zones} catalog={catalog} onCancel={() => setAddingRisk(false)} onSaved={() => { setAddingRisk(false); reload(); }} /> : null}
    {risks.length === 0 && !addingRisk ? <p className="es-muted">Sin riesgos todavía.</p> : null}
    <ul className="es-risks">{risks.map(risk => <RiskItem key={risk.id} studyId={study.id} risk={risk} zoneLabel={risk.zone_id ? zoneName.get(risk.zone_id) || '' : ''} zones={zones} catalog={catalog}
      actions={actions.filter(action => action.risk_id === risk.id)} editable={editable} onChanged={reload} onError={setError}
      evidence={detail.evidence_available ? evidence.filter(item => item.risk_id === risk.id) : null} urls={urls} />)}</ul>
    {!editable ? <p className="es-muted">El estudio no está en borrador: es de consulta.</p> : null}
  </section>;
}

function SummaryRow({ label, counts }: { label: string; counts: Partial<Record<Nivel, number>> }) {
  const present = NIVEL_ORDER.filter(nivel => counts[nivel]);
  return <div className="es-summary-row"><span>{label}</span>{present.length ? present.map(nivel => <NivelBadge key={nivel} nivel={nivel} value={counts[nivel]} />) : <span className="es-muted">—</span>}</div>;
}

function ZonesBlock({ studyId, zones, editable, onChanged, onError }: { studyId: string; zones: Zone[]; editable: boolean; onChanged: () => void; onError: (text: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await addZone(studyId, { name }); setName(''); onChanged(); } catch (reason) { onError(message(reason)); } finally { setBusy(false); }
  };
  const remove = async (zone: Zone) => {
    if (!window.confirm(`¿Quitar la zona "${zone.name}"? Sus riesgos se conservan, sin zona.`)) return;
    try { await deleteZone(studyId, zone.id); onChanged(); } catch (reason) { onError(message(reason)); }
  };
  return <div className="es-zones">
    <h3>Zonas y activos críticos</h3>
    {zones.length ? <ul className="es-zone-list">{zones.map(zone => <li key={zone.id}>{zone.name}{editable ? <button type="button" className="es-link" aria-label={`Quitar ${zone.name}`} onClick={() => remove(zone)}>Quitar</button> : null}</li>)}</ul>
      : <p className="es-muted">Sin zonas. Ej.: portería, bodega 3, perímetro norte.</p>}
    {editable ? <form className="es-inline" onSubmit={add}>
      <input value={name} onChange={event => setName(event.target.value)} placeholder="Nueva zona" minLength={2} maxLength={160} required aria-label="Nombre de la zona" />
      <button type="submit" className="secondary" disabled={busy}>Agregar zona</button>
    </form> : null}
  </div>;
}

function ScaleSelect({ label, value, scale, onChange, required = false }: { label: string; value: number | null | undefined; scale: string[]; onChange: (value: number | null) => void; required?: boolean }) {
  return <label>{label}
    <select value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : null)} required={required}>
      <option value="">{required ? 'Elija' : 'Sin calificar'}</option>
      {scale.map((name, index) => <option key={name} value={index + 1}>{name === String(index + 1) ? name : `${index + 1} · ${name}`}</option>)}
    </select>
  </label>;
}

const EMPTY_RISK: RiskDraft = { title: '', probability: undefined, impact_company: undefined, impact_people: undefined };

function RiskForm({ studyId, zones, catalog, initial, riskId, onCancel, onSaved }: { studyId: string; zones: Zone[]; catalog: Catalog | null; initial?: RiskDraft; riskId?: string; onCancel: () => void; onSaved: (risk: Risk) => void }) {
  const [form, setForm] = useState<RiskDraft>(initial || EMPTY_RISK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: RiskDraft) => setForm(current => ({ ...current, ...patch }));
  const processes = useMemo(() => {
    const allowed = catalog?.riesgos.find(item => item.codigo === form.catalog_risk_code)?.procesos;
    return (catalog?.procesos || []).filter(process => !allowed || allowed.includes(process.codigo));
  }, [catalog, form.catalog_risk_code]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      onSaved(riskId ? await updateRisk(studyId, riskId, form) : await addRisk(studyId, form));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setSaving(false);
    }
  };
  return <form className="es-card es-form" onSubmit={submit} aria-label={riskId ? 'Editar riesgo' : 'Nuevo riesgo'}>
    <div className="es-grid-2">
      <label>Riesgo del catálogo
        <select value={form.catalog_risk_code || ''} onChange={event => {
          const item = catalog?.riesgos.find(entry => entry.codigo === event.target.value);
          set({ catalog_risk_code: event.target.value || null, title: form.title || item?.nombre || '', process_code: item?.procesos.includes(form.process_code || '') ? form.process_code : item?.procesos[0] || null });
        }}>
          <option value="">Riesgo propio (no está en el catálogo)</option>
          {(catalog?.riesgos || []).map(item => <option key={item.codigo} value={item.codigo}>{item.codigo} · {item.nombre}</option>)}
        </select>
      </label>
      <label>Proceso
        <select value={form.process_code || ''} onChange={event => set({ process_code: event.target.value || null })}>
          <option value="">Sin proceso</option>
          {processes.map(item => <option key={item.codigo} value={item.codigo}>{item.codigo} · {item.nombre}</option>)}
        </select>
      </label>
    </div>
    <div className="es-grid-2">
      <label>Cómo se manifiesta en esta sede
        <input value={form.title || ''} onChange={event => set({ title: event.target.value })} required minLength={3} maxLength={300} placeholder="Ej.: Acceso indebido a la bodega 3 por la malla rota" />
      </label>
      <label>Zona
        <select value={form.zone_id || ''} onChange={event => set({ zone_id: event.target.value || null })}>
          <option value="">Sin zona</option>
          {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </select>
      </label>
    </div>
    <div className="es-grid-2">
      <label>Causas<textarea rows={2} value={form.causes || ''} onChange={event => set({ causes: event.target.value })} maxLength={4000} /></label>
      <label>Consecuencias<textarea rows={2} value={form.consequences || ''} onChange={event => set({ consequences: event.target.value })} maxLength={4000} /></label>
    </div>
    <div className="es-grid-3">
      <ScaleSelect label="Probabilidad" value={form.probability} scale={PROBABILITY_SCALE} onChange={value => set({ probability: value ?? undefined })} required />
      <ScaleSelect label="Impacto sobre la empresa" value={form.impact_company} scale={IMPACT_SCALE} onChange={value => set({ impact_company: value ?? undefined })} required />
      <ScaleSelect label="Impacto sobre personas" value={form.impact_people} scale={IMPACT_SCALE} onChange={value => set({ impact_people: value ?? undefined })} required />
    </div>
    <fieldset className="es-fieldset">
      <legend>Control existente</legend>
      <label>Qué hay hoy<textarea rows={2} value={form.current_control || ''} onChange={event => set({ current_control: event.target.value })} maxLength={4000} /></label>
      <div className="es-grid-3">
        <ScaleSelect label="Calidad" value={form.current_quality} scale={CONTROL_SCALE} onChange={value => set({ current_quality: value })} />
        <ScaleSelect label="Eficacia" value={form.current_efficacy} scale={CONTROL_SCALE} onChange={value => set({ current_efficacy: value })} />
        <ScaleSelect label="Eficiencia" value={form.current_efficiency} scale={CONTROL_SCALE} onChange={value => set({ current_efficiency: value })} />
      </div>
    </fieldset>
    <fieldset className="es-fieldset">
      <legend>Control propuesto</legend>
      <label>Qué se recomienda<textarea rows={2} value={form.proposed_control || ''} onChange={event => set({ proposed_control: event.target.value })} maxLength={4000} /></label>
      <div className="es-grid-3">
        <ScaleSelect label="Calidad" value={form.proposed_quality} scale={CONTROL_SCALE} onChange={value => set({ proposed_quality: value })} />
        <ScaleSelect label="Eficacia" value={form.proposed_efficacy} scale={CONTROL_SCALE} onChange={value => set({ proposed_efficacy: value })} />
        <ScaleSelect label="Eficiencia" value={form.proposed_efficiency} scale={CONTROL_SCALE} onChange={value => set({ proposed_efficiency: value })} />
      </div>
    </fieldset>
    <small className="es-muted">Cada control se califica completo (calidad, eficacia y eficiencia) o se deja sin calificar. El nivel lo calcula SIIO.</small>
    {error ? <p className="es-error" role="alert">{error}</p> : null}
    <div className="es-actions">
      <button type="submit" disabled={saving}>{saving ? 'Guardando…' : riskId ? 'Guardar cambios' : 'Agregar riesgo'}</button>
      <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancelar</button>
    </div>
  </form>;
}

function RiskItem({ studyId, risk, zoneLabel, zones, catalog, actions, editable, onChanged, onError, evidence, urls }: {
  studyId: string; risk: Risk; zoneLabel: string; zones: Zone[]; catalog: Catalog | null; actions: Action[]; editable: boolean; onChanged: () => void; onError: (text: string) => void;
  evidence: Evidence[] | null; urls: Record<string, string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const v = risk.valuation;
  const remove = async () => {
    if (!window.confirm(`¿Eliminar el riesgo R${risk.number} y sus acciones?`)) return;
    try { await deleteRisk(studyId, risk.id); onChanged(); } catch (reason) { onError(message(reason)); }
  };
  if (editing) {
    const { id: _id, number: _number, valuation: _valuation, origin: _origin, ...draft } = risk;
    return <li><RiskForm studyId={studyId} zones={zones} catalog={catalog} riskId={risk.id} initial={draft} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} /></li>;
  }
  return <li className="es-card es-risk">
    <div className="es-risk-head">
      <div>
        <strong>R{risk.number} · {risk.title}</strong>
        <small className="es-muted">{[risk.catalog_risk_code, risk.process_code, zoneLabel].filter(Boolean).join(' · ') || 'Riesgo propio'}{risk.origin === 'agente' ? ' · registrado con el agente' : ''}</small>
      </div>
      {editable ? <div className="es-actions">
        <button type="button" className="secondary" onClick={() => setEditing(true)}>Editar</button>
        <button type="button" className="danger" onClick={remove}>Eliminar</button>
      </div> : null}
    </div>
    <div className="es-valuation" aria-label={`Valoración de R${risk.number}`}>
      <span>Inherente <NivelBadge nivel={v.inherente.nivel} value={v.inherente.magnitud} /></span>
      <span>Actual <NivelBadge nivel={v.actual.nivel} value={v.actual.magnitud} /></span>
      <span>Residual <NivelBadge nivel={v.residual.nivel} value={v.residual.magnitud} /></span>
      <small className="es-muted">P {risk.probability} · impacto {v.impacto} (empresa {risk.impact_company}, personas {risk.impact_people})</small>
    </div>
    {risk.current_control ? <p><span className="es-label">Control existente:</span> {risk.current_control}</p> : null}
    {risk.proposed_control ? <p><span className="es-label">Control propuesto:</span> {risk.proposed_control}</p> : null}
    {evidence ? <EvidenceStrip studyId={studyId} items={evidence} urls={urls} riskId={risk.id} editable={editable} label="Evidencia" onChanged={onChanged} /> : null}
    <ActionsBlock studyId={studyId} riskId={risk.id} actions={actions} editable={editable} onChanged={onChanged} onError={onError} />
  </li>;
}

function ActionsBlock({ studyId, riskId, actions, editable, onChanged, onError }: { studyId: string; riskId: string; actions: Action[]; editable: boolean; onChanged: () => void; onError: (text: string) => void }) {
  const [draft, setDraft] = useState({ description: '', owner_label: '', due_date: '', priority: 'media' as Action['priority'] });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await addAction(studyId, { risk_id: riskId, description: draft.description, owner_label: draft.owner_label || null, due_date: draft.due_date || null, priority: draft.priority });
      setDraft({ description: '', owner_label: '', due_date: '', priority: 'media' });
      setOpen(false);
      onChanged();
    } catch (reason) { onError(message(reason)); } finally { setBusy(false); }
  };
  const remove = async (action: Action) => {
    try { await deleteAction(studyId, action.id); onChanged(); } catch (reason) { onError(message(reason)); }
  };
  return <div className="es-plan">
    <span className="es-label">Plan de tratamiento</span>
    {actions.length ? <ul>{actions.map(action => <li key={action.id}>
      {action.description} <small className="es-muted">· {action.owner_label || 'sin responsable'} · {action.due_date ? fmtDate(action.due_date) : 'sin fecha'} · prioridad {action.priority}</small>
      {editable ? <button type="button" className="es-link" onClick={() => remove(action)} aria-label={`Quitar la acción ${action.description}`}>Quitar</button> : null}
    </li>)}</ul> : <small className="es-muted"> Sin acciones.</small>}
    {editable && !open ? <button type="button" className="es-link" onClick={() => setOpen(true)}>+ Acción</button> : null}
    {open ? <form className="es-grid-4" onSubmit={add} aria-label="Nueva acción">
      <label>Acción<input value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} required minLength={3} maxLength={1000} /></label>
      <label>Responsable<input value={draft.owner_label} onChange={event => setDraft({ ...draft, owner_label: event.target.value })} maxLength={120} placeholder="Persona o área" /></label>
      <label>Fecha compromiso<input type="date" value={draft.due_date} onChange={event => setDraft({ ...draft, due_date: event.target.value })} /></label>
      <label>Prioridad<select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as Action['priority'] })}><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select></label>
      <div className="es-actions"><button type="submit" disabled={busy}>Agregar</button><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancelar</button></div>
    </form> : null}
  </div>;
}
