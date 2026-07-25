import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabaseBrowser } from '../supabaseBrowser';
import { loadCompanyProcurementDocuments, loadCompanyProfile } from './api';
import { TenderCompanyDocuments } from './components/TenderCompanyDocuments';
import { createTenderConfigurationActions } from './tenderConfigurationActions';
import type { TenderCompanyDocument, TenderCompanyProfile, TendersModuleProps } from './types';

const emptyCompany: TenderCompanyProfile = { legal_name: '', nit: '', rup_status: '', rup_unspsc_codes: '', authorized_services: '', supervigilancia_license: '', financial_capacity: '', organizational_capacity: '', experience_summary: '', certifications: '', recurring_documents: '', disqualifications_notes: '', useful_company_info: '' };
const fields: Array<{ key: keyof TenderCompanyProfile; label: string; rows?: number }> = [
  { key: 'legal_name', label: 'Nombre legal' }, { key: 'nit', label: 'NIT' }, { key: 'rup_status', label: 'Estado RUP' },
  { key: 'rup_unspsc_codes', label: 'RUP / códigos UNSPSC', rows: 3 }, { key: 'authorized_services', label: 'Servicios autorizados', rows: 3 }, { key: 'supervigilancia_license', label: 'Licencia SuperVigilancia', rows: 3 },
  { key: 'financial_capacity', label: 'Capacidad financiera', rows: 3 }, { key: 'organizational_capacity', label: 'Capacidad organizacional', rows: 3 }, { key: 'experience_summary', label: 'Experiencia habilitante', rows: 4 },
  { key: 'certifications', label: 'Certificaciones / pólizas / permisos', rows: 3 }, { key: 'recurring_documents', label: 'Documentos recurrentes', rows: 3 }, { key: 'disqualifications_notes', label: 'Alertas / restricciones', rows: 3 }, { key: 'useful_company_info', label: 'Información útil para cruzar contra pliegos', rows: 4 },
];
const acceptedFiles = '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
type UploadDialog = 'rup' | 'document' | null;
type TenderConfigurationViewProps = TendersModuleProps & { moduleNavigation: ReactNode; canConfigure: boolean };

function rupSummary(company: TenderCompanyProfile, documents: TenderCompanyDocument[]) {
  const rup = documents.find(document => document.document_type === 'rup' && document.current);
  return rup ? `${rup.display_name} · versión ${rup.version}${rup.issued_at ? ` · expedido ${rup.issued_at}` : ''}` : company.source_document_name || 'RUP pendiente de cargar';
}

