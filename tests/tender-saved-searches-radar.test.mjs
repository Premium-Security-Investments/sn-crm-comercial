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
assert.match(savedSearches, /const \[saveOpen, setSaveOpen\]/, 'Guardar debe iniciar cerrado mediante estado propio.');
assert.match(savedSearches, /const \[libraryOpen, setLibraryOpen\]/, 'La biblioteca debe iniciar cerrada mediante estado propio.');
assert.match(savedSearches, /aria-haspopup="dialog"/, 'Los disparadores deben anunciar que abren dialogs.');
assert.match(savedSearches, /const libraryCloseRef = useRef<HTMLButtonElement \| null>\(null\)/, 'La biblioteca debe conservar una referencia al control de cierre.');
assert.match(savedSearches, /ref=\{libraryCloseRef\}[^>]*aria-label="Cerrar búsquedas guardadas"/, 'Al abrir la biblioteca, el foco debe ir al botón Cerrar, no al título.');
assert.doesNotMatch(savedSearches, /libraryTitleRef/, 'No debe existir una referencia de título obsoleta para el foco inicial.');
assert.match(savedSearches, />Guardar búsqueda</);
assert.match(savedSearches, />Búsquedas guardadas</);
assert.match(savedSearches, /\{libraryOpen && <div className="tender-saved-profiles">/, 'La biblioteca solo debe renderizarse al abrirse.');
assert.doesNotMatch(savedSearches.slice(0, savedSearches.indexOf('{libraryOpen &&')), /tender-saved-profiles/, 'La lista no debe renderizarse antes de su bloque condicionado.');
assert.match(savedSearches, /\/api\/tender-search-profiles/);
assert.doesNotMatch(savedSearches, /tender-company-profile|RUP|Información empresa/);
assert.match(moduleSource, /props\.view === 'configuracion' && <TenderConfigurationView/, 'Configuración debe seguir montando la ficha corporativa fuera de los tabs.');
assert.match(savedSearches, /window\.confirm/, 'Eliminar debe exigir confirmación.');
assert.match(savedSearches, /onApply\(/, 'Aplicar debe actualizar los filtros del Radar mediante callback.');
assert.doesNotMatch(savedSearches, /\bnavigate\b/, 'Aplicar no debe navegar fuera del Radar.');
assert.match(savedSearches, /!saveOpen && !libraryOpen && message && <div className="notice" role="status">\{message\}<\/div>/, 'El éxito solo debe anunciarse fuera cuando ambos diálogos estén cerrados.');
assert.match(savedSearches, /saveOpen && message && <div className="error" role="alert">\{message\}<\/div>/, 'La validación o fallo de Guardar debe ser visible y accesible dentro de su diálogo.');
assert.match(savedSearches, /libraryOpen && message && <div className="error" role="alert">\{message\}<\/div>/, 'El fallo de Eliminar debe ser visible y accesible dentro de la biblioteca activa.');

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
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let currentProfiles = [profileA, profileB];
const setProfiles = updater => { currentProfiles = typeof updater === 'function' ? updater(currentProfiles) : updater; };
const deleteARequest = deferred();
const deleteBRequest = deferred();
const deleteAResponse = deleteARequest.promise.then(() => setProfiles(current => removeTenderSearchProfile(current, 'A')));
const deleteBResponse = deleteBRequest.promise.then(() => setProfiles(current => removeTenderSearchProfile(current, 'B')));
deleteBRequest.resolve();
await deleteBResponse;
assert.deepEqual(currentProfiles, [profileA], 'La respuesta B debe aplicarse antes que la respuesta A.');
deleteARequest.resolve();
await deleteAResponse;
assert.deepEqual(currentProfiles, [], 'Borrados resueltos B antes de A no pueden resucitar perfiles eliminados.');

setProfiles([profileA]);
const saveCPost = deferred();
const deleteAAfterSaveRequest = deferred();
const saveCResponse = saveCPost.promise.then(() => setProfiles(current => prependTenderSearchProfile(current, profileC)));
const deleteAAfterSave = deleteAAfterSaveRequest.promise.then(() => setProfiles(current => removeTenderSearchProfile(current, 'A')));
deleteAAfterSaveRequest.resolve();
await deleteAAfterSave;
assert.deepEqual(currentProfiles, [], 'El borrado debe terminar antes de que complete el POST de guardado.');
saveCPost.resolve();
await saveCResponse;
assert.deepEqual(currentProfiles, [profileC], 'Un POST completado después del borrado debe componer desde el estado actual sin resucitar perfiles.');

console.log('Tender saved searches are managed inside Radar with independent degradation and async-safe updates');
