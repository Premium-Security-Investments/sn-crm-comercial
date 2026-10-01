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
  'tender-filter-order',
]) {
  assert.match(radar, new RegExp(`className="[^"]*${className}`), `${className} debe seguir aplicada a su control.`);
}

assert.equal((controlPanel.match(/<select/g) || []).length, 6, 'El panel debe conservar exactamente seis selectores tras retirar Sección y Estado interno.');
for (const handler of ['setSource', 'setRegion', 'setDeadline', 'setValue', 'setScore', 'setSort', 'setDirection']) {
  assert.match(controlPanel, new RegExp(`\\b${handler}\\b`), `El panel debe conservar el handler ${handler}.`);
}

assert.doesNotMatch(radar, /tender-filter-section/, 'La clase tender-filter-section no debe existir: el filtro "Sección" se retira.');
assert.doesNotMatch(radar, /tender-filter-status/, 'La clase tender-filter-status no debe existir: el filtro "Estado interno" se retira.');
assert.doesNotMatch(controlPanel, /Sección/, 'La etiqueta "Sección" no debe aparecer en el panel de filtros.');
assert.doesNotMatch(controlPanel, /Estado interno/, 'La etiqueta "Estado interno" no debe aparecer en el panel de filtros.');
assert.doesNotMatch(radar, /\bsetSection\b/, 'El handler setSection no debe existir.');
assert.doesNotMatch(radar, /\bsetInternalStatus\b/, 'El handler setInternalStatus no debe existir.');
assert.doesNotMatch(radar, /profile\.section_filter/, 'applyProfile no debe aplicar silenciosamente section_filter de perfiles guardados.');
assert.doesNotMatch(radar, /profile\.internal_status_filter/, 'applyProfile no debe aplicar silenciosamente internal_status_filter de perfiles guardados.');

assert.match(css, /\.tender-control-top\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/, 'La grilla de escritorio debe usar 12 columnas.');
assert.match(css, /\.tender-search-input\{[^}]*grid-column:span 6/, 'La búsqueda debe ocupar seis columnas en escritorio.');
assert.match(css, /\.tender-filter-source,\.tender-filter-region,\.tender-filter-deadline,\.tender-filter-value,\.tender-filter-score\{grid-column:span 2\}/, 'Los cinco filtros secundarios restantes deben ocupar dos columnas de escritorio cada uno.');
assert.match(css, /\.tender-filter-order\{[^}]*grid-column:span 8/, 'Orden debe ocupar ocho columnas en escritorio al liberarse el espacio de Sección y Estado interno.');
assert.doesNotMatch(css, /tender-filter-section/, 'El CSS no debe referenciar tender-filter-section.');
assert.doesNotMatch(css, /tender-filter-status/, 'El CSS no debe referenciar tender-filter-status.');
assert.match(css, /@media\(max-width:1240px\)[\s\S]*\.tender-search-input\{grid-column:1\/-1/, 'Tablet debe llevar búsqueda a ancho completo.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'Móvil debe usar dos columnas.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top>.tender-filter\{grid-column:span 1\}/, 'Los filtros secundarios restantes deben conservar una columna móvil.');
assert.match(css, /@media\(max-width:640px\)[\s\S]*\.tender-control-top input,.tender-control-top select\{[^}]*min-height:44px/, 'Móvil debe conservar altura táctil mínima.');

console.log('Tender filter Sección/Estado interno removal expectations passed');
