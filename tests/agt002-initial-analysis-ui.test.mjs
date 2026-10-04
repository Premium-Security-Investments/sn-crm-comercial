import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/tenders/components/TenderAnalysisSection.tsx', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/tenders/agt002InitialAnalysisProjection.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');

test('INITIAL uses its own status endpoint and projection, never reanalysis polling', () => {
  assert.match(main, /\/api\/agt002-initial-analysis-status/);
  assert.match(main, /parseAgt002InitialAnalysisProjection/);
  assert.match(server, /readAgt002InitialAnalysisStatus/);
  assert.doesNotMatch(projection, /reanalysis|agt002ReanalysisPolling/);
});

test('the visible state has exactly the reduced four labels and preserves human decision', () => {
  for (const label of ['Pendiente', 'Corriendo', 'Listo', 'Fallido']) assert.match(projection, new RegExp(label));
  assert.match(section, /La decisión continúa siendo exclusivamente humana/);
  assert.match(section, /initialAnalysis\.action\.message/);
});

test('ready is guarded by server-owned report/run evidence, not arbitrary analysis JSON', () => {
  assert.match(projection, /state === 'ready'.*!item\.reportAvailable.*!item\.runId.*!item\.humanDecisionRequired/s);
  assert.doesNotMatch(projection, /item\.(result|envelope|payload)|value\.(result|envelope|payload)/);
});
