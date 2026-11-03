export const RENEWAL_WINDOW_DAYS: number;
export function daysUntil(day: string, now?: Date): number;
export function renewalPhrase(daysLeft: number, day: string): string;
export function renewalsDue<T extends { company_name: string }>(opportunities?: T[], now?: Date, windowDays?: number): { opportunity: T; daysLeft: number; phrase: string }[];
