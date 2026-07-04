import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes("const ESU_CONTRATACION_ORIGIN = 'https://esucontratacion.com'"), 'ESU directo debe usar dominio sin www.');
  assert(!file.includes("https://www.esucontratacion.com/procesos/index"), 'ESU no debe usar www porque no resuelve DNS.');
  assert(file.includes('ESU_RELEVANT_CATEGORY_IDS'), 'ESU debe declarar categorías relevantes para recorridos directos.');
  assert(file.includes("'7': 'Tecnología'"), 'ESU debe recorrer categoría Tecnología.');
  assert(file.includes("'8': 'Sistemas integrales de seguridad'"), 'ESU debe recorrer categoría Sistemas integrales de seguridad.');
  assert(file.includes("'9': 'Vigilancia física'"), 'ESU debe recorrer categoría Vigilancia física.');
  assert(file.includes('ESU_RELEVANT_KEYWORDS'), 'ESU debe declarar keywords relevantes para búsqueda directa.');
  assert(file.includes('fetchEsuIndexPages'), 'ESU debe paginar índice, no solo primera página.');
  assert(file.includes('searchEsuProcesses'), 'ESU debe usar el buscador nativo /procesos/buscar.');
  assert(file.includes('fetchEsuProcessDetail'), 'ESU debe enriquecer procesos desde /procesos/view/<id>.');
  assert(file.includes('documents_count') && file.includes('detail?.documents'), 'ESU debe conservar documentos descargables detectados en detalle.');
  assert(file.includes('procesos\\/descargar') || file.includes('/procesos/descargar/'), 'ESU debe reconocer links descargables de pliegos/anexos.');
  assert(file.includes('ESU Contratación directo'), 'Diagnóstico debe distinguir ESU directo de respaldo datos.gov.co.');
}

console.log('ESU direct crawl static checks passed');
