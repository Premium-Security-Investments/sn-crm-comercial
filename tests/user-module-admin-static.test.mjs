import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const src = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');

assert.match(src, /from ['"]\.\.\/module-access\.js['"]/, 'UsersAdmin debe consumir el catálogo compartido de módulos.');
assert.match(src, /MODULE_PERMISSIONS/, 'UsersAdmin debe usar MODULE_PERMISSIONS en lugar de permisos por email o rol codificados.');
assert.match(src, /MODULE_PERMISSION_CODES/, 'UsersAdmin debe clasificar el catálogo con MODULE_PERMISSION_CODES.');
assert.match(src, /emptyUserForm:[\s\S]*?permissions:\s*\[\]/, 'Un usuario nuevo debe iniciar sin módulos seleccionados.');
assert.match(src, /Módulos y pestañas/, 'El formulario debe mostrar una sección explícita de módulos y pestañas.');
assert.match(src, /eligibleModulePermissions\(form\.role\)/, 'Las casillas deben derivarse del catálogo elegible para el rol.');
assert.match(src, /isModulePermissionEligible\(role, permission\)/, 'Al cambiar rol se deben retirar todos los módulos incompatibles.');
assert.match(src, /permissions:\s*user\.permissions\s*\|\|\s*\[\]/, 'Editar debe cargar exactamente los módulos persistidos del usuario.');
assert.match(src, /Resumen antes de guardar/, 'El formulario debe mostrar el resumen previo de módulos y áreas.');
assert.match(src, /Módulos seleccionados/, 'El resumen debe exponer los módulos seleccionados.');
assert.match(src, /Áreas asignadas/, 'El resumen debe exponer las áreas asignadas.');
assert.doesNotMatch(src, /defaultModule|moduleTemplate|templateModules|autoSelectModules/i, 'No se permiten templates ni auto-selección de módulos.');

console.log('user module admin static checks passed');
