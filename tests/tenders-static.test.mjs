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
assert(src.includes('Crear oportunidad'), 'Licitaciones debe permitir convertir una licitación en oportunidad.');
assert(src.includes('createOpportunityFromTender'), 'Frontend debe tener acción createOpportunityFromTender para convertir licitación.');
assert(src.includes("service_type_code: 'licitacion_publica'"), 'La oportunidad creada desde licitación debe quedar como servicio Licitación Pública.');
assert(src.includes("stage_code: 'prospecto'"), 'La oportunidad creada desde licitación debe entrar como Prospecto.');
assert(src.includes('findTenderOwner'), 'Frontend debe asignar la oportunidad a Katherine o al usuario de licitaciones.');
assert(src.includes("api<{id:string}>('/api/opportunities'"), 'La conversión debe usar el endpoint existente de creación de oportunidades.');
assert(!src.includes('disabled title="Fase 2"'), 'El botón Crear oportunidad en Licitaciones ya no debe estar deshabilitado como fase futura.');

for (const file of [server, api]) {
  assert(file.includes('canViewTenders'), 'API debe tener guard canViewTenders.');
  assert(file.includes("app.get('/api/tenders'"), 'API debe exponer GET /api/tenders.');
  assert(file.includes('directora.licitaciones@seguridadnacional.co'), 'API debe autorizar a Katherine por email.');
  assert(file.includes('Solo dirección o licitaciones puede ver este radar.'), 'API debe responder 403 para perfiles no autorizados.');
  assert(file.includes('fetchSecopSource'), 'API debe consultar SECOP para poblar radar de licitaciones.');
  assert(file.includes('section: classifyTenderSection'), 'API debe clasificar licitaciones en hacer/revisar/descartar.');
}

console.log('tenders static checks passed');
