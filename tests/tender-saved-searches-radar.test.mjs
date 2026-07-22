import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const radarPath = new URL('../src/tenders/TenderRadarView.tsx', import.meta.url);
const radar = readFileSync(radarPath, 'utf8');
const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const savedSearchesPath = new URL('../src/tenders/components/TenderSavedSearches.tsx', import.meta.url);

assert.ok(existsSync(savedSearchesPath), 'Radar debe tener un componente propio para búsquedas guardadas.');
const savedSearches = readFileSync(savedSearchesPath, 'utf8');

assert.match(radar, /<TenderSavedSearches/);
assert.match(savedSearches, />Guardar búsqueda</);
assert.match(savedSearches, />Búsquedas guardadas</);
assert.match(savedSearches, /\/api\/tender-search-profiles/);
assert.doesNotMatch(savedSearches, /tender-company-profile|RUP|Información empresa/);
assert.match(moduleSource, /props\.view === 'configuracion' && <TenderProfilesView/, 'Configuración debe seguir montando la ficha corporativa fuera de los tabs.');
assert.match(savedSearches, /window\.confirm/, 'Eliminar debe exigir confirmación.');
assert.match(savedSearches, /onApply\(/, 'Aplicar debe actualizar los filtros del Radar mediante callback.');
assert.doesNotMatch(savedSearches, /\bnavigate\b/, 'Aplicar no debe navegar fuera del Radar.');

assert.match(radar, /export async function loadRadarAndProfiles/, 'Radar debe tener una carga coordinada que degrade perfiles sin ocultar sus resultados.');
assert.match(radar, /Promise\.allSettled/, 'La carga de Radar y perfiles debe esperar resultados independientes.');
assert.match(radar, /profilesError/, 'El error de perfiles debe conservarse para mostrarlo dentro del panel secundario.');
assert.match(savedSearches, /onProfilesChange\(current =>/, 'Las respuestas async deben actualizar perfiles desde el estado actual, no desde una prop capturada.');
assert.match(savedSearches, /deletingIds/, 'Cada borrado debe tener estado ocupado independiente.');
assert.match(savedSearches, /disabled=\{deletingIds\.has\(profile\.id\)\}/, 'Solo la fila que se está borrando debe quedar deshabilitada.');

const radarBundle = buildSync({
  entryPoints: [radarPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false,
});
const radarUrl = `data:text/javascript;base64,${Buffer.from(radarBundle.outputFiles[0].contents).toString('base64')}`;
const { loadRadarAndProfiles } = await import(radarUrl);
const radarPayload = { generatedAt: '2026-07-22T00:00:00.000Z', totals: { all: 0, hacer: 0, revisar: 0, descartar: 0, highValue: 0, urgent: 0 }, tenders: [] };
const degraded = await loadRadarAndProfiles(
  () => Promise.resolve(radarPayload),
  () => Promise.reject(new Error('Perfiles temporalmente no disponibles')),
);
assert.equal(degraded.radar, radarPayload, 'Un fallo de perfiles no debe descartar el payload ya cargado del Radar.');
assert.deepEqual(degraded.profiles, [], 'Un fallo de perfiles debe degradar el panel a una lista vacía.');
assert.equal(degraded.profilesError, 'Perfiles temporalmente no disponibles', 'El panel debe recibir un error no bloqueante de perfiles.');
await assert.rejects(
  () => loadRadarAndProfiles(() => Promise.reject(new Error('Radar no disponible')), () => Promise.resolve([])),
  /Radar no disponible/,
  'Solo el fallo del Radar puede bloquear el Radar.',
);

const savedSearchesBundle = buildSync({
  entryPoints: [savedSearchesPath.pathname], bundle: true, platform: 'node', format: 'esm', write: false,
});
const savedSearchesUrl = `data:text/javascript;base64,${Buffer.from(savedSearchesBundle.outputFiles[0].contents).toString('base64')}`;
const { buildTenderSearchProfilePayload, prependTenderSearchProfile, removeTenderSearchProfile } = await import(savedSearchesUrl);
const filters = {
  query: 'CCTV Bogotá', source: 'SECOP II', region: 'bog_cundinamarca', deadline: '0_7', value: '500m_plus', score: 'alto', section: 'hacer', internalStatus: 'en_revision',
};
assert.deepEqual(buildTenderSearchProfilePayload(' CCTV crítico ', filters), {
  name: 'CCTV crítico', region_key: 'bog_cundinamarca', source_filter: 'SECOP II', section_filter: 'hacer', internal_status_filter: 'en_revision', deadline_filter: '0_7', value_filter: '500m_plus', score_filter: 'alto', query_text: 'CCTV Bogotá',
}, 'Guardar debe enviar el payload completo de nombre y los ocho filtros activos.');

const profileA = { id: 'A', name: 'A' };
const profileB = { id: 'B', name: 'B' };
const profileC = { id: 'C', name: 'C' };
let currentProfiles = [profileA, profileB];
const setProfiles = updater => { currentProfiles = typeof updater === 'function' ? updater(currentProfiles) : updater; };
const deleteAResponse = Promise.resolve().then(() => setProfiles(current => removeTenderSearchProfile(current, 'A')));
const deleteBResponse = Promise.resolve().then(() => setProfiles(current => removeTenderSearchProfile(current, 'B')));
await Promise.all([deleteBResponse, deleteAResponse]);
assert.deepEqual(currentProfiles, [], 'Borrados completados fuera de orden no pueden resucitar perfiles eliminados.');
setProfiles([profileA]);
const saveCResponse = Promise.resolve().then(() => setProfiles(current => prependTenderSearchProfile(current, profileC)));
const deleteAAfterSave = Promise.resolve().then(() => setProfiles(current => removeTenderSearchProfile(current, 'A')));
await Promise.all([deleteAAfterSave, saveCResponse]);
assert.deepEqual(currentProfiles, [profileC], 'Guardar y borrar concurrentes deben componer sobre el estado actual sin reintroducir elementos.');

console.log('Tender saved searches are managed inside Radar with independent degradation and async-safe updates');
