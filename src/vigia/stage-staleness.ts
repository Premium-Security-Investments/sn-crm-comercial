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

const DAY_MS = 86_400_000;

export type StageStalenessInput = {
  stageEnteredAt?: string | null;
  measured?: boolean | null;
  stalenessDays?: number | null;
  nextActionAt?: string | null;
  stageName?: string | null;
  now?: Date;
};

export type StageStaleness = {
  /** Supera el umbral de su etapa y no hay próxima gestión futura. */
  stale: boolean;
  /** Días completos en la etapa; cota inferior si `atLeast`. `null` si no se puede saber. */
  days: number | null;
  /** true cuando la fecha fue sembrada: los días son un mínimo, no un dato exacto. */
  atLeast: boolean;
  /** Texto para la persona, vacío si no hay nada que decir. */
  label: string;
};

const NOT_STALE: StageStaleness = { stale: false, days: null, atLeast: false, label: '' };

function ms(value?: string | null): number | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  // Postgres entrega "2026-10-21 13:07:56.568+00": espacio en vez de T y desfase sin minutos.
  const parsed = Date.parse(text.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Cuánto lleva en la etapa y si eso ya es un estancamiento. */
export function stageStaleness({
  stageEnteredAt = null, measured = false, stalenessDays = null, nextActionAt = null, stageName = null, now = new Date(),
}: StageStalenessInput = {}): StageStaleness {
  const enteredAt = ms(stageEnteredAt);
  const nowMs = now instanceof Date ? now.getTime() : ms(now as unknown as string);
  if (enteredAt === null || nowMs === null || !Number.isFinite(nowMs)) return NOT_STALE;

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
