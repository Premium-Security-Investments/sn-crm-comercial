// AGT-002 — un análisis que se cae tiene que dejar rastro donde lo vea una persona.
//
// El 2026-10-26T00:51Z Juan escribió una aclaración sobre el RUP en la Mesa de Supersalud
// `SNS-LP-2-2026`; eso disparó el reanálisis incremental automático y a las 00:58:08Z falló
// (`model_call_failed`, con el diagnóstico `AGT002_CLAUDE_OUTPUT_TOO_LARGE` en la fase de síntesis).
// **No quedó nada**: ni una interacción, ni una línea en la oportunidad, ni un correo. La ficha siguió
// mostrando el análisis anterior como si nada hubiera pasado, y se supo tres horas después porque Juan
// preguntó si todo estaba bien. Un análisis que no termina y no avisa es peor que uno que no se pide:
// el que lo pidió cree que sus conclusiones ya están al día.
//
// El aviso dice tres cosas y ninguna más: que no terminó, por qué en lenguaje llano, y que lo vigente
// sigue siendo lo anterior. El motivo sale de un vocabulario cerrado de códigos propios —nunca del
// texto de un error, nunca de la salida del modelo—.
//
// El aviso se agrega con el UPDATE atómico del lado SQL (migración 116), que sólo agrega la línea si no
// está: dos fallos del mismo tipo el mismo día dejan una sola línea, y un reintento no la duplica.

/** Códigos de fallo del ejecutor y del worker, en llano. Vocabulario cerrado. */
export const AGT002_ANALYSIS_FAILURE_REASONS = Object.freeze({
  model_call_failed: 'el modelo no devolvió un resultado utilizable',
  budget_exceeded: 'el análisis superó su presupuesto de tokens o de costo',
  member_hash_mismatch: 'el expediente cambió mientras se analizaba',
  resume_invalid: 'el punto de reanudación guardado ya no servía',
  persistence_failure: 'no se pudo guardar el resultado',
  executor_failure: 'el ejecutor se interrumpió',
  lease_lost: 'el trabajo perdió su turno de ejecución',
});

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/**
 * '2026-10-26T00:58:08Z' → '25-oct' (día Bogotá). Mismo formato que los avisos de cambio de fase
 * (`bogotaDayLabel` en agt002-phase-change-followup.js), a propósito: las líneas de la oportunidad se
 * leen juntas. Se repite aquí para que este módulo no arrastre dependencias al worker.
 */
export function agt002FailureDayLabel(at = new Date()) {
  const ms = at instanceof Date ? at.getTime() : Date.parse(String(at || ''));
  if (!Number.isFinite(ms)) return '';
  const local = new Date(ms - 5 * 3_600_000);
  return `${local.getUTCDate()}-${MONTHS[local.getUTCMonth()]}`;
}

export function agt002AnalysisFailureLine({ errorCode, at = new Date() } = {}) {
  const reason = AGT002_ANALYSIS_FAILURE_REASONS[String(errorCode || '')] || 'por una causa no tipificada';
  const day = agt002FailureDayLabel(at);
  return `Vig-IA: el análisis${day ? ` del ${day}` : ''} no terminó (${reason}). El análisis vigente sigue siendo el anterior, así que no hay conclusiones nuevas: volver a pedirlo y, si se repite, avisar a Innovación.`;
}

/**
 * Deja el aviso en las observaciones de la oportunidad. Pensada para inyectarse como `announceFailure`
 * del worker. No lanza por un aviso: el trabajo ya quedó marcado como fallido, que es lo que importa.
 */
export async function announceAgt002AnalysisFailure(database, { opportunityId, errorCode, at = new Date() } = {}) {
  if (!opportunityId) return { announced: false, reason: 'sin_oportunidad' };
  const line = agt002AnalysisFailureLine({ errorCode, at });
  const { error } = await database.rpc('psi_append_opportunity_observation_line', {
    p_opportunity_id: opportunityId,
    p_line: line,
  });
  if (error) return { announced: false, reason: 'append_failed' };
  return { announced: true, line };
}
