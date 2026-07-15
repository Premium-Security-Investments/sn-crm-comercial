import { createClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { loadCompanyProfile, loadProfiles } from './api';
import { profileRadarHash } from './viewUtils';
import type { TenderCompanyProfile, TenderDeadlineFilter, TenderInternalStatus, TenderRegionKey, TenderScoreFilter, TenderSearchProfile, TenderSection, TenderValueFilter, TendersModuleProps } from './types';

const browserSupabase = createClient(import.meta.env.NEXT_PUBLIC_SUPABASE_URL, import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const emptyCompany: TenderCompanyProfile = { legal_name: '', nit: '', rup_status: '', rup_unspsc_codes: '', authorized_services: '', supervigilancia_license: '', financial_capacity: '', organizational_capacity: '', experience_summary: '', certifications: '', recurring_documents: '', disqualifications_notes: '', useful_company_info: '' };
const fields: Array<{ key: keyof TenderCompanyProfile; label: string; rows?: number }> = [
  { key: 'legal_name', label: 'Nombre legal' }, { key: 'nit', label: 'NIT' }, { key: 'rup_status', label: 'Estado RUP' },
  { key: 'rup_unspsc_codes', label: 'RUP / códigos UNSPSC', rows: 3 }, { key: 'authorized_services', label: 'Servicios autorizados', rows: 3 }, { key: 'supervigilancia_license', label: 'Licencia SuperVigilancia', rows: 3 },
  { key: 'financial_capacity', label: 'Capacidad financiera', rows: 3 }, { key: 'organizational_capacity', label: 'Capacidad organizacional', rows: 3 }, { key: 'experience_summary', label: 'Experiencia habilitante', rows: 4 },
  { key: 'certifications', label: 'Certificaciones / pólizas / permisos', rows: 3 }, { key: 'recurring_documents', label: 'Documentos recurrentes', rows: 3 }, { key: 'disqualifications_notes', label: 'Alertas / restricciones', rows: 3 }, { key: 'useful_company_info', label: 'Información útil para cruzar contra pliegos', rows: 4 },
];
const selectOptions = { region: ['todas', 'bog_cundinamarca', 'med_antioquia', 'eje_cafetero', 'cali_valle', 'costa_caribe', 'santanderes', 'sur_occidente', 'otros'], section: ['todas', 'hacer', 'revisar', 'descartar'], status: ['todas', 'nueva', 'en_revision', 'convertida_oportunidad', 'descartada'], deadline: ['todas', '0_7', '8_15', '16_30', 'vencida', 'sin_fecha'], value: ['todas', 'sin_valor', 'lt_50m', '50m_500m', '500m_plus', '1000m_plus'], score: ['todas', 'alto', 'medio', 'bajo'] };

export function TenderProfilesView({ request, navigate }: TendersModuleProps) {
  const [company, setCompany] = useState<TenderCompanyProfile>(emptyCompany);
  const [profiles, setProfiles] = useState<TenderSearchProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingRup, setUploadingRup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [filters, setFilters] = useState({ region_key: 'todas' as TenderRegionKey, source_filter: 'todas', section_filter: 'todas' as TenderSection | 'todas', internal_status_filter: 'todas' as TenderInternalStatus | 'todas', deadline_filter: 'todas' as TenderDeadlineFilter, value_filter: 'todas' as TenderValueFilter, score_filter: 'todas' as TenderScoreFilter, query_text: '' });
  const load = async () => {
    setLoading(true); setMessage(null);
    try {
      const [loadedCompany, loadedProfiles] = await Promise.all([loadCompanyProfile<TenderCompanyProfile>(request), loadProfiles<TenderSearchProfile[]>(request)]);
      setCompany({ ...emptyCompany, ...loadedCompany }); setProfiles(loadedProfiles);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const saveCompany = async () => {
    setSaving(true); setMessage('Guardando información de empresa…');
    try { setCompany({ ...emptyCompany, ...(await request<TenderCompanyProfile>('/api/tender-company-profile', { method: 'PUT', body: JSON.stringify(company) })) }); setMessage('Información de empresa guardada.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const uploadRup = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { setMessage('Error: el RUP supera 50MB.'); return; }
    setUploadingRup(true); setMessage('Preparando carga segura del RUP…');
    try {
      const ticket = await request<{ path: string; token: string }>('/api/tender-company-profile-upload-url', { method: 'POST', body: JSON.stringify({ name: file.name, mime_type: file.type, size: file.size }) });
      const uploaded = await browserSupabase.storage.from('tender-documents').uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploaded.error) throw uploaded.error;
      setCompany({ ...emptyCompany, ...(await request<TenderCompanyProfile>('/api/tender-company-profile-process-upload', { method: 'POST', body: JSON.stringify({ storage_path: ticket.path, name: file.name, mime_type: file.type }) })) });
      setMessage('RUP cargado y ficha actualizada.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setUploadingRup(false); }
  };
  const saveProfile = async () => {
    if (!name.trim()) { setMessage('Escriba un nombre para guardar el perfil.'); return; }
    setSaving(true); setMessage('Guardando perfil de búsqueda…');
    try { const saved = await request<TenderSearchProfile>('/api/tender-search-profiles', { method: 'POST', body: JSON.stringify({ name: name.trim(), ...filters }) }); setProfiles(current => [saved, ...current.filter(item => item.id !== saved.id)]); setMessage(`Perfil guardado: ${saved.name}`); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const removeProfile = async (profile: TenderSearchProfile) => {
    if (!window.confirm(`¿Eliminar el perfil "${profile.name}"?`)) return;
    try { await request(`/api/tender-search-profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' }); setProfiles(current => current.filter(item => item.id !== profile.id)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
  };
  if (loading) return <div className="notice">Cargando perfiles y ficha corporativa…</div>;
  return <section className="stack tenders-page tender-profiles-view" aria-labelledby="tender-profiles-heading">
    <header className="tracking-header"><div><span className="eyebrow">Configuración aislada</span><h2 id="tender-profiles-heading">Perfiles de búsqueda</h2><p>Configure criterios reutilizables y la información habilitante de Seguridad Nacional sin cargar el Radar.</p></div><button className="secondary" onClick={() => void load()}>Recargar ficha</button></header>
    {message && <div className="notice" role="status">{message}</div>}
    <section className="panel company-profile-panel"><h3>Información empresa</h3><label className="rup-upload-card"><span>Cargar RUP</span><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={uploadingRup || loading} onChange={event => { void uploadRup(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /><small>{uploadingRup ? 'Procesando documento…' : 'PDF, DOCX o TXT'}</small></label><div className="company-profile-form">{fields.map(field => <label key={field.key} className={field.rows ? 'wide' : ''}><span>{field.label}</span>{field.rows ? <textarea rows={field.rows} value={String(company[field.key] || '')} onChange={event => setCompany(current => ({ ...current, [field.key]: event.target.value }))} /> : <input value={String(company[field.key] || '')} onChange={event => setCompany(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div><div className="row-actions"><button onClick={() => void saveCompany()} disabled={saving}>Guardar información de empresa</button></div></section>
    <section className="panel tender-search-profiles-panel"><h3>Guardar criterios de búsqueda</h3><div className="filters"><label>Nombre<input value={name} onChange={event => setName(event.target.value)} placeholder="Ej. CCTV Bogotá $500M+" /></label><label>Fuente<input value={filters.source_filter} onChange={event => setFilters(current => ({ ...current, source_filter: event.target.value }))} /></label>{(['region_key', 'section_filter', 'internal_status_filter', 'deadline_filter', 'value_filter', 'score_filter'] as const).map(key => <label key={key}>{key.replace(/_/g, ' ')}<select value={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))}>{(key === 'region_key' ? selectOptions.region : key === 'section_filter' ? selectOptions.section : key === 'internal_status_filter' ? selectOptions.status : key === 'deadline_filter' ? selectOptions.deadline : key === 'value_filter' ? selectOptions.value : selectOptions.score).map(option => <option key={option} value={option}>{option}</option>)}</select></label>)}<label className="wide">Texto<input value={filters.query_text} onChange={event => setFilters(current => ({ ...current, query_text: event.target.value }))} /></label></div><div className="row-actions"><button onClick={() => void saveProfile()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar perfil actual'}</button></div><div className="tender-saved-profiles"><h3>Perfiles guardados</h3>{profiles.length ? profiles.map(profile => <div className="tender-saved-profile-row" key={profile.id}><div><strong>{profile.name}</strong><small>{profile.region_key} · {profile.source_filter} · {profile.value_filter}</small></div><div className="row-actions"><button onClick={() => navigate(profileRadarHash(profile.id))}>Aplicar en Radar</button><button className="secondary" onClick={() => void removeProfile(profile)}>Eliminar</button></div></div>) : <p className="muted">Aún no hay perfiles guardados.</p>}</div></section>
  </section>;
}
