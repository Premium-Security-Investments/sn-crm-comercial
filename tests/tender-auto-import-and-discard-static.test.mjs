import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const apiClient = readFileSync(new URL('../src/apiClient.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const opportunities = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
const documents = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const conversionViews = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8') + readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('refreshTenderDocumentsFromOfficialSource'), 'Al convertir licitación debe existir actualización automática de documentos oficiales.');
  assert(file.includes('resolveSecopProcessByExactUrl'), 'La importación SECOP debe resolver por urlproceso/noticeUID exacto, no por número suelto.');
  assert(file.includes('SECOP_DOCUMENTS_RESOURCE'), 'Debe consultar el dataset oficial de documentos SECOP II.');
  assert(file.includes('auto_import: true'), 'Los documentos importados automáticamente deben quedar marcados como auto_import.');
  assert(file.includes('buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile)'), 'La conversión debe reutilizar el análisis documental persistente existente con ficha/RUP.');
  assert(file.includes("app.post('/api/tender-documents-import'"), 'Debe existir endpoint para reintentar importación automática desde el detalle.');
  assert(file.includes("app.post('/api/tender-opportunity-exit'"), 'Debe existir endpoint Vercel-safe para sacar una licitación hacia Radar o Seguimiento.');
  assert(file.includes('exitTenderOpportunity'), 'La salida debe marcar oportunidad y licitación de origen sin borrar trazabilidad.');
  assert(file.includes('callTenderOpportunityExit'), 'La salida debe usar el RPC combinado atómico.');
  assert(file.includes('expected_tracking_updated_at: tender?.tracking_updated_at ?? null'), 'La salida debe pasar el último token de seguimiento al RPC atómico.');
}

assert(opportunities.includes('Actualizar documentos') && documents.includes('Actualizar documentos'), 'La UI debe permitir actualizar documentos oficiales desde la bandeja y el detalle.');
assert(src.includes('/api/tender-documents-import'), 'El frontend debe llamar el endpoint de importación automática/manual.');
assert(src.includes('Sacar de oportunidad'), 'El detalle debe tener acción para sacar una licitación no óptima de oportunidades.');
assert(apiClient.includes('/api/tender-opportunity-exit'), 'El cliente frontend debe llamar el endpoint seguro para elegir Radar o Seguimiento.');
assert(conversionViews.includes('Documentos oficiales importados'), 'La UI debe comunicar que la carga automática ocurrió al convertir.');
assert(documents.includes('complementarios'), 'La carga manual debe quedar como complemento, no flujo principal.');

console.log('tender auto import and discard static checks passed');
