import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const profiles = readFileSync(new URL('../src/tenders/TenderProfilesView.tsx', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const savedSearches = readFileSync(new URL('../src/tenders/components/TenderSavedSearches.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/013_tender_search_profiles.sql', import.meta.url), 'utf8');

assert.match(migration, /create table if not exists public\.psi_tender_search_profiles/, 'Debe existir tabla para persistir perfiles de búsqueda');
assert.match(migration, /region_key text not null default 'todas'/, 'El perfil debe persistir región');
assert.match(migration, /unique\s*\(name\)/i, 'No deben duplicarse nombres de perfiles');
assert.match(api, /app\.get\('\/api\/tender-search-profiles'/, 'Debe existir endpoint GET de perfiles');
assert.match(api, /app\.post\('\/api\/tender-search-profiles'/, 'Debe existir endpoint POST de perfiles');
assert.match(api, /app\.delete\('\/api\/tender-search-profiles\/:id'/, 'Debe existir endpoint DELETE de perfiles');
assert.doesNotMatch(profiles, /tender-search-profiles|TenderSearchProfile|profileRadarHash/, 'Configuración/RUP no debe gestionar búsquedas guardadas.');
assert.match(profiles, /\/api\/tender-company-profile/, 'Configuración conserva exclusivamente la ficha corporativa.');
assert.match(radar, /<TenderSavedSearches/, 'Radar debe mostrar el gestor de búsquedas guardadas.');
assert.match(radar, /loadProfiles/, 'Radar debe cargar los perfiles junto con sus datos.');
assert.match(savedSearches, /\/api\/tender-search-profiles/, 'El gestor debe consumir el endpoint existente.');
for (const field of ['query_text', 'source_filter', 'region_key', 'deadline_filter', 'value_filter', 'score_filter', 'section_filter', 'internal_status_filter']) {
  assert.match(radar, new RegExp(`profile\\.${field}`), `Radar debe aplicar el campo persistido ${field}.`);
}
assert.match(radar, /section_filter/, 'Radar debe aplicar la sección persistida del perfil.');
assert.match(radar, /internal_status_filter/, 'Radar debe aplicar el estado interno persistido del perfil.');
assert.match(radar, /Mostrando procesos convertidos/, 'Radar debe explicar que las oportunidades convertidas permanecen visibles.');
assert.match(radar, /view=oportunidades/, 'Radar debe ofrecer navegación explícita a Oportunidades para convertidas.');
assert.doesNotMatch(main, /loadSearchProfiles|saveCurrentSearchProfile|applySearchProfile/, 'main no debe retener la lógica de perfiles migrada.');

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false,
});
const radarUtilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { filterRadarTenders } = await import(radarUtilsUrl);
const candidates = [
  { id: 'new-hacer', source: 'SECOP II', section: 'hacer', internal_status: 'nueva', entity: 'Bogotá', title: 'Nueva', value: 100, score: 80, reasons: [], risks: [] },
  { id: 'review-revisar', source: 'SECOP II', section: 'revisar', internal_status: 'en_revision', entity: 'Bogotá', title: 'Revisión', value: 100, score: 80, reasons: [], risks: [] },
  { id: 'discard-descartar', source: 'SECOP II', section: 'descartar', internal_status: 'descartada', entity: 'Bogotá', title: 'Descartada', value: 100, score: 80, reasons: [], risks: [] },
  { id: 'converted', source: 'SECOP II', section: 'hacer', internal_status: 'convertida_oportunidad', converted_opportunity_id: 'opp-1', entity: 'Bogotá', title: 'Convertida', value: 100, score: 80, reasons: [], risks: [] },
];
const baseFilters = { query: '', source: 'todas', region: 'todas', deadline: 'todas', value: 'todas', score: 'todas', section: 'todas', internalStatus: 'todas' };
assert.deepEqual(filterRadarTenders(candidates, { ...baseFilters, section: 'revisar', internalStatus: 'en_revision' }).map(item => item.id), ['review-revisar'], 'El perfil debe aplicar sección y estado interno conjuntamente.');
assert.deepEqual(filterRadarTenders(candidates, { ...baseFilters, internalStatus: 'descartada' }).map(item => item.id), ['discard-descartar'], 'El perfil debe poder recuperar descartadas.');
assert.deepEqual(filterRadarTenders(candidates, { ...baseFilters, internalStatus: 'convertida_oportunidad' }).map(item => item.id), ['converted'], 'Un perfil debe poder recuperar procesos convertidos dentro del Radar.');

console.log('Tender saved search isolation and Radar application passed');
