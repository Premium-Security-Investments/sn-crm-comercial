import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const source = readFileSync('src/siio/selectors.ts', 'utf8');
const outDir = mkdtempSync(join(tmpdir(), 'siio-navigation-'));
const outPath = join(outDir, 'selectors.mjs');
writeFileSync(outPath, transformSync(source, { loader: 'ts', format: 'esm', target: 'es2020' }).code);
const mod = await import(`file://${outPath}`);

assert.deepEqual(mod.parseSiioRouteState('#/siio?view=seguimiento&kind=riesgos&status=pendiente&area=finanzas'), {
  view: 'seguimiento',
  filters: { kind: 'riesgos', status: 'pendiente', semaphore: '', owner: '' },
});
assert.deepEqual(mod.parseSiioRouteState('#/siio?view=invalida&period=2026-06-01'), {
  view: 'resumen',
  filters: { period: '2026-06-01', area: '' },
});
assert.equal(
  mod.toSiioHash({ view: 'inteligencia', filters: { freshness: 'vencida', trust: 'restringida', sourceType: 'archivo' } }),
  '#/siio?view=inteligencia&freshness=vencida&trust=restringida&sourceType=archivo',
);
assert.equal(
  mod.toSiioHash({ view: 'agentes', filters: { status: 'piloto', owner: 'Gerencia General' } }),
  '#/siio?view=agentes&status=piloto&owner=Gerencia+General',
);
console.log('SIIO managerial navigation selector contracts OK');
