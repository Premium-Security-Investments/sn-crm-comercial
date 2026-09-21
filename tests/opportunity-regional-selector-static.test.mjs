import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const main = readFileSync('src/main.tsx', 'utf8');

// main.tsx must import the shared regional catalog + validator.
const regionalImportMatch = main.match(/import \{([^}]*)\} from '\.\/regional-options(?:\.js)?';/);
assert.ok(regionalImportMatch, 'main.tsx should import from ./regional-options');
assert.match(regionalImportMatch[1], /\bREGIONAL_OPTIONS\b/, 'main.tsx should import REGIONAL_OPTIONS');
assert.match(regionalImportMatch[1], /\bisValidRegionalOption\b/, 'main.tsx should import isValidRegionalOption');

// Select must accept and forward a `required` prop.
const selectIdx = main.indexOf('function Select(');
assert.ok(selectIdx !== -1, 'Select component should be defined');
const selectEnd = main.indexOf('\nfunction ', selectIdx + 1);
const selectSource = main.slice(selectIdx, selectEnd === -1 ? selectIdx + 800 : selectEnd);
assert.match(selectSource, /\brequired\b/, 'Select should accept a required prop');
assert.match(selectSource, /<select\b[^>]*\brequired\b[^>]*>/, 'Select should forward required onto the underlying <select> element');

// The opportunity form must render Regional as a required Select, not a free-text input.
assert.ok(!main.includes('Regional<input'), 'Regional field should no longer be a free-text input');
const regionalFieldMatch = main.match(/<label>Regional<Select\b[\s\S]{0,400}?<\/label>/);
assert.ok(regionalFieldMatch, 'Opportunity form should render a Regional Select field');
const regionalFieldSource = regionalFieldMatch[0];
assert.match(regionalFieldSource, /\brequired\b/, 'Regional Select should be required');
assert.ok(regionalFieldSource.includes('empty="Seleccione una regional"'), 'Regional Select should use the "Seleccione una regional" placeholder');

// Regional options must be built from the shared REGIONAL_OPTIONS catalog.
assert.ok(main.includes('REGIONAL_OPTIONS.map('), 'Regional Select options should be derived by mapping REGIONAL_OPTIONS');

// A noncanonical existing regional value must still be selectable and flagged as historical.
assert.ok(main.includes('(histórico)'), 'A noncanonical existing regional value should be labeled (histórico)');

console.log('opportunity regional selector static checks passed');
