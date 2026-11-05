import { useCallback, useEffect, useState } from 'react';
import { apiDownload } from '../../apiClient';
import { addTenderDossierArtifactVersion, loadTenderDossierWorkbench, loadTenderDraftSharepointCopies, postTenderDossierWorkbenchMessage, recordTenderDossierArtifactReview, requestTenderDraftSharepointCopy, type TenderDraftSharepointCopy } from '../api';
import type { TenderDossierArtifact, TenderRequest } from '../types';
import { VIGIA_VISIBLE_NAMES } from '../../vigia/agentIdentity';
import { TenderStatusBadge } from './TenderStatusBadge';

const REVIEW_TONES: Record<TenderDossierArtifact['review_status'], 'success' | 'danger' | 'warning'> = {
  aprobado: 'success',
  rechazado: 'danger',
  pendiente: 'warning',
};
const VIGIA_DRAFT_CAPABILITY_ID = 'agt002.dossier-workbench.draft.v1';
type ArtifactDraft = { content: string; comment: string };
/** Pedido ya enviado: guarda la versión que había para poder decir si el borrador llegó o no. */
type DraftRequest = { artifactId: string; previousVersionId: string | null };

/**
 * Mejora 5: lo que una versión dice de su Word. `archivo` es el original que guardó el CRM (lo armó Vig-IA y no se
 * modifica); `sharepoint.url` o `url` es la copia de trabajo, la que se corrige y se firma. `falta` es lo que Vig-IA
 * marcó en amarillo o no encontró.
 */
