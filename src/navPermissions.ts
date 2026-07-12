export type NavRole = 'admin' | 'gerencia' | 'director' | 'comercial' | string;

export type NavProfile = {
  role?: NavRole | null;
  microsoft_email?: string | null;
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

const managementRoles = new Set(['admin', 'gerencia', 'director']);
const tenderExceptionEmails = new Set(['directora.licitaciones@seguridadnacional.co']);

export function isManagementRole(role?: string | null) {
  return managementRoles.has(role || '');
}

export function canManageUsers(profile?: NavProfile) {
  return profile?.role === 'admin';
}

export function canViewTenders(profile?: NavProfile) {
  return isManagementRole(profile?.role) || tenderExceptionEmails.has(profile?.microsoft_email?.toLowerCase() || '');
}

export function canAccessSiio(profile?: NavProfile) {
  return isManagementRole(profile?.role);
}

export function canAccessRoute(profile: NavProfile, page: NavRoutePage) {
  if (page === 'siio') return canAccessSiio(profile);
  if (page === 'users') return canManageUsers(profile);
  if (page === 'tenders') return canViewTenders(profile);
  if (page === 'centinel' || page === 'dashboard' || page === 'dashboard2' || page === 'consultant') return isManagementRole(profile?.role);
  return true;
}

export function getVisibleNavGroups(profile?: NavProfile): NavGroup[] {
  const groups: NavGroup[] = [];
  if (isManagementRole(profile?.role)) {
    groups.push({ title: 'Gerencia', items: [
      { href: '#/siio', label: 'SIIO Gerencial', page: 'siio' },
      { href: '#/dashboard2', label: 'Dashboard comercial', page: 'dashboard2' },
      { href: '#/vig-ia', label: 'Vig-IA', page: 'centinel' }
    ] });
  }
  const commercialItems: NavItem[] = [
    { href: '#/dashboard2', label: 'Dashboard comercial', page: 'dashboard2' },
    { href: '#/alerts', label: 'Alertas comerciales', page: 'alerts' },
    { href: '#/opportunities', label: 'Oportunidades', page: 'opportunities' },
    { href: '#/new', label: 'Crear oportunidad', page: 'new' },
    { href: '#/goals', label: 'Metas y cumplimiento', page: 'goals' }
  ];
  groups.push({ title: 'Comercial', items: commercialItems.filter(item => item.page !== 'dashboard2' || !isManagementRole(profile?.role)) });
  if (canViewTenders(profile)) {
    groups.push({ title: 'Licitaciones', items: [
      { href: '#/tenders?view=radar', label: 'Radar de oportunidades', page: 'tenders' },
      { href: '#/tenders?view=seguimiento', label: 'Seguimiento', page: 'tenders' },
      { href: '#/tenders?view=expedientes', label: 'Expedientes', page: 'tenders' },
      { href: '#/tenders?view=perfiles', label: 'Perfiles de búsqueda', page: 'tenders' }
    ] });
  }
  if (canManageUsers(profile)) groups.push({ title: 'Administración', items: [{ href: '#/users', label: 'Usuarios y permisos', page: 'users' }] });
  return groups;
}
