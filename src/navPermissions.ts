import { isModulePermissionEligible } from '../module-access.js';

export type NavRole = 'admin' | 'gerencia' | 'director' | 'comercial' | string;

export type NavProfile = {
  id?: string;
  role?: NavRole | null;
  microsoft_email?: string | null;
  active?: boolean | null;
  permissions?: string[] | null;
} | null | undefined;

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
      { href: '#/dashboard2', label: 'Dashboard comercial', page: 'dashboard2' },
      { href: '#/alerts', label: 'Prioridades Comerciales', page: 'alerts' },
      { href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' },
    ],
  },
  {
    title: 'Licitaciones',
    items: [
      { href: '#/tenders?view=radar', label: 'Radar de oportunidades', page: 'tenders' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { href: '#/goals', label: 'Metas y cumplimiento', page: 'goals' },
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

export function canAccessRoute(profile: NavProfile, page: NavRoutePage) {
  const moduleCode = moduleActionForPage(page);
  return moduleCode ? hasModuleAccess(profile, moduleCode) : profile?.active === true;
}

export function getVisibleNavGroups(profile?: NavProfile): NavGroup[] {
  return navGroups
    .map(group => ({
      title: group.title,
      items: group.items
        .filter(item => canAccessRoute(profile, item.page))
        .map(({ href, label, page }) => ({ href, label, page })),
    }))
    .filter((group): group is NavGroup => group.items.length > 0);
}
