export const CLIENT_PROFILE_FIELDS: readonly string[];
export type ClientProfile = {
  company_website: string | null; company_nit: string | null; decision_maker_title: string | null; decision_maker_linkedin: string | null;
  current_security_provider: string | null; current_security_provider_none: boolean; current_contract_end_date: string | null;
};
export function normalizeWebsite(value: unknown): string | null;
export function normalizeLinkedin(value: unknown): string | null;
export function hasClientProfileFields(body: unknown): boolean;
export function normalizeClientProfile(body?: Record<string, unknown>): ClientProfile;
export const PROFILE_CHECKS: readonly { key: string; label: string; done: (o: Record<string, unknown>) => boolean }[];
export function profileCompleteness(opportunity?: Record<string, unknown>): { done: number; total: number; pct: number; complete: boolean; missing: string[] };
