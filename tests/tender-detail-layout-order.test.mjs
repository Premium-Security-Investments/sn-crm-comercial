import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const moduleNavigation = readFileSync(new URL('../src/tenders/components/TenderModuleNavigation.tsx', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/tenders/TendersModule.tsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(moduleNavigation, /<TenderModuleTabs/);
assert.match(moduleNavigation, /canConfigureTenders/);
assert.match(moduleSource, /<TenderModuleNavigation/);
assert.doesNotMatch(moduleSource, /<TenderModuleTabs/);
assert.match(main, /<TenderModuleNavigation active="oportunidades"/);

const banner = main.indexOf('id="tender-summary"');
const hero = main.indexOf('className="hero"', banner);
const moduleNav = main.indexOf('<TenderModuleNavigation active="oportunidades"', banner);
const detailNav = main.indexOf('<TenderDetailNavigation', banner);
// El resumen de licitación usa su propia cuadrícula compacta (ver `tender-opportunity-compact-summary`);
// `grid three` ya no marca contenido de la ficha (AGT-003 — refinamiento posterior, ver
// `agt003-first-analysis-refinement-static`), así que el marcador de contenido pasa a ser ese grid.
const infoGrid = main.indexOf('tender-opportunity-summary-grid', banner);
assert.ok(banner >= 0 && banner < hero && hero < moduleNav && moduleNav < detailNav && detailNav < infoGrid, 'el orden debe ser banner → navegación de módulo → barra híbrida → contenido');
assert.match(styles, /\.tender-module-navigation\{[^}]*display:flex/);
assert.match(styles, /\.tender-module-navigation \.tender-module-tabs\.module-segmented-nav\{[^}]*width:auto/);

console.log('tender detail layout order passed');
