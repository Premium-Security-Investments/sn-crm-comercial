// El cierre lo manda el pliego (Juan, 2026-11-15: «vamos a confiarnos en la información del pliego, que es la que
// manda»).
//
// Por qué: SECOP datos abiertos traía para la Rama de Pereira `fecha_de_recepcion_de` 26-nov, y el pliego definitivo dice
// 25-nov 4:00 p. m. La conciliación diaria mueve el cierre hacia adelante cuando la fuente trae una fecha posterior, así
// que la corrección hecha a mano el 14-nov se perdió y el CRM volvió a mostrar 26. Un día de más en el cierre es el
// error que más cuesta.
//
// Regla: cuando el último análisis de Vig-IA leyó en el pliego (o en una adenda) la fecha de presentación de ofertas y la
// marcó CONFIRMED, esa fecha queda como cierre (`deadline_at` con su hora, `raw.deadline` con su día en Bogotá) y se
// marca `raw.deadline_source = 'pliego'`. Desde ahí, ni la conciliación con SECOP ni la revisión de fases la cambian: si la
// fuente trae otra, se anota como diferencia. Una adenda que mueva el cierre llega por el reanálisis, que trae la fecha
// nueva y vuelve a mandar. Módulo puro salvo `aplicarCierresDelPliego`.

import { readAgt002InitialAnalysisReport } from './agt002-initial-analysis-report.js';
import { tenderSemanaDia } from './tender-semana.js';

export const CIERRE_DEL_PLIEGO = 'pliego';

/** ¿El cierre de esta fila lo fija el pliego? */
export function cierreMandaElPliego(raw) {
  return raw?.deadline_source === CIERRE_DEL_PLIEGO;
}

/**
 * La fecha de presentación de ofertas que el análisis leyó confirmada en el pliego. Si hay dos confirmadas distintas
 * (el análisis se contradice), no se escoge: null.
 */
export function cierreDelPliego(deadlines = []) {
  const confirmed = (deadlines || []).filter(deadline => deadline?.kind === 'SUBMISSION' && deadline?.certainty === 'CONFIRMED'
    && typeof deadline.value === 'string' && !Number.isNaN(Date.parse(deadline.value)));
  const instants = [...new Set(confirmed.map(deadline => Date.parse(deadline.value)))];
  if (instants.length !== 1) return null;
  const value = confirmed[0].value;
  return { value, deadline_at: new Date(instants[0]).toISOString(), day: tenderSemanaDia(value), label: confirmed[0].label || null };
}

/** Lo que hay que escribir en `psi_public_tenders` para que mande el pliego; null si ya está así. */
export function planCierrePliego(row, cierre, { analysisRunId = null, now = new Date().toISOString() } = {}) {
  if (!row || !cierre?.day) return null;
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const same = cierreMandaElPliego(raw) && raw.deadline === cierre.day && Date.parse(row.deadline_at) === Date.parse(cierre.deadline_at);
  if (same) return null;
  return {
    deadline_at: cierre.deadline_at,
    raw: { ...raw, deadline: cierre.day, deadline_source: CIERRE_DEL_PLIEGO,
      deadline_pliego: { value: cierre.value, label: cierre.label, analysis_run_id: analysisRunId, applied_at: now,
        previous_deadline_at: row.deadline_at || null, previous_raw_deadline: raw.deadline || null } },
  };
}

/**
 * Para cada licitación convertida en una oportunidad abierta: si su último análisis trae el cierre confirmado del pliego,
 * lo aplica a la fila del Radar y a la fecha de cierre de la oportunidad. Devuelve el resumen; los errores de una fila no
 * detienen las demás.
 */
export async function aplicarCierresDelPliego(database, { now = () => new Date().toISOString() } = {}) {
  const { data: tenders, error } = await database.from('psi_public_tenders')
    .select('id,deadline_at,raw,converted_opportunity_id').eq('internal_status', 'convertida_oportunidad').not('converted_opportunity_id', 'is', null);
  if (error) throw error;
  const ids = (tenders || []).map(row => row.converted_opportunity_id);
  const { data: opportunities, error: opportunityError } = ids.length
    ? await database.from('psi_sales_opportunities').select('id,expected_close_date,archived_at,deleted_at,discarded_at,lost_at').in('id', ids)
    : { data: [], error: null };
  if (opportunityError) throw opportunityError;
  const open = new Map((opportunities || []).filter(row => !row.archived_at && !row.deleted_at && !row.discarded_at && !row.lost_at).map(row => [row.id, row]));
  const summary = { revisadas: 0, aplicadas: 0, sin_cierre_confirmado: 0, errores: [] };
  for (const row of tenders || []) {
    const opportunity = open.get(row.converted_opportunity_id);
    if (!opportunity) continue;
    summary.revisadas += 1;
    try {
      const report = await readAgt002InitialAnalysisReport(database, opportunity.id);
      const cierre = report?.available && report.report ? cierreDelPliego(report.report.deadlines) : null;
      if (!cierre) { summary.sin_cierre_confirmado += 1; continue; }
      const patch = planCierrePliego(row, cierre, { analysisRunId: report.report.runId || null, now: now() });
      if (patch) {
        const { error: writeError } = await database.from('psi_public_tenders').update(patch).eq('id', row.id);
        if (writeError) throw writeError;
        summary.aplicadas += 1;
      }
      if (opportunity.expected_close_date !== cierre.day) {
        const { error: oppError } = await database.from('psi_sales_opportunities').update({ expected_close_date: cierre.day }).eq('id', opportunity.id);
        if (oppError) throw oppError;
      }
    } catch (rowError) {
      summary.errores.push({ id: row.id, message: rowError?.message || String(rowError) });
    }
  }
  return summary;
}
