import { strict as assert } from 'node:assert';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const backends = ['../api/[...path].js', '../server/index.js'].map(path =>
  readFileSync(new URL(path, import.meta.url), 'utf8')
);
const tenderApi = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
assert.match(tenderApi, /loadDossiers[\s\S]*?\/api\/tender-dossiers[\s\S]*?limit/);

for (const source of backends) {
  assert.match(source, /app\.get\('\/api\/tender-dossiers'/);
  for (const field of [
    'opportunity_id', 'document_count', 'missing_document_count', 'document_import_status',
    'document_import_error', 'go_no_go', 'risk', 'checklist_progress', 'preparation_status',
    'human_pending_count', 'sharepoint_status', 'sharepoint_url', 'dossier_error'
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

function importedError(created_at = '2026-07-14T10:03:00.000Z') {
  return {
    id: `error-${created_at}`,
    notes: JSON.stringify({
      kind: 'tender_document_import_error',
      source: 'SECOP II',
      error: 'detalle interno de proveedor que no debe exponerse'
    }),
    created_at,
    psi_sales_profiles: { full_name: 'Ana' }
  };
}

const generatedAnalysis = {
  id: 'analysis-1',
  notes: JSON.stringify({
    kind: 'tender_document_analysis',
    status: 'analisis_generado',
    recommendation: 'GO condicionado',
    risk: 'Medio',
    checklist: ['Pendiente póliza', 'Validar RUP'],
    go_no_go: { decision: 'GO condicionado', risk: 'Medio' }
  }),
  created_at: '2026-07-14T10:01:00.000Z',
  psi_sales_profiles: { full_name: 'Ana' }
};

const upload = {
  id: 'upload-1',
  notes: JSON.stringify({ kind: 'tender_document_upload', documents: [
    { id: 'doc-1', name: 'pliego.pdf', current: true, storage_path: 'good/pliego.pdf' },
    { id: 'doc-2', name: 'obsolete.pdf', current: false, storage_path: 'good/obsolete.pdf' }
  ] }),
  created_at: '2026-07-14T10:00:00.000Z',
  psi_sales_profiles: { full_name: 'Ana' }
};

const preparation = {
  id: 'prep-1',
  notes: JSON.stringify({ kind: 'tender_offer_preparation', status: 'preparacion_oferta', checklist_summary: { total: 8, auto_generated: 3, human_required: 2 }, human_required_items: [{ key: 'poliza' }, { key: 'financiero' }], sharepoint_folder: { status: 'pendiente_configurar_integracion', url: null } }),
  created_at: '2026-07-14T10:02:00.000Z',
  psi_sales_profiles: { full_name: 'Ana' }
};

const interactionsByOpportunity = {
  good: [upload, generatedAnalysis, preparation],
  'error-only': [importedError()],
  'non-generated': [upload, { ...generatedAnalysis, id: 'analysis-pending', notes: JSON.stringify({ kind: 'tender_document_analysis', status: 'analisis_pendiente' }), created_at: '2026-07-14T10:02:30.000Z' }, importedError('2026-07-14T10:03:00.000Z')],
  stale: [upload, generatedAnalysis, importedError('2026-07-14T10:04:00.000Z')]
};

function mockDatabaseByOpportunity({ failOpportunityId = null } = {}) {
  return {
    from(table) {
      assert.equal(table, 'psi_sales_interactions');
      return {
        select() { return this; },
        eq(_field, opportunityId) {
          if (opportunityId === failOpportunityId) return interactionQuery(null, new Error('lectura fallida'));
          return interactionQuery(interactionsByOpportunity[opportunityId] || []);
        }
      };
    },
    storage: {
      from() {
        return {
          async createSignedUrl() {
            assert.fail('Los resúmenes de expediente no deben generar URL firmada');
          }
        };
      }
    }
  };
}

const tender = { stable_key: 'SECOP-good', source: 'SECOP II', entity: 'Entidad', title: 'Servicio de vigilancia', converted_opportunity_id: 'good' };

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || '';
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function requestJson(port, path, token = null) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, headers: token ? { authorization: `Bearer ${token}` } : {} }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end();
  });
}

const observed = { tenderQueries: [], ranges: [] };
const fakeSupabase = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth/v1/user') {
    const token = String(getHeader(req, 'authorization')).replace(/^Bearer\s+/i, '');
    if (token === 'manager-token') return json(res, 200, { id: 'manager-user', email: 'manager@example.test' });
    if (token === 'viewer-token') return json(res, 200, { id: 'viewer-user', email: 'viewer@example.test' });
    return json(res, 401, { message: 'invalid token' });
  }
  if (url.pathname === '/rest/v1/psi_sales_profiles') {
    const manager = url.searchParams.get('auth_user_id') === 'eq.manager-user';
    const profile = manager
      ? { id: 'manager-profile', full_name: 'Manager', microsoft_email: 'manager@example.test', role: 'director', active: true }
      : { id: 'viewer-profile', full_name: 'Viewer', microsoft_email: 'viewer@example.test', role: 'comercial', active: true };
    return json(res, 200, getHeader(req, 'accept').includes('vnd.pgrst.object') ? profile : [profile]);
  }
  if (url.pathname === '/rest/v1/psi_profile_area_assignments' || url.pathname === '/rest/v1/psi_profile_permissions') {
    return json(res, 200, []);
  }
  if (url.pathname === '/rest/v1/psi_public_tenders') {
    observed.tenderQueries.push(url.search);
    observed.ranges.push(getHeader(req, 'range'));
    return json(res, 200, [
      { stable_key: 'SECOP-good', source: 'SECOP II', entity: 'Entidad', title: 'Servicio de vigilancia', converted_opportunity_id: 'good', tracking_updated_at: '2026-07-14T12:00:00.000Z', id: 'tender-good' },
      { stable_key: 'SECOP-broken', source: 'SECOP II', entity: 'Entidad rota', title: 'Servicio roto', converted_opportunity_id: 'broken', tracking_updated_at: '2026-07-14T11:00:00.000Z', id: 'tender-broken' }
    ]);
  }
  if (url.pathname === '/rest/v1/psi_sales_interactions') {
    const opportunity = decodeURIComponent(url.searchParams.get('opportunity_id') || '').replace(/^eq\./, '');
    if (opportunity === 'broken') return json(res, 500, { message: 'lectura fallida' });
    return json(res, 200, interactionsByOpportunity[opportunity] || []);
  }
  return json(res, 404, { message: `Unhandled Supabase path ${url.pathname}` });
});

