// AGT-002 revisión accionable — drawer accesible (design
// docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md §§8.3, 8.4, 8.6).
// Único punto de montaje del flujo nuevo: nunca sube documentos oficiales de la licitación, nunca
// dispara AGT/Vig-IA/reanálisis y nunca toca GO/NO-GO. Toda la mecánica de red vive en
// `createTenderActionableReviewActions`; este componente sólo la consume y proyecta estado humano.

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  createTenderActionableReviewActions,
  TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION,
  TENDER_ACTIONABLE_REVIEW_OUTCOMES,
  type TenderActionableReviewAttachment,
  type TenderActionableReviewCapabilities,
  type TenderActionableReviewEvent,
  type TenderActionableReviewEventType,
  type TenderActionableReviewListPayload,
  type TenderActionableReviewOutcome,
  type TenderActionableReviewState,
} from '../tenderActionableReviewActions';
import type { TenderCurrentProfile, TenderRequest } from '../types';
import './tender-actionable-review-drawer.css';

export type TenderActionableReviewDrawerItem = {
  id: string;
  requirement_title: string;
  analysis_conclusion_summary: string;
  state: TenderActionableReviewState;
  outcome: TenderActionableReviewOutcome | null;
  comment_count: number;
  attachment_count: number;
  current_supports_count: number;
  capabilities: TenderActionableReviewCapabilities;
  timeline: TenderActionableReviewEvent[];
};

export type TenderActionableReviewDrawerProps = {
  item: TenderActionableReviewDrawerItem;
  opportunityId: string;
  analysisRunId: string;
  currentProfile: TenderCurrentProfile | null | undefined;
  request: TenderRequest;
  apiDownload: (url: string) => Promise<Blob>;
  uploadToSignedUrl?: (path: string, token: string, file: Blob) => Promise<{ error: unknown | null }>;
  onClose: () => void;
  triggerLabel?: string;
};

const STATE_LABELS: Readonly<Record<TenderActionableReviewState, string>> = Object.freeze({
  pendiente: 'Pendiente',
  en_revision: 'En revisión',
  resuelto: 'Resuelto',
  reabierto: 'Reabierto',
});

// Rótulos cerrados al dominio (§8.4 de la spec): nunca se inventa un quinto resultado ni se
// renombran los cuatro existentes.
const OUTCOME_LABELS: Readonly<Record<TenderActionableReviewOutcome, string>> = Object.freeze({
  aclarado_con_soporte: 'Aclarado con soporte',
  riesgo_confirmado: 'Riesgo confirmado',
  no_aplica: 'No aplica',
  informacion_insuficiente: 'Información insuficiente',
});

const EVENT_TYPE_LABELS: Readonly<Record<TenderActionableReviewEventType, string>> = Object.freeze({
  review_started: 'Revisión iniciada',
  comment_added: 'Comentario añadido',
  attachment_added: 'Adjunto añadido',
  outcome_recorded: 'Resultado registrado',
  reopened: 'Pendiente reabierto',
  knowledge_requested: 'Conocimiento reutilizable solicitado',
});

const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Id estable del único drawer montado a nivel de sección (§8.6/§18): permite que el CTA de cada
// tarjeta declare `aria-controls` hacia el diálogo real, sin depender del id dinámico por ítem.
export const TENDER_ACTIONABLE_REVIEW_DRAWER_DOM_ID = 'tender-actionable-review-drawer';

const ATTACHMENT_ACCEPT = Object.keys(TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION).join(',');