/** Consulta empresarial por defecto; los cambios se aíslan en un borrador hasta guardar. */
export function TenderConfigurationView({ request, moduleNavigation, canConfigure }: TenderConfigurationViewProps) {
  const [persistedCompany, setPersistedCompany] = useState<TenderCompanyProfile>(emptyCompany);
  const [draftCompany, setDraftCompany] = useState<TenderCompanyProfile>(emptyCompany);
  const [documents, setDocuments] = useState<TenderCompanyDocument[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadDialog, setUploadDialog] = useState<UploadDialog>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [documentType, setDocumentType] = useState('certificado');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const initialDialogFocusRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mutationActions = createTenderConfigurationActions({
    canConfigure,
    request,
    uploadToSignedUrl: (path, token, file) => supabaseBrowser.storage.from('tender-documents').uploadToSignedUrl(path, token, file),
  });

  const load = async () => {
    setLoading(true); setMessage(null);
    const [profileResult, documentsResult] = await Promise.allSettled([
      loadCompanyProfile<TenderCompanyProfile>(request),
      loadCompanyProcurementDocuments(request),
    ]);
    const failures: string[] = [];
    if (profileResult.status === 'fulfilled') {
      const nextCompany = { ...emptyCompany, ...profileResult.value };
      setPersistedCompany(nextCompany);
      if (!editing) setDraftCompany(nextCompany);
    } else failures.push(`No fue posible cargar la ficha: ${profileResult.reason instanceof Error ? profileResult.reason.message : String(profileResult.reason)}`);
    if (documentsResult.status === 'fulfilled') setDocuments(documentsResult.value);
    else failures.push(`No fue posible cargar el inventario: ${documentsResult.reason instanceof Error ? documentsResult.reason.message : String(documentsResult.reason)}`);
    setMessage(failures.length ? failures.join(' ') : null);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const beginEditing = (trigger: HTMLButtonElement) => {
    if (!canConfigure) return;
    editTriggerRef.current = trigger;
    setDraftCompany({ ...persistedCompany });
    setEditing(true);
    setMessage(null);
  };
  const cancelEditing = () => {
    setDraftCompany(persistedCompany);
    setEditing(false);
    setMessage(null);
    editTriggerRef.current?.focus();
  };
  const saveCompany = async () => {
    if (!canConfigure || saving) return;
    setSaving(true); setMessage('Guardando cambios…');
    try {
      const saved = await mutationActions.saveCompany(draftCompany);
      if (saved) {
        const nextCompany = { ...emptyCompany, ...saved };
        setPersistedCompany(nextCompany);
        setDraftCompany(nextCompany);
        setEditing(false);
        setMessage('Información de empresa guardada.');
        editTriggerRef.current?.focus();
      }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };

  const resetUploadForm = () => {
    setUploadFile(null); setDisplayName(''); setDocumentType('certificado'); setIssuedAt(''); setExpiresAt('');
  };
  const restoreFocus = () => {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (target?.isConnected) target.focus();
  };
  const closeUploadDialog = () => {
    if (uploading) return;
    setUploadDialog(null);
    resetUploadForm();
    restoreFocus();
  };
  const openUploadDialog = (dialog: Exclude<UploadDialog, null>, trigger: HTMLButtonElement) => {
    if (!canConfigure || editing) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    setMessage(null);
    resetUploadForm();
    setUploadDialog(dialog);
  };

  useEffect(() => {
    if (!uploadDialog) return;
    initialDialogFocusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeUploadDialog(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [uploadDialog, uploading]);

  const submitUpload = async () => {
    if (!canConfigure || !uploadDialog || !uploadFile || uploading) return;
    if (uploadDialog === 'document' && (!displayName.trim() || !documentType || !issuedAt)) {
      setMessage('Nombre, tipo y fecha de expedición son obligatorios para el inventario empresarial.');
      return;
    }
    setUploading(true); setMessage(uploadDialog === 'rup' ? 'Preparando carga segura del RUP…' : 'Preparando carga segura del documento…');
    try {
      if (uploadDialog === 'rup') {
        const updated = await mutationActions.uploadRup(uploadFile);
        if (updated) {
          const nextCompany = { ...emptyCompany, ...updated };
          setPersistedCompany(nextCompany);
          if (!editing) setDraftCompany(nextCompany);
          setUploadDialog(null);
          resetUploadForm();
          restoreFocus();
          setMessage('RUP cargado y ficha actualizada.');
          try {
            setDocuments(await loadCompanyProcurementDocuments(request));
          } catch (refreshCause) {
            const detail = refreshCause instanceof Error ? refreshCause.message : String(refreshCause);
            setMessage(`RUP cargado y ficha actualizada. No fue posible refrescar el inventario: ${detail}`);
          }
        }
        return;
      } else {
        const result = await mutationActions.uploadCompanyDocument(uploadFile, { documentType, displayName: displayName.trim(), issuedAt, expiresAt: expiresAt || null });
        if (result) {
          const nextCompany = { ...emptyCompany, ...result.profile };
          setPersistedCompany(nextCompany);
          if (!editing) setDraftCompany(nextCompany);
          setDocuments(result.documents);
        }
        setMessage('Documento empresarial cargado y versionado.');
      }
      setUploadDialog(null);
      resetUploadForm();
      restoreFocus();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { setUploading(false); }
  };

  if (loading) return <div className="notice">Cargando base empresarial…</div>;
  const company = editing ? draftCompany : persistedCompany;
  return <section className="stack tenders-page tender-configuration-view" aria-labelledby="tender-configuration-heading">
    <header className="tracking-header company-base-header"><div><span className="eyebrow">Consulta empresarial</span><h2 id="tender-configuration-heading">Base empresarial de licitaciones</h2><p>Información habilitante y soportes empresariales para consultar antes de decidir.</p></div><button className="secondary" onClick={() => void load()} disabled={loading || saving || uploading}>Recargar base</button></header>
    {moduleNavigation}
    {!canConfigure && <div className="notice" role="status">Tiene acceso de solo lectura a la base empresarial.</div>}
    {message && <div className="notice" role="status">{message}</div>}

    <section className="panel company-profile-panel" aria-labelledby="company-profile-heading">
      <header className="company-base-section-head"><div><span className="eyebrow">Ficha corporativa</span><h3 id="company-profile-heading">Información empresa</h3><p>{editing ? 'Está editando una copia. Los cambios sólo se aplican al guardar.' : 'Consulte la información declarada y edítela cuando sea necesario.'}</p></div><span className="company-editing-state">{editing ? 'Edición en curso' : 'Consulta'}</span></header>
      {!editing ? <div className="company-profile-readonly">{fields.map(field => <div key={field.key} className={field.rows ? 'wide' : ''}><small>{field.label}</small><strong>{String(company[field.key] || 'Sin información')}</strong></div>)}</div> : <div className="company-profile-form">{fields.map(field => <label key={field.key} className={field.rows ? 'wide' : ''}><span>{field.label}</span>{field.rows ? <textarea rows={field.rows} value={String(draftCompany[field.key] || '')} onChange={event => setDraftCompany(current => ({ ...current, [field.key]: event.target.value }))} /> : <input value={String(draftCompany[field.key] || '')} onChange={event => setDraftCompany(current => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div>}
      <div className="row-actions company-base-actions">{editing ? <><button type="button" className="secondary" onClick={cancelEditing} disabled={saving}>Cancelar</button><button type="button" onClick={() => void saveCompany()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button></> : canConfigure && <button type="button" ref={editTriggerRef} onClick={event => beginEditing(event.currentTarget)}>Editar información</button>}</div>
    </section>

    <section className="panel company-documents-panel" aria-labelledby="company-documents-heading">
      <header className="company-base-section-head"><div><span className="eyebrow">Soportes empresariales</span><h3 id="company-documents-heading">RUP e inventario documental</h3><p>RUP actual: {rupSummary(persistedCompany, documents)}</p></div></header>
      {canConfigure && <div className="row-actions company-base-actions">{editing && <span className="muted">Guarde o cancele la edición antes de cargar documentos.</span>}<button type="button" className="secondary" aria-haspopup="dialog" aria-expanded={uploadDialog === 'rup'} aria-controls="company-document-upload-dialog" disabled={editing} title={editing ? 'Guarde o cancele la edición primero' : undefined} onClick={event => openUploadDialog('rup', event.currentTarget)}>Actualizar RUP</button><button type="button" aria-haspopup="dialog" aria-expanded={uploadDialog === 'document'} aria-controls="company-document-upload-dialog" disabled={editing} title={editing ? 'Guarde o cancele la edición primero' : undefined} onClick={event => openUploadDialog('document', event.currentTarget)}>Añadir documento empresarial</button></div>}
      <TenderCompanyDocuments documents={documents} />
    </section>

    {uploadDialog && <div className="tender-go-no-go-backdrop" role="presentation" onMouseDown={closeUploadDialog}>
      <div id="company-document-upload-dialog" className="company-document-upload-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="company-document-upload-title" onMouseDown={event => event.stopPropagation()}>
        <header><div><span className="eyebrow">Carga segura</span><h3 id="company-document-upload-title">{uploadDialog === 'rup' ? 'Actualizar RUP' : 'Añadir documento empresarial'}</h3></div><button type="button" className="secondary" onClick={closeUploadDialog} disabled={uploading} aria-label="Cerrar carga de documento">Cerrar</button></header>
        {uploadDialog === 'document' && <><label><span>Nombre visible</span><input ref={initialDialogFocusRef} value={displayName} required onChange={event => setDisplayName(event.target.value)} placeholder="Ej. Certificado de experiencia 2026" /></label><label><span>Tipo de documento</span><select value={documentType} required onChange={event => setDocumentType(event.target.value)}><option value="certificado">Certificado</option><option value="certificacion">Certificación</option><option value="licencia">Licencia</option><option value="poliza">Póliza</option><option value="permiso">Permiso</option><option value="experiencia">Soporte de experiencia</option><option value="financiero">Soporte financiero</option><option value="otro">Otro documento empresarial</option></select></label><div className="company-document-date-grid"><label><span>Fecha de expedición</span><input type="date" value={issuedAt} required onChange={event => setIssuedAt(event.target.value)} /><small>La API exige esta fecha para versionar el documento.</small></label><label><span>Fecha de vencimiento</span><input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /><small>Opcional cuando el documento no vence.</small></label></div></>}
        <label className="rup-upload-card"><span>{uploadDialog === 'rup' ? 'Archivo RUP' : 'Archivo del documento'}</span><input ref={uploadDialog === 'rup' ? initialDialogFocusRef : undefined} type="file" accept={acceptedFiles} onChange={event => setUploadFile(event.currentTarget.files?.[0] || null)} /><small>{uploadFile ? uploadFile.name : 'PDF, DOCX o TXT (máximo 50 MB)'}</small></label>
        <footer><button type="button" className="secondary" onClick={closeUploadDialog} disabled={uploading}>Cancelar</button><button type="button" onClick={() => void submitUpload()} disabled={uploading || !uploadFile}>{uploading ? 'Cargando…' : uploadDialog === 'rup' ? 'Actualizar RUP' : 'Añadir documento'}</button></footer>
      </div>
    </div>}
  </section>;
}
