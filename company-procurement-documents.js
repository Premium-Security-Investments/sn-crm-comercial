import { createHash } from 'node:crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateAtMidnight(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Derives a readable temporal state without changing the registered document. */
export function companyDocumentState(document, now = new Date()) {
  const expiresAt = dateAtMidnight(document?.expires_at);
  if (!expiresAt) return 'sin_vencimiento';
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (expiresAt < today) return 'vencido';
  return expiresAt.getTime() - today.getTime() <= 30 * DAY_MS ? 'vence_pronto' : 'vigente';
}

export async function listCompanyProcurementDocuments(database) {
  const { data, error } = await database
    .from('psi_company_procurement_documents')
    .select('*, psi_sales_profiles:uploaded_by(full_name)')
    .order('current', { ascending: false })
    .order('document_type')
    .order('version', { ascending: false });
  if (error) throw error;
  return (data || []).map(document => ({
    ...document,
    uploaded_by_name: document.uploaded_by_name || document.psi_sales_profiles?.full_name || null,
    state: companyDocumentState(document),
  }));
}

/** Records exactly the downloaded bytes through the audited SQL RPC. */
export async function recordCompanyProcurementDocument(database, input) {
  const contentHash = input.contentHash || createHash('sha256').update(input.content).digest('hex');
  const { data, error } = await database.rpc('psi_record_company_procurement_document', {
    p_document_type: String(input.documentType || '').trim().toLowerCase(),
    p_display_name: String(input.displayName || '').trim(),
    p_issued_at: input.issuedAt || null,
    p_expires_at: input.expiresAt || null,
    p_content_hash: contentHash,
    p_storage_path: input.storagePath,
    p_mime_type: String(input.mimeType || '').trim(),
    p_size_bytes: Number(input.sizeBytes || input.content?.length || 0),
    p_uploaded_by: input.uploadedBy,
    p_replace_document_id: input.replaceDocumentId || null,
  });
  if (error) throw error;
  return data;
}