function safeErrorCopy(): string {
  return 'No se pudo completar la operación. Intente nuevamente.';
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha desconocida';
  return date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function actorLabel(event: TenderActionableReviewEvent, currentProfile: TenderCurrentProfile | null | undefined): string {
  if (event.actor_name) return event.actor_name;
  if (currentProfile && event.actor_id === currentProfile.id) return currentProfile.full_name || 'Usted';
  return 'Persona revisora';
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function TenderActionableReviewDrawer({
  item,
  opportunityId,
  analysisRunId,
  currentProfile,
  request,
  apiDownload,
  uploadToSignedUrl,
  onClose,
  triggerLabel,
}: TenderActionableReviewDrawerProps) {
  const actions = useMemo(
    () => createTenderActionableReviewActions({ request, apiDownload, uploadToSignedUrl }),
    [request, apiDownload, uploadToSignedUrl],
  );

  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [loadErrorMessage, setLoadErrorMessage] = useState<string | null>(null);
  const [payload, setPayload] = useState<TenderActionableReviewListPayload | null>(null);
  const [attachmentsMeta, setAttachmentsMeta] = useState<Record<string, TenderActionableReviewAttachment>>({});
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [commentText, setCommentText] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgressLabel, setUploadProgressLabel] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<TenderActionableReviewOutcome | ''>('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [reusableRequested, setReusableRequested] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [reopenNote, setReopenNote] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fetchReviews = useCallback(async () => {
    setPhase('loading');
    setLoadErrorMessage(null);
    try {
      const result = await actions.listReviews(opportunityId, analysisRunId);
      setPayload(result);
      setPhase('ready');
    } catch {
      setLoadErrorMessage(safeErrorCopy());
      setPhase('error');
    }
  }, [actions, opportunityId, analysisRunId]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  // Foco inicial en el título al abrir (§8.6): una sola vez por montaje, nunca en cada re-render.
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Bloqueo de scroll del body mientras el drawer está abierto, restaurado siempre al desmontar.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  // Escape cierra y Tab queda atrapado dentro del diálogo (§8.6). Devolver el foco al disparador
  // original es responsabilidad de quien monta este drawer (ver onClose), no de este componente.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const fetchedItem = payload?.items.find(entry => entry.id === item.id) ?? null;
  const state = fetchedItem?.state ?? item.state;
  const outcomeValue = fetchedItem?.outcome ?? item.outcome;
  const commentCount = fetchedItem?.comment_count ?? item.comment_count;
  const attachmentCount = fetchedItem?.attachment_count ?? item.attachment_count;
  const supportsCount = fetchedItem?.current_supports_count ?? item.current_supports_count;
  const capabilities = fetchedItem?.capabilities ?? item.capabilities;
  const timeline = fetchedItem?.timeline ?? item.timeline;
  const stateLabel = STATE_LABELS[state];
  const outcomeLabel = outcomeValue != null ? OUTCOME_LABELS[outcomeValue] : null;

  const isHuman = currentProfile != null && currentProfile.identity_type !== 'agent';
  const canContribute = isHuman && Boolean(capabilities?.can_contribute);
  const canResolve = isHuman && Boolean(capabilities?.can_resolve);

  const titleId = `tender-actionable-review-drawer-title-${item.id}`;
  const descId = `tender-actionable-review-drawer-desc-${item.id}`;
  const summaryHeadingId = `tender-actionable-review-drawer-summary-${item.id}`;
  const timelineHeadingId = `tender-actionable-review-drawer-timeline-${item.id}`;
  const commentHeadingId = `tender-actionable-review-drawer-comment-${item.id}`;
  const commentFieldId = `tender-actionable-review-drawer-comment-field-${item.id}`;
  const attachmentHeadingId = `tender-actionable-review-drawer-attachment-${item.id}`;
  const fileFieldId = `tender-actionable-review-drawer-file-field-${item.id}`;
  const resolveHeadingId = `tender-actionable-review-drawer-resolve-${item.id}`;
  const resolutionNoteFieldId = `tender-actionable-review-drawer-resolution-note-${item.id}`;
  const reopenHeadingId = `tender-actionable-review-drawer-reopen-${item.id}`;
  const reopenNoteFieldId = `tender-actionable-review-drawer-reopen-note-${item.id}`;

  const attachmentEvents = timeline.filter(event => event.event_type === 'attachment_added' && event.attachment_id);

  // Fuente de verdad: los metadatos server-owned de `fetchedItem.attachments`; `attachmentsMeta`
  // sólo aporta la entrada optimista del adjunto recién subido mientras la relectura está en vuelo.
  const attachmentsById = useMemo(() => {
    const merged: Record<string, TenderActionableReviewAttachment> = { ...attachmentsMeta };
    for (const attachment of fetchedItem?.attachments ?? []) merged[attachment.id] = attachment;
    return merged;
  }, [fetchedItem, attachmentsMeta]);

  const handleDownload = async (attachmentId: string, displayName: string) => {
    setDownloadError(null);
    try {
      const blob = await actions.downloadAttachment(attachmentId, opportunityId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = displayName || 'adjunto-revision';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(safeErrorCopy());
    }
  };

  const handleCommentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      await actions.addComment(item.id, trimmed, crypto.randomUUID());
      setCommentText('');
      await fetchReviews();
    } catch {
      setCommentError(safeErrorCopy());
    } finally {
      setCommentBusy(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPendingFile(event.target.files?.[0] ?? null);
    setUploadError(null);
  };

  const handleUploadSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingFile) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      setUploadProgressLabel('Calculando huella digital…');
      const sha256 = await sha256Hex(pendingFile);
      setUploadProgressLabel('Solicitando autorización de carga…');
      const ticket = await actions.requestUploadTicket(item.id, {
        name: pendingFile.name,
        mimeType: pendingFile.type,
        sizeBytes: pendingFile.size,
        sha256,
        logicalAttachmentId: crypto.randomUUID(),
      });
      setUploadProgressLabel('Subiendo archivo…');
      await actions.uploadAttachmentBytes(ticket, pendingFile);
      setUploadProgressLabel('Confirmando carga…');
      const attachment = await actions.completeUpload(item.id, ticket.ticket_id, ticket.nonce);
      setAttachmentsMeta(previous => ({ ...previous, [attachment.id]: attachment }));
      setPendingFile(null);
      await fetchReviews();
    } catch {
      setUploadError(safeErrorCopy());
    } finally {
      setUploadProgressLabel(null);
      setUploadBusy(false);
    }
  };

  const handleResolveSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!outcome) { setResolveError('Seleccione uno de los cuatro resultados.'); return; }
    const trimmedNote = resolutionNote.trim();
    if (!trimmedNote) { setResolveError('La nota de resolución es obligatoria.'); return; }
    setResolveBusy(true);
    setResolveError(null);
    try {
      await actions.recordOutcome(item.id, outcome, trimmedNote, reusableRequested, crypto.randomUUID());
      setOutcome('');
      setResolutionNote('');
      setReusableRequested(false);
      await fetchReviews();
    } catch {
      setResolveError(safeErrorCopy());
    } finally {
      setResolveBusy(false);
    }
  };

  const handleReopenSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = reopenNote.trim();
    if (!trimmed) { setReopenError('La nota de reapertura es obligatoria.'); return; }
    setReopenBusy(true);
    setReopenError(null);
    try {
      await actions.reopen(item.id, trimmed, crypto.randomUUID());
      setReopenNote('');
      await fetchReviews();
    } catch {
      setReopenError(safeErrorCopy());
    } finally {
      setReopenBusy(false);
    }
  };

  return <div className="tender-actionable-review-drawer-backdrop" role="presentation" onMouseDown={onClose}>
    <aside
      id={TENDER_ACTIONABLE_REVIEW_DRAWER_DOM_ID}
      className="tender-actionable-review-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      ref={dialogRef}
      onMouseDown={event => event.stopPropagation()}
    >
      <header className="tender-actionable-review-drawer-header">
        <div>
          <span className="eyebrow">Revisión accionable</span>
          <h2 id={titleId} ref={titleRef} tabIndex={-1}>{item.requirement_title}</h2>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={onClose}
          aria-label={triggerLabel ? `Cerrar y volver a ${triggerLabel}` : 'Cerrar revisión'}
        >Cerrar</button>
      </header>

      {phase === 'loading' && <p className="tender-actionable-review-drawer-status" role="status">Cargando revisión…</p>}
      {phase === 'error' && <div className="tender-actionable-review-drawer-alert" role="alert">
        <p>{loadErrorMessage}</p>
        <button type="button" onClick={fetchReviews}>Reintentar</button>
      </div>}

      <section className="tender-actionable-review-drawer-summary" aria-labelledby={summaryHeadingId}>
        <h3 id={summaryHeadingId}>Conclusión del análisis</h3>
        <p id={descId}>{item.analysis_conclusion_summary}</p>
        <p className="tender-actionable-review-drawer-state">
          <strong className={`tender-actionable-review-drawer-badge is-${state}`}>{stateLabel}</strong>
          {outcomeLabel && <span className="tender-actionable-review-drawer-outcome">{outcomeLabel}</span>}
        </p>
        <ul className="tender-actionable-review-drawer-counts">
          <li>{commentCount} comentario{commentCount === 1 ? '' : 's'}</li>
          <li>{attachmentCount} archivo{attachmentCount === 1 ? '' : 's'}</li>
          <li>{supportsCount} soporte{supportsCount === 1 ? '' : 's'} vigente{supportsCount === 1 ? '' : 's'}</li>
        </ul>
      </section>

      <section className="tender-actionable-review-drawer-timeline" aria-labelledby={timelineHeadingId}>
        <h3 id={timelineHeadingId}>Historial de la revisión</h3>
        <ol>
          {timeline.length === 0
            ? <li className="is-empty">Sin eventos registrados todavía.</li>
            : timeline.map(event => <li key={event.id}>
              <span className="tender-actionable-review-timeline-actor">{actorLabel(event, currentProfile)}</span>
              <span className="tender-actionable-review-timeline-date">{formatEventDate(event.created_at)}</span>
              <span className="tender-actionable-review-timeline-event">{EVENT_TYPE_LABELS[event.event_type]}{event.outcome ? ` · ${OUTCOME_LABELS[event.outcome]}` : ''}</span>
              {event.comment && <p>{event.comment}</p>}
              {event.note && <p>{event.note}</p>}
            </li>)}
        </ol>
      </section>

      <section className="tender-actionable-review-drawer-comments" aria-labelledby={commentHeadingId}>
        <h3 id={commentHeadingId}>Añadir comentario</h3>
        {canContribute
          ? <form onSubmit={handleCommentSubmit}>
            <label htmlFor={commentFieldId}>Comentario</label>
            <textarea
              id={commentFieldId}
              value={commentText}
              onChange={event => setCommentText(event.target.value)}
              disabled={commentBusy}
              required
            />
            {commentError && <p role="alert">{commentError}</p>}
            <button type="submit" disabled={commentBusy || !commentText.trim()}>{commentBusy ? 'Guardando…' : 'Añadir comentario'}</button>
          </form>
          : <p className="muted">No tiene permiso para comentar esta revisión.</p>}
      </section>

      <section className="tender-actionable-review-drawer-attachments" aria-labelledby={attachmentHeadingId}>
        <h3 id={attachmentHeadingId}>Adjuntar soporte de revisión</h3>
        <ul className="tender-actionable-review-drawer-attachment-list">
          {attachmentEvents.length === 0
            ? <li className="is-empty">Sin adjuntos privados registrados todavía.</li>
            : attachmentEvents.map(event => {
              const meta = event.attachment_id ? attachmentsById[event.attachment_id] : undefined;
              const displayName = meta?.name || 'Adjunto de revisión';
              return <li key={event.id}>
                <span className="tender-actionable-review-drawer-attachment-name">{displayName}</span>
                <span className="tender-actionable-review-drawer-attachment-date">{formatEventDate(event.created_at)}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => event.attachment_id && handleDownload(event.attachment_id, displayName)}
                >Descargar</button>
              </li>;
            })}
        </ul>
        {downloadError && <p role="alert">{downloadError}</p>}
        {canContribute
          ? <form onSubmit={handleUploadSubmit} className="tender-actionable-review-drawer-upload-form">
            <label htmlFor={fileFieldId}>Adjuntar soporte de revisión</label>
            <input id={fileFieldId} type="file" accept={ATTACHMENT_ACCEPT} onChange={handleFileChange} disabled={uploadBusy} />
            {pendingFile && <p className="tender-actionable-review-drawer-pending-file">{pendingFile.name}</p>}
            {uploadProgressLabel && <p role="status">{uploadProgressLabel}</p>}
            {uploadError && <p role="alert">{uploadError}</p>}
            <button type="submit" disabled={uploadBusy || !pendingFile}>{uploadBusy ? 'Adjuntando…' : 'Adjuntar archivo'}</button>
          </form>
          : <p className="muted">No tiene permiso para adjuntar soporte de revisión.</p>}
      </section>

      {canResolve && <section className="tender-actionable-review-drawer-resolve" aria-labelledby={resolveHeadingId}>
        <h3 id={resolveHeadingId}>Registrar resultado</h3>
        <form onSubmit={handleResolveSubmit}>
          <fieldset>
            <legend>Resultado de la revisión</legend>
            {TENDER_ACTIONABLE_REVIEW_OUTCOMES.map(value => <label key={value} className="tender-actionable-review-drawer-outcome-option">
              <input
                type="radio"
                name={`tender-actionable-review-outcome-${item.id}`}
                value={value}
                checked={outcome === value}
                onChange={() => setOutcome(value)}
                disabled={resolveBusy}
              />
              {OUTCOME_LABELS[value]}
            </label>)}
          </fieldset>
          <label htmlFor={resolutionNoteFieldId}>Nota de resolución (obligatoria)</label>
          <textarea
            id={resolutionNoteFieldId}
            value={resolutionNote}
            onChange={event => setResolutionNote(event.target.value)}
            disabled={resolveBusy}
            required
          />
          <label className="tender-actionable-review-drawer-checkbox">
            <input
              type="checkbox"
              checked={reusableRequested}
              onChange={event => setReusableRequested(event.target.checked)}
              disabled={resolveBusy || outcome === 'informacion_insuficiente'}
            />
            Solicitar reutilización como conocimiento
          </label>
          {resolveError && <p role="alert">{resolveError}</p>}
          <button type="submit" disabled={resolveBusy}>{resolveBusy ? 'Registrando…' : 'Registrar resultado'}</button>
        </form>
      </section>}

      {canResolve && state === 'resuelto' && <section className="tender-actionable-review-drawer-reopen" aria-labelledby={reopenHeadingId}>
        <h3 id={reopenHeadingId}>Reabrir pendiente</h3>
        <form onSubmit={handleReopenSubmit}>
          <label htmlFor={reopenNoteFieldId}>Nota de reapertura (obligatoria)</label>
          <textarea
            id={reopenNoteFieldId}
            value={reopenNote}
            onChange={event => setReopenNote(event.target.value)}
            disabled={reopenBusy}
            required
          />
          {reopenError && <p role="alert">{reopenError}</p>}
          <button type="submit" disabled={reopenBusy}>{reopenBusy ? 'Reabriendo…' : 'Reabrir pendiente'}</button>
        </form>
      </section>}
    </aside>
  </div>;
}
