export type ModulePermission = Readonly<{
  code: string;
  name: string;
  description: string;
}>;

export const MODULE_PERMISSIONS: readonly ModulePermission[];
export const MODULE_PERMISSION_CODES: readonly string[];
export function eligibleModulePermissions(role: string): string[];
export function isModulePermissionEligible(role: string, code: string): boolean;
