import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('la función del servidor usa copias idénticas del conector', () => {
  for (const f of ['odoo.ts', 'normalizar.ts']) {
    assert.equal(readFileSync(`supabase/functions/avancys-sync/${f}`, 'utf8'), readFileSync(`src/programacion/integracion/${f}`, 'utf8'), `${f} difiere: cópielo de src/programacion/integracion`);
  }
});
