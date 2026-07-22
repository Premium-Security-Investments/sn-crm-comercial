import type { TenderModuleView } from './types';

export function normalizeTenderModuleView(value: string): TenderModuleView {
  if (value === 'expedientes') return 'oportunidades';
  if (value === 'perfiles') return 'configuracion';
  return value === 'seguimiento' || value === 'oportunidades' || value === 'configuracion' ? value : 'radar';
}

export function dossierPageQuery(page: number, limit: number) {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit) || 50));
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
