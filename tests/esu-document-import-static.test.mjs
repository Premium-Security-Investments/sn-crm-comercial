import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const documents = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const conversionViews = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8') + readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');
const sharedCrawler = readFileSync(new URL('../esu-direct-crawl.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes('listEsuDocumentsFromProcessUrl'), 'Debe existir importador de documentos ESU desde /procesos/view/<id>.');
  assert(file.includes('downloadEsuDocument'), 'Debe descargar documentos ESU oficiales desde /procesos/descargar/...');
  assert(file.includes('safeOfficialFetch') && file.includes('validateOfficialHttpsUrl'), 'Toda descarga oficial debe validar host/ruta/DNS antes de red y revalidar redirects.');
  assert(!/downloadEsuDocument[\s\S]{0,300}fetch\(doc\.url/.test(file), 'ESU no debe usar fetch directo sobre href del HTML.');
  assert(!/downloadSecopDocument[\s\S]{0,350}fetch\(doc\.url_descarga_documento\.url/.test(file), 'SECOP no debe usar fetch directo sobre URL entregada por datos.gov.');
  assert(file.includes("source: 'ESU Contratación'"), 'La interacción documental debe identificar fuente ESU Contratación.');
  assert(file.includes("canonicalTender.source === 'ESU Contratación'"), 'La conversión a oportunidad debe disparar importación automática para ESU usando la fuente canónica persistida.');
  assert((file + sharedCrawler).includes('community.secop.gov.co') && (file + sharedCrawler).includes('esucontratacion.com'), 'El importador oficial debe soportar SECOP II y ESU, no solo SECOP.');
  assert(!file.includes('La importación automática solo está disponible para enlaces SECOP II'), 'El mensaje no debe bloquear ESU como carga manual.');
  assert(file.includes("errorPrefix: 'ESU'"), 'Los errores por documento ESU deben quedar identificados sin tumbar todo el lote.');
  assert(file.includes('buildTenderDocumentAnalysis(opportunity, currentDocs, companyProfile)'), 'ESU debe reutilizar el análisis documental persistente existente con ficha/RUP.');
}

assert(documents.includes('Actualizar documentos'), 'La UI debe permitir actualizar documentos oficiales sin mezclar el análisis.');
assert(conversionViews.includes('Documentos oficiales importados'), 'La UI debe mantener comunicación de importación automática.');

console.log('ESU document import static checks passed');
