import { isModulePermissionEligible } from '../module-access.js';
import { isReadOnlyRole } from '../access-control.js';

export type NavRole = 'admin' | 'gerencia' | 'director' | 'comercial' | string;

export type NavProfile = {
  id?: string;
  role?: NavRole | null;
  microsoft_email?: string | null;
  active?: boolean | null;
  permissions?: string[] | null;
  identity_type?: string | null;
  can_own_opportunities?: boolean | null;
} | null | undefined;

/** Modo de presentación del CRM: 'admin' (por defecto) o 'comercial' para perfiles no comerciales con oportunidades propias. */
export type NavViewMode = 'admin' | 'comercial';

export type NavRoutePage =
  | 'home'
  | 'opportunities'
  | 'tenders'
  | 'detail'
  | 'new'
  | 'edit'
  | 'dashboard'
  | 'dashboard2'
  | 'consultant'
  | 'goals'
  | 'alerts'
  | 'centinel'
  | 'users'
  | 'siio';

export type NavItem = { href: string; label: string; page: NavRoutePage };
export type NavGroup = { title: 'Gerencia' | 'Comercial' | 'Licitaciones' | 'Administración'; items: NavItem[] };

type NavGroupDefinition = {
  title: NavGroup['title'];
  items: NavItem[];
};

const managementRoles = new Set(['admin', 'gerencia', 'director']);
// Quienes ven las vistas directivas (Dashboard comercial, SIIO completo). Incluye al Directivo de solo consulta, que NO es
// un rol de gestión: no edita segmentos, metas ni oportunidades (por eso no entra en managementRoles).
const directiveViewerRoles = new Set([...managementRoles, 'consulta']);
// Sólo gerencia y admin cargan metas (PUT /api/goals); el ítem "Cargar metas" del menú sólo existe para ellos.
const goalWriterRoles = new Set(['admin', 'gerencia']);
// Rutas de escritura que un rol de solo consulta nunca abre, aunque tenga el módulo.
const writeOnlyPages = new Set<NavRoutePage>(['new', 'edit', 'users', 'goals']);

