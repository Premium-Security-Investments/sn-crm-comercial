import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const tracking = readFileSync(new URL('../src/tenders/TenderTrackingView.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
const tabsSource = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(moduleSource, /<TenderRadarView/);
assert.match(moduleSource, /<TenderTrackingView/);
assert.match(moduleSource, /<TenderDossiersView/);
assert.match(moduleSource, /<TenderProfilesView/);
assert.match(moduleSource, /\{props\.view === 'seguimiento' && <TenderTrackingView \{\.\.\.props\} \/>\}/, 'Seguimiento debe ser una vista independiente y no recibir renderLegacy.');
assert.match(moduleSource, /renderLegacy/, 'Expedientes y perfiles aún conservan el adaptador transitorio.');
assert.match(apiSource, /export async function loadRadar/);
assert.match(apiSource, /export async function loadTracking/);
assert.match(apiSource, /export async function loadDossiers/);
assert.match(apiSource, /export async function loadProfiles/);
assert.match(tabsSource, /navigate\(hash\)/, 'Tabs must navigate through the callback supplied by the module.');
assert.match(tabsSource, /Radar de oportunidades/);
assert.match(tabsSource, /Seguimiento/);
assert.match(tabsSource, /Expedientes/);
assert.match(tabsSource, /Perfiles de búsqueda/);
assert.match(main, /<TendersModule/);
assert.match(main, /renderLegacy=\{\(\) => <TendersRadar/);
assert.match(main, /import type \{ TenderModuleView \} from '\.\/tenders\/types';/, 'main must use the tender module view type from the authoritative module types.');
assert.doesNotMatch(main, /type TenderModuleView =/, 'main must not redeclare the tender module view union locally.');
assert.doesNotMatch(moduleSource, /TenderUnifiedBoard/);

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
const trackingConvert = tracking.match(/const convert = async \(tender: PublicTender\) => \{[\s\S]*?\n  \};\n\n  if \(loading\)/);
assert.ok(trackingConvert, 'Seguimiento debe conservar su flujo de conversión.');
assert.doesNotMatch(trackingConvert[0], /navigate\(`#\/detail\/\$\{result\.id\}`\)/, 'Seguimiento no debe navegar automáticamente antes de que el usuario lea el resultado documental.');
assert.match(radar, /Abrir oportunidad/, 'Radar debe dejar una acción explícita para abrir la oportunidad tras confirmar el resultado documental.');
assert.doesNotMatch(radar, /sessionStorage\./, 'Radar tampoco debe escribir estado documental sin un lector.');
const radarConvert = radar.match(/const convert = async \(tender: PublicTender\) => \{[\s\S]*?\n  \};\n\n  const deduped/);
assert.ok(radarConvert, 'Radar debe conservar su flujo de conversión.');
assert.doesNotMatch(radarConvert[0], /navigate\(`#\/detail\/\$\{result\.id\}`\)/, 'Radar no debe navegar automáticamente antes de que el usuario lea el resultado documental.');
assert.match(tracking, /No hay procesos en seguimiento\. Selecciónelos desde Radar\./);
assert.match(tracking, /Seguimiento desactualizado/);
assert.doesNotMatch(tracking, /renderLegacy|Sincronizar fuentes oficiales|TenderCard/);
assert.doesNotMatch(tracking, /event_type\s*:/, 'El navegador no debe elegir el tipo de evento; el servidor lo deriva.');

const bundled = buildSync({
  entryPoints: [new URL('../src/tenders/trackingUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { daysSince, matchesTrackingFilter } = await import(utilsUrl);
const now = new Date('2026-07-14T12:00:00.000Z');
assert.equal(daysSince('2026-07-11T12:00:00.000Z', now), 3, 'Inactividad debe calcular días completos sin gestión.');
assert.equal(daysSince(null, now), null, 'Una fila sin revisión no debe inventar días de inactividad.');
assert.equal(daysSince('invalid-date', now), null, 'Una fecha inválida no debe producir una inactividad falsa.');
const row = { tracking_status: 'bloqueado', tracking_owner_id: 'owner-1', tracking_blocker: 'Falta certificado' };
assert.equal(matchesTrackingFilter(row, { status: 'bloqueado', owner: 'owner-1', semaphore: 'rojo' }), true, 'Los filtros operativos deben combinar estado, responsable y semáforo.');
assert.equal(matchesTrackingFilter(row, { status: 'analizando', owner: 'todas', semaphore: 'todas' }), false, 'Un estado distinto debe excluir la fila.');

console.log('independent tender tracking behavior passed');
