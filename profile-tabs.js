// Usuarios y permisos por pestañas (Juan Botero, 2026-10-15).
//
// El formulario ya no pide un rol: se marcan las pestañas del menú que la persona puede abrir y unas pocas opciones
// dentro de ellas. Este módulo traduce esas casillas al modelo que el servidor ya autoriza (rol + permisos + áreas),
// sin cambiar la matriz de access-control.js. El servidor sigue validando todo (topes por rol, solo consulta).
//
// Reglas del rol calculado:
//   Usuarios y permisos                              → admin
//   Solo consulta                                    → consulta
//   Torre, Dashboard, Cargar metas u oportunidades "todas" → gerencia
//   Oportunidades o Licitaciones                      → comercial
//   Sólo Programación (o nada)                        → colaborador (sin acceso a datos del SIIO)
// Lo que antes eran módulos aparte (Alertas Comerciales, Vig-IA) ya no se muestra: va incluido con Oportunidades o
// Dashboard porque su motor alimenta esas pantallas.

export const PROGRAMACION_PERMISSION = 'modulo_programacion';

export const PROFILE_TABS = Object.freeze([
  { code: 'torre', group: 'Gerencia', label: 'Torre de Control' },
  { code: 'dashboard', group: 'Comercial', label: 'Dashboard' },
  { code: 'oportunidades', group: 'Comercial', label: 'Oportunidades' },
  { code: 'metas', group: 'Comercial', label: 'Cargar metas' },
  { code: 'licitaciones', group: 'Licitaciones', label: 'Licitaciones' },
  { code: 'programacion', group: 'Programación', label: 'Programación de turnos' },
  { code: 'usuarios', group: 'Administración', label: 'Usuarios y permisos · Agentes' },
]);
const TAB_CODES = new Set(PROFILE_TABS.map(tab => tab.code));
// Pestañas que escriben: no aplican con "Solo consulta".
const WRITE_TABS = new Set(['metas', 'usuarios']);

export const EMPTY_TABS_ACCESS = Object.freeze({
  tabs: [],
  opportunity_scope: 'propias',
  owns_opportunities: false,
  copilot: false,
  edit_segment: false,
  delete_opportunities: false,
  tender_custody: false,
  tender_company: false,
  read_only: false,
});

export const PROFILE_TEMPLATES = Object.freeze([
  { code: 'comercial', label: 'Comercial', access: { tabs: ['oportunidades'], opportunity_scope: 'propias', copilot: true, edit_segment: true } },
  { code: 'licitaciones', label: 'Licitaciones', access: { tabs: ['licitaciones'] } },
  { code: 'gerencia', label: 'Gerencia', access: { tabs: ['torre', 'dashboard', 'oportunidades', 'metas'], opportunity_scope: 'todas' } },
  { code: 'junta', label: 'Junta', access: { tabs: ['torre'], read_only: true } },
  { code: 'programacion', label: 'Programación', access: { tabs: ['programacion'] } },
]);

export function templateAccess(code) {
  const template = PROFILE_TEMPLATES.find(item => item.code === code);
  return template ? { ...EMPTY_TABS_ACCESS, ...template.access, tabs: [...template.access.tabs] } : null;
}

function accessError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'PROFILE_TABS_INVALID';
  return error;
}

export function normalizeTabsAccess(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.tabs)) throw accessError('Debe indicar las pestañas.');
  const tabs = [];
  for (const tab of input.tabs) {
    if (!TAB_CODES.has(tab)) throw accessError('Pestaña no válida.');
    if (!tabs.includes(tab)) tabs.push(tab);
  }
  const flag = key => input[key] === true;
  const access = {
    tabs,
    opportunity_scope: input.opportunity_scope === 'todas' ? 'todas' : 'propias',
    owns_opportunities: flag('owns_opportunities'),
    copilot: flag('copilot'),
    edit_segment: flag('edit_segment'),
    delete_opportunities: flag('delete_opportunities'),
    tender_custody: flag('tender_custody'),
    tender_company: flag('tender_company'),
    read_only: flag('read_only'),
  };
  const has = code => tabs.includes(code);
  // Opciones que dependen de su pestaña: sin la pestaña no tienen efecto.
  if (!has('oportunidades')) Object.assign(access, { opportunity_scope: 'propias', owns_opportunities: false, copilot: false, edit_segment: false, delete_opportunities: false });
  if (!has('licitaciones')) Object.assign(access, { tender_custody: false, tender_company: false });
  if (access.read_only) {
    const blocked = tabs.filter(tab => WRITE_TABS.has(tab));
    if (blocked.length) throw accessError('Con "Solo consulta" no se pueden dar Cargar metas ni Usuarios y permisos.');
    if (access.copilot || access.edit_segment || access.delete_opportunities || access.tender_custody || access.tender_company || access.owns_opportunities) {
      throw accessError('Con "Solo consulta" no se pueden dar opciones que cambian información.');
    }
    if (has('oportunidades')) access.opportunity_scope = 'todas';
  }
  return access;
}