type VersionFiles = { archivo: { nombre: string } | null; sharepointUrl: string | null; falta: string[]; error: boolean };
const httpsUrl = (value: unknown) => (typeof value === 'string' && /^https:\/\//.test(value) ? value : null);
function versionFiles(metadata: Record<string, unknown> | null | undefined): VersionFiles {
  const record = metadata || {};
  const archivo = record.archivo && typeof record.archivo === 'object' ? record.archivo as Record<string, unknown> : null;
  const sharepoint = record.sharepoint && typeof record.sharepoint === 'object' ? record.sharepoint as Record<string, unknown> : null;
  return {
    archivo: archivo && typeof archivo.storage_path === 'string' ? { nombre: typeof archivo.nombre === 'string' ? archivo.nombre : 'Borrador.docx' } : null,
    sharepointUrl: httpsUrl(sharepoint?.url) || httpsUrl(record.url),
    falta: Array.isArray(record.falta) ? record.falta.filter((item): item is string => typeof item === 'string') : [],
    error: typeof record.documento_error === 'string',
  };
}

/**
 * El texto del pedido es el mensaje humano que queda en el hilo, así que dice lo mismo que la
 * persona haría al pedirlo: sobre qué documento, desde qué versión, y que lo que falte se declare
 * en vez de rellenarse.
 */
function draftRequestText(artifact: TenderDossierArtifact) {
  return artifact.current_version
    ? `Redacta una nueva versión de "${artifact.title}" para este expediente, partiendo de la versión ${artifact.current_version.version} que ya está registrada, y declara lo que quede por diligenciar.`
    : `Redacta el primer borrador de "${artifact.title}" para este expediente, y declara lo que quede por diligenciar.`;
}

export function TenderDossierArtifacts({ opportunityId, artifacts, request, canApprove, workbenchEnabled = false, onChanged }: {
  opportunityId: string;
  artifacts: TenderDossierArtifact[];
  request: TenderRequest;
  canApprove: boolean;
  /**
   * Mismo interruptor con el que se monta la Mesa. Sin él no se ofrece pedir borradores: el pedido
   * viaja por la misma puerta y con la Mesa apagada el servidor la cierra con 503.
   */
  workbenchEnabled?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ArtifactDraft>>({});
  const [requested, setRequested] = useState<DraftRequest | null>(null);
  const [error, setError] = useState('');
  const draftFor = (artifact: TenderDossierArtifact): ArtifactDraft => drafts[artifact.id] || { content: '', comment: '' };
  const setDraft = (artifact: TenderDossierArtifact, patch: Partial<ArtifactDraft>) => setDrafts(current => ({ ...current, [artifact.id]: { ...draftFor(artifact), ...patch } }));

  // Mejora 5: la copia de trabajo en SharePoint, pedida con el botón. Mientras haya una en curso, se vuelve a mirar cada
  // 15 s; la sube el servidor de tareas en uno o dos minutos.
  const [copies, setCopies] = useState<Record<string, TenderDraftSharepointCopy>>({});
  const loadCopies = useCallback(async () => {
    try {
      const { copies: list } = await loadTenderDraftSharepointCopies(request, opportunityId);
      setCopies(Object.fromEntries(list.map(copy => [copy.artifact_version_id, copy])));
    } catch { /* sin la migración 177 o sin permiso: la pantalla sigue como antes */ }
  }, [request, opportunityId]);
  useEffect(() => { void loadCopies(); }, [loadCopies, artifacts]);
  const inFlight = Object.values(copies).some(copy => copy.status === 'pendiente' || copy.status === 'subiendo');
  useEffect(() => {
    if (!inFlight) return undefined;
    const timer = window.setInterval(() => { void loadCopies(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [inFlight, loadCopies]);
  // Juan, 2026-11-05: el botón va frente a cada documento, no uno arriba que suba todo. Cada documento se revisa por
  // separado; con el general se subía también un borrador que nadie había mirado. Sube la versión vigente con Word.
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const uploadToSharepoint = async (artifact: TenderDossierArtifact) => {
    if (!artifact.current_version) return;
    setUploadingId(artifact.id); setError('');
    try {
      await requestTenderDraftSharepointCopy(request, { opportunity_id: opportunityId, version_id: artifact.current_version.id });
      await loadCopies();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingId(null);
    }
  };

  const downloadWord = async (artifact: TenderDossierArtifact, fileName: string) => {
    const version = artifact.current_version;
    if (!version) return;
    setBusyId(artifact.id); setError('');
    try {
      const blob = await apiDownload(`/api/tender-dossier-artifact-versions/${encodeURIComponent(version.id)}/download?opportunity_id=${encodeURIComponent(opportunityId)}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = fileName;
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

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
  /**
   * Pide el borrador por la misma puerta que usa la Mesa. El hilo y la referencia canónica los
   * entrega el servidor en la lectura previa —esta pantalla no los construye—; el pedido sólo nombra
   * el documento y la versión que se está viendo, que es la que el control optimista compara: si
   * alguien guardó otra versión mientras tanto, el servidor lo rechaza y no se escribe nada.
   */
  const requestDraft = async (artifact: TenderDossierArtifact) => {
    setBusyId(artifact.id); setError('');
    try {
      const workbench = await loadTenderDossierWorkbench(request, opportunityId);
      await postTenderDossierWorkbenchMessage(request, {
        opportunity_id: opportunityId,
        thread_id: workbench.thread_id,
        client_message_id: crypto.randomUUID(),
        content: draftRequestText(artifact),
        context_links: workbench.reference.context_links,
        capability_id: VIGIA_DRAFT_CAPABILITY_ID,
        snapshot_id: workbench.reference.snapshot_id,
        base_version_id: artifact.current_version?.id ?? null,
        artifact_id: artifact.id,
      });
      setRequested({ artifactId: artifact.id, previousVersionId: artifact.current_version?.id ?? null });
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
    <div className="tender-dossier-section-head"><div><small>Documentos de la oferta</small><h3>Borradores y aprobación</h3></div><div className="row-actions"><span className="badge badge-neutral">{artifacts.filter(artifact => artifact.review_status === 'aprobado').length} de {artifacts.length} aprobados</span></div></div>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="timeline tender-dossier-list">
      {artifacts.map(artifact => {
        const draft = draftFor(artifact);
        const disabled = busyId === artifact.id;
        // El pedido se dio por recibido y la versión vigente sigue siendo la misma: el borrador no
        // ha aterrizado todavía. En cuanto aterriza, la fila lo muestra y este aviso desaparece solo.
        const draftPending = requested?.artifactId === artifact.id
          && (artifact.current_version?.id ?? null) === requested.previousVersionId;
        // Fila compacta (estado, documento, versión); se abre para escribir o revisar la versión.
        return <details className="card tender-dossier-artifact tender-dossier-row" key={artifact.id}>
          <summary className="tender-dossier-row-summary">
            <span className="tender-dossier-row-status"><TenderStatusBadge label={artifact.review_status === 'aprobado' ? 'Aprobado' : artifact.review_status === 'rechazado' ? 'Rechazado' : artifact.current_version ? 'Por revisar' : 'Sin borrador'} tone={REVIEW_TONES[artifact.review_status]} /></span>
            <span className="tender-dossier-row-title"><strong>{artifact.title}</strong>{artifact.required && <span className="tender-dossier-row-required">Obligatorio</span>}</span>
            <span className="tender-dossier-row-owner">{artifact.current_version ? `Versión ${artifact.current_version.version}` : 'Sin versión'}</span>
          </summary>
          <div className="tender-dossier-row-body">
          <p className="muted">{artifact.version_count ? `${artifact.version_count} versión(es) registradas` : 'Sin versión registrada'}{artifact.current_version?.author_kind === 'agent' && ` · la vigente la redactó ${VIGIA_VISIBLE_NAMES.tenders} y está pendiente de revisión humana`}</p>
          {(() => {
            const files = versionFiles(artifact.current_version?.content_metadata);
            const copy = artifact.current_version ? copies[artifact.current_version.id] : undefined;
            if (copy?.status === 'subido' && copy.sharepoint_url) files.sharepointUrl = copy.sharepoint_url;
            if (!files.archivo && !files.sharepointUrl && !files.falta.length && !files.error) return null;
            return <div className="stack">
              <div className="row-actions">
                {files.sharepointUrl && <a className="button" href={files.sharepointUrl} target="_blank" rel="noreferrer">Abrir en SharePoint</a>}
                {files.archivo && <button type="button" className={files.sharepointUrl ? 'secondary' : undefined} disabled={disabled} onClick={() => void downloadWord(artifact, files.archivo!.nombre)}>Descargar Word</button>}
                {files.archivo && !files.sharepointUrl && (!copy || copy.status === 'fallido') && <button type="button" className="secondary" disabled={uploadingId === artifact.id} onClick={() => void uploadToSharepoint(artifact)}>{uploadingId === artifact.id ? 'Pidiendo…' : 'Subir a SharePoint'}</button>}
              </div>
              {files.archivo && !files.sharepointUrl && (copy?.status === 'pendiente' || copy?.status === 'subiendo'
                ? <p className="muted">Subiendo la copia de trabajo a SharePoint; tarda uno o dos minutos.</p>
                : copy?.status === 'fallido'
                  ? <p className="error" role="alert">No se pudo subir a SharePoint: {copy.error_text || 'error desconocido'}. Puede volver a intentarlo con «Subir a SharePoint», aquí.</p>
                  : <p className="muted">El Word de aquí es el original que armó {VIGIA_VISIBLE_NAMES.tenders}. Para trabajarlo en SharePoint, use «Subir a SharePoint».</p>)}
              {files.falta.length > 0 && <div><strong>Lo que falta decidir o diligenciar</strong> (va en amarillo en el Word)<ul>{files.falta.map(item => <li key={item}>{item}</li>)}</ul></div>}
            </div>;
          })()}
          {artifact.current_version?.content_text && <pre className="artifact-preview tender-dossier-preview">{artifact.current_version.content_text}</pre>}

          {workbenchEnabled && (artifact.review_status === 'aprobado'
            ? <p className="muted">La versión vigente está aprobada: un borrador nuevo la reemplazaría y el documento volvería a quedar por revisar, así que aquí no se pide.</p>
            : <div className="row-actions"><button type="button" className="secondary" disabled={disabled} onClick={() => void requestDraft(artifact)}>Pedir borrador a {VIGIA_VISIBLE_NAMES.tenders}</button></div>)}
          {draftPending && <p className="muted">El pedido quedó registrado y todavía no hay versión nueva; el detalle queda en la Mesa de ayuda.</p>}

          <label className="tender-dossier-field"><span>Nueva versión</span><textarea value={draft.content} disabled={disabled} onChange={event => setDraft(artifact, { content: event.target.value })} placeholder="Contenido verificable del documento" /></label>
          <div className="row-actions"><button type="button" disabled={disabled || !draft.content.trim()} title={draft.content.trim() ? undefined : 'Escriba el contenido para poder guardarlo'} onClick={() => void saveVersion(artifact)}>Guardar nueva versión</button></div>

          {canApprove && artifact.current_version && <div className="tender-dossier-review">
            <label className="tender-dossier-field"><span>Comentario de revisión</span><textarea value={draft.comment} disabled={disabled} onChange={event => setDraft(artifact, { comment: event.target.value })} placeholder="Obligatorio al rechazar; opcional al aprobar" /></label>
            <div className="row-actions"><button type="button" className="secondary" disabled={disabled} onClick={() => void review(artifact, 'aprobado')}>Aprobar versión vigente</button><button type="button" className="danger" disabled={disabled || !draft.comment.trim()} onClick={() => void review(artifact, 'rechazado')}>Rechazar versión vigente</button></div>
          </div>}
          </div>
        </details>;
      })}
      {!artifacts.length && <p className="muted">El expediente todavía no tiene documentos.</p>}
    </div>
  </section>;
}
