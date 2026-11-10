// La semana de licitaciones en Mi día (Juan, 2026-11-10): «un resumen del cronograma para que en una visual rápida
// pueda ver qué tiene pendiente para hoy y los siguientes días, no importa el estado del proceso». La semana completa,
// con hoy destacado.
//
// Por qué: Mi día sólo avisaba de tres cosas (cronograma faltante, vencidos que tumban la oferta y cierres sin
// registrar), y lo urgente que no cae ahí no se veía: observaciones de Manizales y Metro, el cierre de Fiscalía, la
// subsanación de Terminal (ya presentada, y por eso fuera del tablero). Las fechas ya están en el cronograma que Vig-IA
// extrae de cada proceso; aquí sólo se juntan las de los próximos días. Módulo puro.

export const TENDER_SEMANA_DIAS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value);

/** El día en Bogotá de un plazo. Un plazo a medianoche (UTC o Bogotá) es una fecha sin hora: vale su fecha escrita. */
export function tenderSemanaDia(value) {
  if (!isDay(value)) return null;
  if (/T00:00(?::00(?:\.0+)?)?(?:Z|\+00:00|-05:00)$/.test(value) || value.length === 10) return value.slice(0, 10);
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(instant);
}

/** ¿El plazo trae hora? Medianoche se toma como «sin hora». */
export function tenderSemanaTieneHora(value) {
  if (!isDay(value) || value.length === 10) return false;
  return !/T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value);
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Los hitos de los próximos `dias` días (hoy incluido) de los procesos dados, en orden de fecha y hora.
 * `processes`: [{ opportunity_id, entity, ref, offer_status, deadlines: [{ kind, value, label, certainty }] }].
 */
export function buildTenderSemana({ processes = [], today, dias = TENDER_SEMANA_DIAS } = {}) {
  if (!isDay(today)) throw new Error('buildTenderSemana: falta la fecha de hoy (YYYY-MM-DD).');
  const last = addDays(today, dias - 1);
  const items = [];
  for (const process of processes || []) {
    const seen = new Set();
    for (const deadline of process?.deadlines || []) {
      const day = tenderSemanaDia(deadline?.value);
      if (!day || day < today || day > last) continue;
      const label = (typeof deadline.label === 'string' && deadline.label.trim()) || String(deadline.kind || 'Fecha del cronograma');
      const key = `${label}|${deadline.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        opportunity_id: process.opportunity_id,
        entity: process.entity || null,
        ref: process.ref || null,
        offer_status: process.offer_status || null,
        label,
        kind: deadline.kind || null,
        value: deadline.value,
        day,
        tiene_hora: tenderSemanaTieneHora(deadline.value),
        por_confirmar: Boolean(deadline.certainty) && deadline.certainty !== 'CONFIRMED',
        dias: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS),
      });
    }
  }
  // Hoy primero; dentro del día, lo que tiene hora en orden de hora y lo que no tiene hora al final.
  items.sort((a, b) => a.day.localeCompare(b.day)
    || Number(b.tiene_hora) - Number(a.tiene_hora)
    || (a.tiene_hora && b.tiene_hora ? Date.parse(a.value) - Date.parse(b.value) : 0)
    || String(a.entity || '').localeCompare(String(b.entity || '')));
  return { today, hasta: last, dias, items, hoy: items.filter(item => item.day === today).length };
}