export function deriveRole(access) {
  const has = code => access.tabs.includes(code);
  if (has('usuarios')) return 'admin';
  if (access.read_only) return 'consulta';
  if (has('torre') || has('dashboard') || has('metas') || (has('oportunidades') && access.opportunity_scope === 'todas')) return 'gerencia';
  if (has('oportunidades') || has('licitaciones')) return 'comercial';
  return 'colaborador';
}

/**
 * Casillas → { role, permissions, areas, can_edit_customer_segment, can_own_opportunities }.
 * `existingAreas` son las asignaciones guardadas: se conservan las del área comercial (el resumen semanal de Vig-IA
 * excluye a quien es sólo de Licitaciones por su subárea) y se descartan las demás, que ya no controlan nada.
 */
export function accessFromTabs(input, existingAreas = []) {
  const access = normalizeTabsAccess(input);
  const role = deriveRole(access);
  const has = code => access.tabs.includes(code);
  const permissions = new Set();
  if (has('torre')) permissions.add('modulo_siio_gerencial');
  if (has('dashboard')) { permissions.add('modulo_dashboard_comercial'); permissions.add('modulo_alertas_comerciales'); }
  if (has('oportunidades')) {
    permissions.add('modulo_oportunidades');
    permissions.add('modulo_alertas_comerciales');
    if (role !== 'consulta') permissions.add('modulo_vig_ia');
    // El comercial ve su meta desde Mi día.
    if (role === 'comercial') permissions.add('modulo_metas');
  }
  if (has('metas')) permissions.add('modulo_metas');
  if (has('licitaciones')) permissions.add('licitaciones');
  if (has('programacion')) permissions.add(PROGRAMACION_PERMISSION);
  if (has('usuarios')) permissions.add('modulo_usuarios');
  if (access.copilot) permissions.add('vigia_copilot_pilot');
  if (access.delete_opportunities) permissions.add('crm_eliminar_oportunidades');
  if (access.tender_custody) permissions.add('licitaciones_custodia');
  if (access.tender_company) permissions.add('licitaciones_empresa');

  const commercialAreas = (Array.isArray(existingAreas) ? existingAreas : [])
    .filter(area => area && area.area_code === 'comercial')
    .map(area => ({ area_code: 'comercial', subarea_code: area.subarea_code ?? null }));
  let areas = [];
  if (role === 'comercial' && has('oportunidades')) areas = commercialAreas;
  else if (role === 'comercial' && has('licitaciones')) areas = [{ area_code: 'comercial', subarea_code: 'licitaciones' }];

  return {
    role,
    permissions: [...permissions],
    areas,
    can_edit_customer_segment: access.edit_segment,
    can_own_opportunities: role !== 'comercial' && role !== 'consulta' && has('oportunidades') && access.owns_opportunities,
    access,
  };
}

/** Perfil guardado → casillas (para editar). Lo que no se puede representar se deja como está al leer. */
export function tabsFromProfile(profile) {
  const permissions = new Set(Array.isArray(profile?.permissions) ? profile.permissions : []);
  const role = profile?.role || '';
  const tabs = [];
  if (permissions.has('modulo_siio_gerencial')) tabs.push('torre');
  if (permissions.has('modulo_dashboard_comercial')) tabs.push('dashboard');
  if (permissions.has('modulo_oportunidades')) tabs.push('oportunidades');
  if (permissions.has('modulo_metas') && (role === 'admin' || role === 'gerencia')) tabs.push('metas');
  if (permissions.has('licitaciones')) tabs.push('licitaciones');
  if (permissions.has(PROGRAMACION_PERMISSION)) tabs.push('programacion');
  if (permissions.has('modulo_usuarios') && role === 'admin') tabs.push('usuarios');
  const sees = role === 'comercial' || role === 'colaborador' ? 'propias' : 'todas';
  return {
    ...EMPTY_TABS_ACCESS,
    tabs,
    opportunity_scope: sees,
    owns_opportunities: profile?.can_own_opportunities === true,
    copilot: permissions.has('vigia_copilot_pilot'),
    edit_segment: profile?.can_edit_customer_segment === true,
    delete_opportunities: permissions.has('crm_eliminar_oportunidades'),
    tender_custody: permissions.has('licitaciones_custodia'),
    tender_company: permissions.has('licitaciones_empresa'),
    read_only: role === 'consulta' || role === 'junta',
  };
}

/** Nombres de las pestañas para la lista de personas. */
export function tabsSummary(access) {
  return PROFILE_TABS.filter(tab => access.tabs.includes(tab.code)).map(tab => {
    if (tab.code === 'oportunidades') return access.opportunity_scope === 'todas' ? 'Oportunidades (todas)' : 'Oportunidades (las suyas)';
    if (tab.code === 'usuarios') return 'Usuarios y permisos';
    return tab.label;
  });
}
