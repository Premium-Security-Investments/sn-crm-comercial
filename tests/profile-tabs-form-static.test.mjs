// Cada pestaña de permisos tiene su casilla en el formulario de Usuarios (2026-11-05).
//
// El tramo 1 de Estudios de Seguridad agregó la pestaña `estudios` a PROFILE_TABS pero no su casilla en UsersAdmin,
// que arma las casillas a mano: el módulo quedó en producción sin forma de darle el permiso a nadie. Esta prueba lo
// detecta para cualquier pestaña futura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILE_TABS, accessFromTabs } from '../profile-tabs.js';

const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

test('cada pestaña de PROFILE_TABS tiene su casilla en el formulario de Usuarios', () => {
  for (const tab of PROFILE_TABS) assert.match(main, new RegExp(`tabBox\\('${tab.code}',`), `falta la casilla de "${tab.label}"`);
});

test('"Solo consulta" quita las pestañas de escritura, incluida Estudios de seguridad', () => {
  assert.match(main, /tabs: access\.tabs\.filter\(tab => tab !== 'metas' && tab !== 'estudios' && tab !== 'usuarios'\)/);
});

test('quien sólo hace estudios queda como colaborador con el permiso del módulo', () => {
  const derived = accessFromTabs({ tabs: ['estudios'] });
  assert.equal(derived.role, 'colaborador');
  assert.deepEqual(derived.permissions, ['estudios_seguridad']);
  assert.throws(() => accessFromTabs({ tabs: ['estudios'], read_only: true }), /Estudios de seguridad/);
});
