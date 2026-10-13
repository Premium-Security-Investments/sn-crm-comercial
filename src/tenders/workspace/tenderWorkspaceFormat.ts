import type { TenderOfferStatus } from '../types';

/** Estados en los que la licitación ya tiene GO y se trabaja la oferta. */
export const POST_GO_STATUSES = new Set<TenderOfferStatus>(['en_preparacion', 'lista_para_presentar', 'presentada', 'adjudicada', 'no_adjudicada']);

export const OFFER_STATUS_LABEL: Record<TenderOfferStatus, string> = {
  pendiente_decision: 'Por decidir',
  en_preparacion: 'GO · Preparando la oferta',
  lista_para_presentar: 'GO · Lista para presentar',
  presentada: 'Oferta presentada',
  adjudicada: 'Adjudicada',
  no_adjudicada: 'No adjudicada',
  cerrada_no_go: 'NO GO',
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function dayParts(isoDay: string) {
  const [year, month, day] = isoDay.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return { date, label: `${WEEKDAYS[date.getUTCDay()]} ${day} ${MONTHS[month - 1]}` };
}

/** Fecha corta ("lun 19 oct") sin depender de la zona del navegador. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return 'Sin fecha';
  return dayParts(value)?.label || 'Sin fecha';
}

/**
 * Fecha y hora de un plazo del análisis. Un plazo guardado a medianoche (UTC o Bogotá) es una fecha
 * sin hora: mostrar "1:00 a. m." o "7:00 p. m. del día anterior" confundía al equipo. Las horas reales
 * se muestran en hora de Bogotá.
 */
export function formatDeadline(value: string | null | undefined): string {
  if (!value) return 'Sin fecha';
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return formatDay(value);
  const midnightUtc = /T00:00(?::00(?:\.0+)?)?(?:Z|\+00:00)$/.test(value);
  const bogotaParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (type: string) => bogotaParts.find(part => part.type === type)?.value || '';
  if (midnightUtc) return formatDay(value);
  const bogotaDay = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour')); const minute = get('minute');
  if (hour === 0 && minute === '00') return formatDay(bogotaDay);
  const hour12 = hour % 12 || 12;
  return `${formatDay(bogotaDay)}, ${hour12}:${minute} ${hour < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Días calendario que faltan hasta una fecha (negativo si ya pasó), contados en Bogotá. */
export function daysUntil(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  const parts = dayParts(value);
  if (!parts) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const todayParts = dayParts(today);
  if (!todayParts) return null;
  return Math.round((parts.date.getTime() - todayParts.date.getTime()) / 86_400_000);
}

export function countdownLabel(value: string | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return 'Sin fecha de cierre';
  if (days < 0) return `Cerró hace ${-days} ${days === -1 ? 'día' : 'días'}`;
  if (days === 0) return 'Cierra hoy';
  if (days === 1) return 'Cierra mañana';
  return `Faltan ${days} días`;
}

export function todayInBogota(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
