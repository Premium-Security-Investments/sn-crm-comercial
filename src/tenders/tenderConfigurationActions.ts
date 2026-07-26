import type { TenderCompanyProfile, TenderRequest } from './types';

const RUP_MAX_BYTES = 50 * 1024 * 1024;

type SignedUpload = { path: string; token: string };
type CompanyDocumentMetadata = { documentType: string; displayName: string; issuedAt: string; expiresAt?: string | null; replaceDocumentId?: string | null };
export type CompanyDocumentUploadResponse = { profile: TenderCompanyProfile; documents: import('./types').TenderCompanyDocument[] };
type UploadResult = { error: unknown | null };
type TenderConfigurationActionsDeps = {
  canConfigure: boolean;
  request: TenderRequest;
  uploadToSignedUrl: (path: string, token: string, file: File) => Promise<UploadResult>;
};

/** Mutations retain their authorization guard even when invoked outside disabled UI controls. */
export function createTenderConfigurationActions({ canConfigure, request, uploadToSignedUrl }: TenderConfigurationActionsDeps) {
  return {
    async saveCompany(company: TenderCompanyProfile): Promise<TenderCompanyProfile | null> {
      if (!canConfigure) return null;
      return request<TenderCompanyProfile>('/api/tender-company-profile', { method: 'PUT', body: JSON.stringify(company) });
    },
    async uploadRup(file?: File): Promise<TenderCompanyProfile | null> {
      if (!canConfigure || !file) return null;
      if (file.size > RUP_MAX_BYTES) throw new Error('Error: el RUP supera 50MB.');
      const ticket = await request<SignedUpload>('/api/tender-company-profile-upload-url', { method: 'POST', body: JSON.stringify({ name: file.name, mime_type: file.type, size: file.size }) });
      const uploaded = await uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploaded.error) throw uploaded.error;
      return request<TenderCompanyProfile>('/api/tender-company-profile-process-upload', { method: 'POST', body: JSON.stringify({ storage_path: ticket.path, name: file.name, mime_type: file.type }) });
    },
    async uploadCompanyDocument(file: File | undefined, metadata: CompanyDocumentMetadata): Promise<CompanyDocumentUploadResponse | null> {
      if (!canConfigure || !file) return null;
      if (file.size > RUP_MAX_BYTES) throw new Error('Error: el documento empresarial supera 50MB.');
      const payload = { ...metadata, name: file.name, mime_type: file.type, size: file.size };
      const ticket = await request<SignedUpload>('/api/tender-company-document-upload-url', { method: 'POST', body: JSON.stringify(payload) });
      const uploaded = await uploadToSignedUrl(ticket.path, ticket.token, file);
      if (uploaded.error) throw uploaded.error;
      return request<CompanyDocumentUploadResponse>('/api/tender-company-document-process-upload', {
        method: 'POST',
        body: JSON.stringify({ ...payload, storage_path: ticket.path }),
      });
    },
  };
}
