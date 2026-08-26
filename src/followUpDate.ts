const BOGOTA_TIME_ZONE = 'America/Bogota';

export function bogotaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}

export function followUpDateToIso(day: string): string {
  return new Date(`${day}T12:00:00-05:00`).toISOString();
}
