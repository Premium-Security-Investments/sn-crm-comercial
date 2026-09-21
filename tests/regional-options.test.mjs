import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONAL_OPTIONS, isValidRegionalOption, regionalForOpportunityWrite } from '../src/regional-options.js';

const EXPECTED = [
  'Nariño', 'Cauca', 'Valle del cauca', 'Caldas', 'Risaralda', 'Quindio',
  'Cundinamarca', 'Antioquia', 'Magdalena', 'Bolívar', 'Cesar', 'Sucre',
  'Atlántico', 'Guajira',
];

test('regional options is a frozen array with the exact expected values in order', () => {
  assert.equal(Object.isFrozen(REGIONAL_OPTIONS), true);
  assert.deepEqual(REGIONAL_OPTIONS, EXPECTED);
});

test('validator accepts every listed region', () => {
  for (const region of EXPECTED) assert.equal(isValidRegionalOption(region), true, region);
});

test('validator rejects blank and non-listed values', () => {
  for (const invalid of ['', '   ', null, undefined, 'Otra', 'otra', 'nariño', 'Valle Del Cauca', 'Boyacá']) {
    assert.equal(isValidRegionalOption(invalid), false, String(invalid));
  }
});

test('regionalForOpportunityWrite accepts a canonical regional', () => {
  assert.equal(regionalForOpportunityWrite('Nariño'), 'Nariño');
});

test('regionalForOpportunityWrite throws for a blank regional', () => {
  assert.throws(() => regionalForOpportunityWrite(''), /La regional es obligatoria\./);
  assert.throws(() => regionalForOpportunityWrite('   '), /La regional es obligatoria\./);
  assert.throws(() => regionalForOpportunityWrite(null), /La regional es obligatoria\./);
  assert.throws(() => regionalForOpportunityWrite(undefined), /La regional es obligatoria\./);
});

test('regionalForOpportunityWrite throws for an unlisted regional on a new opportunity', () => {
  assert.throws(() => regionalForOpportunityWrite('Bogotá'), /Seleccione una regional válida\./);
});

test('regionalForOpportunityWrite allows an unchanged historical regional that is no longer listed', () => {
  assert.equal(regionalForOpportunityWrite('Bogotá', 'Bogotá'), 'Bogotá');
});

test('regionalForOpportunityWrite still throws for other unlisted values even with a historical regional present', () => {
  assert.throws(() => regionalForOpportunityWrite('Otra', 'Bogotá'), /Seleccione una regional válida\./);
});

test('regionalForOpportunityWrite preserves the original historical value verbatim when unchanged', () => {
  assert.equal(regionalForOpportunityWrite(' Nariño ', ' Nariño '), ' Nariño ');
});

test('regionalForOpportunityWrite returns the canonical value when the same value has no matching history', () => {
  assert.equal(regionalForOpportunityWrite(' Nariño '), 'Nariño');
});

test('regionalForOpportunityWrite throws when submitted and stored legacy values differ byte-for-byte even if trim-equal', () => {
  assert.throws(() => regionalForOpportunityWrite('Bogotá', ' Bogotá '), /Seleccione una regional válida\./);
});
