import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { buildSync } from 'esbuild';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/api.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const apiUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { enterTrackingFromRadar } = await import(apiUrl);

const calls = [];
await enterTrackingFromRadar(async (path, options) => {
  calls.push({ path, options });
  return { internal_status: 'en_revision' };
}, 'abc123stablekey');
assert.equal(calls[0].path, '/api/tender-status?id=abc123stablekey');
assert.equal(calls[0].options.method, 'PATCH');
assert.deepEqual(JSON.parse(calls[0].options.body), { internal_status: 'en_revision' });

assert.match(radar, /enterTrackingFromRadar\(request, tender\.stable_key \|\| tender\.id\)/);
assert.doesNotMatch(radar, /updateTracking[^;]*tender\.id/);

console.log('Radar enters tracking through stable tender key');
