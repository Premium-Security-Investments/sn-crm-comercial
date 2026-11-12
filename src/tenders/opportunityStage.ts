import type { TenderOpportunityFilter, TenderOpportunitySummary } from './types';

/**
 * Los tres estados primarios de la bandeja de oportunidades. Son una PARTICIÓN de la bandeja: toda
 * fila cae en exactamente uno, incluso cuando sus campos se contradicen entre sí.
 *
 * El detalle operativo (GO/NO GO humano, en preparación, lista para presentar, presentada,
 * adjudicada, no adjudicada) NO desaparece: sigue viviendo íntegro en la tarjeta. Esto es sólo la
 * agrupación primaria con la que se navega la bandeja.
 */
export type TenderOpportunityStage = 'por_decidir' | 'en_curso' | 'cerradas' | 'archivadas';
export type TenderOpportunityPrimaryFilter = 'all' | TenderOpportunityStage;

/** Única fuente de verdad de los filtros primarios y sus rótulos. */
export const OPPORTUNITY_PRIMARY_FILTER_OPTIONS: readonly { value: TenderOpportunityPrimaryFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'por_decidir', label: 'Por decidir' },
  { value: 'en_curso', label: 'En curso' },
  { value: 'archivadas', label: 'Archivadas' },
];

/** Estados de oferta terminales: el proceso ya cerró y no admite más trabajo. */
const terminalOfferStatuses: readonly string[] = ['cerrada_no_go', 'adjudicada', 'no_adjudicada'];

type ClassifiableOpportunity = Partial<Pick<TenderOpportunitySummary, 'decision' | 'tender_offer_status' | 'archived_at'>> | null | undefined;

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
  if (row?.archived_at) return 'archivadas';
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

/**
 * Cuántas oportunidades hay detrás de cada filtro primario (Juan, 2026-11-12: «cuando uno entra a oportunidades no sabe
 * cuántas tiene»). Con el mismo clasificador de la bandeja, para que el número coincida con lo que muestra el filtro.
 */
export type OpportunityStageCounts = { all: number; por_decidir: number; en_curso: number; cerradas: number };
export function countOpportunityStages(rows: ClassifiableOpportunity[]): OpportunityStageCounts {
  // Juan, 2026-11-12: las cerradas (NO GO o con resultado) no cuentan en Todas; Todas = Por decidir + En curso.
  const counts = { all: 0, por_decidir: 0, en_curso: 0, cerradas: 0 };
  for (const row of rows) {
    const stage = classifyOpportunityStage(row);
    if (stage === 'archivadas') continue;
    if (stage === 'cerradas') { counts.cerradas += 1; continue; }
    counts.all += 1;
    counts[stage] += 1;
  }
  return counts;
}

/** Lo que va en «Todas» (Juan, 2026-11-12): sin cerradas ni archivadas. Pura. */
export function isActiveOpportunity(row: ClassifiableOpportunity): boolean {
  const stage = classifyOpportunityStage(row);
  return stage === 'por_decidir' || stage === 'en_curso';
}

/**
 * Los grupos de «Ver cerradas» (Juan, 2026-11-12): No GO (decidimos no presentarnos), Archivadas (se archivaron por
 * otra razón: con GO pero no nos presentamos, o de prueba) y Con resultado (adjudicada o no adjudicada). Pura.
 */
export type ClosedOpportunityGroup = 'no_go' | 'archivadas' | 'con_resultado';
export const CLOSED_OPPORTUNITY_GROUPS: readonly { value: ClosedOpportunityGroup; label: string; hint: string }[] = [
  { value: 'no_go', label: 'No GO', hint: 'Decidimos no presentarnos.' },
  { value: 'archivadas', label: 'Archivadas', hint: 'Se archivaron por otra razón: con GO pero no nos presentamos, o de prueba.' },
  { value: 'con_resultado', label: 'Con resultado', hint: 'Presentadas y ya adjudicadas o no adjudicadas.' },
];
export function closedOpportunityGroup(row: ClassifiableOpportunity): ClosedOpportunityGroup {
  if (row?.archived_at) return 'archivadas';
  return ['adjudicada', 'no_adjudicada'].includes(String(row?.tender_offer_status || '')) ? 'con_resultado' : 'no_go';
}
