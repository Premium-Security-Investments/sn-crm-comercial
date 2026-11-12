// Estudios de Seguridad Física: vencimiento y revaloración (migración 209; Juan, 2026-11-11: "vamos adelante").
//
// Héctor Martínez (reunión del 2026-11-11): "como mínimo cada 6 meses y como máximo cada 3 años", según el puesto, y
// antes si cambian las instalaciones o hay un siniestro: "el estudio de seguridad es el que nos blinda". Aquí sólo hay
// cálculo: la fecha de vencimiento sale de la aprobación de la última versión y la frecuencia del estudio; la
// revaloración la piden una persona (cambio de instalaciones), las novedades graves de SecurityOps posteriores o el
// indicador por riesgo (las novedades de la sede ya superan la probabilidad calificada; sugerencia.js).
import { riskIndicators } from './sugerencia.js';

export const RENEWAL_OPTIONS = Object.freeze([
  Object.freeze({ meses: 6, etiqueta: 'Cada 6 meses', cuando: 'puesto crítico con requisito normativo (BASC, OEA)' }),
  Object.freeze({ meses: 12, etiqueta: 'Cada año', cuando: 'requisito normativo (BASC, OEA) o puesto crítico' }),
  Object.freeze({ meses: 24, etiqueta: 'Cada 2 años', cuando: 'procedimiento de la empresa' }),
  Object.freeze({ meses: 36, etiqueta: 'Cada 3 años', cuando: 'puesto no crítico' }),
]);
export const RENEWAL_MONTHS = new Set(RENEWAL_OPTIONS.map(item => item.meses));
export const WARNING_DAYS = 60;

const DAY = 86400e3;
const bogotaDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(value));

function addMonths(isoDay, months) {
  const [year, month, day] = isoDay.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
}

/**
 * La vigencia de un estudio.
 * `approvedAt`: la aprobación de la última versión (o null). `securityops`: lo traído para el estudio (summary.altas_fechas).
 * Devuelve { estado: 'sin_aprobar' | 'vigente' | 'por_vencer' | 'vencido', aprobado, vence, dias, meses, revalorar: [...] }.
 */
export function studyValidity(study, { approvedAt = null, securityops = null, risks = null, catalog = null, now = new Date() } = {}) {
  const meses = RENEWAL_MONTHS.has(Number(study.renewal_months)) ? Number(study.renewal_months) : 24;
  if (!approvedAt) return { estado: 'sin_aprobar', aprobado: null, vence: null, dias: null, meses, revalorar: [] };
  const aprobado = bogotaDay(approvedAt);
  const vence = addMonths(aprobado, meses);
  const today = bogotaDay(now);
  const dias = Math.round((Date.parse(`${vence}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / DAY);
  const estado = dias < 0 ? 'vencido' : dias <= WARNING_DAYS ? 'por_vencer' : 'vigente';

  const revalorar = [];
  if (study.revaluation_requested_at && new Date(study.revaluation_requested_at).getTime() > new Date(approvedAt).getTime()) {
    revalorar.push({ motivo: 'pedida', fecha: bogotaDay(study.revaluation_requested_at), detalle: study.revaluation_note || 'Revaloración pedida.' });
  }
  const graves = (securityops?.data?.status === 'ok' ? securityops.data.summary?.novedades?.altas_fechas || [] : []).filter(day => day > aprobado).sort();
  if (graves.length) {
    revalorar.push({ motivo: 'siniestro', fecha: graves.at(-1), detalle: `${graves.length} ${graves.length === 1 ? 'novedad' : 'novedades'} de prioridad alta o crítica en SecurityOps después de la aprobación (la última, ${graves.at(-1)}).` });
  }
  // Indicador por riesgo: las novedades de la sede superan la probabilidad calificada.
  for (const item of risks ? riskIndicators({ risks, catalog, securityops }) : []) {
    revalorar.push({ motivo: 'indicador', fecha: today, riesgo: item.riesgo, detalle: item.detalle });
  }
  return { estado, aprobado, vence, dias, meses, revalorar };
}

/** Pedir revaloración (cambio de instalaciones u otro motivo). Lo decide la ruta: quien prepara, revisa o aprueba. */
export async function requestRevaluation(db, study, body = {}, now = new Date()) {
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim() : '';
  if (note.length < 3 || note.length > 1000) throw Object.assign(new Error('Escriba el motivo de la revaloración (por ejemplo, el cambio en las instalaciones).'), { status: 400 });
  const { error } = await db.from('psi_security_studies').update({ revaluation_requested_at: now.toISOString(), revaluation_note: note }).eq('id', study.id);
  if (error) throw error;
  return { requested: true };
}
