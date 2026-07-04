import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('listEsuDocumentsFromProcessUrl'), 'Debe existir importador de documentos ESU desde /procesos/view/<id>.');
  assert(file.includes('downloadEsuDocument'), 'Debe descargar documentos ESU oficiales desde /procesos/descargar/...');
  assert(file.includes("source: 'ESU Contratación'"), 'La interacción documental debe identificar fuente ESU Contratación.');
  assert(file.includes("tender.source === 'ESU Contratación'"), 'La conversión a oportunidad debe disparar importación automática para ESU.');
  assert(file.includes('community.secop.gov.co') && file.includes('esucontratacion.com'), 'El importador oficial debe soportar SECOP II y ESU, no solo SECOP.');
  assert(!file.includes('La importación automática solo está disponible para enlaces SECOP II'), 'El mensaje no debe bloquear ESU como carga manual.');
  assert(file.includes('Error al importar desde ESU'), 'Los errores por documento ESU deben quedar visibles sin tumbar todo el lote.');
  assert(file.includes('buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile)'), 'ESU debe reutilizar el análisis documental persistente existente con ficha/RUP.');
}

assert(src.includes('Importar/Reintentar documentos oficiales'), 'La UI debe hablar de documentos oficiales, no solo SECOP.');
assert(src.includes('Documentos oficiales importados automáticamente'), 'La UI debe mantener comunicación de importación automática.');

console.log('ESU document import static checks passed');
