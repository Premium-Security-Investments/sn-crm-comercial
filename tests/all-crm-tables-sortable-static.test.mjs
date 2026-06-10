import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync('src/main.tsx', 'utf8');
const css = readFileSync('src/styles.css', 'utf8');

const requiredMarkers = [
  "tenderSortConfig",
  "sortedTenderRows",
  "consultantMonthlySortConfig",
  "sortedConsultantMonthlyRows",
  "consultantOpportunitySortConfig",
  "sortedConsultantOpportunities",
  "personalCriticalSortConfig",
  "sortedPersonalCriticalRows",
  "lowGoalSortConfig",
  "sortedLowGoalRows",
  "stageActionSortConfig",
  "sortedStageActionRows",
  "centinelOpportunitySortConfig",
  "sortedCentinelOpportunityRows",
  "centinelTenderSortConfig",
  "sortedCentinelTenderRows",
  "businessUnitSortConfig",
  "sortedBusinessUnitRuleRows",
  "complianceSortConfig",
  "sortedComplianceRows",
  "usersSortConfig",
  "sortedUsers",
  'sortKey="deadline"',
  'sortKey="commission"',
  'sortKey="priority"',
  'sortKey="score"',
  'sortKey="segment"',
  'sortKey="status"',
  'sortKey="month"',
  "'year'>>"
];

for (const marker of requiredMarkers) {
  assert.ok(main.includes(marker), `Missing sortable marker: ${marker}`);
}

assert.ok(css.includes('.sortable-th:hover'), 'sortable hover style exists');
assert.ok(css.includes('background:transparent'), 'sortable hover keeps transparent background');
assert.ok(css.includes('box-shadow:none'), 'sortable header buttons do not inherit primary button shadow');
assert.ok(css.includes('color:#174ea6'), 'sortable hover/active color remains legible on light header');
assert.ok(!css.includes('.sortable-th:hover,.sortable-th.active{color:#174ea6}'), 'old hover allowed global button hover background to leak');

console.log('all CRM table sortable static checks passed');
