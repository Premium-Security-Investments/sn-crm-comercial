// AGT-003 — cuánto lleva una oportunidad en su etapa, y cuándo eso es un estancamiento (Juan, 2026-10-22).
//
// La fecha de entrada a la etapa (`stage_entered_at`, migración 145) viene de dos orígenes y no se tratan igual:
//   · medida  (`stage_entered_at_measured = true`): el sistema la puso al cambiar la etapa. Los días son exactos.
//   · sembrada (false): se usó `updated_at`, que es igual o POSTERIOR a la entrada real. Los días son una cota
//     inferior, así que el texto dice "al menos N días" y nunca un número exacto que no podemos sostener.
//
// El umbral lo fija cada etapa (`staleness_days`). Una etapa sin umbral no se vigila; las terminales no lo tienen.
// Según la especificación del 2026-10-22, el aviso se apaga si hay próxima gestión con fecha futura: ya hay un
// compromiso vigente y no hace falta un segundo recordatorio.
//
// Módulo puro: no lee red ni base, y no altera lo que recibe.
//
// Es JavaScript con sus tipos en `stage-staleness.d.ts`, y no TypeScript, por una razón concreta (2026-10-23): el
// correo semanal (`weekly-digest.js`) corre en Node sin compilar y necesita esta misma regla. Mientras vivió en
// TypeScript, el correo no podía importarla y la alternativa era copiarla: dos definiciones de "estancada" que el
// día que una cambie dirían cosas distintas sobre la misma oportunidad. Es el mismo patrón de `client-profile.js` y
// `commercial-behavior.js`.

const DAY_MS = 86_400_000;

/** @type {import('./stage-staleness.js').StageStaleness} */
const NOT_STALE = { stale: false, days: null, atLeast: false, label: '' };

function ms(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Postgres entrega "2026-10-21 13:07:56.568+00": espacio en vez de T y desfase sin minutos.
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Cuánto lleva en la etapa y si eso ya es un estancamiento. */
export function stageStaleness({
  stageEnteredAt = null, measured = false, stalenessDays = null, nextActionAt = null, stageName = null, now = new Date(),
} = {}) {
  const enteredAt = ms(stageEnteredAt);
  const nowMs = ms(now);
  if (enteredAt === null || nowMs === null) return NOT_STALE;

  const days = Math.max(0, Math.floor((nowMs - enteredAt) / DAY_MS));
  const atLeast = measured !== true;
  const threshold = Number.isInteger(stalenessDays) && Number(stalenessDays) > 0 ? Number(stalenessDays) : null;
  const inStage = stageName ? ` en ${stageName}` : '';
  const label = atLeast ? `Lleva al menos ${days} día(s)${inStage}.` : `Lleva ${days} día(s)${inStage}.`;

  if (threshold === null) return { stale: false, days, atLeast, label };
  // Una próxima gestión con fecha futura ya es el compromiso: no se avisa dos veces por lo mismo.
  const next = ms(nextActionAt);
  const committed = next !== null && next > nowMs;
  return { stale: days >= threshold && !committed, days, atLeast, label };
}

/**
 * Las estancadas de una lista, de la más parada a la menos. Es la ÚNICA definición de "estancada" del producto
 * (Juan, 2026-10-22). Hasta hoy convivía con "Sustentación estancada": una vista de base con el umbral de 5 días
 * escrito dentro, sólo para esa etapa, y que medía días sin contacto en vez de días en la etapa. El tablero decía
 * una cosa y Mi día otra sobre la misma oportunidad; medido el 22 de octubre, la vieja marcaba 3 y la nueva 0, sin
 * una sola oportunidad en común.
 */
export function stalledInStage(opportunities, now = new Date()) {
  return (opportunities || [])
    .map(opportunity => ({
      opportunity,
      stall: stageStaleness({
        stageEnteredAt: opportunity.stage_entered_at, measured: opportunity.stage_entered_at_measured,
        stalenessDays: opportunity.staleness_days, nextActionAt: opportunity.next_action_at,
        stageName: opportunity.stage_name, now,
      }),
    }))
    .filter(row => row.stall.stale)
    .sort((a, b) => (b.stall.days || 0) - (a.stall.days || 0));
}
