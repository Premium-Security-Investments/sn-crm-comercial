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
assert(src.includes("api<{id:string}>('/api/tender-convert'"), 'La conversión debe usar alias Vercel-safe /api/tender-convert para bloquear duplicados y marcar convertido.');
assert(src.includes("api<TenderRadarPayload>('/api/tender-refresh'"), 'La sincronización debe usar alias Vercel-safe /api/tender-refresh.');
assert(src.includes('api<PublicTender>(`/api/tender-status'), 'Los estados internos deben usar alias Vercel-safe /api/tender-status.');
assert(!src.includes('disabled title="Fase 2"'), 'El botón Crear oportunidad en Licitaciones ya no debe estar deshabilitado como fase futura.');
assert(src.includes('TenderInternalStatus'), 'Frontend debe modelar estado interno de licitación.');
assert(src.includes('markTenderStatus'), 'Frontend debe permitir marcar En revisión / Descartada.');
assert(src.includes('converted_opportunity_id'), 'Frontend debe mostrar licitaciones ya convertidas con enlace a oportunidad.');
assert(!src.includes('Radar público SECOP'), 'Frontend no debe amarrar el módulo solo a SECOP.');
assert(src.includes('Radar de Licitaciones Públicas'), 'Frontend debe presentar el radar como multifuente.');
assert(src.includes('Sincronizar fuentes'), 'Frontend debe tener acción explícita de sincronización multifuente.');
assert(!src.includes('Sincronizar SECOP'), 'El botón ya no debe decir Sincronizar SECOP.');
assert(src.includes('Abrir fuente'), 'Frontend debe abrir la fuente genérica, no solo SECOP.');
assert(src.includes('diagnostics'), 'Frontend debe mostrar diagnóstico de fuentes, incluyendo TVEC temporalmente no disponible.');
assert(src.includes('Estado interno'), 'Frontend debe mostrar/filtar estado interno.');

for (const file of [server, api]) {
  assert(file.includes('canViewTenders'), 'API debe tener guard canViewTenders.');
  assert(file.includes("app.get('/api/tenders'"), 'API debe exponer GET /api/tenders.');
  assert(file.includes("app.post('/api/tenders/refresh'"), 'API debe exponer POST /api/tenders/refresh para persistir radar.');
  assert(file.includes("app.post('/api/tender-refresh'"), 'API debe exponer alias Vercel-safe POST /api/tender-refresh.');
  assert(file.includes("app.patch('/api/tenders/:id/status'"), 'API debe exponer PATCH /api/tenders/:id/status.');
  assert(file.includes("app.patch('/api/tender-status'"), 'API debe exponer alias Vercel-safe PATCH /api/tender-status.');
  assert(file.includes("app.post('/api/tenders/convert'"), 'API debe exponer POST /api/tenders/convert.');
  assert(file.includes("app.post('/api/tender-convert'"), 'API debe exponer alias Vercel-safe POST /api/tender-convert.');
  assert(file.includes('directora.licitaciones@seguridadnacional.co'), 'API debe autorizar a Katherine por email.');
  assert(file.includes('Solo dirección o licitaciones puede ver este radar.'), 'API debe responder 403 para perfiles no autorizados.');
  assert(file.includes('fetchSecopSource'), 'API debe consultar SECOP para poblar radar de licitaciones.');
  assert(file.includes('fetchTvecEvents'), 'API debe consultar TVEC como tercera fuente activa.');
  assert(file.includes('TVEC_RELEVANT_AGGREGATIONS'), 'API debe declarar instrumentos TVEC relevantes.');
  assert(file.includes('TVEC no disponible temporalmente'), 'API debe diagnosticar falla temporal de TVEC sin tumbar SECOP.');
  assert(file.includes('Promise.allSettled'), 'API debe tolerar errores por fuente sin romper todo el radar.');
  assert(file.includes('section: classifyTenderSection'), 'API debe clasificar licitaciones en hacer/revisar/descartar.');
  assert(file.includes('psi_public_tenders'), 'API debe usar tabla psi_public_tenders para historizar licitaciones.');
  assert(file.includes('psi_tender_radar_runs'), 'API debe registrar ejecuciones en psi_tender_radar_runs.');
  assert(file.includes('tenderTableAvailable'), 'API debe tener fallback si la migración aún no existe.');
  assert(file.includes('external_source: `secop_radar:${tender.source}:${stableTenderKey(tender)}`'), 'Conversión debe usar external_source estable para prevenir duplicados.');
  assert(file.includes('converted_opportunity_id'), 'Conversión debe marcar la licitación con opportunity_id.');
}

console.log('tenders static checks passed');
