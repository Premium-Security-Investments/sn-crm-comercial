import type { TenderDossierItem } from './types';

/**
 * Lista de trabajo de la oferta (Preparación). Ordena y agrupa los ítems del expediente para que lo
 * que falta se lea primero y lo terminado, lo que no aplica y los documentos de plantilla no ocupen
 * la pantalla. Solo presenta: el estado sigue viviendo en las acciones del expediente.
 */
export type DossierItemTitle = { area: string | null; label: string; rejection: boolean };
export type DossierDueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none';
export type DossierChecklistGroups = {
  open: TenderDossierItem[];
  done: TenderDossierItem[];
  templateDocuments: TenderDossierItem[];
  notApplicable: TenderDossierItem[];
};

const REJECTION_SUFFIX = /\s*[—-]\s*CAUSA RECHAZO\s*$/i;
const KNOWN_AREAS = new Set(['Jurídico', 'Financiero', 'Licitaciones', 'Operaciones', 'Comercial', 'Técnico', 'Gerencia']);

/** "Jurídico · Sedes … — CAUSA RECHAZO" → área, texto y marca de rechazo. Títulos sin área quedan igual. */
export function parseDossierItemTitle(title: string): DossierItemTitle {
  const rejection = REJECTION_SUFFIX.test(title);
  const clean = title.replace(REJECTION_SUFFIX, '').trim();
  const separator = clean.indexOf(' · ');
  const area = separator > 0 ? clean.slice(0, separator).trim() : '';
  if (area && KNOWN_AREAS.has(area)) return { area, label: clean.slice(separator + 3).trim(), rejection };
  return { area: null, label: clean, rejection };
}

function dayNumber(isoDate: string): number | null {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / 86_400_000 : null;
}

export function dossierDueTone(targetDate: string | null, today: Date): DossierDueTone {
  const target = targetDate ? dayNumber(targetDate) : null;
  if (target == null) return 'none';
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000;
  const remaining = target - now;
  if (remaining < 0) return 'overdue';
  if (remaining === 0) return 'today';
  if (remaining <= 2) return 'soon';
  return 'later';
}

const STATUS_ORDER: Record<TenderDossierItem['status'], number> = { bloqueado: 0, en_progreso: 1, pendiente: 2, listo: 3 };

function compareOpen(a: TenderDossierItem, b: TenderDossierItem): number {
  const rejection = Number(parseDossierItemTitle(b.title).rejection) - Number(parseDossierItemTitle(a.title).rejection);
  const dateA = a.target_date || '9999-12-31';
  const dateB = b.target_date || '9999-12-31';
  return (dateA < dateB ? -1 : dateA > dateB ? 1 : 0)
    || rejection
    || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || Number(b.required) - Number(a.required)
    || a.title.localeCompare(b.title, 'es');
}

export function groupDossierChecklist(items: TenderDossierItem[]): DossierChecklistGroups {
  const groups: DossierChecklistGroups = { open: [], done: [], templateDocuments: [], notApplicable: [] };
  for (const item of items) {
    if (item.applicability === 'no_aplica') groups.notApplicable.push(item);
    // Los documentos de la plantilla repiten la lista "Documentos de la oferta": se muestran aparte y cerrados.
    else if (item.item_type === 'documento' && item.origin === 'seed_go') groups.templateDocuments.push(item);
    else if (item.status === 'listo') groups.done.push(item);
    else groups.open.push(item);
  }
  groups.open.sort(compareOpen);
  return groups;
}

/** Fecha corta en español sin depender de la zona horaria: "mié 14-oct". */
export function formatDossierDate(isoDate: string | null): string {
  const days = isoDate ? dayNumber(isoDate) : null;
  if (days == null) return 'Sin fecha';
  const date = new Date(days * 86_400_000);
  const weekday = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][date.getUTCDay()];
  const month = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][date.getUTCMonth()];
  return `${weekday} ${date.getUTCDate()}-${month}`;
}
