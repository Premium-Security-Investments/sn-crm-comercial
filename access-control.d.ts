export const ACTIONS: Readonly<Record<string, string>>;
export function can(profile: Record<string, unknown>, action: string, resource?: Record<string, unknown>): boolean;
export function requireAction(profile: Record<string, unknown>, action: string, resource?: Record<string, unknown>): true;
