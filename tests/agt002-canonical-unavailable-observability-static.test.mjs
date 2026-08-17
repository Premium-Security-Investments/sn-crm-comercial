import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../agt002-reanalysis-worker.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs', import.meta.url), 'utf8');

function canonicalBranch(source) {
  const routeStart = source.indexOf("app.post('/api/tender-documents-analyze-agent-preview'");
  const routeEnd = source.indexOf("\napp.post('/api/tender-documents-import'", routeStart);
  const route = source.slice(routeStart, routeEnd);
  const start = route.indexOf('if (canonicalOnly) {');
  const end = route.indexOf('// canonicalOnly always returns above', start);
  return route.slice(start, end);
}

test('canonical HTTP branch queues only; terminal unavailable classification belongs to the direct worker', () => {
  assert.equal(server, api, 'production backends must remain byte-identical');
  const canonical = canonicalBranch(server);
  assert.match(canonical, /enqueueAgt002CanonicalReanalysis/);
  assert.match(canonical, /res\.status\(202\)\.json/);
  assert.doesNotMatch(canonical, /canonical_preview_unavailable|error\.message|error\.stack|engine\.analyze/);
  assert.match(worker, /AGT002_REANALYSIS_QUEUE_ERROR_CODES/);
  assert.match(worker, /runtime_boundary_code \|\| error\?\.code/);
  assert.doesNotMatch(worker, /error_message\s*:/);
  assert.doesNotMatch(runner, /error\.message|error\.stack/);
});
