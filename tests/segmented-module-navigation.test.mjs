import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const compact = value => value.replace(/\s+/g, '');

const siioNavigation = read('src/siio/SiioNavigation.tsx');
const tenderTabs = read('src/tenders/components/TenderModuleTabs.tsx');
const tendersModule = read('src/tenders/TendersModule.tsx');
const styles = compact(read('src/styles.css'));
const siioStyles = compact(read('src/siio/siio.css'));
const tenderViews = [
  'src/tenders/TenderRadarView.tsx',
  'src/tenders/TenderTrackingView.tsx',
  'src/tenders/TenderOpportunitiesView.tsx',
  'src/tenders/TenderConfigurationView.tsx',
].map(path => ({ path, source: read(path) }));

assert.match(siioNavigation, /className="siio-navigation module-segmented-nav"/, 'SIIO debe usar el control segmentado compartido');
assert.match(tenderTabs, /className="tender-module-tabs module-segmented-nav"/, 'Licitaciones debe usar el control segmentado compartido');
assert.equal((siioNavigation.match(/view:\s*'/g) || []).length, 4, 'SIIO conserva cuatro vistas internas');
assert.equal((tenderTabs.match(/view:\s*'/g) || []).length, 3, 'Licitaciones conserva tres vistas primarias');
assert.match(siioNavigation, /aria-current=/, 'SIIO conserva aria-current');
assert.match(tenderTabs, /aria-current=/, 'Licitaciones conserva aria-current');

assert.match(styles, /\.module-segmented-nav\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\);[^}]*width:100%;/, 'el control debe ser una cuadrícula de cuatro segmentos iguales');
assert.match(styles, /\.tender-module-tabs\.module-segmented-nav\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);\}/, 'Licitaciones debe distribuir sus tres vistas primarias en segmentos iguales');
assert.match(styles, /\.module-segmented-navbutton\{[^}]*width:100%;[^}]*min-width:0;[^}]*box-shadow:none;/, 'cada segmento debe ser compacto y sin sombras');
assert.match(styles, /\.module-segmented-navbutton\.active[^{}]*\{[^}]*background:#174ea6;[^}]*color:#fff;/, 'el segmento activo debe ser inequívoco');
assert.match(styles, /\.module-segmented-navbutton:focus-visible\{[^}]*outline:/, 'el foco de teclado debe ser visible');
assert.doesNotMatch(siioStyles, /\.siio-dashboard\.siio-navigation\{[^}]*display:flex/, 'SIIO no debe reintroducir layout flex vertical');

assert.match(tendersModule, /const moduleNavigation = <>\s*<TenderModuleTabs/, 'el módulo debe construir una única navegación interna con el acceso secundario protegido.');
assert.doesNotMatch(tendersModule, /<TenderModuleTabs[^>]*\/>\s*\{props\.view/, 'las pestañas no deben permanecer antes del encabezado contextual');
for (const { path, source } of tenderViews) {
  assert.match(source, /moduleNavigation:\s*ReactNode/, `${path} debe aceptar la navegación compartida`);
  assert.match(source, /<header[\s\S]*?<\/header>\s*\{moduleNavigation\}/, `${path} debe mostrar la navegación después de su encabezado`);
}

console.log('segmented module navigation contract passed');
