import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const mainMarkers = [
  'const OPPORTUNITIES_PAGE_SIZE = 25',
  'const TENDERS_PAGE_SIZE = 24',
  'function Pagination(',
  'opportunitiesPage',
  'tenderPage',
  'function normalizeRegion(',
  'function isCommercialProfile(',
  'function canonicalTenderKey(',
  'function deduplicateTenders(',
  'tenderStatusRank',
  'applyingSearchProfileRef',
  'const commercialProfiles = data.profiles.filter(isCommercialProfile)',
  'const goalCommercialProfiles = data.profiles.filter(isCommercialProfile)',
  'ROLE_LABELS[value || \'\']',
  'roleLabel(p.role)',
  'tender-profiles-only',
  'Ver detalle en Metas y cumplimiento',
  'setSidebarOpen',
  'topbar-menu-toggle',
  'sidebar-backdrop',
];
for (const marker of mainMarkers) assert.ok(main.includes(marker), `main.tsx missing QA fix marker: ${marker}`);

const styleMarkers = [
  '.pagination',
  '.topbar-menu-toggle',
  '.sidebar-backdrop',
  '.sidebar.sidebar-open',
  '.dashboard-v2 .v2-component-block>*{min-width:0',
  '@media(max-width:768px)',
];
for (const marker of styleMarkers) assert.ok(styles.includes(marker), `styles.css missing QA fix marker: ${marker}`);

const hookResetIndex = main.indexOf("useEffect(() => { setTenderPage(1); }");
const tenderPermissionGuardIndex = main.indexOf("if (!canViewTenders(currentProfile)) return");
assert.ok(hookResetIndex > -1 && hookResetIndex < tenderPermissionGuardIndex, 'tender pagination hook must run before conditional returns');

assert.ok(!main.includes('<Panel title="Cumplimiento bajo 80%">'), 'Alerts must not render the full low-goal compliance table.');
assert.ok(main.includes('deduplicateTenders(payload.tenders)'), 'Radar must operate on deduplicated tenders.');
assert.ok(main.includes('commercialProfiles.map'), 'Commercial selectors must use role-filtered profiles.');

console.log('post-deploy QA fixes static checks passed');
