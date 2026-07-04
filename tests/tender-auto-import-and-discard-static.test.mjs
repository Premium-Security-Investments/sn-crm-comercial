import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('importTenderDocumentsFromOfficialSource'), 'Al convertir licitación debe existir importación automática de documentos oficiales.');
  assert(file.includes('resolveSecopProcessByExactUrl'), 'La importación SECOP debe resolver por urlproceso/noticeUID exacto, no por número suelto.');
  assert(file.includes('SECOP_DOCUMENTS_RESOURCE'), 'Debe consultar el dataset oficial de documentos SECOP II.');
  assert(file.includes('auto_import: true'), 'Los documentos importados automáticamente deben quedar marcados como auto_import.');
  assert(file.includes('buildTenderDocumentAnalysis(opportunity, currentDocs)'), 'La conversión debe reutilizar el análisis documental persistente existente.');
  assert(file.includes("app.post('/api/tender-documents-import'"), 'Debe existir endpoint para reintentar importación automática desde el detalle.');
  assert(file.includes("app.post('/api/tender-opportunity-discard'"), 'Debe existir endpoint Vercel-safe para sacar/descartar una licitación ya convertida a oportunidad.');
  assert(file.includes('markTenderOpportunityDiscarded'), 'Descartar oportunidad debe marcar oportunidad y licitación de origen sin borrar trazabilidad.');
  assert(file.includes("stage_code: 'descartado'"), 'Sacar de oportunidad debe mover la oportunidad a etapa descartado.');
  assert(file.includes("internal_status: 'descartada'"), 'Sacar de oportunidad debe regresar la licitación a estado descartada.');
}

assert(src.includes('Importar/Reintentar documentos SECOP'), 'El detalle debe permitir reintentar importación automática desde SECOP.');
assert(src.includes('/api/tender-documents-import'), 'El frontend debe llamar el endpoint de importación automática/manual.');
assert(src.includes('Sacar de oportunidad'), 'El detalle debe tener acción para sacar una licitación no óptima de oportunidades.');
assert(src.includes('/api/tender-opportunity-discard'), 'El frontend debe llamar el endpoint seguro para descartar oportunidad de licitación.');
assert(src.includes('Documentos oficiales importados automáticamente'), 'La UI debe comunicar que la carga automática ocurrió al convertir.');
assert(src.includes('documentos complementarios'), 'La carga manual debe quedar como complemento, no flujo principal.');

console.log('tender auto import and discard static checks passed');
