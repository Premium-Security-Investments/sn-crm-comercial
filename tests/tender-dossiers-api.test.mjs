import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildTenderDossierSummary } from '../server/index.js';

const backends = ['../api/[...path].js', '../server/index.js'].map(path =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
);

for (const source of backends) {
  assert.match(source, /app\.get\('\/api\/tender-dossiers'/);
  for (const field of [
    'opportunity_id', 'document_count', 'missing_document_count', 'document_import_status',
    'go_no_go', 'risk', 'checklist_progress', 'preparation_status', 'human_pending_count',
    'sharepoint_status', 'sharepoint_url', 'dossier_error'
  ]) {
    assert.ok(source.includes(field), `Falta ${field}`);
  }
  assert.match(source, /converted_opportunity_id/);
  assert.match(source, /getTenderDocumentRecords/);
  assert.match(source, /getTenderOfferPreparationRecords/);
  assert.match(source, /requireTenderTrackingAccess\(currentProfile\)/);
}

function interactionQuery(rows, error = null) {
  return {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    then(resolve, reject) { return Promise.resolve({ data: rows, error }).then(resolve, reject); }
  };
}

function mockDatabaseByOpportunity({ failOpportunityId = null } = {}) {
  const interactions = {
    good: [
      { id: 'upload-1', notes: JSON.stringify({ kind: 'tender_document_upload', documents: [
        { id: 'doc-1', name: 'pliego.pdf', current: true, storage_path: 'good/pliego.pdf' },
        { id: 'doc-2', name: 'obsolete.pdf', current: false, storage_path: 'good/obsolete.pdf' }
      ] }), created_at: '2026-07-14T10:00:00.000Z', psi_sales_profiles: { full_name: 'Ana' } },
      { id: 'analysis-1', notes: JSON.stringify({ kind: 'tender_document_analysis', status: 'analisis_generado', recommendation: 'GO condicionado', risk: 'Medio', checklist: ['Pendiente póliza', 'Validar RUP'], go_no_go: { decision: 'GO condicionado', risk: 'Medio' } }), created_at: '2026-07-14T10:01:00.000Z', psi_sales_profiles: { full_name: 'Ana' } },
      { id: 'prep-1', notes: JSON.stringify({ kind: 'tender_offer_preparation', status: 'preparacion_oferta', checklist_summary: { total: 8, auto_generated: 3, human_required: 2 }, human_required_items: [{ key: 'poliza' }, { key: 'financiero' }], sharepoint_folder: { status: 'pendiente_configurar_integracion', url: null } }), created_at: '2026-07-14T10:02:00.000Z', psi_sales_profiles: { full_name: 'Ana' } }
    ]
  };
  return {
    from(table) {
      assert.equal(table, 'psi_sales_interactions');
      return {
        select() { return this; },
        eq(_field, opportunityId) {
          if (opportunityId === failOpportunityId) return interactionQuery(null, new Error('lectura fallida'));
          return interactionQuery(interactions[opportunityId] || []);
        }
      };
    },
    storage: { from() { return { async createSignedUrl(path) { return { data: { signedUrl: `https://signed.test/${path}` } }; } }; } }
  };
}

const tender = { stable_key: 'SECOP-good', source: 'SECOP II', entity: 'Entidad', title: 'Servicio de vigilancia', converted_opportunity_id: 'good' };
const success = await buildTenderDossierSummary(mockDatabaseByOpportunity(), tender);
assert.equal(success.opportunity_id, 'good');
assert.equal(success.document_count, 1, 'solo cuenta documentos vigentes');
assert.equal(success.missing_document_count, 1);
assert.equal(success.document_import_status, 'analisis_generado');
assert.equal(success.go_no_go, 'GO condicionado');
assert.equal(success.risk, 'Medio');
assert.deepEqual(success.checklist_progress, { total: 8, auto_generated: 3, human_required: 2 });
assert.equal(success.preparation_status, 'preparacion_oferta');
assert.equal(success.human_pending_count, 2);
assert.equal(success.sharepoint_status, 'pendiente_configurar_integracion');
assert.equal(success.sharepoint_url, null);
assert.equal(success.dossier_error, null);

const failed = await buildTenderDossierSummary(mockDatabaseByOpportunity({ failOpportunityId: 'broken' }), { ...tender, stable_key: 'SECOP-broken', converted_opportunity_id: 'broken' });
assert.equal(failed.opportunity_id, 'broken');
assert.equal(failed.dossier_error, 'No se pudo cargar el expediente.');
assert.equal(failed.document_import_status, 'error');
assert.equal(failed.document_count, 0);

console.log('tender dossier API contract and aggregation behavior passed');
