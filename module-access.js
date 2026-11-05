const freezePermission = (code, name, description) => Object.freeze({ code, name, description });

export const MODULE_PERMISSIONS = Object.freeze([
  freezePermission('modulo_siio_gerencial', 'SIIO Gerencial', 'Acceso al módulo SIIO Gerencial.'),
  freezePermission('modulo_vig_ia', 'Vig-IA', 'Acceso al módulo Vig-IA.'),
  freezePermission('modulo_dashboard_comercial', 'Dashboard Comercial', 'Acceso al Dashboard Comercial.'),
  freezePermission('modulo_alertas_comerciales', 'Alertas Comerciales', 'Acceso al módulo de Alertas Comerciales.'),
  freezePermission('modulo_oportunidades', 'Oportunidades', 'Acceso al módulo de Oportunidades.'),
  freezePermission('modulo_metas', 'Metas y Cumplimiento', 'Acceso al módulo de Metas y Cumplimiento.'),
  freezePermission('licitaciones', 'Licitaciones', 'Acceso al módulo de Licitaciones.'),
  // Estudios de Seguridad Física (decisión de Juan, 2026-11-05): quien hace los estudios los registra en SIIO.
  freezePermission('estudios_seguridad', 'Estudios de Seguridad', 'Acceso al módulo de Estudios de Seguridad Física.'),
  // Entrada a la aplicación de Programación de turnos (migración 130). Aplica a todos los roles: el detalle lo decide
  // Programación en su pestaña Usuarios.
  freezePermission('modulo_programacion', 'Programación', 'Entrada a la aplicación de Programación de turnos.'),

  freezePermission('modulo_usuarios', 'Usuarios y Permisos', 'Acceso al módulo de Usuarios y Permisos.'),
]);

export const MODULE_PERMISSION_CODES = Object.freeze(MODULE_PERMISSIONS.map(({ code }) => code));

export const CAPABILITY_PERMISSIONS = Object.freeze([
  freezePermission('licitaciones_custodia', 'Custodia de Licitaciones', 'Autoridad exclusiva para convertir detecciones y aprobar perfiles, reglas y fuentes corporativas de Licitaciones.'),
  freezePermission('crm_eliminar_oportunidades', 'Eliminar oportunidades', 'Autoridad para confirmar o rechazar las solicitudes de eliminación de oportunidades comerciales.'),
  freezePermission('vigia_copilot_pilot', 'Vig-IA Comercial · Próximo seguimiento', 'Permite usar Próximo seguimiento de Vig-IA Comercial en la ficha de la oportunidad: propone el siguiente contacto y un borrador para revisar.'),
  // Estudios de Seguridad, tramo 3 (migración 180): revisor técnico y aprobador. Nunca sobre un estudio propio.
  freezePermission('estudios_seguridad_revisar', 'Revisa estudios de seguridad', 'Revisor técnico: devuelve con observaciones o da por revisado un estudio de seguridad que no preparó.'),
  freezePermission('estudios_seguridad_aprobar', 'Aprueba estudios de seguridad', 'Aprueba la versión de un estudio de seguridad que no preparó, y puede reabrirlo.'),
]);

export const CAPABILITY_PERMISSION_CODES = Object.freeze(CAPABILITY_PERMISSIONS.map(({ code }) => code));

const ALL_MODULES = new Set(MODULE_PERMISSION_CODES);
const ROLE_MODULE_CEILINGS = new Map([
  ['admin', ALL_MODULES],
  ['gerencia', new Set(MODULE_PERMISSION_CODES.filter(code => code !== 'modulo_usuarios'))],
  ['director', new Set(MODULE_PERMISSION_CODES.filter(code => code !== 'modulo_usuarios' && code !== 'modulo_siio_gerencial'))],
  ['comercial', new Set(['modulo_vig_ia', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas', 'licitaciones', 'estudios_seguridad', 'modulo_programacion'])],
  ['colaborador', new Set(['modulo_alertas_comerciales', 'modulo_oportunidades', 'modulo_metas', 'estudios_seguridad', 'modulo_programacion'])],
  ['junta', new Set(['modulo_siio_gerencial', 'modulo_programacion'])],
  // Directivo de solo consulta (asesor externo de junta): ve todo lo directivo, nunca administra metas, usuarios ni Vig-IA.
  // modulo_alertas_comerciales sólo habilita el motor de prioridades que alimenta el Dashboard comercial.
  ['consulta', new Set(['modulo_siio_gerencial', 'modulo_dashboard_comercial', 'modulo_alertas_comerciales', 'modulo_oportunidades', 'licitaciones', 'modulo_programacion'])],
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
