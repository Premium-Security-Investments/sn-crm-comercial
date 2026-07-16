import { strict as assert } from 'node:assert';
import {
  MODULE_PERMISSIONS,
  MODULE_PERMISSION_CODES,
  eligibleModulePermissions,
  isModulePermissionEligible,
} from '../module-access.js';

assert.deepEqual(MODULE_PERMISSION_CODES, [
  'modulo_siio_gerencial',
  'modulo_vig_ia',
  'modulo_dashboard_comercial',
  'modulo_alertas_comerciales',
  'modulo_oportunidades',
  'modulo_metas',
  'licitaciones',
  'modulo_usuarios',
]);
assert.equal(new Set(MODULE_PERMISSION_CODES).size, MODULE_PERMISSION_CODES.length);
assert.ok(MODULE_PERMISSIONS.every(item => item.code && item.name && item.description));
assert.equal(Object.isFrozen(MODULE_PERMISSIONS), true, 'el catálogo no puede mutarse');
assert.ok(MODULE_PERMISSIONS.every(Object.isFrozen), 'cada módulo no puede mutarse');
assert.deepEqual(eligibleModulePermissions('junta'), []);
assert.equal(isModulePermissionEligible('admin', 'modulo_usuarios'), true);
assert.equal(isModulePermissionEligible('gerencia', 'modulo_usuarios'), false);
assert.equal(isModulePermissionEligible('comercial', 'modulo_siio_gerencial'), false);
assert.equal(isModulePermissionEligible('comercial', 'modulo_oportunidades'), true);
assert.equal(isModulePermissionEligible('colaborador', 'modulo_oportunidades'), true);
assert.equal(isModulePermissionEligible('desconocido', 'modulo_metas'), false);

const commercialModules = eligibleModulePermissions('comercial');
commercialModules.pop();
assert.equal(
  isModulePermissionEligible('comercial', 'licitaciones'),
  true,
  'las copias devueltas no pueden mutar la matriz interna',
);

console.log('module access catalog contract passed');
