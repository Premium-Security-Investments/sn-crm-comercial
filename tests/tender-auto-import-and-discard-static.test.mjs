import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
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
  assert(file.includes("app.post('/api/tender-opportunity-discard'"), 'Debe existir endpoint Vercel-safe para sacar/descartar una licitación ya convertida a oportunidad.');
  assert(file.includes('markTenderOpportunityDiscarded'), 'Descartar oportunidad debe marcar oportunidad y licitación de origen sin borrar trazabilidad.');
  assert(file.includes('callTenderOpportunityDiscard'), 'Sacar de oportunidad debe usar el RPC combinado atómico.');
  assert(!file.includes("markTenderOpportunityDiscarded(database, opportunityId, currentProfile, reason) {\n  await ensureTenderOpportunity(database, opportunityId, currentProfile);\n  const notes = String(reason || 'Descartada después de revisión documental / comercial.').trim();\n  await must(database.from('psi_sales_opportunities').update"), 'Sacar de oportunidad no puede actualizar la oportunidad fuera del RPC atómico.');
  assert(file.includes('expected_tracking_updated_at: tender?.tracking_updated_at ?? null'), 'Sacar de oportunidad debe pasar el último token de seguimiento al RPC atómico.');
}

assert(opportunities.includes('Actualizar documentos') && documents.includes('Actualizar documentos'), 'La UI debe permitir actualizar documentos oficiales desde la bandeja y el detalle.');
assert(src.includes('/api/tender-documents-import'), 'El frontend debe llamar el endpoint de importación automática/manual.');
assert(src.includes('Sacar de oportunidad'), 'El detalle debe tener acción para sacar una licitación no óptima de oportunidades.');
assert(src.includes('/api/tender-opportunity-discard'), 'El frontend debe llamar el endpoint seguro para descartar oportunidad de licitación.');
assert(conversionViews.includes('Documentos oficiales importados'), 'La UI debe comunicar que la carga automática ocurrió al convertir.');
assert(documents.includes('complementarios'), 'La carga manual debe quedar como complemento, no flujo principal.');

console.log('tender auto import and discard static checks passed');
