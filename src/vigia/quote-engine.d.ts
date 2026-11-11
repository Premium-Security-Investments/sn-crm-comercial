export type GuardModality = 'sin_arma' | 'con_arma' | 'canino';
export type GuardDayType = 'lunes_a_viernes' | 'sabados' | 'domingos' | 'festivos';
export type TechCategory = 'equipo' | 'insumo' | 'mano_de_obra';
export type GuardRates = {
  smlmv: number; factor: number; dayShare: number; nightShare: number; dayStartHour: number; dayEndHour: number;
  modalities: Record<GuardModality, number>; lifeInsurancePerGuard: number; aiuRate: number; ivaRate: number;
};
export type TechRates = { margin: number; ivaRate: number };
export type GuardPostInput = { name?: string; start: string; end: string; dayTypes: GuardDayType[]; guards: number; modality: GuardModality };
export type TechLineInput = { description?: string; category: TechCategory; quantity: number; unitCost: number };
export type GuardPostQuote = {
  kind: 'vigilancia'; name: string | null; dayHours: number; nightHours: number; totalHours: number; days: number; guards: number;
  modality: GuardModality; modalityRate: number; service: number; lifeInsurance: number; subtotal: number; aiu: number; iva: number; total: number;
};
export type TechLineQuote = { kind: 'tecnologia'; description: string | null; category: TechCategory; quantity: number; unitCost: number; cost: number; unitPrice: number; price: number };
export type QuoteTotals = {
  posts: GuardPostQuote[]; lines: TechLineQuote[];
  monthly: { subtotal: number; aiu: number; iva: number; total: number };
  oneTime: { subtotal: number; iva: number; total: number; cost: number; equipmentPrice: number };
};
export const GUARD_DAY_TYPES: readonly { code: GuardDayType; label: string; days: number }[];
export const MONTH_DAYS: number;
export const GUARD_MODALITIES: readonly GuardModality[];
export const TECH_CATEGORIES: readonly TechCategory[];
export const DEFAULT_GUARD_RATES: GuardRates;
export const DEFAULT_TECH_RATES: TechRates;
export class QuoteInputError extends Error { status: number }
export function militaryToHours(value: unknown): number;
export function splitDayNight(startHours: number, endHours: number, rates?: Partial<GuardRates>): { dayHours: number; nightHours: number; totalHours: number };
export function coveredDays(dayTypes: unknown): number;
export function quoteGuardPost(post: GuardPostInput, rates?: GuardRates): GuardPostQuote;
export function quoteTechLine(line: TechLineInput, rates?: TechRates): TechLineQuote;
export function quoteTotals(input: { guardPosts?: GuardPostInput[]; techLines?: TechLineInput[] }, rates?: { guardRates?: GuardRates; techRates?: TechRates }): QuoteTotals;
export function normalizeGuardRates(params: unknown): GuardRates;
export function normalizeTechRates(params: unknown): TechRates;
export function ratesInEffect<T extends { valid_from: string }>(rows: T[], day: string): T | null;
