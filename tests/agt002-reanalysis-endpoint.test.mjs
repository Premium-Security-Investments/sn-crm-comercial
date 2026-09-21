import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'api/[...path].js'), 'utf8');

assert.equal(server, vercel, 'Express and Vercel backends must remain byte-identical');

assert.match(
  server,
  /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/,
  'the preview-analyze route must be registered directly to the governed-retirement helper, executing no canonical/legacy work',
);

const humanStart = server.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
const humanEnd = server.indexOf('\nasync function getTenderOfferPreparationRecords', humanStart);
assert.ok(humanStart >= 0 && humanEnd > humanStart);
const humanRoute = server.slice(humanStart, humanEnd);
assert.match(humanRoute, /enqueueAgt002CanonicalReanalysis/);
assert.doesNotMatch(humanRoute, /createAgt002PreviewRuntime|runAgt002PostBridgeAnalysis|claimAgt002PreviewRun/);

console.log('AGT-002 async enqueue endpoint contract passed');
