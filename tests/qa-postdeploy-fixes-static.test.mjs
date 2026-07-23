import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const radarUtils = readFileSync(new URL('../src/tenders/radarUtils.ts', import.meta.url), 'utf8');
const configuration = readFileSync(new URL('../src/tenders/TenderConfigurationView.tsx', import.meta.url), 'utf8');

const mainMarkers = [
  'const OPPORTUNITIES_PAGE_SIZE = 25',
  'function Pagination(',
  'opportunitiesPage',
  'function normalizeRegion(',
  'function isCommercialProfile(',
  'const commercialProfiles = data.profiles.filter(isCommercialProfile)',
  'const goalCommercialProfiles = data.profiles.filter(isCommercialProfile)',
  'ROLE_LABELS[value || \'\']',
  'roleLabel(p.role)',
  'setSidebarOpen',
  'event.key === \'Escape\'',
  '<aside id="app-sidebar"',
  'topbar-menu-toggle',
  'sidebar-backdrop',
];
for (const marker of mainMarkers) assert.ok(main.includes(marker), `main.tsx missing QA fix marker: ${marker}`);

for (const marker of ['const PAGE_SIZE = 24', 'setPage(', 'className="pagination"', 'deduplicateTenders(payload?.tenders || [])']) {
  assert.ok(radar.includes(marker), `TenderRadarView.tsx missing QA fix marker: ${marker}`);
}
for (const marker of ['function canonicalTenderKey(', 'function deduplicateTenders(', 'tenderStatusRank']) {
  assert.ok(radarUtils.includes(marker), `radarUtils.ts missing QA fix marker: ${marker}`);
}
assert.ok(configuration.includes('tender-configuration-view'), 'TenderConfigurationView must retain an isolated configuration-view marker.');

const styleMarkers = [
  '.pagination',
  '.topbar-menu-toggle',
  '.sidebar-backdrop',
  '.sidebar.sidebar-open',
  '.dashboard-v2 .v2-component-block>*{min-width:0',
  '@media(max-width:768px)',
];
for (const marker of styleMarkers) assert.ok(styles.includes(marker), `styles.css missing QA fix marker: ${marker}`);

const hookResetIndex = radar.indexOf('useEffect(() => { setPage(1); }');
const firstConditionalReturnIndex = radar.indexOf('if (loading) return');
assert.ok(hookResetIndex > -1 && hookResetIndex < firstConditionalReturnIndex, 'tender pagination hook must run before conditional returns');

assert.ok(!main.includes('<Panel title="Cumplimiento bajo 80%">'), 'Alerts must not render the full low-goal compliance table.');
assert.ok(radar.includes('deduplicateTenders(payload?.tenders || [])'), 'Radar must operate on deduplicated tenders.');
assert.ok(main.includes('commercialProfiles.map'), 'Commercial selectors must use role-filtered profiles.');

console.log('post-deploy QA fixes static checks passed');
