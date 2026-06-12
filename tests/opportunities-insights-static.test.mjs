import fs from 'node:fs';
import assert from 'node:assert/strict';

const main = fs.readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const requiredMainMarkers = [
  'customerSegmentFilter',
  'setCustomerSegmentFilter',
  'empty="Todos los tipos de cliente"',
  'o.customer_segment === customerSegmentFilter',
  'setCustomerSegmentFilter(\'\')',
  'opportunityInsightCards',
  'opportunity-insight-grid',
  'opportunity-insight-card',
  'Pipeline filtrado',
  'Forecast ponderado',
  'Ticket promedio',
  'Clientes nuevos',
  'Clientes actuales',
  'Pendientes clasificar',
  'Oportunidad líder',
  'Etapa dominante',
  'fmtMoneyCompact(filteredTotals.pipeline)',
  'fmtMoneyCompact(filteredTotals.weighted)',
  'fmtMoneyCompact(averageFilteredValue)',
];

for (const marker of requiredMainMarkers) {
  assert.ok(main.includes(marker), `main.tsx missing opportunity insight marker: ${marker}`);
}

const requiredCssMarkers = [
  '.opportunity-filters',
  '.opportunity-insight-grid',
  '.opportunity-insight-card',
  '.opportunity-insight-card:before',
  '.opportunity-insight-card strong',
  '.opportunity-insight-card em',
  '.opportunity-insight-card.blue',
  '.opportunity-insight-card.green',
  '.opportunity-insight-card.amber',
  '.opportunity-insight-card.purple',
];

for (const marker of requiredCssMarkers) {
  assert.ok(css.includes(marker), `styles.css missing opportunity insight marker: ${marker}`);
}

const filtersIndex = main.indexOf('className="filters opportunity-filters"');
const cardsIndex = main.indexOf('opportunity-insight-grid');
const tableIndex = main.indexOf('className="tablewrap"');
assert.ok(filtersIndex !== -1, 'Opportunity filters must exist');
assert.ok(cardsIndex !== -1, 'Opportunity KPI cards must exist');
assert.ok(tableIndex !== -1, 'Opportunity table must exist');
assert.ok(filtersIndex < cardsIndex, 'Opportunity KPI cards should update below filters');
assert.ok(cardsIndex < tableIndex, 'Opportunity KPI cards should sit above the listing table');

console.log('opportunities insights static checks passed');
