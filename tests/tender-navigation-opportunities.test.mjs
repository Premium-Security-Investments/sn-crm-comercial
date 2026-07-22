import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const types = readFileSync(new URL('../src/tenders/types.ts', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const primaryViews = [...types.matchAll(/'([^']+)'/g)].map(([, value]) => value).filter(value => ['radar', 'seguimiento', 'oportunidades'].includes(value));

assert.deepEqual(primaryViews, ['radar', 'seguimiento', 'oportunidades']);

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/viewUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { normalizeTenderModuleView } = await import(utilsUrl);

assert.equal(normalizeTenderModuleView('expedientes'), 'oportunidades');
assert.equal(normalizeTenderModuleView('perfiles'), 'configuracion');
assert.equal(normalizeTenderModuleView('configuracion'), 'configuracion');
assert.equal(normalizeTenderModuleView('desconocida'), 'radar');
assert.match(moduleSource, /TenderConfigurationView/);
assert.match(moduleSource, /props\.view === 'configuracion'/);
for (const label of ['Radar', 'Seguimiento', 'Oportunidades']) assert.match(tabs, new RegExp(`label: '${label}'`));
assert.doesNotMatch(tabs, /Radar de oportunidades/);
assert.doesNotMatch(tabs, />Expedientes</);
assert.doesNotMatch(tabs, />Perfiles de búsqueda</);

console.log('Tender opportunities navigation expectations passed');
