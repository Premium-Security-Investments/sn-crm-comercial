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
  items: [{ href: '#/home', label: 'Mi día', page: 'home' }, { href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' }],
}], 'comercial con solo oportunidades ve Mi día y Oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'detail'), true, 'detalle requiere y acepta modulo_oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'new'), true, 'crear requiere y acepta modulo_oportunidades');
assert.equal(mod.canAccessRoute(opportunitiesOnlyCommercial, 'edit'), true, 'editar requiere y acepta modulo_oportunidades');

// Prioridades Comerciales salió de todos los menús y "Cargar metas" sólo lo ve quien escribe metas; las rutas siguen
// abiertas para enlaces directos (Ver mi meta → #/goals).
const alertsAndGoals = profile('comercial', ['modulo_alertas_comerciales', 'modulo_metas']);
assert.deepEqual(labelsFor(alertsAndGoals), ['Mi día'], 'el comercial no ve Prioridades ni Metas en el menú');
assert.equal(mod.canAccessRoute(alertsAndGoals, 'alerts'), true, 'la ruta de prioridades sigue disponible por enlace');
assert.equal(mod.canAccessRoute(alertsAndGoals, 'goals'), true, 'Ver mi meta sigue abriendo #/goals');
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

// Menú del comercial: sólo Mi día + Oportunidades (Radar sólo si tiene licitaciones).
const fullCommercial = profile('comercial', ['modulo_vig_ia', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas']);
assert.deepEqual(labelsFor(fullCommercial), ['Mi día', 'Oportunidades']);
assert.deepEqual(labelsFor(profile('comercial', ['modulo_oportunidades', 'licitaciones'])), ['Mi día', 'Oportunidades', 'Radar']);

// Menú directivo.
const allModules = ['modulo_siio_gerencial', 'modulo_vig_ia', 'modulo_dashboard_comercial', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas', 'licitaciones', 'modulo_usuarios'];
assert.deepEqual(mod.getVisibleNavGroups(profile('admin', allModules)).map(group => [group.title, group.items.map(item => item.label)]), [
  ['Gerencia', ['SIIO Gerencial']],
  ['Comercial', ['Dashboard comercial', 'Oportunidades']],
  ['Licitaciones', ['Radar']],
  ['Administración', ['Cargar metas', 'Usuarios y permisos']],
]);
assert.deepEqual(labelsFor(profile('director', allModules)), ['Dashboard comercial', 'Oportunidades', 'Radar'], 'director no carga metas');
assert.deepEqual(labelsFor(profile('consulta', allModules)), ['SIIO Gerencial', 'Dashboard comercial', 'Oportunidades', 'Radar']);
for (const page of ['new', 'edit', 'users', 'goals']) assert.equal(mod.canAccessRoute(profile('consulta', allModules), page), false, `consulta no abre ${page}`);
assert.equal(mod.preferredLandingRoute(profile('gerencia', ['modulo_alertas_comerciales'])), 'home', 'prioridades ya no es pantalla de llegada');

// Vista Comercial (presentación) para perfiles no comerciales con oportunidades propias.
const juan = { ...profile('admin', allModules), can_own_opportunities: true };
assert.equal(mod.canUseCommercialView(juan), true);
assert.equal(mod.effectiveNavProfile(juan, 'admin'), juan, 'Vista Admin no cambia nada');
const juanCommercial = mod.effectiveNavProfile(juan, 'comercial');
assert.equal(juanCommercial.role, 'comercial');
assert.deepEqual(juanCommercial.permissions, ['modulo_oportunidades']);
assert.deepEqual(labelsFor(juanCommercial), ['Mi día', 'Oportunidades'], 'Vista Comercial: sólo Mi día + Oportunidades');
assert.equal(mod.preferredLandingRoute(juanCommercial), 'home', 'Vista Comercial llega a Mi día');
assert.equal(mod.canAccessRoute(juanCommercial, 'new'), true);
assert.equal(mod.canAccessRoute(juanCommercial, 'users'), false);
assert.equal(juan.role, 'admin', 'el perfil real no se muta');
for (const subject of [profile('admin', allModules), { ...profile('consulta', allModules), can_own_opportunities: true }, { ...profile('comercial', allModules), can_own_opportunities: true }, { ...juan, identity_type: 'agent' }, { ...juan, active: false }]) {
  assert.equal(mod.canUseCommercialView(subject), false, `${subject.role} sin vista comercial`);
  assert.equal(mod.effectiveNavProfile(subject, 'comercial'), subject);
}

console.log('nav permission matrix OK');
