import { useState } from 'react';
import { appendTenderDossierItemAction } from '../api';
import type { TenderDossierAssignee, TenderDossierItem, TenderDossierItemActionInput, TenderDossierWorkspace, TenderRequest } from '../types';
import { TenderStatusBadge } from './TenderStatusBadge';
import { dossierDueTone, formatDossierDate, groupDossierChecklist, parseDossierItemTitle } from '../dossierChecklistModel';

const STATUS_LABELS: Record<TenderDossierItem['status'], string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  listo: 'Listo',
  bloqueado: 'Bloqueado',
};
const STATUS_TONES: Record<TenderDossierItem['status'], 'success' | 'danger' | 'warning' | 'neutral'> = {
  pendiente: 'warning',
  en_progreso: 'neutral',
  listo: 'success',
  bloqueado: 'danger',
};
type ItemDraft = { evidenceKind: 'texto' | 'url'; evidence: string; justification: string; targetDate: string };

export function TenderDossierChecklist({ opportunityId, workspace, request, profiles, canApprove, onChanged }: {
  opportunityId: string;
  workspace: TenderDossierWorkspace;
  request: TenderRequest;
  profiles: TenderDossierAssignee[];
  canApprove: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [showNoAplica, setShowNoAplica] = useState<string | null>(null);
  const humanProfiles = profiles.filter(profile => profile.active !== false && profile.identity_type !== 'agent');

  const baselineFor = (item: TenderDossierItem): ItemDraft => ({
    evidenceKind: 'texto', evidence: '', justification: '', targetDate: item.target_date || '',
  });
  const draftFor = (item: TenderDossierItem): ItemDraft => drafts[item.id] || baselineFor(item);
  // El merge parte SIEMPRE del borrador vigente en `current`, nunca del capturado en el render:
  // dos campos del mismo ítem editados en el mismo lote deben conservarse los dos.
  const setDraft = (item: TenderDossierItem, patch: Partial<ItemDraft>) => {
    setDrafts(current => ({ ...current, [item.id]: { ...(current[item.id] || baselineFor(item)), ...patch } }));
  };
  const act = async (item: TenderDossierItem, action: Omit<TenderDossierItemActionInput, 'opportunity_id' | 'item_id'>): Promise<boolean> => {
    setBusyId(item.id);
    setError('');
    try {
      await appendTenderDossierItemAction(request, { opportunity_id: opportunityId, item_id: item.id, ...action });
      await onChanged();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusyId(null);
    }
  };
  const attachEvidence = async (item: TenderDossierItem) => {
    const draft = draftFor(item);
    if (!draft.evidence.trim()) return setError('Debe registrar la evidencia antes de guardarla.');
    const succeeded = await act(item, {
      action_type: 'evidence_attached',
      evidence_kind: draft.evidenceKind,
      evidence_text: draft.evidenceKind === 'texto' ? draft.evidence : null,
      evidence_url: draft.evidenceKind === 'url' ? draft.evidence : null,
    });
    if (succeeded) setDraft(item, { evidence: '' });
  };
  const markNotApplicable = async (item: TenderDossierItem) => {
    const justification = draftFor(item).justification.trim();
    if (!justification) return setError('La justificación es obligatoria para marcar No aplica.');
    await act(item, { action_type: 'marked_not_applicable', justification });
    setShowNoAplica(null);
  };

  const groups = groupDossierChecklist(workspace.checklist);
  const today = new Date();
  const rejectionOpen = groups.open.filter(item => parseDossierItemTitle(item.title).rejection).length;

  // Cada ítem es una fila compacta (estado, área, qué, responsable, fecha). Se abre para editar.
  const renderItem = (item: TenderDossierItem) => {
    const draft = draftFor(item);
    const disabled = busyId === item.id;
    const title = parseDossierItemTitle(item.title);
    const due = item.applicability === 'no_aplica' || item.status === 'listo' ? 'none' : dossierDueTone(item.target_date, today);
    return <details className={`card tender-dossier-item tender-dossier-row due-${due}`} key={item.id}>
      <summary className="tender-dossier-row-summary">
        <span className="tender-dossier-row-status"><TenderStatusBadge label={item.applicability === 'no_aplica' ? 'No aplica' : STATUS_LABELS[item.status]} tone={item.applicability === 'no_aplica' ? 'neutral' : STATUS_TONES[item.status]} /></span>
        <span className="tender-dossier-row-title">
          {title.area && <span className="tender-dossier-row-area">{title.area}</span>}
          <strong>{title.label}</strong>
          {title.rejection && <span className="badge badge-danger tender-dossier-row-rejection">Causa rechazo</span>}
          {!title.rejection && item.required && item.applicability !== 'no_aplica' && <span className="tender-dossier-row-required">Obligatorio</span>}
          {item.analysis_source && <TenderStatusBadge label="Desde Análisis" tone="neutral" />}
        </span>
        <span className="tender-dossier-row-owner">{item.assignee_name || 'Sin responsable'}</span>
        <span className={`tender-dossier-row-date due-${due}`}>{due === 'overdue' ? 'Vencida · ' : due === 'today' ? 'Hoy · ' : ''}{formatDossierDate(item.target_date)}</span>
      </summary>
      <div className="tender-dossier-row-body">
        {item.instruction && <p className="tender-dossier-instruction">{item.instruction}</p>}
        <div className="tender-dossier-controls">
          <label><span>Estado</span><select value={item.status} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => void act(item, { action_type: 'status_changed', to_status: event.target.value as TenderDossierItem['status'] })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Responsable</span><select value={item.assignee_id || ''} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => void act(item, { action_type: 'assigned', assignee_id: event.target.value || null, target_date: draft.targetDate || null })}><option value="">Sin asignar</option>{humanProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name} · {profile.role}</option>)}</select></label>
          <label><span>Fecha objetivo</span><input type="date" value={draft.targetDate} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => setDraft(item, { targetDate: event.target.value })} onBlur={() => { if (draft.targetDate !== (item.target_date || '')) void act(item, { action_type: 'requirement_changed', target_date: draft.targetDate || null }); }} /></label>
        </div>

        {item.latest_evidence && <div className="tender-dossier-evidence"><strong>Última evidencia</strong><span>{item.latest_evidence.kind === 'url' ? item.latest_evidence.url : item.latest_evidence.text}</span></div>}
        <div className="tender-dossier-evidence-form">
          <select aria-label="Tipo de evidencia" value={draft.evidenceKind} disabled={disabled} onChange={event => setDraft(item, { evidenceKind: event.target.value as ItemDraft['evidenceKind'] })}><option value="texto">Texto</option><option value="url">Enlace https</option></select>
          <input aria-label="Evidencia" value={draft.evidence} disabled={disabled} placeholder={draft.evidenceKind === 'url' ? 'https://…' : 'Qué se hizo o dónde está el soporte'} onChange={event => setDraft(item, { evidence: event.target.value })} />
          <button type="button" className="secondary" disabled={disabled || !draft.evidence.trim()} title={draft.evidence.trim() ? undefined : 'Escriba la evidencia para poder guardarla'} onClick={() => void attachEvidence(item)}>Guardar evidencia</button>
        </div>

        <div className="row-actions">
          {item.applicability === 'no_aplica'
            ? <button type="button" className="secondary" disabled={disabled} onClick={() => void act(item, { action_type: 'reopened' })}>Reabrir requisito</button>
            : canApprove && <button type="button" className="secondary" disabled={disabled} onClick={() => setShowNoAplica(current => current === item.id ? null : item.id)}>Marcar No aplica</button>}
        </div>
        {showNoAplica === item.id && <div className="tender-dossier-inline-decision"><label><span>Justificación</span><textarea value={draft.justification} onChange={event => setDraft(item, { justification: event.target.value })} placeholder="Explique por qué este requisito no aplica" /></label><div className="row-actions"><button type="button" className="secondary" onClick={() => setShowNoAplica(null)}>Cancelar</button><button type="button" disabled={disabled || !draft.justification.trim()} onClick={() => void markNotApplicable(item)}>Confirmar No aplica</button></div></div>}
      </div>
    </details>;
  };
  const collapsedGroup = (label: string, items: TenderDossierItem[]) => items.length > 0 && <details className="tender-dossier-group">
    <summary>{label} ({items.length})</summary>
    <div className="timeline tender-dossier-list">{items.map(renderItem)}</div>
  </details>;

  return <section className="document-analysis-card tender-dossier-section">
    <div className="tender-dossier-section-head">
      <div><small>Lista de trabajo de la oferta</small><h3>Qué falta, quién lo hace y para cuándo</h3></div>
      <span className="badge badge-neutral">{groups.open.length} por hacer · {groups.done.length} listos{rejectionOpen ? ` · ${rejectionOpen} causan rechazo` : ''}</span>
    </div>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="timeline tender-dossier-list">
      {groups.open.map(renderItem)}
      {!groups.open.length && workspace.checklist.length > 0 && <p className="muted">No hay tareas pendientes.</p>}
    </div>
    {collapsedGroup('Listos', groups.done)}
    {collapsedGroup('Documentos de apoyo de la plantilla', groups.templateDocuments)}
    {collapsedGroup('No aplica', groups.notApplicable)}
    {!workspace.checklist.length && <p className="muted">El expediente todavía no tiene ítems.</p>}
  </section>;
}
