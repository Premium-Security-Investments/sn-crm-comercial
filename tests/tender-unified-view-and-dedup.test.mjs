import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const radarPath = new URL('../src/tenders/TenderRadarView.tsx', import.meta.url);
const radar = readFileSync(radarPath, 'utf8');
const api = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');

assert.match(radar, /Sincronizar fuentes oficiales/);
assert.match(radar, /Pasar a seguimiento/);
assert.match(radar, /Convertir en oportunidad/);
assert.match(radar, /Abrir expediente/);
assert.doesNotMatch(radar, /TenderUnifiedBoard/);
assert.doesNotMatch(radar, /renderLegacy/);
assert.match(radar, /expected_tracking_updated_at/);
assert.doesNotMatch(radar, /event_type/);
assert.match(radar, /document_import_status/);
assert.match(radar, /document_import_error/);
assert.match(api, /export async function loadRadar/);
assert.match(api, /\/api\/tenders/);

const bundled = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { deduplicateTenders } = await import(utilsUrl);
const duplicate = { id: 'older', source: 'SECOP II', entity: 'Alcaldía de Bogotá', ref: 'LP-01 (presentación de oferta)', detected_at: '2026-01-01', internal_status: 'nueva' };
const preferred = { ...duplicate, id: 'newer', ref: 'LP-01', last_seen_at: '2026-02-01', internal_status: 'en_revision' };
const unique = { id: 'unique', source: 'TVEC', entity: 'Entidad Nacional', ref: 'AMP-2', internal_status: 'nueva' };
const result = deduplicateTenders([duplicate, preferred, unique]);
assert.deepEqual(result.map(tender => tender.id), ['newer', 'unique'], 'Radar must retain one canonical process and prefer its most advanced/latest row.');

console.log('independent tender radar and dedup behavior passed');
