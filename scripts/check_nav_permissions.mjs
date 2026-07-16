import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';

const sourcePath = new URL('../src/navPermissions.ts', import.meta.url);
assert.ok(existsSync(sourcePath), 'src/navPermissions.ts must exist');

const tempDir = mkdtempSync(join(tmpdir(), 'nav-permissions-'));
const outPath = join(tempDir, 'navPermissions.mjs');
buildSync({
  entryPoints: [sourcePath.pathname],
  bundle: true,
  format: 'esm',
  outfile: outPath,
  platform: 'node',
  target: 'es2020',
});
const mod = await import(`file://${outPath}`);

assert.equal(typeof mod.moduleActionForPage, 'function', 'moduleActionForPage must be exported');
assert.equal(typeof mod.getVisibleNavGroups, 'function', 'getVisibleNavGroups must be exported');
assert.equal(typeof mod.canAccessRoute, 'function', 'canAccessRoute must be exported');

const profile = (role, permissions = [], active = true) => ({
  id: `${role}-${permissions.join('-') || 'none'}-${active ? 'active' : 'inactive'}`,
  role,
  active,
  permissions,
  microsoft_email: `${role}@example.com`,
});
const labelsFor = (subject) => mod.getVisibleNavGroups(subject).flatMap(group => group.items.map(item => item.label));

const adminWithoutModules = profile('admin');
assert.deepEqual(mod.getVisibleNavGroups(adminWithoutModules), [], 'admin sin módulos no debe ver grupos');
assert.equal(mod.canAccessRoute(adminWithoutModules, 'users'), false, 'admin sin modulo_usuarios no puede abrir Usuarios');

const usersOnlyAdmin = profile('admin', ['modulo_usuarios']);
assert.deepEqual(mod.getVisibleNavGroups(usersOnlyAdmin), [{
  title: 'Administración',
  items: [{ href: '#/users', label: 'Usuarios y permisos', page: 'users' }],
}], 'admin con solo modulo_usuarios ve únicamente Usuarios y permisos');

const opportunitiesOnlyCommercial = profile('comercial', ['modulo_oportunidades']);
assert.deepEqual(mod.getVisibleNavGroups(opportunitiesOnlyCommercial), [{
  title: 'Comercial',
  items: [{ href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' }],
}], 'comercial con solo oportunidades ve únicamente Oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'detail'), true, 'detalle requiere y acepta modulo_oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'new'), true, 'crear requiere y acepta modulo_oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'edit'), true, 'editar requiere y acepta modulo_oportunidades');

const alertsAndGoals = profile('comercial', ['modulo_alertas_comerciales', 'modulo_metas']);
assert.deepEqual(labelsFor(alertsAndGoals), ['Alertas comerciales', 'Metas y cumplimiento']);
assert.equal(mod.canAccessRoute(alertsAndGoals, 'opportunities'), false);
assert.equal(mod.canAccessRoute(alertsAndGoals, 'detail'), false);
assert.equal(mod.canAccessRoute(alertsAndGoals, 'new'), false);
assert.equal(mod.canAccessRoute(alertsAndGoals, 'edit'), false);

const managerWithoutSiio = profile('gerencia', ['modulo_vig_ia']);
assert.equal(labelsFor(managerWithoutSiio).includes('SIIO Gerencial'), false, 'gerencia sin módulo SIIO no lo ve');
assert.equal(mod.canAccessRoute(managerWithoutSiio, 'siio'), false, 'gerencia sin módulo SIIO no lo abre');
assert.equal(mod.canAccessRoute(profile('gerencia', ['modulo_siio_gerencial']), 'siio'), true);

const historicalEmailWithoutTender = {
  ...profile('comercial', []),
  microsoft_email: 'directora.licitaciones@seguridadnacional.co',
};
assert.equal(mod.canAccessRoute(historicalEmailWithoutTender, 'tenders'), false, 'el email histórico no concede licitaciones');
assert.equal(mod.canAccessRoute(profile('comercial', ['licitaciones']), 'tenders'), true);
assert.equal(mod.canAccessRoute(profile('admin', ['modulo_usuarios'], false), 'users'), false, 'perfil inactivo no puede usar módulos');

assert.equal(mod.moduleActionForPage('opportunities'), 'modulo_oportunidades');
assert.equal(mod.moduleActionForPage('detail'), 'modulo_oportunidades');
assert.equal(mod.moduleActionForPage('new'), 'modulo_oportunidades');
assert.equal(mod.moduleActionForPage('edit'), 'modulo_oportunidades');

console.log('nav permission matrix OK');
