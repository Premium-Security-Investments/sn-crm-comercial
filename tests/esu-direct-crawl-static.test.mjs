import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../esu-direct-crawl.js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const file of [server, api]) {
  assert(file.includes("from '../esu-direct-crawl.js'"), 'Cada backend debe importar el crawler ESU compartido.');
  assert(!file.includes("const ESU_CONTRATACION_ORIGIN = 'https://esucontratacion.com'"), 'El origen ESU no debe duplicarse en los backends.');
  assert(!file.includes('async function fetchEsuProcesses('), 'El crawler ESU no debe duplicarse en los backends.');
  assert(file.includes('ESU Contratación directo'), 'Diagnóstico debe distinguir ESU directo de respaldo datos.gov.co.');

  const persistMatch = file.match(/async function persistTenderRadar\([\s\S]*?\n}/);
  assert(persistMatch, 'persistTenderRadar debe existir en el backend legacy.');
  const persistBody = persistMatch[0];
  assert(!persistBody.includes('deadline_at: t.deadline || null'), 'persistTenderRadar no debe sobrescribir deadline_at con t.deadline || null porque borra valores ESU autoritativos.');
  assert(!persistBody.includes('status: t.status || null'), 'persistTenderRadar no debe sobrescribir status con t.status || null porque borra valores ESU autoritativos.');
}

assert(shared.includes("const ESU_CONTRATACION_ORIGIN = 'https://esucontratacion.com'"), 'ESU directo debe usar dominio sin www.');
assert(!shared.includes("https://www.esucontratacion.com/procesos/index"), 'ESU no debe usar www porque no resuelve DNS.');
assert(shared.includes('ESU_RELEVANT_CATEGORY_IDS'), 'ESU debe declarar categorías relevantes para recorridos directos.');
assert(shared.includes("'7': 'Tecnología'"), 'ESU debe recorrer categoría Tecnología.');
assert(shared.includes("'8': 'Sistemas integrales de seguridad'"), 'ESU debe recorrer categoría Sistemas integrales de seguridad.');
assert(shared.includes("'9': 'Vigilancia física'"), 'ESU debe recorrer categoría Vigilancia física.');
assert(shared.includes('ESU_RELEVANT_KEYWORDS'), 'ESU debe declarar keywords relevantes para búsqueda directa.');
assert(shared.includes('fetchEsuIndexPages'), 'ESU debe paginar índice, no solo primera página.');
assert(shared.includes('searchEsuProcesses'), 'ESU debe usar el buscador nativo /procesos/buscar.');
assert(shared.includes('fetchEsuProcessDetail'), 'ESU debe enriquecer procesos desde /procesos/view/<id>.');
assert(shared.includes('documents_count') && shared.includes('detail?.documents'), 'ESU debe conservar documentos descargables detectados en detalle.');
assert(shared.includes('procesos\\/descargar') || shared.includes('/procesos/descargar/'), 'ESU debe reconocer links descargables de pliegos/anexos.');

console.log('ESU direct crawl shared-module static checks passed');
