import { classifyOpportunityStage, isOpportunityPrimaryFilter, matchesOpportunityPrimaryFilter, type TenderOpportunityPrimaryFilter } from './opportunityStage';
import type { TenderModuleView, TenderOpportunityFilter, TenderOpportunitySummary } from './types';

const tenderOpportunityFilters: readonly TenderOpportunityFilter[] = ['all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed', 'archivadas'];

/**
 * Acepta el vocabulario primario (`all` / `por_decidir` / `en_curso` / `cerradas`), que es una
 * partición y delega en el clasificador puro, y además el vocabulario del backend, que sigue vivo
 * porque el RPC 023 y `/api/tender-opportunities` no cambian y sus predicados se solapan entre sí.
 */
export function filterOpportunitySummaries(rows: TenderOpportunitySummary[], filter: TenderOpportunityFilter | TenderOpportunityPrimaryFilter): TenderOpportunitySummary[] {
  if (isOpportunityPrimaryFilter(filter)) return filter === 'all' ? rows : rows.filter(row => matchesOpportunityPrimaryFilter(row, filter));
  if (!tenderOpportunityFilters.includes(filter)) throw new Error('Filtro de oportunidades inválido.');
  return rows.filter(row => {
    const status = row.tender_offer_status || 'pendiente_decision';
    if (filter === 'pending_decision') return status === 'pendiente_decision' && !row.decision;
    if (filter === 'go_authorized') return ['en_preparacion', 'lista_para_presentar', 'presentada'].includes(status) && row.decision === 'go';
    if (filter === 'in_preparation') return ['en_preparacion', 'lista_para_presentar'].includes(status);
    if (filter === 'submitted') return status === 'presentada';
    return ['cerrada_no_go', 'adjudicada', 'no_adjudicada'].includes(status);
  });
}

export function normalizeTenderModuleView(value: string): TenderModuleView {
  if (value === 'expedientes') return 'oportunidades';
  if (value === 'perfiles') return 'configuracion';
  return value === 'seguimiento' || value === 'oportunidades' || value === 'configuracion' ? value : 'radar';
}

export function dossierPageQuery(page: number, limit: number) {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit) || 50));
  const safePage = Math.max(1, Math.trunc(page) || 1);
  return { limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

export function profileRadarHash(profileId: string) {
  return `#/tenders?view=radar&profile=${encodeURIComponent(profileId)}`;
}

export function focusDocumentReviewArea(target: { scrollIntoView: (options: ScrollIntoViewOptions) => void; focus: () => void } | null | undefined) {
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.focus();
  return true;
}

export async function reloadCurrentDossierPage<T>(page: number, limit: number, loadPage: (query: { limit: number; offset: number }) => Promise<T>) {
  return loadPage(dossierPageQuery(page, limit));
}

// Punto (3) del contrato del 2026-09-29: en "Todas" la lista se lee en bloques. Lo que espera decisión va
// primero, después lo que está en curso y al final lo cerrado. Hasta ahora el bloque no contaba para nada y
// sólo mandaba la fecha, así que una licitación ya cerrada podía quedar encima de una que esperaba decisión.
// Dentro de cada bloque no cambia nada: sigue el mismo orden por fecha de cierre de siempre. En los filtros de
// un solo estado esto no tiene efecto, porque todas las filas caen en el mismo bloque.
const OPPORTUNITY_STAGE_RANK: Record<string, number> = { por_decidir: 0, en_curso: 1, cerradas: 2, archivadas: 3 };

type SortableOpportunity = Partial<Pick<TenderOpportunitySummary, 'decision' | 'tender_offer_status' | 'archived_at'>>
  & { expected_close_date?: string | null; last_updated_at?: string | null; opportunity_id: string };

function stageRank(row: SortableOpportunity): number {
  const rank = OPPORTUNITY_STAGE_RANK[classifyOpportunityStage(row)];
  return rank === undefined ? OPPORTUNITY_STAGE_RANK.archivadas : rank;
}

export function sortTenderOpportunitySummaries<T extends SortableOpportunity>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const aDate = a.expected_close_date || '9999-12-31';
    const bDate = b.expected_close_date || '9999-12-31';
    return stageRank(a) - stageRank(b)
      || aDate.localeCompare(bDate) || String(b.last_updated_at || '').localeCompare(String(a.last_updated_at || '')) || a.opportunity_id.localeCompare(b.opportunity_id);
  });
}