const fakePort = await listen(fakeSupabase);
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${fakePort}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.VERCEL = '1';

const { buildTenderDossierSummary, default: app } = await import('../server/index.js');

const success = await buildTenderDossierSummary(mockDatabaseByOpportunity(), tender);
assert.equal(success.opportunity_id, 'good');
assert.equal(success.document_count, 1, 'solo cuenta documentos vigentes');
assert.equal(success.missing_document_count, 1);
assert.equal(success.document_import_status, 'analisis_generado');
assert.equal(success.document_import_error, null);
assert.equal(success.go_no_go, 'GO condicionado');
assert.equal(success.risk, 'Medio');
assert.deepEqual(success.checklist_progress, { total: 8, auto_generated: 3, human_required: 2 });
assert.equal(success.preparation_status, 'preparacion_oferta');
assert.equal(success.human_pending_count, 2);
assert.equal(success.sharepoint_status, 'pendiente_configurar_integracion');
assert.equal(success.sharepoint_url, null);
assert.equal(success.dossier_error, null);

const importFailed = await buildTenderDossierSummary(mockDatabaseByOpportunity(), { ...tender, stable_key: 'SECOP-error', converted_opportunity_id: 'error-only' });
assert.equal(importFailed.document_import_status, 'fallo_importacion');
assert.match(importFailed.document_import_error, /falló/i);
assert.doesNotMatch(importFailed.document_import_error, /detalle interno de proveedor/i);
assert.equal(importFailed.dossier_error, null);

const nonGeneratedAnalysis = await buildTenderDossierSummary(mockDatabaseByOpportunity(), { ...tender, stable_key: 'SECOP-pending', converted_opportunity_id: 'non-generated' });
assert.equal(nonGeneratedAnalysis.document_import_status, 'fallo_importacion', 'un análisis no generado no oculta el fallo persistido');

const staleAnalysis = await buildTenderDossierSummary(mockDatabaseByOpportunity(), { ...tender, stable_key: 'SECOP-stale', converted_opportunity_id: 'stale' });
assert.equal(staleAnalysis.document_import_status, 'fallo_importacion', 'un error posterior invalida un análisis ya obsoleto');
assert.equal(staleAnalysis.go_no_go, 'Pendiente');

const failed = await buildTenderDossierSummary(mockDatabaseByOpportunity({ failOpportunityId: 'broken' }), { ...tender, stable_key: 'SECOP-broken', converted_opportunity_id: 'broken' });
assert.equal(failed.opportunity_id, 'broken');
assert.equal(failed.dossier_error, 'No se pudo cargar el expediente.');
assert.equal(failed.document_import_status, 'error');
assert.equal(failed.document_count, 0);

const originalConsoleError = console.error;
console.error = () => {};
const appServer = app.listen(0, '127.0.0.1');
await new Promise(resolve => appServer.once('listening', resolve));
const appPort = appServer.address().port;
try {
  const unauthenticated = await requestJson(appPort, '/api/tender-dossiers');
  assert.equal(unauthenticated.status, 401);

  const forbidden = await requestJson(appPort, '/api/tender-dossiers', 'viewer-token');
  assert.equal(forbidden.status, 403);

  const routeSuccess = await requestJson(appPort, '/api/tender-dossiers?limit=2&offset=0', 'manager-token');
  assert.equal(routeSuccess.status, 200);
  assert.equal(routeSuccess.body.length, 2);
  assert.equal(routeSuccess.body[0].document_count, 1);
  assert.equal(routeSuccess.body[1].dossier_error, 'No se pudo cargar el expediente.', 'un expediente fallido no impide los demás');
  const routeQuery = observed.tenderQueries.at(-1);
  assert.ok(routeQuery.includes('converted_opportunity_id=not.is.null'));
  assert.ok(routeQuery.includes('offset=0'));
  assert.ok(routeQuery.includes('limit=2'));

  const defaultPage = await requestJson(appPort, '/api/tender-dossiers', 'manager-token');
  assert.equal(defaultPage.status, 200);
  assert.ok(observed.tenderQueries.at(-1).includes('limit=50'));

  const invalidLimit = await requestJson(appPort, '/api/tender-dossiers?limit=101', 'manager-token');
  assert.equal(invalidLimit.status, 400);
} finally {
  await Promise.all([
    new Promise(resolve => appServer.close(resolve)),
    new Promise(resolve => fakeSupabase.close(resolve))
  ]);
  console.error = originalConsoleError;
}

console.log('tender dossier API contract, bounded route, and failure isolation passed');
