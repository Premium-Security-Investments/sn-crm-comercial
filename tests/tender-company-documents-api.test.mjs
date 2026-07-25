import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');
const service = await import(new URL('../company-procurement-documents.js', import.meta.url));

assert.equal(service.companyDocumentState({ expires_at: null }), 'sin_vencimiento');
assert.equal(service.companyDocumentState({ expires_at: '2026-01-01' }, new Date('2026-01-02T00:00:00Z')), 'vencido');
assert.equal(service.companyDocumentState({ expires_at: '2026-01-10' }, new Date('2026-01-01T00:00:00Z')), 'vence_pronto');
assert.equal(service.companyDocumentState({ expires_at: '2026-02-01' }, new Date('2026-01-01T00:00:00Z')), 'vigente');

const calls = [];
const database = {
  from(table) {
    assert.equal(table, 'psi_company_procurement_documents');
    return {
      select() { return this; },
      order() { return this; },
      async then(resolve) {
        return resolve({ data: [{ id: 'doc-1', expires_at: null, current: true }], error: null });
      },
    };
  },
  rpc(name, input) {
    calls.push({ name, input });
    return Promise.resolve({ data: { id: 'doc-1' }, error: null });
  },
};
assert.deepEqual(await service.listCompanyProcurementDocuments(database), [{ id: 'doc-1', expires_at: null, current: true, uploaded_by_name: null, state: 'sin_vencimiento' }]);
const content = Buffer.from('documento empresarial verificable');
await service.recordCompanyProcurementDocument(database, {
  documentType: 'certificado', displayName: 'Certificado vigente', issuedAt: '2026-01-01', expiresAt: null,
  content, storagePath: 'company-profile/documents/actor-1/certificado.pdf', mimeType: 'application/pdf', sizeBytes: content.length, uploadedBy: 'actor-1', replaceDocumentId: null,
});
assert.deepEqual(calls, [{
  name: 'psi_record_company_procurement_document',
  input: {
    p_document_type: 'certificado', p_display_name: 'Certificado vigente', p_issued_at: '2026-01-01', p_expires_at: null,
    p_content_hash: createHash('sha256').update(content).digest('hex'), p_storage_path: 'company-profile/documents/actor-1/certificado.pdf',
    p_mime_type: 'application/pdf', p_size_bytes: content.length, p_uploaded_by: 'actor-1', p_replace_document_id: null,
  },
}]);

for (const source of [read('server/index.js'), read('api/[...path].js')]) {
  assert.match(source, /app\.get\('\/api\/tender-company-documents'[\s\S]*?requireAction\(currentProfile, ACTIONS\.LICITACIONES_VIEW\)/, 'GET requiere LICITACIONES_VIEW');
  for (const endpoint of ['/api/tender-company-document-upload-url', '/api/tender-company-document-process-upload']) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`app\\.post\\('${escaped}'[\\s\\S]*?requireAction\\(currentProfile, ACTIONS\\.LICITACIONES_CONFIGURE\\)`), `${endpoint} requiere LICITACIONES_CONFIGURE`);
  }
  assert.match(source, /company-profile\/documents\//, 'las cargas generales usan ruta privada de documentos');
}
assert.match(read('src/tenders/types.ts'), /TenderCompanyDocument/);
assert.match(read('src/tenders/tenderConfigurationActions.ts'), /uploadCompanyDocument/);
assert.match(read('src/tenders/api.ts'), /loadCompanyProcurementDocuments/);
console.log('tender company documents API contract passed');
