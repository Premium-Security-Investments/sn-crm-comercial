import { useEffect, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '../supabaseBrowser';
import { loadCompanyProfile } from './api';
import type { TenderCompanyProfile, TendersModuleProps } from './types';

const emptyCompany: TenderCompanyProfile = { legal_name: '', nit: '', rup_status: '', rup_unspsc_codes: '', authorized_services: '', supervigilancia_license: '', financial_capacity: '', organizational_capacity: '', experience_summary: '', certifications: '', recurring_documents: '', disqualifications_notes: '', useful_company_info: '' };
const fields: Array<{ key: keyof TenderCompanyProfile; label: string; rows?: number }> = [
  { key: 'legal_name', label: 'Nombre legal' }, { key: 'nit', label: 'NIT' }, { key: 'rup_status', label: 'Estado RUP' },
  { key: 'rup_unspsc_codes', label: 'RUP / códigos UNSPSC', rows: 3 }, { key: 'authorized_services', label: 'Servicios autorizados', rows: 3 }, { key: 'supervigilancia_license', label: 'Licencia SuperVigilancia', rows: 3 },
  { key: 'financial_capacity', label: 'Capacidad financiera', rows: 3 }, { key: 'organizational_capacity', label: 'Capacidad organizacional', rows: 3 }, { key: 'experience_summary', label: 'Experiencia habilitante', rows: 4 },
  { key: 'certifications', label: 'Certificaciones / pólizas / permisos', rows: 3 }, { key: 'recurring_documents', label: 'Documentos recurrentes', rows: 3 }, { key: 'disqualifications_notes', label: 'Alertas / restricciones', rows: 3 }, { key: 'useful_company_info', label: 'Información útil para cruzar contra pliegos', rows: 4 },
];

type TenderConfigurationViewProps = TendersModuleProps & { moduleNavigation: ReactNode; canConfigure: boolean };

/** Base habilitante SN/RUP; mutation affordances mirror the fine backend action. */
export function TenderConfigurationView({ request, moduleNavigation, canConfigure }: TenderConfigurationViewProps) {
  const [company, setCompany] = useState<TenderCompanyProfile>(emptyCompany);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingRup, setUploadingRup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setMessage(null);
    try { setCompany({ ...emptyCompany, ...(await loadCompanyProfile<TenderCompanyProfile>(request)) }); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const saveCompany = async () => {
    if (!canConfigure) return;
    setSaving(true); setMessage('Guardando información de empresa…');
    try { setCompany({ ...emptyCompany, ...(await request<TenderCompanyProfile>('/api/tender-company-profile', { method: 'PUT', body: JSON.stringify(company) })) }); setMessage('Información de empresa guardada.'); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  const uploadRup = async (file?: File) => {
    if (!canConfigure || !file) return;
    if (file.size > 50 * 1024 * 1024) { setMessage('Error: el RUP supera 50MB.'); return; }
    setUploadingRup(true); setMessage('Preparando carga segura del RUP…');
    try {
      const ticket = await request<{ path: string; token: string }>('/api/tender-company-profile-upload-url', { method: 'POST', body: JSON.stringify({ name: file.name, mime_type: file.type, size: file.size }) });
      const uploaded = await supabaseBrowser.storage.from('tender-documents').uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploaded.error) throw uploaded.error;
      setCompany({ ...emptyCompany, ...(await request<TenderCompanyProfile>('/api/tender-company-profile-process-upload', { method: 'POST', body: JSON.stringify({ storage_path: ticket.path, name: file.name, mime_type: file.type }) })) });
      setMessage('RUP cargado y ficha actualizada.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setUploadingRup(false); }
  };
  if (loading) return <div className="notice">Cargando ficha corporativa…</div>;
  return <section className="stack tenders-page tender-configuration-view" aria-labelledby="tender-configuration-heading">
    <header className="tracking-header"><div><span className="eyebrow">Configuración protegida</span><h2 id="tender-configuration-heading">Base habilitante SN</h2><p>La ficha corporativa y el RUP se mantienen fuera del Radar.</p></div><button className="secondary" onClick={() => void load()}>Recargar ficha</button></header>
    {moduleNavigation}
    {!canConfigure && <div className="notice" role="status">Tiene acceso de solo lectura a la ficha corporativa.</div>}
    {message && <div className="notice" role="status">{message}</div>}
    <section className="panel company-profile-panel"><h3>Información empresa</h3><label className="rup-upload-card"><span>Cargar RUP</span><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={!canConfigure || uploadingRup || loading} onChange={event => { void uploadRup(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /><small>{uploadingRup ? 'Procesando documento…' : 'PDF, DOCX o TXT'}</small></label><div className="company-profile-form">{fields.map(field => <label key={field.key} className={field.rows ? 'wide' : ''}><span>{field.label}</span>{field.rows ? <textarea rows={field.rows} disabled={!canConfigure} value={String(company[field.key] || '')} onChange={event => setCompany(current => ({ ...current, [field.key]: event.target.value }))} /> : <input disabled={!canConfigure} value={String(company[field.key] || '')} onChange={event => setCompany(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div><div className="row-actions"><button onClick={() => void saveCompany()} disabled={!canConfigure || saving}>Guardar información de empresa</button></div></section>
  </section>;
}
