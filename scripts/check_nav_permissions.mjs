import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const sourcePath = new URL('../src/navPermissions.ts', import.meta.url);
assert.ok(existsSync(sourcePath), 'src/navPermissions.ts must exist');

const source = readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020, strict: true },
  fileName: 'navPermissions.ts'
});
const tempDir = mkdtempSync(join(tmpdir(), 'nav-permissions-'));
const outPath = join(tempDir, 'navPermissions.mjs');
writeFileSync(outPath, compiled.outputText);
const mod = await import(`file://${outPath}`);

assert.equal(typeof mod.getVisibleNavGroups, 'function', 'getVisibleNavGroups must be exported');
assert.equal(typeof mod.canAccessRoute, 'function', 'canAccessRoute must be exported');

const profile = (role, email = `${role}@example.com`) => ({ role, microsoft_email: email, active: true });
const labelsFor = (role, email) => mod.getVisibleNavGroups(profile(role, email)).flatMap(group => group.items.map(item => item.label));

assert.deepEqual(labelsFor('comercial'), ['Dashboard comercial', 'Alertas comerciales', 'Oportunidades', 'Crear oportunidad', 'Metas y cumplimiento']);
assert.deepEqual(labelsFor('gerencia'), ['SIIO Gerencial', 'Dashboard comercial', 'Vig-IA', 'Alertas comerciales', 'Oportunidades', 'Crear oportunidad', 'Metas y cumplimiento', 'Radar de oportunidades', 'Seguimiento', 'Expedientes', 'Perfiles de búsqueda']);
assert.deepEqual(labelsFor('director'), labelsFor('gerencia'));
assert.deepEqual(labelsFor('admin'), ['SIIO Gerencial', 'Dashboard comercial', 'Vig-IA', 'Alertas comerciales', 'Oportunidades', 'Crear oportunidad', 'Metas y cumplimiento', 'Radar de oportunidades', 'Seguimiento', 'Expedientes', 'Perfiles de búsqueda', 'Usuarios y permisos']);

assert.ok(mod.canAccessRoute(profile('admin'), 'siio'));
assert.ok(mod.canAccessRoute(profile('gerencia'), 'siio'));
assert.ok(mod.canAccessRoute(profile('director'), 'siio'));
assert.equal(mod.canAccessRoute(profile('comercial'), 'siio'), false);
assert.equal(mod.canAccessRoute(profile('comercial'), 'users'), false);
assert.equal(mod.canAccessRoute(profile('gerencia'), 'users'), false);
assert.ok(mod.canAccessRoute(profile('admin'), 'users'));
assert.ok(mod.canAccessRoute(profile('comercial'), 'opportunities'));
assert.ok(mod.canAccessRoute(profile('comercial'), 'new'));
assert.ok(mod.canAccessRoute(profile('comercial'), 'goals'));
assert.equal(mod.canAccessRoute(profile('comercial'), 'tenders'), false);
assert.ok(mod.canAccessRoute(profile('comercial', 'directora.licitaciones@seguridadnacional.co'), 'tenders'));

console.log('nav permission matrix OK');
