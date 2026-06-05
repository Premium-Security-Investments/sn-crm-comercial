import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(src.includes("'tenders'"), 'Frontend debe incluir ruta tenders/licitaciones.');
assert(src.includes("#/tenders','Licitaciones'"), 'Sidebar debe incluir pestaña Licitaciones.');
assert(src.includes('canViewTenders'), 'Frontend debe ocultar Licitaciones según rol/persona autorizada.');
assert(src.includes('directora.licitaciones@seguridadnacional.co'), 'Katherine debe estar autorizada explícitamente para ver Licitaciones.');
assert(src.includes('TendersRadar'), 'Frontend debe incluir componente TendersRadar.');
assert(src.includes("api<TenderRadarPayload>('/api/tenders')"), 'Licitaciones debe cargar datos desde /api/tenders.');
assert(src.includes('Crear oportunidad'), 'Licitaciones debe preparar la conexión futura con creación de oportunidad.');

for (const file of [server, api]) {
  assert(file.includes('canViewTenders'), 'API debe tener guard canViewTenders.');
  assert(file.includes("app.get('/api/tenders'"), 'API debe exponer GET /api/tenders.');
  assert(file.includes('directora.licitaciones@seguridadnacional.co'), 'API debe autorizar a Katherine por email.');
  assert(file.includes('Solo dirección o licitaciones puede ver este radar.'), 'API debe responder 403 para perfiles no autorizados.');
  assert(file.includes('fetchSecopSource'), 'API debe consultar SECOP para poblar radar de licitaciones.');
  assert(file.includes('section: classifyTenderSection'), 'API debe clasificar licitaciones en hacer/revisar/descartar.');
}

console.log('tenders static checks passed');
