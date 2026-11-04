export const CLIENT_PROFILE_FIELDS: readonly string[];
export type ClientProfile = {
  company_website: string | null; company_nit: string | null; decision_maker_title: string | null; decision_maker_linkedin: string | null;
  current_security_provider: string | null; current_security_provider_none: boolean; current_contract_end_date: string | null;
};
export function normalizeWebsite(value: unknown): string | null;
export function normalizeLinkedin(value: unknown): string | null;
export function hasClientProfileFields(body: unknown): boolean;
export function normalizeClientProfile(body?: Record<string, unknown>): ClientProfile;
export const PROFILE_CHECKS: readonly { key: string; label: string; optional?: boolean; done: (o: Record<string, unknown>) => boolean }[];
export function profileCompleteness(opportunity?: Record<string, unknown>): { done: number; total: number; pct: number; complete: boolean; missing: string[]; suggested: string[] };
export const CLIENT_DEAL_FIELD: 'client_deal_type';
export type ClientDealType = 'renovacion' | 'servicio_nuevo';
export const CLIENT_DEAL_TYPES: readonly (readonly [ClientDealType, string])[];
export function clientDealLabel(value: unknown): string | null;
export function normalizeClientDeal(body?: Record<string, unknown>): { client_deal_type: ClientDealType | null } | undefined;
export const CUSTOMER_SEGMENT_FILTER_OPTIONS: readonly (readonly [string, string])[];
export function isCustomerSegmentFilter(value: unknown): boolean;
export function matchesCustomerSegmentFilter(row: { customer_segment?: string | null; client_deal_type?: string | null } | null | undefined, filter: string): boolean;
