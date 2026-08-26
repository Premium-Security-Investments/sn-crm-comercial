import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const [name, url] of [
  ['server', new URL('../server/index.js', import.meta.url)],
  ['vercel', new URL('../api/[...path].js', import.meta.url)],
]) {
  const source = readFileSync(url, 'utf8');
  assert.ok(source.includes("from '../agt003-preflight-api.js'"), `${name} imports the shared preflight API`);
  assert.ok(source.includes("from '../agt003-preflight-runtime.js'"), `${name} imports the governed preflight runtime`);
  assert.ok(source.includes("'POST /api/vigia/opportunity-preflight': ['vigia', ACTIONS.AI_COMMERCIAL_DRAFT_RUN]"), `${name} inventories preflight`);
  assert.ok(source.includes("app.post('/api/vigia/opportunity-preflight'"), `${name} exposes preflight endpoint`);
  assert.ok(source.includes("app.all('/api/vigia/opportunity-preflight'"), `${name} rejects wrong methods`);
  assert.ok(source.includes('resolveAgt003OpportunityResource(database, opportunityId, profile)'), `${name} reuses scoped opportunity authorization`);
  assert.ok(source.includes('loadAgt003OpportunityContext(database, opportunityId)'), `${name} reuses the bounded CRM context`);
  assert.ok(!source.includes('AGT003_PREFLIGHT_API_KEY'), `${name} never receives a provider key`);

  const start = source.indexOf("app.post('/api/vigia/opportunity-preflight'");
  const end = source.indexOf("app.all('/api/vigia/opportunity-preflight'", start);
  const route = source.slice(start, end);
  assert.ok(route.indexOf('getAuthContext(req)') < route.indexOf('.run('), `${name} authenticates before preflight orchestration`);
  assert.ok(route.includes('body: req.body'), `${name} passes untouched body to closed validation`);

  const factoryStart = source.indexOf('function createBackendAgt003PreflightApi');
  const factoryEnd = source.indexOf("app.get('/api/vigia/priorities'", factoryStart);
  const factory = source.slice(factoryStart, factoryEnd);
  assert.doesNotMatch(factory, /recordRun|recordFailure|claimRun|findRun|recordFeedback|migration/i, `${name} preflight is non-persistent`);
}

const server = readFileSync(new URL('../server/index.js', import.meta.url));
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url));
assert.deepEqual(server, vercel, 'backend entrypoints remain byte-identical');

console.log('AGT-003 preflight backend wiring contract passed');
