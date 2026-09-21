import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../agt002-reanalysis-worker.js', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../ops/agt002-reanalysis-worker/run-agt002-reanalysis-worker.mjs', import.meta.url), 'utf8');

test('preview-analyze route is retired directly to the governed helper; terminal unavailable classification belongs to the direct worker', () => {
  assert.equal(server, api, 'production backends must remain byte-identical');
  assert.match(
    server,
    /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/,
    'the preview-analyze route must be registered directly to the governed-retirement helper, executing no canonical/legacy work',
  );
  assert.match(worker, /AGT002_REANALYSIS_QUEUE_ERROR_CODES/);
  assert.match(worker, /runtime_boundary_code \|\| error\?\.code/);
  assert.doesNotMatch(worker, /error_message\s*:/);
  assert.doesNotMatch(runner, /error\.message|error\.stack/);
});
