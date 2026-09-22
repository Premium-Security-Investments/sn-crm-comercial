import { isOpportunityPrimaryFilter, matchesOpportunityPrimaryFilter, type TenderOpportunityPrimaryFilter } from './opportunityStage';
import type { TenderModuleView, TenderOpportunityFilter, TenderOpportunitySummary } from './types';

const tenderOpportunityFilters: readonly TenderOpportunityFilter[] = ['all', 'pending_decision', 'go_authorized', 'in_preparation', 'submitted', 'closed'];

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
