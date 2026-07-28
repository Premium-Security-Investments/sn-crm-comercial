import { useState } from 'react';
import { addTenderDossierArtifactVersion, recordTenderDossierArtifactReview } from '../api';
import type { TenderDossierArtifact, TenderRequest } from '../types';
import { TenderStatusBadge } from './TenderStatusBadge';

const REVIEW_TONES: Record<TenderDossierArtifact['review_status'], 'success' | 'danger' | 'warning'> = {
  aprobado: 'success',
  rechazado: 'danger',
  pendiente: 'warning',
};
type ArtifactDraft = { content: string; comment: string };

export function TenderDossierArtifacts({ opportunityId, artifacts, request, canApprove, onChanged }: {
  opportunityId: string;
  artifacts: TenderDossierArtifact[];
  request: TenderRequest;
  canApprove: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ArtifactDraft>>({});
  const [error, setError] = useState('');
  const draftFor = (artifact: TenderDossierArtifact): ArtifactDraft => drafts[artifact.id] || { content: '', comment: '' };
  const setDraft = (artifact: TenderDossierArtifact, patch: Partial<ArtifactDraft>) => setDrafts(current => ({ ...current, [artifact.id]: { ...draftFor(artifact), ...patch } }));

  const saveVersion = async (artifact: TenderDossierArtifact) => {
    const content = draftFor(artifact).content.trim();
    if (!content) return setError('La nueva versión requiere contenido.');
    setBusyId(artifact.id); setError('');
    try {
      await addTenderDossierArtifactVersion(request, {
        opportunity_id: opportunityId,
        artifact_id: artifact.id,
        content_kind: 'markdown',
        content_text: content,
      });
      setDraft(artifact, { content: '', comment: '' });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };
  const review = async (artifact: TenderDossierArtifact, decision: 'aprobado' | 'rechazado') => {
    if (!artifact.current_version) return;
    const comment = draftFor(artifact).comment.trim();
    if (decision === 'rechazado' && !comment) return setError('Rechazar requiere un comentario de revisión.');
    setBusyId(artifact.id); setError('');
    try {
      await recordTenderDossierArtifactReview(request, {
        opportunity_id: opportunityId,
        version_id: artifact.current_version.id,
        decision,
        comment: comment || null,
      });
      setDraft(artifact, { comment: '' });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return <section className="document-analysis-card tender-dossier-section">
    <div className="tender-dossier-section-head"><div><small>Documentos del expediente</small><h3>Versiones y aprobación humana</h3></div><span className="badge badge-neutral">{artifacts.length} documentos</span></div>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="timeline tender-dossier-list">
      {artifacts.map(artifact => {
        const draft = draftFor(artifact);
        const disabled = busyId === artifact.id;
        return <article className="card tender-dossier-artifact" key={artifact.id}>
          <div className="tender-card-kickers">
            <TenderStatusBadge label={artifact.review_status === 'aprobado' ? 'Aprobado' : artifact.review_status === 'rechazado' ? 'Rechazado' : 'Pendiente de revisión'} tone={REVIEW_TONES[artifact.review_status]} />
            {artifact.required && <TenderStatusBadge label="Obligatorio" tone="neutral" />}
            <TenderStatusBadge label={`v${artifact.current_version?.version ?? 0}`} tone="neutral" />
          </div>
          <h3>{artifact.title}</h3>
          <p className="muted">{artifact.version_count ? `${artifact.version_count} versión(es) registradas` : 'Sin versión registrada'}</p>
          {artifact.current_version?.content_text && <pre className="artifact-preview tender-dossier-preview">{artifact.current_version.content_text}</pre>}

          <label className="tender-dossier-field"><span>Nueva versión</span><textarea value={draft.content} disabled={disabled} onChange={event => setDraft(artifact, { content: event.target.value })} placeholder="Contenido verificable del documento" /></label>
          <div className="row-actions"><button type="button" disabled={disabled || !draft.content.trim()} onClick={() => void saveVersion(artifact)}>Guardar nueva versión</button></div>

          {canApprove && artifact.current_version && <div className="tender-dossier-review">
            <label className="tender-dossier-field"><span>Comentario de revisión</span><textarea value={draft.comment} disabled={disabled} onChange={event => setDraft(artifact, { comment: event.target.value })} placeholder="Obligatorio al rechazar; opcional al aprobar" /></label>
            <div className="row-actions"><button type="button" className="secondary" disabled={disabled} onClick={() => void review(artifact, 'aprobado')}>Aprobar versión vigente</button><button type="button" className="danger" disabled={disabled || !draft.comment.trim()} onClick={() => void review(artifact, 'rechazado')}>Rechazar versión vigente</button></div>
          </div>}
        </article>;
      })}
      {!artifacts.length && <p className="muted">El expediente todavía no tiene documentos.</p>}
    </div>
  </section>;
}
