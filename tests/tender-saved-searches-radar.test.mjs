import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
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

console.log('Tender saved searches are managed inside Radar');
