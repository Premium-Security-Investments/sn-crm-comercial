import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../src/navPermissions.ts', import.meta.url), 'utf8');
const module = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');
const opportunities = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
const configuration = readFileSync(new URL('../src/tenders/TenderConfigurationView.tsx', import.meta.url), 'utf8');
const radarUtils = readFileSync(new URL('../src/tenders/radarUtils.ts', import.meta.url), 'utf8');
const tenderApi = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
const viewUtils = readFileSync(new URL('../src/tenders/viewUtils.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const documentSection = readFileSync(new URL('../src/tenders/components/TenderDocumentSection.tsx', import.meta.url), 'utf8');
const analysisSection = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');

assert.ok(main.includes("'tenders'") && nav.includes("#/tenders?view=radar"), 'Frontend debe incluir la ruta y el catálogo central de Licitaciones.');
assert.match(nav, /tenders: 'licitaciones'/, 'Licitaciones debe mapearse a su capability central.');
assert.match(nav, /export function canViewTenders[\s\S]{0,100}hasModuleAccess\(profile, 'licitaciones'\)/, 'Licitaciones debe protegerse por capability central y no por un email hardcoded.');
assert.match(main, /getVisibleNavGroups\(currentProfile\)[\s\S]{0,420}group\.items\.map\(item/, 'El sidebar debe renderizar el catálogo filtrado por capability.');
const navRenderer = main.slice(main.indexOf('function Nav('), main.indexOf('function RouterView'));
assert.doesNotMatch(navRenderer, /href="#\/tenders\?view=radar"|directora\.licitaciones@seguridadnacional\.co/, 'El renderer del sidebar no debe duplicar enlace ni autorización nominal de Licitaciones.');
assert.ok(main.includes('tenderViewFromHash()'), 'La vista de Licitaciones debe derivarse de la URL.');

for (const [view, component] of [['radar', 'TenderRadarView'], ['seguimiento', 'TenderTrackingView'], ['oportunidades', 'TenderOpportunitiesView']]) {
  assert.ok(module.includes(`props.view === '${view}' && <${component}`), `${view} debe tener un componente independiente.`);
  assert.ok(tabs.includes(`view: '${view}'`), `${view} debe estar disponible en la navegación interna.`);
}
assert.ok(module.includes("props.view === 'configuracion' && <TenderConfigurationView"), 'Configuración debe conservar su vista fuera de las tabs primarias.');
assert.ok(!tabs.includes("view: 'configuracion'"), 'Configuración no debe aparecer en las tabs primarias.');
assert.ok(!module.includes('renderLegacy') && !main.includes('TenderUnifiedBoard') && !main.includes('TendersRadar'), 'No debe quedar el tablero monolítico legacy.');

for (const marker of ["loadRadar<TenderRadarPayload>(request)", "'/api/tender-refresh'", "'/api/tender-convert'", 'Sincronizar fuentes oficiales', 'Abrir fuente', 'diagnostics', 'Cierre más próximo', 'className="pagination"']) {
  assert.ok(radar.includes(marker), `Radar debe conservar el contrato operativo: ${marker}`);
}
assert.ok(radar.includes('document_import_status') && radar.includes('document_import_error') && radar.includes('Abrir oportunidad'), 'Radar debe confirmar el resultado documental antes de navegar.');
assert.ok(radarUtils.includes('TENDER_OFFICIAL_SOURCES') && radarUtils.includes('ESU Contratación'), 'Radar debe conservar el catálogo multifuente oficial.');
assert.ok(radarUtils.includes('deduplicateTenders') && radarUtils.includes('sortTenderCards'), 'Radar debe deduplicar y ordenar resultados.');

assert.ok(tracking.includes('loadTracking<PublicTender[]>') && tenderApi.includes("'/api/tender-tracking'") && tracking.includes('expected_tracking_updated_at'), 'Seguimiento debe usar la cola y concurrencia optimista.');
assert.ok(tracking.includes('Abrir oportunidad') && tracking.includes('document_import_status'), 'Seguimiento debe confirmar estado documental antes de navegar.');
assert.ok(opportunities.includes("'/api/tender-documents-import'") && opportunities.includes('focus=documents'), 'Oportunidades debe reutilizar importación protegida y abrir el foco documental.');
assert.ok(configuration.includes('loadCompanyProfile') && !configuration.includes("'/api/tenders'"), 'Configuración no debe cargar el Radar.');
assert.doesNotMatch(configuration, /tender-search-profiles|profileRadarHash/, 'Configuración no debe gestionar perfiles de búsqueda.');
assert.ok(radar.includes('TenderSavedSearches') && viewUtils.includes('view=radar&profile=${encodeURIComponent(profileId)}'), 'Un perfil guardado debe aplicarse mediante URL codificada al Radar.');

for (const marker of ['TenderDocumentReviewPanel', 'TenderOfferPreparationPanel']) assert.ok(main.includes(marker), `El detalle protegido debe conservar: ${marker}`);
assert.ok(documentSection.includes('Documentos vigentes del proceso'), 'El detalle debe conservar la revisión documental extraída.');
assert.ok(analysisSection.includes('Generar análisis preliminar'), 'El detalle debe conservar la acción separada de análisis.');
for (const handler of [server, api]) {
  assert.ok(handler.includes("if (!process.env.VERCEL)") && handler.includes('app.listen(port'), 'El handler debe arrancar localmente sin abrir un puerto dentro de Vercel.');
  assert.ok(handler.includes("app.post('/api/tender-convert'"), 'Backend debe conservar conversión protegida.');
  assert.ok(handler.includes("app.post('/api/tender-refresh'"), 'Backend debe conservar sincronización oficial.');
  assert.ok(handler.includes("app.get('/api/tender-dossiers'"), 'Backend debe exponer expedientes protegidos.');
  assert.ok(handler.includes('service_type_code'), 'Conversión debe conservar el tipo de oportunidad de licitación.');
}
assert.equal(server, api, 'Los dos handlers deben permanecer byte-idénticos.');

console.log('modern independent tender module static checks passed');
