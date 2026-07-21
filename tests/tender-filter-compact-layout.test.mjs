import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const radar = readFileSync(new URL('../src/tenders/TenderRadarView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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

assert.match(css, /\.tender-control-top\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/, 'La grilla de escritorio debe usar 12 columnas.');
assert.match(css, /\.tender-search-input\{[^}]*grid-column:span 6/, 'La búsqueda debe ocupar seis columnas en escritorio.');
assert.match(css, /\.tender-filter-order\{[^}]*grid-column:span 4/, 'Orden debe ocupar cuatro columnas en escritorio.');
assert.match(css, /@media\(max-width:1240px\)[\s\S]*\.tender-search-input\{grid-column:1\/-1/, 'Tablet debe llevar búsqueda a ancho completo.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Móvil debe usar dos columnas.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top>.tender-filter-status\{grid-column:1\/-1/, 'Estado interno debe ocupar todo el ancho móvil para evitar una celda vacía.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top input,.tender-control-top select\{[^}]*min-height:44px/, 'Móvil debe conservar altura táctil mínima.');

console.log('Tender compact filter layout expectations passed');
