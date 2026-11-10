// Lecciones (Juan, 2026-11-07): botón «Lecciones» al lado de «Empresa», sólo para quien tiene el permiso de lecciones;
// nada en el menú de la izquierda; las rutas piden el mismo permiso.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canManageTenderLessons } from '../src/tenders/permissions.ts';
import { getVisibleNavGroups } from '../src/navPermissions.ts';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const person = (role, permissions) => ({ id: 'p1', active: true, role, identity_type: 'human', permissions });

test('el botón sólo es para quien tiene el permiso de lecciones', () => {
  assert.equal(canManageTenderLessons(person('comercial', ['licitaciones', 'licitaciones_lecciones'])), true);
  assert.equal(canManageTenderLessons(person('gerencia', ['licitaciones', 'licitaciones_custodia'])), false, 'la custodia sola no alcanza');
  assert.equal(canManageTenderLessons(person('consulta', ['licitaciones', 'licitaciones_lecciones'])), false);
  assert.equal(canManageTenderLessons({ ...person('comercial', ['licitaciones', 'licitaciones_lecciones']), identity_type: 'agent' }), false);
  const nav = read('src/tenders/components/TenderModuleNavigation.tsx');
  assert.match(nav, /canManageLessons && <button.*view=lecciones/);
  assert.ok(nav.indexOf('Empresa') < nav.indexOf('Lecciones'), 'va al lado de «Empresa»');
});

test('la vista existe y el menú de la izquierda no la muestra', () => {
  assert.match(read('src/tenders/viewUtils.ts'), /value === 'lecciones'( \|\| value === 'aliados')? \? value : 'radar'/);
  const profile = { ...person('comercial', ['licitaciones', 'licitaciones_lecciones']) };
  const labels = getVisibleNavGroups(profile).flatMap(group => group.items.map(item => item.label));
  assert.ok(!labels.includes('Lecciones'));
});

test('las rutas piden el permiso de lecciones y el servidor espejo es idéntico', () => {
  const server = read('server/index.js');
  assert.match(server, /'GET \/api\/tender-lessons': \['tenders', ACTIONS\.LICITACIONES_LESSONS_MANAGE\]/);
  assert.match(server, /'POST \/api\/tender-lessons\/decision': \['tenders', ACTIONS\.LICITACIONES_LESSONS_MANAGE\]/);
  assert.equal(server, read('api/[...path].js'));
});

test('la Mesa ya no muestra «Propuestas de aprendizaje»', () => {
  assert.doesNotMatch(read('src/tenders/components/TenderDossierVigiaWorkbench.tsx'), /capabilities: \[[^\]]*'learning'/);
});
