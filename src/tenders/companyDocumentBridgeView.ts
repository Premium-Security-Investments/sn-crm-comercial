import type { TenderCompanyDocumentRow, TenderCompanyDocumentState } from './types';

/**
 * Cómo se lee el puente ficha de empresa → expediente: etiquetas, orden y tono. Selectores puros, aparte del panel,
 * para que el orden —que es la decisión de producto— se pueda probar sin renderizar.
 */
export const TENDER_COMPANY_DOCUMENT_STATE_LABELS: Record<TenderCompanyDocumentState, string> = {
  vencido: 'Vencido',
  vence_antes_del_cierre: 'Vence antes del cierre',
  sin_archivo: 'Falta el soporte',
  vigencia_por_confirmar: 'Vigencia por confirmar',
  listo_al_cierre: 'Listo al cierre',
  sin_fecha_de_cierre: 'Sin fecha de cierre',
};

/** Primero lo que puede costar la oferta; lo que está listo, al final. */
export const TENDER_COMPANY_DOCUMENT_STATE_ORDER: TenderCompanyDocumentState[] = [
  'vencido', 'vence_antes_del_cierre', 'sin_archivo', 'vigencia_por_confirmar', 'sin_fecha_de_cierre', 'listo_al_cierre',
];

export function tenderCompanyDocumentStateTone(state: TenderCompanyDocumentState): string {
  if (state === 'vencido' || state === 'vence_antes_del_cierre') return 'tender-fit-bajo';
  if (state === 'sin_archivo') return 'tender-fit-por_validar';
  if (state === 'vigencia_por_confirmar' || state === 'sin_fecha_de_cierre') return 'badge-muted';
  return 'tender-fit-alto';
}

/**
 * Orden de lectura: por estado y, dentro del mismo estado, el hecho inscrito antes del trámite. Un trámite se
 * resuelve con una llamada; un hecho inscrito que falta a la fecha de cierre no lo arregla ningún trámite, así que
 * se ve primero (instrucción de Juan, 2026-10-21).
 */
export function sortTenderCompanyDocumentRows(rows: TenderCompanyDocumentRow[]): TenderCompanyDocumentRow[] {
  return [...rows].sort((left, right) => {
    const byState = TENDER_COMPANY_DOCUMENT_STATE_ORDER.indexOf(left.state) - TENDER_COMPANY_DOCUMENT_STATE_ORDER.indexOf(right.state);
    if (byState !== 0) return byState;
    const weight = (row: TenderCompanyDocumentRow) => (row.kind === 'tramite' ? 1 : 0);
    return weight(left) - weight(right) || left.label.localeCompare(right.label, 'es');
  });
}
