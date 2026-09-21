import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const executor = readFileSync(new URL('../agt002-reanalysis-executor.js', import.meta.url), 'utf8');

assert.equal(server, api, 'production backends must remain byte-identical');

for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  assert.match(
    source,
    /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/,
    `${label}: the preview-analyze route must be registered directly to the governed-retirement helper, executing no canonical/legacy work`,
  );
}

assert.match(executor, /const bridgeTelemetry = \{ invocationStarted: false, responseReceived: false, invocationCount: 0, responseCount: 0 \};/);
assert.match(executor, /onBridgeInvocationStarted: \(\) => \{ bridgeTelemetry\.invocationStarted = true; bridgeTelemetry\.invocationCount \+= 1; \}/);
assert.match(executor, /onBridgeResponseReceived: \(\) => \{ bridgeTelemetry\.responseReceived = true; bridgeTelemetry\.responseCount \+= 1; \}/);
assert.match(executor, /const outcome = await runPostBridgeAnalysis\(database,/);
assert.equal((executor.match(/await runPostBridgeAnalysis\(/g) || []).length, 1, 'executor invokes the real post-bridge orchestrator exactly once');
assert.match(executor, /contextVersionId: job\.contextVersionId/);
assert.match(executor, /canonicalOnly: true/);
assert.match(executor, /previewClaimId = null;/);
assert.doesNotMatch(executor, /registerAgt002PreviewAnalysis\(/, 'executor reuses orchestrator persistence');

console.log('AGT-002 durable canonical post-bridge frontier passed');
