// Mejora 1 (encargo desde Terminal; Juan, 2026-11-05: «déjelo en la plataforma únicamente por ahora»): lo vencido del
// expediente, ordenado por consecuencia, con una sola regla para todas las pantallas —Preparar, el tablero de procesos
// abiertos y «Mi día»— para que nunca digan cosas distintas. Módulo puro; lo usan el navegador y el servidor.
//
// En TT-SPO-07 trece ítems llegaron al cierre en `pendiente` con fechas vencidas y nadie se enteró.

/** @typedef {'no_subsanable' | 'causa_rechazo' | 'obligatorio' | 'otro'} DossierConsequence */

export const DOSSIER_CONSEQUENCE_LABEL = Object.freeze({
  no_subsanable: 'No se subsana',
  causa_rechazo: 'Causa rechazo',
  obligatorio: 'Obligatorio',
  otro: 'Otro',
});
const RANK = { no_subsanable: 0, causa_rechazo: 1, obligatorio: 2, otro: 3 };
const REJECTION_SUFFIX = /\s*[—-]\s*CAUSA RECHAZO\s*$/i;
const NOT_CURABLE = /\bno (?:se )?(?:puede |es )?subsanab|\bno (?:se )?(?:puede )?subsana|\binsubsanable/;
const fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const dayNumber = isoDate => {
  const [year, month, day] = String(isoDate || '').slice(0, 10).split('-').map(Number);
  return year && month && day ? Date.UTC(year, month - 1, day) / 86_400_000 : null;
};

/** Abierto = lo que la lista de tareas muestra como pendiente: aplica, no es documento de la plantilla y no está listo. */
export function isOpenDossierItem(item) {
  return item?.applicability !== 'no_aplica' && !(item?.item_type === 'documento' && item?.origin === 'seed_go') && item?.status !== 'listo';
}

/** La consecuencia de no tener el ítem, leída del título y de lo que escribieron el análisis y las personas. */
export function dossierItemConsequence(item) {
  const text = fold([item?.title, item?.instruction, item?.latest_evidence?.text].filter(Boolean).join(' \n '));
  if (NOT_CURABLE.test(text)) return 'no_subsanable';
  if (REJECTION_SUFFIX.test(String(item?.title || '')) || /\bcausa(?:l)? (?:de )?rechazo\b/.test(text)) return 'causa_rechazo';
  return item?.required ? 'obligatorio' : 'otro';
}

/** Abiertos con fecha meta antes de `today` (YYYY-MM-DD, Bogotá): por consecuencia y luego por días de atraso. */
export function overdueByConsequence(items = [], today) {
  const todayNumber = dayNumber(today);
  return items
    .filter(item => isOpenDossierItem(item) && item.target_date && String(item.target_date).slice(0, 10) < today)
    .map(item => ({ item, consequence: dossierItemConsequence(item), daysLate: todayNumber !== null ? todayNumber - (dayNumber(item.target_date) ?? todayNumber) : 0 }))
    .sort((a, b) => RANK[a.consequence] - RANK[b.consequence] || b.daysLate - a.daysLate);
}

/** Lo que no se subsana y sigue abierto, venza o no. */
export function openNotCurable(items = []) {
  return items.filter(item => isOpenDossierItem(item) && dossierItemConsequence(item) === 'no_subsanable');
}

/**
 * El resumen que muestran el tablero y «Mi día»: cuántos vencidos tumban la oferta (no se subsana o causa rechazo),
 * cuántos hay en total, lo no subsanable abierto, y los tres primeros por nombre.
 */
export function overdueSummary(items = [], today) {
  const overdue = overdueByConsequence(items, today);
  return {
    vencidos: overdue.length,
    vencidos_que_tumban: overdue.filter(entry => entry.consequence === 'no_subsanable' || entry.consequence === 'causa_rechazo').length,
    no_subsanables_abiertos: openNotCurable(items).length,
    primeros: overdue.slice(0, 3).map(entry => ({
      titulo: String(entry.item.title || '').replace(REJECTION_SUFFIX, '').trim().slice(0, 160),
      consecuencia: entry.consequence,
      dias_vencido: entry.daysLate,
      responsable: entry.item.assignee_name || null,
    })),
  };
}
