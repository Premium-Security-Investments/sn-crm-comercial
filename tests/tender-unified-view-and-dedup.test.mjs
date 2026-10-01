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
assert.match(radar, /tracking_updated_at/);
assert.match(api, /expected_tracking_updated_at/);
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

// Two ambiguous successor candidates (Radar Corte 1) can share the same canonical process key by
// construction (same source/entity/ref, tied SECOP phase) — dedup must keep both visible instead of
// silently discarding one, or a human can never see the identity they are supposed to resolve.
const tiedCandidateA = { id: 'tied-a', source: 'SECOP II', entity: 'Entidad Ambigua', ref: 'LP-02', internal_status: 'nueva', identity_review_required: true, detected_at: '2026-01-01' };
const tiedCandidateB = { id: 'tied-b', source: 'SECOP II', entity: 'Entidad Ambigua', ref: 'LP-02', internal_status: 'nueva', identity_review_required: true, detected_at: '2026-01-02' };
const ambiguousResult = deduplicateTenders([tiedCandidateA, tiedCandidateB]);
assert.deepEqual(ambiguousResult.map(tender => tender.id), ['tied-a', 'tied-b'], 'Both tied ambiguous successor candidates must remain visible for human review, not merged away.');

console.log('independent tender radar and dedup behavior passed');
