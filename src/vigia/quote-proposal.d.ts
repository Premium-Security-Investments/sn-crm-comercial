import type { GuardDayType, GuardPostInput, GuardPostQuote, QuoteTotals, TechLineInput } from './quote-engine.js';

export const COMPANY: { name: string; tagline: string; nit: string; city: string; agencies: readonly string[] };
export const GUARD_VALIDITY_DAYS: number;
export const TECH_VALIDITY_DAYS: number;
export const TECH_OPPORTUNITY_TYPE: string;
export const GUARD_OPPORTUNITY_TYPE: string;
export function pesos(value: number): string;
export function longDate(day: string): string;
export function addDays(day: string, days: number): string;
export function clock(value: string): string;
export function daysLabel(dayTypes: GuardDayType[]): string;
export function scheduleLabel(post: GuardPostInput, result: GuardPostQuote): string;
export type OpportunityValue = { value: number; explanation: string };
export function opportunityValuesFromQuote(totals: QuoteTotals): { guard: OpportunityValue | null; tech: OpportunityValue | null; mixed: boolean } | null;
export type QuoteClosurePost = {
  description: string; shift_start: string; shift_end: string; days_per_month: number; guards_required: number; armed: boolean; service_value: number; notes: string | null;
};
export function closurePostsFromQuote(guardPosts: GuardPostInput[], results: GuardPostQuote[]): QuoteClosurePost[];
export function proposalConditions(input: { hasGuard: boolean; hasTech: boolean; today: string; deliveryTerms?: string | null }): string[];
export type ProposalQuote = { id?: string | null; client_name?: string | null; title?: string | null; tech_delivery_terms?: string | null; guardPosts: GuardPostInput[]; techLines: TechLineInput[]; totals: QuoteTotals };
export type ProposalContent = {
  company: { name: string; tagline: string; nit: string; city: string; agencies: readonly string[] };
  number: string; date: string; validUntil: string; client: string; reference: string | null; intro: string;
  guard: { rows: { name: string; schedule: string; days: string; guards: number; modality: string; value: number }[]; subtotal: number; aiu: number; iva: number; total: number } | null;
  tech: { rows: { description: string; category: string; quantity: number; unitPrice: number; value: number }[]; subtotal: number; iva: number; total: number } | null;
  conditions: string[];
  seller: { name: string; email: string | null; phone: string | null } | null;
};
export function proposalContent(input: { quote: ProposalQuote; today: string; seller?: { name: string; email?: string | null; phone?: string | null } | null }): ProposalContent;
