export const RENEWAL_WINDOW_DAYS: number;
export function daysUntil(day: string, now?: Date): number;
export function renewalPhrase(daysLeft: number, day: string, subject?: string): string;
export function renewalsDue<T extends { company_name: string }>(opportunities?: T[], now?: Date, windowDays?: number): { opportunity: T; daysLeft: number; phrase: string }[];
export const COMPETITOR_WINDOW_DAYS: number;
export const COMPETITOR_GRACE_DAYS: number;
export function competitorContractsDue<T extends { company_name: string }>(opportunities?: T[], now?: Date, windowDays?: number): { opportunity: T; daysLeft: number; phrase: string }[];
