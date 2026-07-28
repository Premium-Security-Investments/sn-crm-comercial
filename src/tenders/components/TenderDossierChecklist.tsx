import { useState } from 'react';
import { appendTenderDossierItemAction } from '../api';
import type { TenderDossierAssignee, TenderDossierItem, TenderDossierItemActionInput, TenderDossierWorkspace, TenderRequest } from '../types';
import { TenderStatusBadge } from './TenderStatusBadge';

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

  const draftFor = (item: TenderDossierItem): ItemDraft => drafts[item.id] || {
    evidenceKind: 'texto', evidence: '', justification: '', targetDate: item.target_date || '',
  };
  const setDraft = (item: TenderDossierItem, patch: Partial<ItemDraft>) => {
    setDrafts(current => ({ ...current, [item.id]: { ...draftFor(item), ...patch } }));
  };
  const act = async (item: TenderDossierItem, action: Omit<TenderDossierItemActionInput, 'opportunity_id' | 'item_id'>) => {
    setBusyId(item.id);
    setError('');
    try {
      await appendTenderDossierItemAction(request, { opportunity_id: opportunityId, item_id: item.id, ...action });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };
  const attachEvidence = async (item: TenderDossierItem) => {
    const draft = draftFor(item);
    if (!draft.evidence.trim()) return setError('Debe registrar la evidencia antes de guardarla.');
    await act(item, {
      action_type: 'evidence_attached',
      evidence_kind: draft.evidenceKind,
      evidence_text: draft.evidenceKind === 'texto' ? draft.evidence : null,
      evidence_url: draft.evidenceKind === 'url' ? draft.evidence : null,
    });
    setDraft(item, { evidence: '' });
  };
  const markNotApplicable = async (item: TenderDossierItem) => {
    const justification = draftFor(item).justification.trim();
    if (!justification) return setError('La justificación es obligatoria para marcar No aplica.');
    await act(item, { action_type: 'marked_not_applicable', justification });
    setShowNoAplica(null);
  };

  return <section className="document-analysis-card tender-dossier-section">
    <div className="tender-dossier-section-head"><div><small>Checklist del expediente</small><h3>Requisitos y pendientes humanos</h3></div><span className="badge badge-neutral">{workspace.checklist.length} ítems</span></div>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="timeline tender-dossier-list">
      {workspace.checklist.map(item => {
        const draft = draftFor(item);
        const disabled = busyId === item.id;
        return <article className="card tracking-row tender-dossier-item" key={item.id}>
          <div className="tracking-row-head">
            <div>
              <div className="tender-card-kickers">
                <TenderStatusBadge label={STATUS_LABELS[item.status]} tone={STATUS_TONES[item.status]} />
                {item.required && <TenderStatusBadge label="Requerido" tone="neutral" />}
                {item.applicability === 'no_aplica' && <TenderStatusBadge label="No aplica" tone="neutral" />}
              </div>
              <h3>{item.title}</h3>
              <p>{item.assignee_name ? `Responsable: ${item.assignee_name}` : 'Sin responsable'}{item.target_date ? ` · Fecha objetivo: ${item.target_date}` : ''}</p>
            </div>
          </div>

          <div className="tender-dossier-controls">
            <label><span>Estado</span><select value={item.status} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => void act(item, { action_type: 'status_changed', to_status: event.target.value as TenderDossierItem['status'] })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Responsable</span><select value={item.assignee_id || ''} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => void act(item, { action_type: 'assigned', assignee_id: event.target.value || null, target_date: draft.targetDate || null })}><option value="">Sin asignar</option>{humanProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.full_name} · {profile.role}</option>)}</select></label>
            <label><span>Fecha objetivo</span><input type="date" value={draft.targetDate} disabled={disabled || item.applicability === 'no_aplica'} onChange={event => setDraft(item, { targetDate: event.target.value })} onBlur={() => { if (draft.targetDate !== (item.target_date || '')) void act(item, { action_type: 'requirement_changed', target_date: draft.targetDate || null }); }} /></label>
          </div>

          {item.latest_evidence && <div className="tender-dossier-evidence"><strong>Última evidencia</strong><span>{item.latest_evidence.kind === 'url' ? item.latest_evidence.url : item.latest_evidence.text}</span></div>}
          <div className="tender-dossier-evidence-form">
            <select aria-label="Tipo de evidencia" value={draft.evidenceKind} disabled={disabled} onChange={event => setDraft(item, { evidenceKind: event.target.value as ItemDraft['evidenceKind'] })}><option value="texto">Texto</option><option value="url">URL https</option></select>
            <input aria-label="Evidencia" value={draft.evidence} disabled={disabled} placeholder={draft.evidenceKind === 'url' ? 'https://…' : 'Describa la evidencia verificable'} onChange={event => setDraft(item, { evidence: event.target.value })} />
            <button type="button" className="secondary" disabled={disabled || !draft.evidence.trim()} onClick={() => void attachEvidence(item)}>Guardar evidencia</button>
          </div>

          <div className="row-actions">
            {item.applicability === 'no_aplica'
              ? <button type="button" className="secondary" disabled={disabled} onClick={() => void act(item, { action_type: 'reopened' })}>Reabrir requisito</button>
              : canApprove && <button type="button" className="secondary" disabled={disabled} onClick={() => setShowNoAplica(current => current === item.id ? null : item.id)}>Marcar No aplica</button>}
          </div>
          {showNoAplica === item.id && <div className="tender-dossier-inline-decision"><label><span>Justificación</span><textarea value={draft.justification} onChange={event => setDraft(item, { justification: event.target.value })} placeholder="Explique por qué este requisito no aplica" /></label><div className="row-actions"><button type="button" className="secondary" onClick={() => setShowNoAplica(null)}>Cancelar</button><button type="button" disabled={disabled || !draft.justification.trim()} onClick={() => void markNotApplicable(item)}>Confirmar No aplica</button></div></div>}
        </article>;
      })}
      {!workspace.checklist.length && <p className="muted">El expediente todavía no tiene ítems.</p>}
    </div>
  </section>;
}
