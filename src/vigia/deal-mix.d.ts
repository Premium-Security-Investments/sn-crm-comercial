export type DealMixRow = { key: string; label: string; sales: number; salesCount: number; pipeline: number; pipelineCount: number };
export const DEAL_MIX_ROWS: readonly (readonly [string, string])[];
export function dealMixKey(opportunity: unknown): string;
export function dealMix(opportunities?: unknown[], year?: string | number): DealMixRow[];
