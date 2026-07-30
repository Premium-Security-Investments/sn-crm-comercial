import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

assert.equal(vercel, server, 'backends must remain byte-identical');
assert.match(server, /createTenderProcessingDrain/);
assert.match(server, /dispatchTenderProcessingAfterConversion\(\{/);
assert.match(server, /enabled:\s*agt002AnalysisConfig\.TENDER_IMMEDIATE_DISPATCH/);
assert.match(server, /job,\s*runOnce:\s*\(\)\s*=>\s*createTenderProcessingWorker/);
assert.match(server, /releaseLease:\s*agt002AnalysisConfig\.TENDER_CONTINUOUS_DRAIN/);
assert.match(server, /createTenderProcessingDrain\(\{ worker, analysisConfig: agt002AnalysisConfig, timeBudgetMs: 45_000 \}\)/);
assert.match(server, /dispatch_status:\s*dispatch\.status/);
assert.doesNotMatch(server, /releaseLease:\s*true/, 'lease release may not bypass the phase flag');

console.log('tender processing E1 backend wiring contract passed');
