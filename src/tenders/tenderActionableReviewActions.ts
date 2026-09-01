// AGT-002 revisión accionable — cliente HTTP del frontend (design
// docs/superpowers/specs/2026-08-31-agt002-actionable-review-knowledge-design.md §§9, 12.1,
// 12.3, 13). Todas las llamadas pasan por el `request`/`apiDownload` same-origin autenticados
// inyectados por quien monta este cliente (nunca fetch directo a Supabase ni service_role). La
// carga de bytes hacia el storage privado usa una URL firmada create-only emitida por el
// servidor y nunca lleva el header de autorización de la API.

import type { TenderRequest } from './types';
import type {
  TenderActionableReviewCapabilities,
  TenderActionableReviewOutcome,
  TenderActionableReviewState,
} from './tenderActionableReviewProjection';

export type { TenderActionableReviewCapabilities, TenderActionableReviewOutcome, TenderActionableReviewState };

export const TENDER_ACTIONABLE_REVIEW_OUTCOMES: ReadonlyArray<TenderActionableReviewOutcome> = Object.freeze([
  'aclarado_con_soporte',
  'riesgo_confirmado',
  'no_aplica',
  'informacion_insuficiente',
]);
const CLOSED_OUTCOME_SET: ReadonlySet<TenderActionableReviewOutcome> = new Set(TENDER_ACTIONABLE_REVIEW_OUTCOMES);

export const TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
});
export const TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MAX_NAME_LENGTH = 140;

export type TenderActionableReviewEventType =
  | 'review_started'
  | 'comment_added'
  | 'attachment_added'
  | 'outcome_recorded'
  | 'reopened'
  | 'knowledge_requested';

export type TenderActionableReviewEvent = {
  id: string;
  sequence: number;
  event_type: TenderActionableReviewEventType;
  comment: string | null;
  outcome: TenderActionableReviewOutcome | null;
  note: string | null;
  reusable_requested: boolean | null;
  attachment_id: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
};

export type TenderActionableReviewAttachment = {
  id: string;
  logical_attachment_id: string;
  version: number;
  name: string;
  declared_mime_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export type TenderActionableReviewItem = {
  id: string;
  requirement_id: string | null;
  state: TenderActionableReviewState;
  outcome: TenderActionableReviewOutcome | null;
  sequence: number;
  comment_count: number;
  attachment_count: number;
  current_supports_count: number;
  capabilities: TenderActionableReviewCapabilities;
  timeline: TenderActionableReviewEvent[];
  attachments: TenderActionableReviewAttachment[];
};

export type TenderActionableReviewListPayload = {
  analysis_run_id: string;
  items: TenderActionableReviewItem[];
  summary: { open_count: number; confirmed_risk_count: number };
  history_available: boolean;
};

// Respuesta mínima del puente `ensure` (design §§6.1-6.4, 11): sólo la identidad pública que el
// servidor materializó a partir del análisis canónico. Nunca acepta ni recibe el hash de origen,
// payload canónico ni el identificador interno del tender desde el navegador; el servidor los deriva por su cuenta.
export type TenderActionableReviewEnsureResult = {
  id: string;
  status: TenderActionableReviewState;
  requirement_id: string | null;
};

export type TenderActionableReviewUploadTicketInput = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  logicalAttachmentId: string;
};

export type TenderActionableReviewUploadTicket = {
  ticket_id: string;
  nonce: string;
  storage_path: string;
  upload_token: string;
  expires_at: string;
};

type UploadResult = { error: unknown | null };

type TenderActionableReviewActionsDeps = {
  request: TenderRequest;
  apiDownload: (url: string) => Promise<Blob>;
  uploadToSignedUrl?: (path: string, token: string, file: Blob) => Promise<UploadResult>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

function requireUuidParam(value: string, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`${label} debe ser un UUID.`);
  return value;
}

function requireBoundedNote(value: string, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 10000) throw new Error(`${label} debe tener entre 1 y 10000 caracteres.`);
  return text;
}

function attachmentExtensionFromName(name: string): string {
  const match = /\.[^./\\]+$/.exec(name);
  return match ? match[0].toLowerCase() : '';
}

function validateUploadTicketInput(input: TenderActionableReviewUploadTicketInput) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MAX_NAME_LENGTH) {
    throw new Error('El nombre del archivo debe tener entre 1 y 140 caracteres.');
  }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error('El nombre del archivo contiene caracteres no permitidos.');
  }
  const logicalAttachmentId = typeof input?.logicalAttachmentId === 'string' ? input.logicalAttachmentId.trim() : '';
  if (!logicalAttachmentId) throw new Error('Debe indicar el identificador lógico del adjunto.');
  const extension = attachmentExtensionFromName(name);
  const mimeType = typeof input?.mimeType === 'string' ? input.mimeType : '';
  if (!extension || TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MIME_TYPE_BY_EXTENSION[extension] !== mimeType) {
    throw new Error('El tipo de archivo no está permitido para adjuntos de la revisión accionable.');
  }
  const sizeBytes = Number(input?.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error('El tamaño del archivo no es válido.');
  if (sizeBytes > TENDER_ACTIONABLE_REVIEW_ATTACHMENT_MAX_BYTES) throw new Error('El archivo supera el límite de 25 MiB.');
  const sha256 = typeof input?.sha256 === 'string' ? input.sha256.trim().toLowerCase() : '';
  if (!SHA256_HEX_PATTERN.test(sha256)) throw new Error('Debe indicar el SHA-256 declarado del archivo.');
  return { name, mimeType, sizeBytes, sha256, logicalAttachmentId };
}

