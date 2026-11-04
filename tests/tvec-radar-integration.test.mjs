import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const backendPaths = ['../server/index.js', '../api/[...path].js'];
const sources = backendPaths.map(path => ({ path, source: readFileSync(new URL(path, import.meta.url), 'utf8') }));

assert.equal(sources[0].source, sources[1].source, 'server/index.js y api/[...path].js deben permanecer byte-idénticos');

for (const { path, source } of sources) {
  assert.match(source, /import \{ fetchTvecAggregations \} from ['"]\.\.\/tvec-radar-fetch\.js['"];?/);
  const match = source.match(/async function fetchTvecEvents\(\) \{[\s\S]*?\n\}\nasync function fetchEsuDatosGovProcesses/);
  assert.ok(match, `${path}: debe conservar un fetchTvecEvents aislable`);
  const fetchTvecEvents = match[0];
  assert.match(fetchTvecEvents, /fetchTvecAggregations\(TVEC_RELEVANT_AGGREGATIONS, \{ baseUrl: TVEC_EVENTS_URL \}\)/);
  assert.match(fetchTvecEvents, /if \(!result\.ok\) \{[\s\S]*?failedAggregations\.push[\s\S]*?continue;/);
  assert.match(fetchTvecEvents, /parseTenderTableRows\(result\.text\)/);
  assert.doesNotMatch(fetchTvecEvents, /await fetch\(/, 'TVEC no debe volver a hacer fetch por agregación fuera del helper');
  assert.match(fetchTvecEvents, /status === 'partial'/);
  assert.match(fetchTvecEvents, /successfulAggregations === 0[\s\S]*?\? 'error'/);
  assert.match(fetchTvecEvents, /failed_aggregations: failedAggregations/);
  assert.match(fetchTvecEvents, /attempts: result\.attempts/);
  assert.match(source, /const sourceDiagnostics = source === 'TVEC' \? batch\.diagnostics : null;/);
  assert.match(source, /\? \{ source, \.\.\.sourceDiagnostics, count: visibleCount \}/);
  assert.match(source, /error: d\.status !== 'ok' \? d\.message : null/);
}

console.log('tvec radar integration static assertions passed');
