import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('../src/tenders/TenderProfilesView.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/013_tender_search_profiles.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.psi_tender_search_profiles/, 'Debe existir tabla para persistir perfiles de búsqueda');
assert.match(migration, /region_key text not null default 'todas'/, 'El perfil debe persistir región');
assert.match(migration, /unique\s*\(name\)/i, 'No deben duplicarse nombres de perfiles');
assert.match(api, /app\.get\('\/api\/tender-search-profiles'/, 'Debe existir endpoint GET de perfiles');
assert.match(api, /app\.post\('\/api\/tender-search-profiles'/, 'Debe existir endpoint POST de perfiles');
assert.match(api, /app\.delete\('\/api\/tender-search-profiles\/:id'/, 'Debe existir endpoint DELETE de perfiles');
assert.match(profiles, /loadProfiles/, 'Perfiles debe cargar perfiles guardados desde su propia vista.');
assert.match(profiles, /\/api\/tender-company-profile/, 'Perfiles debe cargar la ficha corporativa.');
assert.match(profiles, /\/api\/tender-search-profiles/, 'Perfiles debe consumir los perfiles guardados.');
assert.doesNotMatch(profiles, /\/api\/tenders/, 'Perfiles nunca debe cargar la cola del Radar.');
assert.match(profiles, /profileRadarHash/, 'Aplicar debe construir la URL del Radar desde el id persistido.');
assert.match(profiles, /Aplicar en Radar/);
assert.match(radar, /profileId/, 'Radar debe leer el perfil solicitado en el hash.');
assert.match(radar, /loadProfiles/, 'Radar debe leer el perfil guardado antes de filtrar la cola.');
assert.doesNotMatch(main, /loadSearchProfiles|saveCurrentSearchProfile|applySearchProfile/, 'main no debe retener la lógica de perfiles migrada.');

console.log('Tender search profile isolation and URL handoff passed');
