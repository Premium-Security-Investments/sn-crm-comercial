import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const dossiers = readFileSync(new URL('../src/tenders/TenderDossiersView.tsx', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('../src/tenders/TenderProfilesView.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
const tabsSource = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(moduleSource, /<TenderRadarView/);
assert.match(moduleSource, /<TenderTrackingView/);
assert.match(moduleSource, /<TenderDossiersView/);
assert.match(moduleSource, /<TenderProfilesView/);
assert.match(moduleSource, /\{props\.view === 'seguimiento' && <TenderTrackingView \{\.\.\.props\} moduleNavigation=\{moduleNavigation\} \/>\}/, 'Seguimiento debe seguir siendo una vista independiente y solo recibir composición visual compartida.');
assert.doesNotMatch(moduleSource, /renderLegacy/, 'Ninguna de las cuatro vistas puede conservar el adaptador legado.');
assert.match(apiSource, /export async function loadRadar/);
assert.match(apiSource, /export async function loadTracking/);
assert.match(apiSource, /export async function loadDossiers/);
assert.match(apiSource, /export async function loadProfiles/);
assert.match(tabsSource, /navigate\(hash\)/, 'Tabs must navigate through the callback supplied by the module.');
for (const label of ['Radar de oportunidades', 'Seguimiento', 'Expedientes', 'Perfiles de búsqueda']) assert.match(tabsSource, new RegExp(label));
assert.match(main, /<TendersModule/);
assert.doesNotMatch(main, /renderLegacy=/, 'main no debe conservar el renderer del tablero legado.');
assert.doesNotMatch(main, /TendersRadar|TenderUnifiedBoard|TenderSectionPanel|TenderCompanyProfilePanel|TenderSearchProfilesPanel/, 'Los componentes del tablero legado deben retirarse de main.');
assert.match(main, /TenderDocumentReviewPanel/);
assert.match(main, /TenderOfferPreparationPanel/);
assert.match(main, /import type \{ TenderModuleView \} from '\.\/tenders\/types';/, 'main must use the tender module view type from the authoritative module types.');
assert.doesNotMatch(main, /type TenderModuleView =/, 'main must not redeclare the tender module view union locally.');
assert.match(main, /focusDocumentReviewArea/, 'OpportunityDetail must consume the document focus request through the accessible focus helper.');
assert.match(main, /get\('focus'\) === 'documents'/, 'OpportunityDetail must read the focus query parameter passed by Expedientes.');
assert.match(main, /id="tender-document-review"/, 'TenderDocumentReviewPanel needs a stable document-focus anchor.');
assert.match(main, /tabIndex=\{-1\}/, 'The document-focus anchor must be programmatically focusable.');

for (const label of ['Abrir expediente', 'GO / NO GO', 'Documentos', 'Checklist', 'Pendientes humanos', 'SharePoint / OneDrive']) {
  assert.ok(dossiers.includes(label), `Expedientes debe mostrar ${label}`);
}
assert.match(dossiers, /\/api\/tender-documents-import/);
assert.match(dossiers, /loadDossiers/);
assert.match(dossiers, /dossier_error/);
assert.doesNotMatch(dossiers, /Sincronizar fuentes oficiales|TenderCard|renderLegacy/, 'Expedientes no debe reutilizar Radar ni el adaptador legado.');
assert.match(profiles, /\/api\/tender-search-profiles/);
assert.match(profiles, /\/api\/tender-company-profile/);
assert.ok(!profiles.includes("request('/api/tenders"), 'Perfiles no debe cargar Radar.');
assert.match(profiles, /Aplicar en Radar/);
assert.doesNotMatch(profiles, /renderLegacy/);
assert.match(radar, /profile/, 'Radar debe reconocer el perfil de la URL.');

for (const label of ['Responsable', 'Última revisión', 'Próxima acción', 'Fecha compromiso', 'Días sin gestión', 'Bloqueo', 'Nota', 'Historial']) {
  assert.ok(tracking.includes(label), `Seguimiento debe mostrar ${label}`);
}
for (const label of ['Referencia', 'Inicio de seguimiento', 'Cierre del proceso', 'Prioridad / score', 'Riesgos']) {
  assert.ok(tracking.includes(label), `Seguimiento debe mostrar ${label} para que la fila sea operable sin volver a Radar.`);
}
assert.match(apiSource, /\/api\/tender-tracking/);
assert.match(apiSource, /\/api\/tender-tracking-update/);
assert.match(apiSource, /\/api\/tender-tracking-events/);
assert.match(tracking, /\/api\/tender-convert/);
assert.match(tracking, /expected_tracking_updated_at/);
assert.match(tracking, /document_import_status/);
assert.match(tracking, /document_import_error/);
assert.match(tracking, /Abrir oportunidad/, 'La conversión debe dejar una acción explícita para abrir la oportunidad una vez confirmado el estado documental.');
assert.doesNotMatch(tracking, /sessionStorage\./, 'El estado documental no debe escribirse sin un lector; debe mostrarse antes de navegar.');
assert.match(radar, /Abrir oportunidad/, 'Radar debe dejar una acción explícita para abrir la oportunidad tras confirmar el resultado documental.');
assert.doesNotMatch(radar, /sessionStorage\./, 'Radar tampoco debe escribir estado documental sin un lector.');
assert.match(tracking, /No hay procesos en seguimiento\. Selecciónelos desde Radar\./);
assert.match(tracking, /Seguimiento desactualizado/);
assert.doesNotMatch(tracking, /renderLegacy|Sincronizar fuentes oficiales|TenderCard/);
assert.doesNotMatch(tracking, /event_type\s*:/, 'El navegador no debe elegir el tipo de evento; el servidor lo deriva.');

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/viewUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { dossierPageQuery, profileRadarHash, focusDocumentReviewArea, reloadCurrentDossierPage } = await import(utilsUrl);
assert.deepEqual(dossierPageQuery(3, 25), { limit: 25, offset: 50 }, 'La paginación de expedientes debe calcular el offset de la página actual.');
assert.deepEqual(dossierPageQuery(-4, 999), { limit: 100, offset: 0 }, 'La paginación debe acotar páginas y tamaño inválidos.');
assert.equal(profileRadarHash('perfil con espacio'), '#/tenders?view=radar&profile=perfil%20con%20espacio', 'Aplicar un perfil debe preservar su id codificado en la URL del Radar.');
const focused = { scrollIntoViewCalls: [], focusCalls: 0, scrollIntoView(options) { this.scrollIntoViewCalls.push(options); }, focus() { this.focusCalls += 1; } };
assert.equal(focusDocumentReviewArea(focused), true, 'El foco documental debe desplazar y enfocar el área accesible.');
assert.deepEqual(focused.scrollIntoViewCalls, [{ behavior: 'smooth', block: 'start' }]);
assert.equal(focused.focusCalls, 1);
assert.equal(focusDocumentReviewArea(null), false, 'Un detalle sin documentos no debe lanzar al intentar enfocar.');
const reloadCalls = [];
await reloadCurrentDossierPage(3, 25, async query => { reloadCalls.push(query); return ['same-page']; });
assert.deepEqual(reloadCalls, [{ limit: 25, offset: 50 }], 'El reintento debe recargar la misma página local de Expedientes.');
assert.match(dossiers, /await request\('\/api\/tender-documents-import'[\s\S]*await reloadCurrentDossierPage\(\)/, 'La recarga local nombrada debe ocurrir solo después del reintento protegido exitoso.');

console.log('independent tender functional views and behavior passed');
