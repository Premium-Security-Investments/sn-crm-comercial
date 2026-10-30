import type { TenderCurrentProfile } from './types';

type TenderPermissionProfile = TenderCurrentProfile | null | undefined;

// Espeja HUMAN_TENDER_ROLES de access-control.js: los roles humanos que operan Licitaciones.
const TENDER_ROLES = new Set(['admin', 'gerencia', 'director', 'comercial']);

function isActiveHuman(profile: TenderPermissionProfile): profile is TenderCurrentProfile {
  if (!profile || profile.active !== true || profile.id.trim() !== profile.id || !profile.id) return false;
  return !Object.prototype.hasOwnProperty.call(profile, 'identity_type') || profile.identity_type == null || profile.identity_type === 'human';
}

/** Directivo de solo consulta: ve Licitaciones y nunca opera (el servidor rechaza cualquier escritura de este rol). */
export function isTenderReadOnlyProfile(profile: TenderPermissionProfile): boolean {
  return Boolean(profile) && profile!.role === 'consulta';
}

/** Mirrors LICITACIONES_COMPANY_PROFILE_UPDATE for textual company-profile edits. */
export function canConfigureTenders(profile: TenderPermissionProfile): boolean {
  if (!isActiveHuman(profile) || isTenderReadOnlyProfile(profile) || !Array.isArray(profile.permissions) || !profile.permissions.includes('licitaciones')) return false;
  return profile.permissions.includes('licitaciones_empresa') || profile.permissions.includes('licitaciones_custodia');
}

/** Mirrors LICITACIONES_CONFIGURE: custody is required for RUP/document mutations. */
export function canManageTenderCompanyDocuments(profile: TenderPermissionProfile): boolean {
  return isActiveHuman(profile)
    && !isTenderReadOnlyProfile(profile)
    && Array.isArray(profile.permissions)
    && profile.permissions.includes('licitaciones')
    && profile.permissions.includes('licitaciones_custodia');
}

/**
 * Mirrors LICITACIONES_CONVERT: crear a mano un proceso que no está en SECOP es traerlo al CRM, el mismo acto que
 * convertirlo desde el Radar, así que pide la misma custodia.
 */
export function canCreateManualTenderProcess(profile: TenderPermissionProfile): boolean {
  return canManageTenderCompanyDocuments(profile);
}

/**
 * Mirrors LICITACIONES_GO_NO_GO_APPROVE: todo humano activo con acceso a Licitaciones. Juan, 2026-10-29: el acceso a
 * Licitaciones es el permiso, así que aprobar no depende del rol; el directivo de solo consulta nunca opera.
 */
export function canApproveTenderGoNoGo(profile: TenderPermissionProfile): boolean {
  if (!isActiveHuman(profile) || isTenderReadOnlyProfile(profile)) return false;
  return TENDER_ROLES.has(profile.role)
    && Array.isArray(profile.permissions)
    && profile.permissions.includes('licitaciones');
}
