import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rejectUngovernedAgt002Route } from '../agt002-governed-route-retirement.js';

function fakeResponse() {
  const response = {
    statusCode: null,
    body: null,
    status(code) { response.statusCode = code; return response; },
    json(payload) { response.body = payload; return response; },
  };
  return response;
}

test('rejects with HTTP 410 and the exact governed-retirement payload', () => {
  const res = fakeResponse();
  rejectUngovernedAgt002Route({}, res);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, {
    error: {
      code: 'governed_workset_required',
      message: 'Este flujo fue retirado. Seleccione, congele y ejecute un paquete documental gobernado para Vig-IA Licitaciones.',
    },
  });
});

const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/[...path].js', import.meta.url), 'utf8');

const IMPORT_PATTERN = /\{[^}]*\brejectUngovernedAgt002Route\b[^}]*\}\s*from\s*['"]\.\.\/agt002-governed-route-retirement\.js['"]/;

for (const [label, source] of [['server/index.js', server], ['api/[...path].js', api]]) {
  test(`${label} imports the governed-retirement helper`, () => {
    assert.match(source, IMPORT_PATTERN);
  });

  test(`${label} retires the preview-analyze route directly to the helper`, () => {
    assert.match(source, /app\.post\(\s*['"]\/api\/tender-documents-analyze-agent-preview['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/);
  });

  test(`${label} retires the fixed-snapshot reanalyze route directly to the helper`, () => {
    assert.match(source, /app\.post\(\s*['"]\/api\/agt002-reanalyze-fixed-snapshot['"]\s*,\s*rejectUngovernedAgt002Route\s*\)/);
  });

  test(`${label} still registers the governed document worksets route`, () => {
    assert.match(source, /app\.post\(\s*['"]\/api\/tender-agt002-governed-document-worksets['"]/);
  });

  test(`${label} no longer wires the fixed-snapshot route to the retired operator`, () => {
    assert.doesNotMatch(source, /app\.post\(\s*['"]\/api\/agt002-reanalyze-fixed-snapshot['"]\s*,\s*runAgt002FixedSnapshotOperator\s*\)/);
  });
}
