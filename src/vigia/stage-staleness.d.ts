export type StageStalenessInput = {
  stageEnteredAt?: string | null;
  measured?: boolean | null;
  stalenessDays?: number | null;
  nextActionAt?: string | null;
  stageName?: string | null;
  now?: Date | string;
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

export type StalledCandidate = {
  stage_code?: string | null;
  stage_name?: string | null;
  stage_entered_at?: string | null;
  stage_entered_at_measured?: boolean | null;
  staleness_days?: number | null;
  next_action_at?: string | null;
};

export function stageStaleness(input?: StageStalenessInput): StageStaleness;
export function stalledInStage<T extends StalledCandidate>(
  opportunities: T[], now?: Date,
): Array<{ opportunity: T; stall: StageStaleness }>;
