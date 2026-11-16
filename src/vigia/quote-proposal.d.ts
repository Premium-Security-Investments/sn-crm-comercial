import type { GuardDayType, GuardPostInput, GuardPostQuote, QuoteTotals, TechLineInput } from './quote-engine.js';

export const COMPANY: { name: string; tagline: string; nit: string; city: string };
export const OFFER_VALIDITY_DAYS: number;
export const MIXED_TECH_MONTHS: number;
export function pesos(value: number): string;
export function longDate(day: string): string;
export function addDays(day: string, days: number): string;
export function clock(value: string): string;
export function daysLabel(dayTypes: GuardDayType[]): string;
export function scheduleLabel(post: GuardPostInput, result: GuardPostQuote): string;
export type OpportunityValue = { value: number; basis: 'mensual' | 'total' | 'mixta'; explanation: string };
export function opportunityValueFromQuote(totals: QuoteTotals): OpportunityValue | null;
export type QuoteClosurePost = {
  description: string; shift_start: string; shift_end: string; days_per_month: number; guards_required: number; armed: boolean; service_value: number; notes: string | null;
};
export function closurePostsFromQuote(guardPosts: GuardPostInput[], results: GuardPostQuote[]): QuoteClosurePost[];
export function proposalConditions(input: { hasGuard: boolean; hasTech: boolean; validUntil: string }): string[];
export type ProposalQuote = { id?: string | null; client_name?: string | null; title?: string | null; guardPosts: GuardPostInput[]; techLines: TechLineInput[]; totals: QuoteTotals };
export type ProposalContent = {
  company: { name: string; tagline: string; nit: string; city: string };
  number: string; date: string; validUntil: string; client: string; reference: string | null; intro: string;
  guard: { rows: { name: string; schedule: string; days: string; guards: number; modality: string; value: number }[]; subtotal: number; aiu: number; iva: number; total: number } | null;
  tech: { rows: { description: string; category: string; quantity: number; unitPrice: number; value: number }[]; subtotal: number; iva: number; total: number } | null;
  conditions: string[];
  seller: { name: string; email: string | null; phone: string | null } | null;
};
export function proposalContent(input: { quote: ProposalQuote; today: string; seller?: { name: string; email?: string | null; phone?: string | null } | null }): ProposalContent;
