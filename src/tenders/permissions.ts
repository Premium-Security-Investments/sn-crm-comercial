import type { TenderCurrentProfile } from './types';

type TenderPermissionProfile = TenderCurrentProfile | null | undefined;

const CONFIGURATION_ROLES = new Set(['admin', 'gerencia', 'director']);

function isActiveHuman(profile: TenderPermissionProfile): profile is TenderCurrentProfile {
  if (!profile || profile.active !== true || profile.id.trim() !== profile.id || !profile.id) return false;
  return !Object.prototype.hasOwnProperty.call(profile, 'identity_type') || profile.identity_type == null || profile.identity_type === 'human';
}

/** Mirrors LICITACIONES_COMPANY_PROFILE_UPDATE for textual company-profile edits. */
export function canConfigureTenders(profile: TenderPermissionProfile): boolean {
  if (!isActiveHuman(profile) || !Array.isArray(profile.permissions) || !profile.permissions.includes('licitaciones')) return false;
  return profile.permissions.includes('licitaciones_empresa') || profile.permissions.includes('licitaciones_custodia');
}

/** Mirrors LICITACIONES_CONFIGURE: custody is required for RUP/document mutations. */
export function canManageTenderCompanyDocuments(profile: TenderPermissionProfile): boolean {
  return isActiveHuman(profile)
    && Array.isArray(profile.permissions)
    && profile.permissions.includes('licitaciones')
    && profile.permissions.includes('licitaciones_custodia');
}

/** Mirrors LICITACIONES_GO_NO_GO_APPROVE: active human decision-makers with Licitaciones access. */
export function canApproveTenderGoNoGo(profile: TenderPermissionProfile): boolean {
  if (!profile || profile.active !== true || profile.id.trim() !== profile.id || !profile.id) return false;
  if (Object.prototype.hasOwnProperty.call(profile, 'identity_type') && profile.identity_type != null && profile.identity_type !== 'human') return false;
  return CONFIGURATION_ROLES.has(profile.role)
    && Array.isArray(profile.permissions)
    && profile.permissions.includes('licitaciones');
}