const navGroups: readonly NavGroupDefinition[] = [
  {
    title: 'Gerencia',
    items: [
      { href: '#/siio', label: 'SIIO Gerencial', page: 'siio' },
    ],
  },
  {
    title: 'Comercial',
    items: [
      // El comercial empieza su día aquí (su lista de hoy y las oportunidades por decidir); sólo lo ve el rol comercial.
      { href: '#/home', label: 'Mi día', page: 'home' },
      { href: '#/dashboard2', label: 'Dashboard comercial', page: 'dashboard2' },
      // Prioridades Comerciales (#/alerts) salió del menú: su motor alimenta el Dashboard comercial y el orden
      // "por urgencia" de Oportunidades. La ruta sigue abierta para enlaces directos.
      { href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' },
    ],
  },
  {
    title: 'Licitaciones',
    items: [
      { href: '#/tenders?view=radar', label: 'Radar', page: 'tenders' },
    ],
  },
  {
    title: 'Administración',
    items: [
      // Antes "Metas y cumplimiento": en el menú sólo lo ve quien carga metas; el comercial llega a su meta desde Mi día.
      { href: '#/goals', label: 'Cargar metas', page: 'goals' },
      { href: '#/users', label: 'Usuarios y permisos', page: 'users' },
    ],
  },
];

const moduleActionByPage: Partial<Record<NavRoutePage, string>> = {
  siio: 'modulo_siio_gerencial',
  centinel: 'modulo_vig_ia',
  dashboard: 'modulo_dashboard_comercial',
  dashboard2: 'modulo_dashboard_comercial',
  consultant: 'modulo_dashboard_comercial',
  alerts: 'modulo_alertas_comerciales',
  opportunities: 'modulo_oportunidades',
  detail: 'modulo_oportunidades',
  new: 'modulo_oportunidades',
  edit: 'modulo_oportunidades',
  goals: 'modulo_metas',
  tenders: 'licitaciones',
  users: 'modulo_usuarios',
};

export function isManagementRole(role?: string | null) {
  return managementRoles.has(role || '');
}

export function isDirectiveViewerRole(role?: string | null) {
  return directiveViewerRoles.has(role || '');
}

export function isReadOnlyProfile(profile?: NavProfile) {
  return profile?.active === true && isReadOnlyRole(profile.role ?? null);
}

export function moduleActionForPage(page: NavRoutePage) {
  return moduleActionByPage[page] ?? null;
}

function hasModuleAccess(profile: NavProfile, moduleCode: string) {
  return profile?.active === true
    && typeof profile.role === 'string'
    && isModulePermissionEligible(profile.role, moduleCode)
    && Boolean(profile.permissions?.includes(moduleCode));
}

export function canManageUsers(profile?: NavProfile) {
  return hasModuleAccess(profile, 'modulo_usuarios');
}

export function canViewTenders(profile?: NavProfile) {
  return hasModuleAccess(profile, 'licitaciones');
}

export function canAccessSiio(profile?: NavProfile) {
  return hasModuleAccess(profile, 'modulo_siio_gerencial');
}

/**
 * Vista Comercial: un perfil no comercial (p. ej. admin) habilitado para tener oportunidades propias puede ver el CRM
 * exactamente como un comercial. Nunca aplica a solo consulta ni a identidades técnicas.
 */
export function canUseCommercialView(profile?: NavProfile) {
  return profile?.active === true
    && profile.can_own_opportunities === true
    && typeof profile.role === 'string'
    && profile.role !== 'comercial'
    && !isReadOnlyRole(profile.role)
    && (profile.identity_type == null || profile.identity_type === 'human');
}

/**
 * Perfil efectivo para la PRESENTACIÓN (menú, rutas, pantalla de llegada). En Vista Comercial se comporta como rol
 * comercial con sólo Oportunidades: Mi día + Oportunidades. El servidor sigue autorizando con el perfil real; esto no
 * concede ni retira ningún permiso del lado del servidor.
 */
export function effectiveNavProfile<T extends NonNullable<NavProfile>>(profile: T | null | undefined, viewMode: NavViewMode): T | null | undefined {
  if (viewMode !== 'comercial' || !canUseCommercialView(profile)) return profile;
  // Conserva sólo lo que tiene un comercial: Oportunidades y, si la persona lo tiene, el permiso de la IA comercial en la
  // ficha (copiloto y premio "análisis profundo"). Sin él, la Vista Comercial escondía la IA (Juan, 2026-10-08).
  const COMMERCIAL_VIEW_PERMISSIONS = ['modulo_oportunidades', 'vigia_copilot_pilot'];
  const owned = new Set(profile!.permissions || []);
  const permissions = owned.has('modulo_oportunidades') ? COMMERCIAL_VIEW_PERMISSIONS.filter(code => owned.has(code)) : [];
  return { ...profile!, role: 'comercial', permissions };
}

export function canWriteGoals(profile?: NavProfile) {
  return hasModuleAccess(profile, 'modulo_metas') && goalWriterRoles.has(profile?.role || '');
}

export function canAccessRoute(profile: NavProfile, page: NavRoutePage) {
  if (isReadOnlyProfile(profile) && writeOnlyPages.has(page)) return false;
  if (page === 'alerts' || page === 'centinel') {
    return hasModuleAccess(profile, 'modulo_alertas_comerciales') || hasModuleAccess(profile, 'modulo_vig_ia');
  }
  const moduleCode = moduleActionForPage(page);
  return moduleCode ? hasModuleAccess(profile, moduleCode) : profile?.active === true;
}

// Prioridades y metas ya no son pantallas de llegada: se consultan desde el Dashboard comercial y Mi día.
const LANDING_PRIORITY: NavRoutePage[] = ['siio', 'dashboard2', 'dashboard', 'opportunities', 'tenders', 'consultant', 'users'];

export function isInitialAppHash(hash: string) {
  return hash === '' || hash === '#' || hash === '#/';
}

export function preferredLandingRoute(profile: NavProfile): NavRoutePage {
  if (profile?.active === true && profile.role === 'comercial') return 'home';
  return LANDING_PRIORITY.find(route => canAccessRoute(profile, route)) || 'home';
}

// "Mi día" es la entrada del comercial; los directivos trabajan desde el Dashboard comercial.
// "Cargar metas" sólo aparece para quien puede escribirlas; la ruta #/goals sigue abierta para enlaces (Ver mi meta).
function isNavItemVisible(profile: NavProfile, page: NavRoutePage) {
  if (page === 'home') return profile?.active === true && profile.role === 'comercial';
  if (page === 'goals') return canWriteGoals(profile);
  return true;
}

export function getVisibleNavGroups(profile?: NavProfile): NavGroup[] {
  return navGroups
    .map(group => ({
      title: group.title,
      items: group.items
        .filter(item => canAccessRoute(profile, item.page))
        .filter(item => isNavItemVisible(profile, item.page))
        .map(({ href, label, page }) => ({ href, label, page })),
    }))
    .filter((group): group is NavGroup => group.items.length > 0);
}
