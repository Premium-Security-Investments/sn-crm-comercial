import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../siio-sales-clients.js', import.meta.url);
const NBSP = String.fromCharCode(160);

test('siio-sales-clients.js existe', () => {
  assert.equal(existsSync(moduleUrl), true);
});

test('normalizeClientName recorta, colapsa espacios y minusculas', async () => {
  const { normalizeClientName } = await import(moduleUrl.href);
  assert.equal(normalizeClientName('  Acme   Ltd '), 'acme ltd');
  assert.equal(normalizeClientName('ACME'), 'acme');
  assert.equal(normalizeClientName(''), '');
  assert.equal(normalizeClientName(null), '');
  assert.equal(normalizeClientName('   '), '');
});

test('normalizeClientName colapsa NBSP, tabs y saltos de linea como espacio (canonicalizacion identica a Postgres)', async () => {
  const { normalizeClientName } = await import(moduleUrl.href);
  assert.equal(normalizeClientName(`Acme${NBSP}Ltd`), 'acme ltd');
  assert.equal(normalizeClientName('Acme\tLtd'), 'acme ltd');
  assert.equal(normalizeClientName('Acme\nLtd'), 'acme ltd');
  assert.equal(normalizeClientName('Acme\r\nLtd'), 'acme ltd');
  assert.equal(normalizeClientName(`  Acme${NBSP}${NBSP}Ltd\t\n `), 'acme ltd');
});

test('typeaheadMatches ve todos los clientes, no solo los del comercial', async () => {
  const { typeaheadMatches } = await import(moduleUrl.href);
  const clients = [
    { id: '1', company_name: 'Acme Norte', owner_id: 'comercial-a' },
    { id: '2', company_name: 'Acme Sur', owner_id: 'comercial-b' },
    { id: '3', company_name: 'Beta', owner_id: 'comercial-a' },
  ];
  const matches = typeaheadMatches(clients, 'acme');
  assert.deepEqual(matches.map((row) => row.id).sort(), ['1', '2']);
});

test('mismo nombre normalizado exige elegir el existente', async () => {
  const { duplicateNameRequiresExistingSelection } = await import(moduleUrl.href);
  const existing = new Set(['acme ltd']);
  assert.equal(
    duplicateNameRequiresExistingSelection({
      companyName: '  ACME  LTD ',
      clientId: '',
      existingNormalizedNames: existing,
    }),
    true,
  );
  assert.equal(
    duplicateNameRequiresExistingSelection({
      companyName: '  ACME  LTD ',
      clientId: 'client-1',
      existingNormalizedNames: existing,
    }),
    false,
  );
  assert.equal(
    duplicateNameRequiresExistingSelection({
      companyName: 'Nueva SA',
      clientId: '',
      existingNormalizedNames: existing,
    }),
    false,
  );
});
