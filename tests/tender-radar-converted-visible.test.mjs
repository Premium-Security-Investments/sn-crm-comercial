import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const radarSource = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const bundled = buildSync({
  entryPoints: [new URL('../src/tenders/radarUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`;
const { filterRadarTenders } = await import(utilsUrl);

const converted = {
  id: 'tender-converted',
  source: 'SECOP II',
  entity: 'Entidad pública',
  title: 'Proceso convertido',
  internal_status: 'convertida_oportunidad',
  converted_opportunity_id: '11111111-1111-4111-8111-111111111111',
  section: 'hacer',
  score: 80,
  value: 500_000_000,
};
const linkedWithoutNormalizedStatus = {
  ...converted,
  id: 'tender-linked-only',
  internal_status: 'nueva',
};
const baseFilters = {
  query: '', source: 'todas', region: 'todas', deadline: 'todas', value: 'todas', score: 'todas', section: 'todas', internalStatus: 'todas',
};

assert.deepEqual(filterRadarTenders([converted], baseFilters).map(row => row.id), ['tender-converted'], 'Una licitación convertida debe permanecer visible en Radar con el filtro Todas.');
assert.deepEqual(filterRadarTenders([converted], { ...baseFilters, internalStatus: 'convertida_oportunidad' }).map(row => row.id), ['tender-converted'], 'El filtro Convertida debe mostrar la licitación vinculada.');
assert.deepEqual(filterRadarTenders([converted], { ...baseFilters, internalStatus: 'nueva' }), [], 'Un filtro de otro estado no debe incluir la convertida.');
assert.deepEqual(filterRadarTenders([linkedWithoutNormalizedStatus], { ...baseFilters, internalStatus: 'convertida_oportunidad' }).map(row => row.id), ['tender-linked-only'], 'El vínculo a oportunidad debe prevalecer aunque el estado persistido todavía no esté normalizado.');
assert.deepEqual(filterRadarTenders([linkedWithoutNormalizedStatus], { ...baseFilters, internalStatus: 'nueva' }), [], 'Una licitación vinculada nunca debe reaparecer como nueva por estado persistido desfasado.');

assert.match(radarSource, /Convertida en oportunidad/, 'La tarjeta debe identificar claramente el estado convertido.');
assert.match(radarSource, /Abrir oportunidad/, 'La tarjeta convertida debe abrir la oportunidad comercial vinculada.');
assert.match(radarSource, /Abrir expediente/, 'La tarjeta convertida debe abrir su expediente documental.');
assert.doesNotMatch(radarSource, /no se muestran en Radar|se gestionan fuera del Radar/, 'El copy no debe afirmar que las convertidas desaparecen del Radar.');
assert.match(serverSource, /internal_status\.eq\.convertida_oportunidad/, 'La consulta persistida debe recuperar convertidas aunque estén fuera de la ventana activa.');
assert.match(serverSource, /isConvertedTenderRecord\(row\) \|\| isTenderTrackable\(row\)/, 'El backend debe conservar convertidas aunque el proceso público ya tenga estado terminal.');
assert.match(serverSource, /isConvertedTenderRecord\(t\) \|\| !\['SECOP I','SECOP II'\]\.includes\(t\.source\) \|\| hasTenderServiceSignal\(t\)/, 'Una convertida vinculada no debe desaparecer por filtros de señal posteriores.');

console.log('converted tenders remain visible in Radar');
