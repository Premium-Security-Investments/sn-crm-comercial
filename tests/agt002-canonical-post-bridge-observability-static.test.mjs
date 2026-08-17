import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');

assert.equal(server, api, 'production backends must remain byte-identical');

for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  const routeStart = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const routeEnd = source.indexOf("\napp.post('/api/tender-documents-import'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, `${label}: canonical route must exist`);
  const route = source.slice(routeStart, routeEnd);
  const canonicalStart = route.indexOf('if (canonicalOnly) {');
  const legacyStart = route.indexOf('// canonicalOnly always returns above', canonicalStart);
  assert.ok(canonicalStart >= 0 && legacyStart > canonicalStart, `${label}: durable canonical branch must precede isolated legacy branch`);
  const canonical = route.slice(canonicalStart, legacyStart);
  assert.match(canonical, /enqueueAgt002CanonicalReanalysis\(database,/);
  assert.match(canonical, /res\.status\(202\)\.json/);
  assert.doesNotMatch(canonical, /runAgt002PostBridgeAnalysis|engine\.analyze|claimAgt002PreviewRun|registerAgt002PreviewAnalysis/);
}

assert.match(executor, /const bridgeTelemetry = \{ invocationStarted: false, responseReceived: false \};/);
assert.match(executor, /onBridgeInvocationStarted: \(\) => \{ bridgeTelemetry\.invocationStarted = true; \}/);
assert.match(executor, /onBridgeResponseReceived: \(\) => \{ bridgeTelemetry\.responseReceived = true; \}/);
assert.match(executor, /const outcome = await runPostBridgeAnalysis\(database,/);
assert.equal((executor.match(/await runPostBridgeAnalysis\(/g) || []).length, 1, 'executor invokes the real post-bridge orchestrator exactly once');
assert.match(executor, /contextVersionId: job\.contextVersionId/);
assert.match(executor, /canonicalOnly: true/);
assert.match(executor, /previewClaimId = null;/);
assert.doesNotMatch(executor, /registerAgt002PreviewAnalysis\(/, 'executor reuses orchestrator persistence');

console.log('AGT-002 durable canonical post-bridge frontier passed');
