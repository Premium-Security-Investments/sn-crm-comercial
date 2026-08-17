import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'api/[...path].js'), 'utf8');

assert.equal(server, vercel, 'Express and Vercel backends must remain byte-identical');

const routeStart = server.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
const routeEnd = server.indexOf("app.get('/api/agt002-reanalysis-status'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'canonical enqueue and status routes must exist');
const route = server.slice(routeStart, routeEnd);
const canonicalStart = route.indexOf('if (canonicalOnly)');
const legacyStart = route.indexOf('// canonicalOnly always returns above');
assert.ok(canonicalStart >= 0 && legacyStart > canonicalStart);
const canonicalBranch = route.slice(canonicalStart, legacyStart);
assert.match(canonicalBranch, /enqueueAgt002CanonicalReanalysis/);
assert.match(canonicalBranch, /res\.status\(202\)/);
assert.doesNotMatch(canonicalBranch, /createAgt002PreviewRuntime|runAgt002PostBridgeAnalysis|claimAgt002PreviewRun/);

const humanStart = server.indexOf('async function reanalyzeAgt002AfterHumanAnswer');
const humanEnd = server.indexOf('\nasync function getTenderOfferPreparationRecords', humanStart);
assert.ok(humanStart >= 0 && humanEnd > humanStart);
const humanRoute = server.slice(humanStart, humanEnd);
assert.match(humanRoute, /enqueueAgt002CanonicalReanalysis/);
assert.doesNotMatch(humanRoute, /createAgt002PreviewRuntime|runAgt002PostBridgeAnalysis|claimAgt002PreviewRun/);

console.log('AGT-002 async enqueue endpoint contract passed');
