import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/013_tender_search_profiles.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.psi_tender_search_profiles/, 'Debe existir tabla para persistir perfiles de búsqueda');
assert.match(migration, /region_key text not null default 'todas'/, 'El perfil debe persistir región');
assert.match(migration, /unique\s*\(name\)/i, 'No deben duplicarse nombres de perfiles');
assert.match(api, /app\.get\('\/api\/tender-search-profiles'/, 'Debe existir endpoint GET de perfiles');
assert.match(api, /app\.post\('\/api\/tender-search-profiles'/, 'Debe existir endpoint POST de perfiles');
assert.match(api, /app\.delete\('\/api\/tender-search-profiles\/:id'/, 'Debe existir endpoint DELETE de perfiles');
assert.match(main, /loadSearchProfiles/, 'El frontend debe cargar perfiles guardados');
assert.match(main, /saveCurrentSearchProfile/, 'El frontend debe guardar el perfil actual');
assert.match(main, /applySearchProfile/, 'El frontend debe aplicar perfiles guardados');
assert.match(main, /api<TenderSearchProfile\[]>\('\/api\/tender-search-profiles'\)/, 'El frontend debe consumir el GET de perfiles');

console.log('Tender search profiles persistence expectations passed');
