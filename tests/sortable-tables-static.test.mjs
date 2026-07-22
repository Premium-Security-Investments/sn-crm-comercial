import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

for (const marker of [
  'type SortDirection',
  'function SortableTh',
  'compareSortValues',
  'sortedOpportunities',
  'sortedCriticalOpportunityRows',
  'aria-sort',
  'Ordenar por',
]) {
  assert(src.includes(marker), `missing sortable table marker: ${marker}`);
}

for (const marker of [
  'sortKey="client"',
  'sortKey="owner"',
  'sortKey="regional"',
  'sortKey="stage"',
  'sortKey="value"',
  'sortKey="close"',
  'sortKey="last"',
  'sortKey="next"',
  'sortKey="inactive"',
]) {
  assert(src.includes(marker), `missing sortable column marker: ${marker}`);
}

assert(css.includes('.sortable-th'), 'sortable header styling must exist');
assert(css.includes('.sort-indicator'), 'sort indicator styling must exist');
assert(css.includes('cursor:pointer'), 'sortable columns must show pointer cursor');

console.log('sortable tables static checks passed');
