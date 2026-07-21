import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const panelStart = radar.indexOf('<section className="tender-control-panel"');
const panelEnd = radar.indexOf('<section className="tender-source-diagnostics"', panelStart);
const controlPanel = radar.slice(panelStart, panelEnd);

for (const className of [
  'tender-filter-source',
  'tender-filter-region',
  'tender-filter-deadline',
  'tender-filter-value',
  'tender-filter-score',
  'tender-filter-section',
  'tender-filter-status',
  'tender-filter-order',
]) {
  assert.match(radar, new RegExp(`className="[^"]*${className}`), `${className} debe estar aplicada a su control.`);
}

assert.equal((controlPanel.match(/<select/g) || []).length, 8, 'El panel debe conservar sus ocho selectores.');
for (const handler of ['setSource', 'setRegion', 'setDeadline', 'setValue', 'setScore', 'setSection', 'setInternalStatus', 'setSort', 'setDirection']) {
  assert.match(controlPanel, new RegExp(`\\b${handler}\\b`), `El panel debe conservar el handler ${handler}.`);
}

assert.match(css, /\.tender-control-top\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/, 'La grilla de escritorio debe usar 12 columnas.');
assert.match(css, /\.tender-search-input\{[^}]*grid-column:span 6/, 'La búsqueda debe ocupar seis columnas en escritorio.');
assert.match(css, /\.tender-filter-source,.tender-filter-region,.tender-filter-deadline,.tender-filter-value,.tender-filter-score,.tender-filter-section,.tender-filter-status\{grid-column:span 2\}/, 'Los siete filtros secundarios deben ocupar dos columnas de escritorio cada uno.');
assert.match(css, /\.tender-filter-order\{[^}]*grid-column:span 4/, 'Orden debe ocupar cuatro columnas en escritorio.');
assert.match(css, /@media\(max-width:1240px\)[\s\S]*\.tender-search-input\{grid-column:1\/-1/, 'Tablet debe llevar búsqueda a ancho completo.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Móvil debe usar dos columnas.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top>.tender-filter\{grid-column:span 1\}/, 'Los siete filtros secundarios deben conservar una columna móvil.');
assert.doesNotMatch(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top>.tender-filter-status\{grid-column:1\/-1/, 'Estado interno no debe tener una excepción de ancho completo.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top input,.tender-control-top select\{[^}]*min-height:44px/, 'Móvil debe conservar altura táctil mínima.');

console.log('Tender compact filter layout expectations passed');