export function createTenderActionableReviewActions({ request, apiDownload, uploadToSignedUrl }: TenderActionableReviewActionsDeps) {
  return {
    async listReviews(opportunityId: string, analysisRunId: string, signal?: AbortSignal): Promise<TenderActionableReviewListPayload> {
      const query = new URLSearchParams({ opportunity_id: opportunityId, analysis_run_id: analysisRunId });
      return request<TenderActionableReviewListPayload>(`/api/tender-actionable-reviews?${query.toString()}`, { signal });
    },

    // Primer-acción: el navegador sólo apunta a una fuente que ya vive en el resultado canónico
    // de la corrida (`opportunity_id`/`analysis_run_id`/`source_kind`/`source_id`); el servidor
    // recarga la corrida, deriva el identificador interno del tender y el hash §6.4 por su cuenta y nunca los acepta aquí.
    async ensureReview(
      opportunityId: string,
      analysisRunId: string,
      sourceId: string,
      signal?: AbortSignal,
    ): Promise<TenderActionableReviewEnsureResult> {
      return request<TenderActionableReviewEnsureResult>('/api/tender-actionable-reviews/ensure', {
        method: 'POST',
        body: JSON.stringify({
          opportunity_id: opportunityId,
          analysis_run_id: analysisRunId,
          source_kind: 'integral_unit',
          source_id: sourceId,
        }),
        signal,
      });
    },

    async addComment(itemId: string, comment: string, idempotencyKey: string, signal?: AbortSignal) {
      const text = requireBoundedNote(comment, 'El comentario');
      const key = requireUuidParam(idempotencyKey, 'La clave de idempotencia');
      return request(`/api/tender-actionable-reviews/${encodeURIComponent(itemId)}/comments`, {
        method: 'POST',
        body: JSON.stringify({ comment: text, idempotency_key: key }),
        signal,
      });
    },

    async requestUploadTicket(
      itemId: string,
      input: TenderActionableReviewUploadTicketInput,
      signal?: AbortSignal,
    ): Promise<TenderActionableReviewUploadTicket> {
      const validated = validateUploadTicketInput(input);
      return request<TenderActionableReviewUploadTicket>(
        `/api/tender-actionable-reviews/${encodeURIComponent(itemId)}/attachments/upload-url`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: validated.name,
            mime_type: validated.mimeType,
            size_bytes: validated.sizeBytes,
            sha256: validated.sha256,
            logical_attachment_id: validated.logicalAttachmentId,
          }),
          signal,
        },
      );
    },

    async uploadAttachmentBytes(ticket: TenderActionableReviewUploadTicket, file: Blob): Promise<void> {
      if (!uploadToSignedUrl) throw new Error('No hay un mecanismo de carga de archivos configurado.');
      const uploaded = await uploadToSignedUrl(ticket.storage_path, ticket.upload_token, file);
      if (uploaded.error) throw uploaded.error;
    },

    async completeUpload(itemId: string, ticketId: string, nonce: string, signal?: AbortSignal): Promise<TenderActionableReviewAttachment> {
      const ticket = typeof ticketId === 'string' ? ticketId.trim() : '';
      const ticketNonce = typeof nonce === 'string' ? nonce.trim() : '';
      if (!ticket || !ticketNonce) throw new Error('Debe indicar el ticket y el nonce de carga.');
      return request<TenderActionableReviewAttachment>(
        `/api/tender-actionable-reviews/${encodeURIComponent(itemId)}/attachments/complete`,
        { method: 'POST', body: JSON.stringify({ ticket_id: ticket, nonce: ticketNonce }), signal },
      );
    },

    async downloadAttachment(attachmentId: string, opportunityId: string): Promise<Blob> {
      const query = new URLSearchParams({ opportunity_id: opportunityId });
      return apiDownload(`/api/tender-actionable-review-attachments/${encodeURIComponent(attachmentId)}/download?${query.toString()}`);
    },

    async recordOutcome(
      itemId: string,
      outcome: TenderActionableReviewOutcome,
      note: string,
      reusableRequested: boolean,
      idempotencyKey: string,
      signal?: AbortSignal,
    ) {
      if (!CLOSED_OUTCOME_SET.has(outcome)) throw new Error('El resultado no es válido.');
      const text = requireBoundedNote(note, 'La nota de resolución');
      const key = requireUuidParam(idempotencyKey, 'La clave de idempotencia');
      const reusable = reusableRequested === true;
      if (reusable && outcome === 'informacion_insuficiente') {
        throw new Error('La reutilización sólo puede solicitarse cuando el resultado cierra el pendiente.');
      }
      return request(`/api/tender-actionable-reviews/${encodeURIComponent(itemId)}/outcomes`, {
        method: 'POST',
        body: JSON.stringify({ outcome, note: text, reusable_requested: reusable, idempotency_key: key }),
        signal,
      });
    },

    async reopen(itemId: string, note: string, idempotencyKey: string, signal?: AbortSignal) {
      const text = requireBoundedNote(note, 'La nota de reapertura');
      const key = requireUuidParam(idempotencyKey, 'La clave de idempotencia');
      return request(`/api/tender-actionable-reviews/${encodeURIComponent(itemId)}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ note: text, idempotency_key: key }),
        signal,
      });
    },
  };
}
