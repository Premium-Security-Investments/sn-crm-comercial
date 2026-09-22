import type { TenderOpportunityFilter, TenderOpportunitySummary } from './types';

/**
 * Los tres estados primarios de la bandeja de oportunidades. Son una PARTICIÓN de la bandeja: toda
 * fila cae en exactamente uno, incluso cuando sus campos se contradicen entre sí.
 *
 * El detalle operativo (GO/NO GO humano, en preparación, lista para presentar, presentada,
 * adjudicada, no adjudicada) NO desaparece: sigue viviendo íntegro en la tarjeta. Esto es sólo la
 * agrupación primaria con la que se navega la bandeja.
 */
export type TenderOpportunityStage = 'por_decidir' | 'en_curso' | 'cerradas';
export type TenderOpportunityPrimaryFilter = 'all' | TenderOpportunityStage;

/** Única fuente de verdad de los filtros primarios y sus rótulos. */
export const OPPORTUNITY_PRIMARY_FILTER_OPTIONS: readonly { value: TenderOpportunityPrimaryFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'por_decidir', label: 'Por decidir' },
  { value: 'en_curso', label: 'En curso' },
  { value: 'cerradas', label: 'Cerradas' },
];

/** Estados de oferta terminales: el proceso ya cerró y no admite más trabajo. */
const terminalOfferStatuses: readonly string[] = ['cerrada_no_go', 'adjudicada', 'no_adjudicada'];

type ClassifiableOpportunity = Partial<Pick<TenderOpportunitySummary, 'decision' | 'tender_offer_status'>> | null | undefined;

/**
 * Clasificador puro y total. El orden de las reglas es la regla:
 *
 *  1. Cerradas gana sobre cualquier campo contradictorio rancio — un NO GO humano cierra la
 *     oportunidad aunque el estado de oferta se haya quedado en preparación, y un estado terminal
 *     la cierra aunque la decisión vigente diga GO o falte.
 *  2. Sin decisión humana GO/NO GO (ausente o pendiente) está Por decidir, cualquiera sea el estado
 *     de oferta. La recomendación del sistema NUNCA sustituye a la decisión humana.
 *  3. El resto — GO humano y no terminal — está En curso, incluidas preparación, lista para
 *     presentar y presentada.
 *
 * Nunca lanza: una fila nula, sin campos o con valores desconocidos degrada de forma determinista.
 */
export function classifyOpportunityStage(row: ClassifiableOpportunity): TenderOpportunityStage {
  const status = String(row?.tender_offer_status || 'pendiente_decision');
  const rawDecision = row?.decision;
  const decision = rawDecision === 'go' || rawDecision === 'no_go' ? rawDecision : null;
  if (decision === 'no_go' || terminalOfferStatuses.includes(status)) return 'cerradas';
  if (!decision) return 'por_decidir';
  return 'en_curso';
}

export function matchesOpportunityPrimaryFilter(row: ClassifiableOpportunity, filter: TenderOpportunityPrimaryFilter): boolean {
  return filter === 'all' || classifyOpportunityStage(row) === filter;
}

export function isOpportunityPrimaryFilter(value: unknown): value is TenderOpportunityPrimaryFilter {
  return OPPORTUNITY_PRIMARY_FILTER_OPTIONS.some(option => option.value === value);
}

/**
 * El filtro de oportunidades no se persiste en la URL (vive sólo en el estado de la vista), así que
 * ningún valor del vocabulario anterior necesita sobrevivir a un enlace compartido: cualquier valor
 * desconocido o legado degrada a `all` en lugar de arrastrar una equivalencia inventada.
 */
export function normalizeOpportunityPrimaryFilter(value: unknown): TenderOpportunityPrimaryFilter {
  return isOpportunityPrimaryFilter(value) ? value : 'all';
}

/**
 * Envía el filtro primario tal cual al backend (RPC 023 / `/api/tender-opportunities`), que ahora
 * acepta el vocabulario primario directamente. Traducir a los predicados legados perdía filas: son
 * más estrechos que los estados primarios y el cliente no puede recuperar lo que el SQL no devolvió.
 * Un valor de selector legado o desconocido degrada a `all`, nunca a un predicado más estrecho.
 */
export function opportunityQueryFilter(filter: unknown): TenderOpportunityFilter {
  return normalizeOpportunityPrimaryFilter(filter);
}
