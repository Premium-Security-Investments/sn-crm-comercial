const freezePermission = (code, name, description) => Object.freeze({ code, name, description });

export const MODULE_PERMISSIONS = Object.freeze([
  freezePermission('modulo_siio_gerencial', 'SIIO Gerencial', 'Acceso al módulo SIIO Gerencial.'),
  freezePermission('modulo_vig_ia', 'Vig-IA', 'Acceso al módulo Vig-IA.'),
  freezePermission('modulo_dashboard_comercial', 'Dashboard Comercial', 'Acceso al Dashboard Comercial.'),
  freezePermission('modulo_alertas_comerciales', 'Alertas Comerciales', 'Acceso al módulo de Alertas Comerciales.'),
  freezePermission('modulo_oportunidades', 'Oportunidades', 'Acceso al módulo de Oportunidades.'),
  freezePermission('modulo_metas', 'Metas y Cumplimiento', 'Acceso al módulo de Metas y Cumplimiento.'),
  freezePermission('licitaciones', 'Licitaciones', 'Acceso al módulo de Licitaciones.'),

  freezePermission('modulo_usuarios', 'Usuarios y Permisos', 'Acceso al módulo de Usuarios y Permisos.'),
]);

export const MODULE_PERMISSION_CODES = Object.freeze(MODULE_PERMISSIONS.map(({ code }) => code));

export const CAPABILITY_PERMISSIONS = Object.freeze([
  freezePermission('licitaciones_custodia', 'Custodia de Licitaciones', 'Autoridad exclusiva para convertir detecciones y aprobar perfiles, reglas y fuentes corporativas de Licitaciones.'),
  freezePermission('vigia_copilot_pilot', 'Piloto Copiloto Vig-IA', 'Autoridad temporal y explícita para ejecutar el copiloto comercial de Vig-IA durante el canary.'),
]);

export const CAPABILITY_PERMISSION_CODES = Object.freeze(CAPABILITY_PERMISSIONS.map(({ code }) => code));

const ALL_MODULES = new Set(MODULE_PERMISSION_CODES);
const ROLE_MODULE_CEILINGS = new Map([
  ['admin', ALL_MODULES],
  ['gerencia', new Set(MODULE_PERMISSION_CODES.filter(code => code !== 'modulo_usuarios'))],
  ['director', new Set(MODULE_PERMISSION_CODES.filter(code => code !== 'modulo_usuarios'))],
  ['comercial', new Set(['modulo_vig_ia', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas', 'licitaciones'])],
  ['colaborador', new Set(['modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas'])],
  ['junta', new Set(['modulo_siio_gerencial'])],
]);

export function eligibleModulePermissions(role) {
  const eligible = ROLE_MODULE_CEILINGS.get(role);
  return eligible ? MODULE_PERMISSION_CODES.filter(code => eligible.has(code)) : [];
}

export function isModulePermissionEligible(role, code) {
  return typeof code === 'string'
    && ALL_MODULES.has(code)
    && (ROLE_MODULE_CEILINGS.get(role)?.has(code) ?? false);
}
