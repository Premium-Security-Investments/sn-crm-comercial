import type { TenderCurrentProfile } from './types';

type TenderPermissionProfile = TenderCurrentProfile | null | undefined;

const CONFIGURATION_ROLES = new Set(['admin', 'gerencia', 'director']);

/** Mirrors the backend's human Licitaciones configuration action for UI affordances only. */
export function canConfigureTenders(profile: TenderPermissionProfile): boolean {
  if (!profile) return false;
  if (profile.active !== true || profile.id.trim() !== profile.id || !profile.id) return false;
  if (profile.identity_type !== undefined && profile.identity_type !== 'human') return false;
  if (!CONFIGURATION_ROLES.has(profile.role)) return false;
  return Array.isArray(profile.permissions) && profile.permissions.includes('licitaciones');
}
