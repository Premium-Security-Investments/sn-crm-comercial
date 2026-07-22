import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const opportunitiesView = readFileSync(new URL('../src/tenders/TenderOpportunitiesView.tsx', import.meta.url), 'utf8');
assert.match(opportunitiesView, /requestVersionRef/);
assert.match(opportunitiesView, /requestVersion === requestVersionRef\.current/);

const bundle = buildSync({
  entryPoints: [new URL('../src/tenders/viewUtils.ts', import.meta.url).pathname],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const utilsUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`;
const { filterOpportunitySummaries } = await import(utilsUrl);

const rows = [
  { id: 'pending', decision: null, tender_offer_status: 'pendiente_decision' },
  { id: 'pending-decided', decision: 'no_go', tender_offer_status: 'pendiente_decision' },
  { id: 'go-active', decision: 'go', tender_offer_status: 'en_preparacion' },
  { id: 'go-revoked', decision: 'no_go', tender_offer_status: 'en_preparacion' },
  { id: 'go-presented', decision: 'go', tender_offer_status: 'presentada' },
  { id: 'no-go', decision: 'no_go', tender_offer_status: 'cerrada_no_go' },
  { id: 'awarded', decision: 'go', tender_offer_status: 'adjudicada' },
  { id: 'ready', decision: 'go', tender_offer_status: 'lista_para_presentar' },
  { id: 'not-awarded', decision: 'go', tender_offer_status: 'no_adjudicada' },
  { id: 'recommendation-only', recommendation: 'GO', decision: null, tender_offer_status: 'pendiente_decision' },
];

assert.deepEqual(filterOpportunitySummaries(rows, 'all').map(row => row.id), rows.map(row => row.id));
assert.deepEqual(filterOpportunitySummaries(rows, 'pending_decision').map(row => row.id), ['pending', 'recommendation-only']);
assert.deepEqual(filterOpportunitySummaries(rows, 'go_authorized').map(row => row.id), ['go-active', 'go-presented', 'ready']);
assert.deepEqual(filterOpportunitySummaries(rows, 'in_preparation').map(row => row.id), ['go-active', 'go-revoked', 'ready']);
assert.deepEqual(filterOpportunitySummaries(rows, 'submitted').map(row => row.id), ['go-presented']);
assert.deepEqual(filterOpportunitySummaries(rows, 'closed').map(row => row.id), ['no-go', 'awarded', 'not-awarded']);
assert.throws(() => filterOpportunitySummaries(rows, 'invalid'), /filtro/i);

console.log('tender opportunity lifecycle filters passed');
