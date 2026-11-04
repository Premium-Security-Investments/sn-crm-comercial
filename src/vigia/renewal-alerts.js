// AGT-003 — aviso de renovación (Juan, 2026-11-03).
//
// Una renovación lleva la fecha en que vence el contrato actual (obligatoria desde la migración 173). Sin aviso, esa
// fecha se guardaba y nadie la miraba: si el comercial no se acordaba, el contrato se vencía sin que nadie hubiera
// gestionado la renovación. Esta regla, la misma para la pantalla y las pruebas, dice cuáles hay que mirar ya.
//
// Entran las renovaciones ABIERTAS cuyo contrato vence dentro de los próximos 90 días o ya venció. Las congeladas
// también: congelar la conversación no detiene el vencimiento del contrato.
import { isAgt003CommercialOpportunity } from './commercial-scope.js';
import { bogotaDay, isTerminalStage } from './opportunity-decision-rules.js';

export const RENEWAL_WINDOW_DAYS = 90;
/**
 * Contrato de la competencia (Juan, 2026-11-03): un prospecto cuyo contrato con su proveedor actual vence pronto está
 * en el mejor momento para entrar. La ventana es más larga que la de una renovación propia —seis meses— porque hay que
 * alcanzar a visitar, cotizar y que el cliente decida antes de renovarle al otro. Un contrato que venció hace más de
 * 30 días ya se renovó o se perdió: deja de avisar.
 */
export const COMPETITOR_WINDOW_DAYS = 180;
export const COMPETITOR_GRACE_DAYS = 30;

const dayNumber = day => Math.round(Date.parse(`${day}T12:00:00Z`) / 86_400_000);

/** Días que faltan (negativo si ya venció) entre hoy en Bogotá y el día ISO dado. */
export function daysUntil(day, now = new Date()) {
  return dayNumber(day) - dayNumber(bogotaDay(now));
}

export function renewalPhrase(daysLeft, day, subject = 'El contrato') {
  const date = day.split('-').reverse().join('/');
  if (daysLeft < 0) return `${subject} venció el ${date} (hace ${-daysLeft === 1 ? '1 día' : `${-daysLeft} días`})`;
  if (daysLeft === 0) return `${subject} vence hoy`;
  if (daysLeft === 1) return `${subject} vence mañana`;
  return `${subject} vence el ${date} (en ${daysLeft} días)`;
}

const isOpenCommercial = o => o && isAgt003CommercialOpportunity(o)
  && !isTerminalStage(o.stage_code) && !o.deleted_at && !o.delete_requested_at;
const hasContractDay = o => typeof o.current_contract_end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.current_contract_end_date);
const byUrgency = (a, b) => a.daysLeft - b.daysLeft || a.opportunity.company_name.localeCompare(b.opportunity.company_name, 'es');

/** Renovaciones por vencer, la más urgente primero: `[{ opportunity, daysLeft, phrase }]`. */
export function renewalsDue(opportunities = [], now = new Date(), windowDays = RENEWAL_WINDOW_DAYS) {
  return opportunities
    .filter(o => isOpenCommercial(o) && o.customer_segment === 'cliente_actual' && o.client_deal_type === 'renovacion' && hasContractDay(o))
    .map(o => {
      const day = o.current_contract_end_date;
      const daysLeft = daysUntil(day, now);
      return { opportunity: o, daysLeft, phrase: renewalPhrase(daysLeft, day) };
    })
    .filter(item => item.daysLeft <= windowDays)
    .sort(byUrgency);
}

/** Prospectos cuyo contrato con la competencia vence en seis meses (o venció hace menos de 30 días). */
export function competitorContractsDue(opportunities = [], now = new Date(), windowDays = COMPETITOR_WINDOW_DAYS) {
  return opportunities
    .filter(o => isOpenCommercial(o) && o.customer_segment !== 'cliente_actual' && !o.current_security_provider_none && hasContractDay(o))
    .map(o => {
      const day = o.current_contract_end_date;
      const daysLeft = daysUntil(day, now);
      const provider = typeof o.current_security_provider === 'string' && o.current_security_provider.trim() ? o.current_security_provider.trim() : 'su proveedor actual';
      return { opportunity: o, daysLeft, phrase: renewalPhrase(daysLeft, day, `El contrato con ${provider}`) };
    })
    .filter(item => item.daysLeft <= windowDays && item.daysLeft >= -COMPETITOR_GRACE_DAYS)
    .sort(byUrgency);
}
