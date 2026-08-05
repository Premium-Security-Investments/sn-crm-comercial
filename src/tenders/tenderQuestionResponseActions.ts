import type { TenderRequest } from './types';

export const TENDER_QUESTION_RESPONSE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];
export const TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT = 8;

type UploadResult = { error: unknown | null };
type UploadTicket = { response_id: string; response_ticket: string; path: string; token: string; storage_path: string };
export type TenderQuestionResponseAttachmentInput = { name: string; mime_type: string; size_bytes: number; content_hash: string; storage_path: string };
export type TenderQuestionResponseUploadResult = { response_id?: string; response_ticket?: string; attachments: TenderQuestionResponseAttachmentInput[] };
type TenderQuestionResponseActionsDeps = {
  request: TenderRequest;
  uploadToSignedUrl: (path: string, token: string, file: File) => Promise<UploadResult>;
};

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createTenderQuestionResponseActions({ request, uploadToSignedUrl }: TenderQuestionResponseActionsDeps) {
  return {
    async uploadAttachments(opportunityId: string, files: File[]): Promise<TenderQuestionResponseUploadResult> {
      if (!files.length) return { attachments: [] };
      if (files.length > TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT) throw new Error(`Cada respuesta admite máximo ${TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_COUNT} archivos de soporte.`);
      for (const file of files) {
        if (!TENDER_QUESTION_RESPONSE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(file.type)) throw new Error(`El archivo ${file.name} no tiene un tipo permitido.`);
        if (file.size > TENDER_QUESTION_RESPONSE_ATTACHMENT_MAX_BYTES) throw new Error(`El archivo ${file.name} supera 25 MiB.`);
      }
      let responseId: string | undefined;
      let responseTicket: string | undefined;
      const attachments: TenderQuestionResponseAttachmentInput[] = [];
      for (const [index, file] of files.entries()) {
        const ticket = await request<UploadTicket>('/api/tender-question-response-attachment-upload-url', {
          method: 'POST',
          body: JSON.stringify({ opportunity_id: opportunityId, response_id: responseId, response_ticket: responseTicket, attachment_index: index, name: file.name, mime_type: file.type, size: file.size }),
        });
        responseId = ticket.response_id;
        responseTicket = ticket.response_ticket;
        const uploaded = await uploadToSignedUrl(ticket.path, ticket.token, file);
        if (uploaded.error) throw uploaded.error;
        attachments.push({ name: file.name, mime_type: file.type, size_bytes: file.size, content_hash: await sha256Hex(file), storage_path: ticket.storage_path });
      }
      return { response_id: responseId, response_ticket: responseTicket, attachments };
    },
  };
}
