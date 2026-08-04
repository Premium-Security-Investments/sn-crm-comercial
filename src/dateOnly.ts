// Postgres `date` columns (e.g. expected_close_date) carry no time-of-day or timezone.
// Parsing them with `new Date(value)` treats them as UTC midnight, and formatting with a
// timezone-less Intl formatter then rolls the calendar date back a day in any zone behind
// UTC (e.g. America/Bogota). These helpers parse/format the calendar date verbatim.

export type DateOnlyParts = { year: number; month: number; day: number };

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

export function parseDateOnly(value?: string | null): DateOnlyParts | null {
  if (typeof value !== 'string') return null;
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null;
  return { year, month, day };
}

const dateOnlyFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'UTC' });

export function formatDateOnly(value?: string | null, fallback = '—'): string {
  const parts = parseDateOnly(value);
  if (!parts) return fallback;
  return dateOnlyFormatter.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}
