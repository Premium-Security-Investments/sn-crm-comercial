import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/tenders/api.ts', import.meta.url), 'utf8');
const tabsSource = readFileSync(new URL('../src/tenders/components/TenderModuleTabs.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(moduleSource, /<TenderRadarView/);
assert.match(moduleSource, /<TenderTrackingView/);
assert.match(moduleSource, /<TenderDossiersView/);
assert.match(moduleSource, /<TenderProfilesView/);
assert.match(moduleSource, /renderLegacy/, 'The boundary must preserve the current tender implementation until its views are migrated.');
assert.match(apiSource, /export async function loadRadar/);
assert.match(apiSource, /export async function loadTracking/);
assert.match(apiSource, /export async function loadDossiers/);
assert.match(apiSource, /export async function loadProfiles/);
assert.match(tabsSource, /navigate\(hash\)/, 'Tabs must navigate through the callback supplied by the module.');
assert.match(tabsSource, /Radar de oportunidades/);
assert.match(tabsSource, /Seguimiento/);
assert.match(tabsSource, /Expedientes/);
assert.match(tabsSource, /Perfiles de búsqueda/);
assert.match(main, /<TendersModule/);
assert.match(main, /renderLegacy=\{\(\) => <TendersRadar/);
assert.match(main, /import type \{ TenderModuleView \} from '\.\/tenders\/types';/, 'main must use the tender module view type from the authoritative module types.');
assert.doesNotMatch(main, /type TenderModuleView =/, 'main must not redeclare the tender module view union locally.');
assert.doesNotMatch(moduleSource, /TenderUnifiedBoard/);

console.log('tender functional composition passed');
